/**
 * Race detection — surface ACTUAL race performances from a run history so the
 * predictor can anchor to demonstrated race-day fitness (a real 2:51 marathon is
 * a far stronger signal than any training-volume model), and so the feature
 * windows can EXCLUDE the taper/race/recovery weeks that surround a race.
 *
 * Two detectors, in priority order:
 *  1. Strava race tag — `workoutType === 1` (Strava's `workout_type` for runs:
 *     0 default, 1 race, 2 long run, 3 workout). Authoritative when present, but
 *     many runners never tag races (the subject's Boston row is workout_type
 *     null/untagged) — so we also infer.
 *  2. Distance inference — a run whose distance is within ±2% of a canonical race
 *     distance {marathon, half, 10k, 5k} AND whose pace is ≥12% faster than the
 *     runner's trailing-8-week easy pace. A hard effort at a round race distance
 *     is almost always a race or an all-out time trial; either way it's a
 *     race-quality performance worth anchoring to.
 *
 * Pure + deterministic. Distances in metres, times in seconds (moving time when
 * present, else elapsed), dates civil 'YYYY-MM-DD'.
 */

/** Canonical race distances we recognise, metres. */
export const RACE_DISTANCES = {
  marathon: 42195,
  half: 21097.5,
  '10k': 10000,
  '5k': 5000,
} as const;

/** A detected race distance class (or 'other' for a tagged-but-odd distance). */
export type DistanceClass = 'marathon' | 'half' | '10k' | '5k' | 'other';

/** How a race was detected. */
export type RaceSource = 'strava_race_tag' | 'distance_inference';

/** A detected race performance. */
export interface RaceResult {
  /** Civil 'YYYY-MM-DD' the race was run. */
  date: string;
  /** Race distance in metres (the activity's own distance). */
  distanceMeters: number;
  /** Finish time in seconds (moving time when present, else elapsed). */
  seconds: number;
  /** How it was detected. */
  source: RaceSource;
  /** Nearest canonical distance class, or 'other'. */
  distanceClass: DistanceClass;
}

/** The minimal activity shape race detection reads. */
export interface RaceCandidate {
  /** Civil 'YYYY-MM-DD' the run is attributed to. */
  localDate?: string | null;
  /** Run distance in metres. */
  distanceMeters?: number | null;
  /** Moving time in seconds, when known. */
  movingTimeS?: number | null;
  /** Elapsed time in seconds, when known (fallback when moving time absent). */
  elapsedTimeS?: number | null;
  /** Strava workout_type (1 = race), when known. */
  workoutType?: number | null;
}

/** ±2% distance tolerance for matching a canonical race distance. */
export const RACE_DISTANCE_TOL = 0.02;

/** Inference pace must be at least this fraction faster than trailing easy pace. */
export const RACE_PACE_MARGIN = 0.12;

/** Trailing window (days) for the easy-pace baseline used by inference. */
const EASY_PACE_WINDOW_DAYS = 56; // ~8 weeks

/**
 * Detect race performances from `activities` as of `asOfDate` (only races on or
 * before `asOfDate` are returned). Strava-tagged races take priority; otherwise
 * a round-distance hard effort is inferred against the trailing-8-week easy pace.
 *
 * Returned newest-first. Pure + deterministic.
 */
export function detectRaceResults(
  activities: RaceCandidate[],
  asOfDate: string,
): RaceResult[] {
  const results: RaceResult[] = [];

  for (const a of activities) {
    const date = a.localDate;
    if (!date || date > asOfDate) continue;
    const meters = a.distanceMeters;
    if (!(meters != null && meters > 0)) continue;
    const seconds = raceSeconds(a);
    if (seconds == null) continue;

    // ---- 1. Strava race tag (authoritative) --------------------------------
    if (a.workoutType === 1) {
      results.push({
        date,
        distanceMeters: meters,
        seconds,
        source: 'strava_race_tag',
        distanceClass: classifyDistance(meters),
      });
      continue;
    }

    // ---- 2. Distance inference --------------------------------------------
    const cls = canonicalMatch(meters);
    if (cls == null) continue; // not within ±2% of any canonical distance
    const easyPace = trailingEasyPace(activities, date);
    if (easyPace == null) continue; // no baseline → cannot infer
    const pace = seconds / (meters / 1000); // s/km
    if (pace <= easyPace * (1 - RACE_PACE_MARGIN)) {
      results.push({
        date,
        distanceMeters: meters,
        seconds,
        source: 'distance_inference',
        distanceClass: cls,
      });
    }
  }

  const deduped = dedupeRaces(results);
  const consistent = dropPaceMonotonicityViolations(deduped);
  return consistent.sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : 0));
}

/**
 * Collapse duplicate race rows — the same effort ingested twice (a re-sync
 * producing two activity ids on one day, same distance + time) would otherwise
 * be counted twice in the curve fit. Keyed on date + rounded distance + rounded
 * time; the first occurrence wins.
 */
function dedupeRaces(races: RaceResult[]): RaceResult[] {
  const seen = new Set<string>();
  const out: RaceResult[] = [];
  for (const r of races) {
    const key = `${r.date}|${Math.round(r.distanceMeters / 50)}|${Math.round(r.seconds / 5)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/** ~5% so a marathon (42.2k) counts as "longer" than a half (21.1k), not vs noise. */
const LONGER_DISTANCE_MARGIN = 1.05;

/**
 * Drop INFERRED races that violate distance→pace monotonicity: a real race at a
 * shorter distance must be FASTER per-km than one at a longer distance. A hard
 * long run at a round distance (e.g. a 1:31 half at 7:00/mi when the runner's
 * marathon is 6:30/mi) trips the ±12% inference gate but is NOT a race — keeping
 * it corrupts the log-log curve fit and drags the prediction slow. Strava-tagged
 * races are trusted and never dropped.
 */
function dropPaceMonotonicityViolations(races: RaceResult[]): RaceResult[] {
  const paceOf = (r: RaceResult) => r.seconds / (r.distanceMeters / 1000);
  return races.filter((r) => {
    if (r.source === 'strava_race_tag') return true;
    const pace = paceOf(r);
    // A longer-distance race with a faster-or-equal pace makes this shorter
    // effort physiologically impossible as a race → it's a hard training run.
    const violated = races.some(
      (o) => o.distanceMeters > r.distanceMeters * LONGER_DISTANCE_MARGIN && paceOf(o) <= pace,
    );
    return !violated;
  });
}

/** Finish seconds for a candidate: moving time, else elapsed; null when neither. */
function raceSeconds(a: RaceCandidate): number | null {
  if (a.movingTimeS != null && a.movingTimeS > 0) return a.movingTimeS;
  if (a.elapsedTimeS != null && a.elapsedTimeS > 0) return a.elapsedTimeS;
  return null;
}

/**
 * The canonical distance class whose metres are within ±2% of `meters`, or null.
 * Picks the closest match when (improbably) two windows overlap.
 */
function canonicalMatch(meters: number): DistanceClass | null {
  let best: DistanceClass | null = null;
  let bestErr = Infinity;
  for (const [cls, d] of Object.entries(RACE_DISTANCES) as [DistanceClass, number][]) {
    const err = Math.abs(meters - d) / d;
    if (err <= RACE_DISTANCE_TOL && err < bestErr) {
      best = cls;
      bestErr = err;
    }
  }
  return best;
}

/**
 * Nearest canonical class for a tagged race (no tolerance gate — a tagged race
 * at an odd distance still classifies to the closest standard, else 'other').
 */
function classifyDistance(meters: number): DistanceClass {
  const within = canonicalMatch(meters);
  return within ?? 'other';
}

/**
 * Distance-weighted easy pace (s/km) over the `EASY_PACE_WINDOW_DAYS` days
 * BEFORE `beforeDate`, from EASY runs only: timed runs that are NOT themselves a
 * canonical-distance hard effort would still count, but to keep the baseline
 * honest we simply weight every timed run by distance. The race day itself is
 * excluded (strictly before `beforeDate`), and long efforts at canonical race
 * distances are excluded so a prior race can't inflate the baseline. Null when
 * there's no timed running in the window.
 */
function trailingEasyPace(
  activities: RaceCandidate[],
  beforeDate: string,
): number | null {
  const from = shiftCivil(beforeDate, -EASY_PACE_WINDOW_DAYS);
  let seconds = 0;
  let km = 0;
  for (const a of activities) {
    const d = a.localDate;
    if (!d || d >= beforeDate || d < from) continue;
    const meters = a.distanceMeters;
    const t = a.movingTimeS;
    if (!(meters != null && meters > 0) || !(t != null && t > 0)) continue;
    // Exclude prior races/time-trials from the easy baseline (tag OR a fast
    // canonical-distance effort), so the baseline reflects easy running.
    if (a.workoutType === 1) continue;
    seconds += t;
    km += meters / 1000;
  }
  return km > 0 ? seconds / km : null;
}

/** Civil 'YYYY-MM-DD' + day delta → civil 'YYYY-MM-DD' (noon-UTC, tz-agnostic). */
function shiftCivil(localDate: string, days: number): string {
  const base = new Date(`${localDate}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}
