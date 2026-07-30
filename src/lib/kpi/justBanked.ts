/**
 * justBanked.ts — pick + describe the most-recently banked run for the Dash
 * "just banked" celebration card.
 *
 * The card celebrates a freshly-completed run and invites the runner to open it.
 * This module is the PURE core: which activity is the newest bank, and how it
 * reads (kind label + the raw distance/time the moment animates). Recency and
 * "have I seen it" live in `useJustBanked`; persistence in `app-lib/bankedCard`.
 *
 * The credited workout kind comes from `resolveQuality(stream_summary.quality,
 * override)` — the same precedence (override ?? matched ?? honest) that weekly
 * credit uses, so the card never disagrees with the gauges.
 *
 * Pure. No IO, no React. Node-tested.
 */
import {
  resolveQuality,
  type QualityOverride,
} from './resolveQuality';
import type { QualitySummary } from '../run/streamSummary';

/**
 * The structural slice of an activity row this module needs — declared locally
 * (not imported from app-lib/queries) so the pure core stays free of the query
 * layer. `ActivityRow` satisfies it structurally, so callers pass rows directly.
 */
export interface BankableActivity {
  id: string;
  distance_meters: number | null;
  moving_time_s: number | null;
  /** UTC ISO instant — the recency + newest-of ordering key. */
  start_date: string | null;
  /** Strava workout_type (1 = race). */
  workout_type: number | null;
  stream_summary: { quality?: QualitySummary | null } | null;
  quality_override?: QualityOverride | null;
}

/**
 * What the celebration actually consumes. Deliberately raw: the surface formats
 * distance/pace itself so it can respect the runner's km preference — this
 * module must not pre-format a `/mi` string on its behalf.
 */
export interface BankedInfo {
  activityId: string;
  /** Short uppercase kind — "TEMPO" / "INTERVALS" / "PROGRESSION" / "LONG RUN" / "RACE" / "RUN". */
  label: string;
  /** Raw run distance (m) — the mileage-ring delta the celebration fills. */
  distanceMeters: number;
  /** Raw moving time (s), unconverted. */
  movingTimeS: number | null;
}

/**
 * Parse a timestamptz to epoch ms, tolerant of the Postgres/PostgREST form
 * `2026-07-15 16:22:59+00` (space separator, short `+00` offset). Hermes'
 * `Date.parse` — unlike V8/JSC — rejects that, so normalise to strict ISO 8601
 * first (space→`T`, `+HHMM`/`+HH` → `+HH:MM`). Returns NaN if still unparseable.
 */
export function toMillis(s: string): number {
  const v = s
    .trim()
    .replace(' ', 'T')
    .replace(/([+-]\d{2})(\d{2})$/, '$1:$2')
    .replace(/([+-]\d{2})$/, '$1:00');
  const t = Date.parse(v);
  return Number.isNaN(t) ? Date.parse(s) : t;
}

/** True while `startIso` falls inside the trailing window (default 48h) from `now`. */
export function isRecentlyBanked(startIso: string, now: number, windowMs = 48 * 60 * 60 * 1000): boolean {
  const t = toMillis(startIso);
  if (Number.isNaN(t)) return false;
  const age = now - t;
  return age >= 0 && age < windowMs;
}

/** The newest real run (distance > 0, dated) by start instant, or null. */
export function pickNewestBanked(acts: readonly BankableActivity[]): BankableActivity | null {
  let best: BankableActivity | null = null;
  for (const a of acts) {
    if ((a.distance_meters ?? 0) <= 0 || !a.start_date) continue;
    if (best == null || a.start_date > (best.start_date ?? '')) best = a;
  }
  return best;
}

/**
 * Describe the banked run for the card. Label priority: detected quality → race
 * → the week's long run → a plain run.
 */
export function describeBanked(a: BankableActivity, longTargetMeters: number): BankedInfo {
  const distanceMeters = a.distance_meters ?? 0;
  const q = a.stream_summary?.quality;
  const reading = q ? resolveQuality(q, a.quality_override) : null;
  const base = { activityId: a.id, distanceMeters, movingTimeS: a.moving_time_s ?? null };

  if (reading && reading.kind !== 'none' && reading.qualityMi > 0.05) {
    return { ...base, label: reading.kind.toUpperCase() };
  }
  if (a.workout_type === 1) return { ...base, label: 'RACE' };
  if (longTargetMeters > 0 && distanceMeters >= longTargetMeters * 0.9) {
    return { ...base, label: 'LONG RUN' };
  }
  return { ...base, label: 'RUN' };
}

/**
 * The week's banked meters BEFORE this run — the value the contract track
 * animates out of.
 *
 * Clamped at zero: a re-ingested run or float drift can make the run's own
 * distance exceed the running total, and a negative start would animate the
 * track backwards out of nowhere.
 */
export function preRunMeters(bankedMeters: number, runMeters: number): number {
  if (!Number.isFinite(bankedMeters)) return 0;
  const run = Number.isFinite(runMeters) ? runMeters : 0;
  return Math.max(0, bankedMeters - run);
}

/**
 * Did THIS run close the week's mileage contract?
 *
 * The single escalation trigger for the full moment (owner's call — quality,
 * long run, and perfect-week deliberately do not escalate, so the full moment
 * stays rare enough to land). Landing exactly on target counts as met, matching
 * how the contract reads everywhere else. A week with no target can never cross.
 */
export function crossedMileageContract(
  preMeters: number,
  bankedMeters: number,
  targetMeters: number,
): boolean {
  if (!(targetMeters > 0)) return false;
  return preMeters < targetMeters && bankedMeters >= targetMeters;
}
