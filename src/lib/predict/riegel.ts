/**
 * Riegel's endurance model — a pure, node-tested time-scaling formula plus a
 * best-recent-effort picker over Strava-style `best_efforts`.
 *
 * Riegel, P. (1981). "Athletic records and human endurance." American
 * Scientist, 69(3), 285–290. Predicts the time for a target distance from a
 * known time at another distance via a power law:
 *
 *     T2 = T1 · (d2 / d1) ^ 1.06
 *
 * The fatigue exponent 1.06 is Riegel's pooled fit across distance running; it
 * is conservative for the marathon (it extrapolates a short effort upward
 * assuming a typical endurance fall-off). Longer source efforts extrapolate
 * less and are more predictive of the marathon, so the picker prefers the
 * LONGEST recent best effort available.
 *
 * Conventions: distances in metres, times in seconds, dates ISO/civil.
 */

import type { InsightActivity } from '../kpi/insights';
import {
  METERS_PER_MILE,
} from '../units';

/** Riegel's pooled distance-running fatigue exponent. */
export const RIEGEL_EXPONENT = 1.06;

/** A recent best effort to extrapolate from. */
export interface RecentEffort {
  /** Effort distance in metres (e.g. 10000 for a 10k). */
  meters: number;
  /** Elapsed time of the effort in seconds. */
  seconds: number;
  /** ISO/civil date the effort occurred (for recency gating + the basis line). */
  date: string;
  /** Canonical label of the distance, e.g. "10k" (for the basis line). */
  label: string;
}

/**
 * Riegel-scale a known effort to a target distance: T2 = T1·(d2/d1)^exponent.
 * Pure formula — see the module header for the citation.
 */
export function riegelSeconds(
  effort: { meters: number; seconds: number },
  targetMeters: number,
  exponent = RIEGEL_EXPONENT,
): number {
  if (!(effort.meters > 0) || !(effort.seconds > 0) || !(targetMeters > 0)) {
    return NaN;
  }
  return effort.seconds * Math.pow(targetMeters / effort.meters, exponent);
}

/**
 * The canonical best-effort distances we will extrapolate FROM, longest first.
 * Longer efforts extrapolate less to the marathon, so they are preferred. The
 * 1k is intentionally excluded — a 3-minute effort scaled to 42 km via the
 * power law is too noisy to anchor a marathon prediction.
 *
 * `aliases` are matched CASE-INSENSITIVELY against the stored Strava effort name
 * (Strava sends "10K"/"5K" with an uppercase K and "1 mile" lowercased — the
 * ingest layer persists the raw name verbatim, so we normalize here). `meters`
 * is a fallback only; the picker prefers each effort's own `distance_m`.
 */
const PREFERRED_DISTANCES: { label: string; aliases: string[]; meters: number }[] = [
  { label: '10k', aliases: ['10k'], meters: 10000 },
  { label: '5k', aliases: ['5k'], meters: 5000 },
  { label: '1 mile', aliases: ['1 mile', '1mi', 'mile'], meters: METERS_PER_MILE },
];

/** Normalize a Strava effort name for case-insensitive matching. */
function normName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * The single best recent effort to anchor a Riegel prediction, as of `asOfDate`
 * over the preceding `maxAgeDays` (default 90). Among the qualifying best
 * efforts within the window it prefers the LONGEST canonical distance present
 * (10k > 5k > 1mi — longer is more predictive of the marathon), and within a
 * distance the FASTEST (lowest elapsed) effort. Returns null when no qualifying
 * effort exists. Pure + deterministic.
 *
 * Reads the same `best_efforts` shape the records table reads, so it stays in
 * lockstep with the canonical distance set.
 */
export function bestRecentEffort(
  activities: InsightActivity[],
  asOfDate: string,
  maxAgeDays = 90,
): RecentEffort | null {
  const from = shiftCivil(asOfDate, -maxAgeDays);
  const to = asOfDate;

  // Map each accepted alias → its preferred-distance label (for the lookup).
  const labelByAlias = new Map<string, string>();
  for (const d of PREFERRED_DISTANCES) {
    for (const a of d.aliases) labelByAlias.set(a, d.label);
  }

  // Fastest qualifying effort per preferred label, within the window. We keep
  // the effort's OWN stored distance (`distance_m`) so Riegel scales from the
  // true distance rather than a nominal constant.
  const fastest = new Map<string, { seconds: number; date: string; meters: number }>();
  for (const a of activities) {
    for (const e of a.bestEfforts ?? []) {
      const label = labelByAlias.get(normName(e.name));
      if (!label) continue;
      if (e.elapsed_s == null || !Number.isFinite(e.elapsed_s) || e.elapsed_s <= 0) continue;
      // best_efforts carry their own start_date (the day that effort was set).
      const day = civilDay(e.start_date);
      if (day == null || day < from || day > to) continue;
      const meters =
        e.distance_m != null && Number.isFinite(e.distance_m) && e.distance_m > 0
          ? e.distance_m
          : (PREFERRED_DISTANCES.find((d) => d.label === label)?.meters ?? 0);
      const cur = fastest.get(label);
      if (!cur || e.elapsed_s < cur.seconds) {
        fastest.set(label, { seconds: e.elapsed_s, date: e.start_date, meters });
      }
    }
  }

  // Prefer the longest predictive distance present.
  for (const d of PREFERRED_DISTANCES) {
    const hit = fastest.get(d.label);
    if (hit && hit.meters > 0) {
      return {
        meters: hit.meters,
        seconds: hit.seconds,
        date: hit.date,
        label: d.label,
      };
    }
  }
  return null;
}

/** ISO/civil → civil 'YYYY-MM-DD' (date-only), or null when unparseable. */
function civilDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  // best_efforts.start_date is typically an ISO instant; take the date head.
  const head = iso.length >= 10 ? iso.slice(0, 10) : iso;
  return /^\d{4}-\d{2}-\d{2}$/.test(head) ? head : null;
}

/** Civil 'YYYY-MM-DD' + day delta → civil 'YYYY-MM-DD' (noon-UTC, tz-agnostic). */
function shiftCivil(localDate: string, days: number): string {
  const base = new Date(`${localDate}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}
