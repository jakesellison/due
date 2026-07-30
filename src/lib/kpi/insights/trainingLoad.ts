/**
 * Training load — the build-vs-overreach read every progress app keeps (Strava
 * Relative Effort, The Outsiders Training Load Ratio, Bevel Cardio Load). From
 * per-activity load scores (Strava relative effort / `suffer_score`) it builds a
 * dense daily load series, then a trailing-7-day ACUTE average and trailing-
 * 28-day CHRONIC average. Their ratio (ACWR) flags the zone: detraining (<0.8),
 * optimal (0.8–1.3), building (1.3–1.5), high (>1.5).
 */

import {
  addDays,
} from '../../time/civil';

/** One activity's load on a civil date ('YYYY-MM-DD'); load null when unknown. */
export interface ActivityLoad {
  date: string;
  load: number | null;
}

export interface TrainingLoadPoint {
  /** Civil date 'YYYY-MM-DD' (one per day across the window, oldest→newest). */
  date: string;
  /** Acute load: trailing-7-day mean daily load. */
  acute: number;
  /** Chronic load: trailing-28-day mean daily load. */
  chronic: number;
  /** Acute:chronic ratio (acute / chronic), or null when chronic is ~0. */
  ratio: number | null;
}

export type LoadZone = 'detraining' | 'optimal' | 'building' | 'high';

export interface TrainingLoadTrend {
  /** Daily acute / chronic / ratio series across the window (oldest→newest). */
  points: TrainingLoadPoint[];
  /** Today's acute (7-day mean daily load). */
  acute: number;
  /** Today's chronic (28-day mean daily load). */
  chronic: number;
  /** Today's acute:chronic ratio, or null when there isn't enough history. */
  ratio: number | null;
  /** Today's zone, derived from the ratio. */
  zone: LoadZone;
  /** Share of window activities that carried a load value (0..1). */
  coverage: number;
}

const ACUTE_DAYS = 7;
const CHRONIC_DAYS = 28;

const HR_REST = 50;
const HR_MAX_DEFAULT = 190;
/** Easy-effort fallback weight (HR-reserve ≈ 0.6) when a run carries no HR. */
const EASY_WEIGHT = 0.6 * Math.exp(1.92 * 0.6);

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Per-activity inputs for a TRIMP load score. */
export interface TrimpInput {
  movingTimeS: number | null;
  avgHr: number | null;
  maxHr: number | null;
  /** Override the resting-HR baseline used for HR-reserve (default {@link HR_REST}). */
  restHr?: number;
  /** Override the max-HR cap used when the activity carries no `maxHr` of its own (default {@link HR_MAX_DEFAULT}). */
  hrMaxDefault?: number;
}

/**
 * Banister-style TRIMP for one activity — minutes on feet × a heart-rate-reserve
 * weight (`HRr · e^(1.92·HRr)`), so both VOLUME (duration) and INTENSITY count.
 * The absolute scale is arbitrary (constants drop out); only relative load
 * matters for the trend + ACWR. Full coverage: a run with no HR still scores by
 * duration at an easy-effort weight (unlike Strava's sparse `suffer_score`).
 *
 * `restHr`/`hrMaxDefault` are optional overrides of the module defaults — every
 * existing caller omits them and gets byte-identical behavior to before these
 * were added (used by `src/lib/strava/derive.ts`'s `hrLoad`, which future-proofs
 * training-load if HR is ever purged as raw Strava Data).
 */
export function trimp({
  movingTimeS,
  avgHr,
  maxHr,
  restHr = HR_REST,
  hrMaxDefault = HR_MAX_DEFAULT,
}: TrimpInput): number | null {
  if (movingTimeS == null || movingTimeS <= 0) return null;
  const minutes = movingTimeS / 60;
  if (avgHr != null && avgHr > 0) {
    const hrMax = maxHr != null && maxHr > avgHr ? maxHr : hrMaxDefault;
    const hrr = clamp((avgHr - restHr) / (hrMax - restHr), 0.2, 1);
    return minutes * hrr * Math.exp(1.92 * hrr);
  }
  return minutes * EASY_WEIGHT;
}

/** Map a ratio to its load zone (ACWR sweet spot 0.8–1.3). */
export function loadZone(ratio: number | null): LoadZone {
  if (ratio == null || ratio < 0.8) return 'detraining';
  if (ratio <= 1.3) return 'optimal';
  if (ratio <= 1.5) return 'building';
  return 'high';
}


/**
 * Build the acute:chronic training-load trend over [windowFrom, today].
 *
 * Loads should span at least ~28 days before `windowFrom` for the earliest
 * chronic average to be fully warmed up; means are left-clamped to whatever
 * history exists, so early points read low until the 28-day window fills.
 *
 * Day boundary: `today` only enters the series once IT has a real logged
 * load. Until then it's an in-progress day, not a rest day — counting its
 * placeholder zero would drag the trailing acute mean down and could assert
 * "Detraining" before the day's run has even posted (the exact artifact a
 * Monday-morning check-in would hit). This mirrors `completedWeekFraction`
 * ("today counts only in your favor," never against) — the series runs
 * through end of yesterday until today posts its own number.
 */
export function trainingLoad(loads: ActivityLoad[], windowFrom: string, today: string): TrainingLoadTrend {
  const known = loads.filter((l) => l.load != null && Number.isFinite(l.load as number));
  const coverage = loads.length > 0 ? known.length / loads.length : 0;

  // Sum per day (multiple activities on one day add up).
  const byDay = new Map<string, number>();
  for (const l of known) byDay.set(l.date, (byDay.get(l.date) ?? 0) + (l.load as number));

  const windowTo = byDay.has(today) ? today : addDays(today, -1);

  // Dense daily load from windowFrom..windowTo (rest days contribute 0).
  const days: { date: string; load: number }[] = [];
  for (let d = windowFrom; d <= windowTo; d = addDays(d, 1)) {
    days.push({ date: d, load: byDay.get(d) ?? 0 });
  }

  const mean = (arr: number[]) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0);
  const points: TrainingLoadPoint[] = days.map((_, i) => {
    const acute = mean(days.slice(Math.max(0, i - ACUTE_DAYS + 1), i + 1).map((x) => x.load));
    const chronic = mean(days.slice(Math.max(0, i - CHRONIC_DAYS + 1), i + 1).map((x) => x.load));
    return { date: days[i]!.date, acute, chronic, ratio: chronic > 0 ? acute / chronic : null };
  });

  const last = points[points.length - 1];
  const acute = last?.acute ?? 0;
  const chronic = last?.chronic ?? 0;
  const ratio = last?.ratio ?? null;
  return { points, acute, chronic, ratio, zone: loadZone(ratio), coverage };
}
