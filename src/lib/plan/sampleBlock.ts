import {
  generateRamp,
  type GeneratedWeek,
} from './generate';
import {
  milesToMeters,
  METERS_PER_MILE,
} from '../units';
import {
  addDays,
} from '../time/civil';
import type { WorkoutStructure } from '../workout/types';
import {
  activityPaceCurve,
  activityPaceDurationCurve,
} from '../run/paceCurve';
import {
  earlyMiles,
} from '../kpi/insights/comparableMile';
import {
  detectQuality,
} from '../kpi/qualityDetect';
import {
  estimateQualityFloor,
} from '../kpi/qualityFloor';
import {
  FALLBACK_EASY_BASELINE_SEC_PER_MI,
} from '../kpi/easyBaseline';
import type { StreamSummary } from '../run/streamSummary';
import {
  deriveSupportingContractTargets,
} from './supportingContracts';

/**
 * Pure plan-shaping for the DEV sample plan (Jake's Chicago block).
 *
 * This builds the in-memory arrays — plan weeks, a modest set of workouts for
 * the first few weeks, and a handful of fake past activities — that the seed
 * wrapper (`src/app-lib/seed.ts`) then INSERTS into Supabase. Keeping the shape
 * logic here (no supabase, no React) lets it be unit-tested under the `node`
 * jest project.
 *
 * DEV SEED — remove when real Strava/import data flows.
 */

export interface SampleWeek {
  weekIndex: number;
  phase: GeneratedWeek['phase'];
  targetMeters: number;
  originalTargetMeters: number;
  qualityTargetMeters: number;
  longTargetMeters: number;
  isRecovery: boolean;
  /** 'YYYY-MM-DD' Monday this plan week starts on. */
  weekStart: string;
}

export type SampleWorkoutType = 'easy' | 'long' | 'quality' | 'rest' | 'cross';

export interface SampleWorkout {
  /** Index into the weeks array this workout belongs to. */
  weekIndex: number;
  date: string; // 'YYYY-MM-DD'
  type: SampleWorkoutType;
  title: string;
  plannedDistanceMeters: number;
  structure: WorkoutStructure;
  isQuality: boolean;
  notes?: string;
}

/** A synthetic best-effort segment on a seeded activity (shape per migration 0002). */
export interface SampleBestEffort {
  name: string;
  distance_m: number;
  elapsed_s: number;
  start_date: string;
}

/**
 * Compact columnar activity streams (shape per migration 0003). All numeric
 * arrays share the same length and index alignment as `t`. Mirrors the
 * `ActivityStreams` shape in `src/server/streams.ts` — kept structural here so
 * the pure lib has no dependency on the server tree.
 */
export interface SampleStreams {
  /** Seconds from activity start. */
  t: number[];
  /** Cumulative distance, meters. */
  d: number[];
  /** Velocity, meters/second. */
  v: number[];
  /** Heart rate, bpm. */
  hr: (number | null)[];
  /** Altitude, meters (or null when none synthesized). */
  alt: number[] | null;
}

/** A synthetic route as `[[lat, lng], ...]` (shape per migration 0003, <=120 pts). */
export type SampleRoute = [number, number][];

export interface SampleActivity {
  /** Stable seed id, e.g. 'seed-12'. */
  sourceId: string;
  localDate: string;
  distanceMeters: number;
  avgHr?: number;
  /** Average temperature (°C) for this run — varied 8..28 across the block. */
  avgTempC?: number;
  /** Moving time in seconds (set on ALL seeded activities so pace math works). */
  movingTimeS?: number;
  /**
   * UTC ISO start instant. Local clock time is distributed realistically
   * (mostly 6–7am and 12–1pm, some 6pm) in the user's tz; see SEED_TZ.
   */
  startDate?: string;
  /** Synthetic, slowly-improving best efforts on a sprinkling of activities. */
  bestEfforts?: SampleBestEffort[];
  /** Synthetic per-activity columnar streams (pace/HR/alt over time). */
  streams?: SampleStreams;
  /** Synthetic plausible loop route (<=120 points). */
  route?: SampleRoute;
  /**
   * Precomputed `stream_summary` (pace curves + early miles + quality verdict),
   * derived from `streams` via the same pure functions the real ingest pipeline
   * uses (`computeSampleStreamSummary`) — so seeded/dev accounts can demo
   * quality on Dash instead of reading a permanently-empty tile.
   */
  streamSummary?: StreamSummary | null;
}

export interface SampleBlock {
  weeks: SampleWeek[];
  workouts: SampleWorkout[];
  activities: SampleActivity[];
}

export interface SampleBlockOpts {
  /** 'YYYY-MM-DD' Monday the block starts on. */
  startDate: string;
  /** 'YYYY-MM-DD' today, used to decide which activities are "in the past". */
  today: string;
  /** How many leading weeks get planned workouts (default 5). */
  workoutWeeks?: number;
  /**
   * How many trailing weeks (relative to today) get fake activities (default 6).
   * The Trends screen needs several weeks of history for the HR aerobic-drift
   * trend and the trailing 4-week rolling-mileage line to render meaningfully.
   */
  activityWeeks?: number;
}

const RAMP = {
  weeks: 18,
  startWeeklyMeters: milesToMeters(40),
  peakWeeklyMeters: milesToMeters(72),
  downWeekEvery: 4,
  taperWeeks: 3,
} as const;

const round100 = (m: number): number => Math.round(m / 100) * 100;

/**
 * Timezone the seeded activities' wall-clock start times are expressed in.
 * Matches the dev user's default tz so `localDate` stays consistent with the
 * UTC `start_date` we emit. (America/Chicago = CDT, UTC-5, in late spring.)
 */
const SEED_TZ = 'America/Chicago';
/** UTC offset (hours) for Chicago in late-spring CDT. start_date uses this. */
const SEED_TZ_OFFSET_HOURS = 5; // CDT = UTC-5

/**
 * Deterministic [0,1) pseudo-random from an integer seed (mulberry-ish hash).
 * Keeps the seed reproducible (tests assert determinism) while giving varied,
 * non-patterned noise per activity.
 */
function rng(seed: number): number {
  let t = (seed * 2654435761) >>> 0;
  t = (t ^ (t >>> 15)) >>> 0;
  t = (t * 2246822519) >>> 0;
  t = (t ^ (t >>> 13)) >>> 0;
  t = (t * 3266489917) >>> 0;
  t = (t ^ (t >>> 16)) >>> 0;
  return t / 4294967296;
}

/** Symmetric noise in [-mag, +mag] from a seed. */
function noisePM(seed: number, mag: number): number {
  return (rng(seed) * 2 - 1) * mag;
}

/**
 * Local wall-clock start (hour, minute) for a seeded run, distributed
 * realistically: ~50% 6–7am, ~35% lunch 12–1pm, ~15% evening 6pm. Long runs
 * (Sunday) skew earlier-morning. Deterministic per seed.
 */
function startClock(seed: number, role: SampleWorkoutType): { hour: number; minute: number } {
  const minute = Math.floor(rng(seed * 31 + 7) * 60);
  if (role === 'long') {
    // Long runs: 6–8am.
    return { hour: 6 + Math.floor(rng(seed * 17 + 3) * 3), minute };
  }
  const r = rng(seed * 53 + 11);
  if (r < 0.5) return { hour: 6 + Math.floor(rng(seed * 13) * 2), minute }; // 6 or 7am
  if (r < 0.85) return { hour: 12, minute }; // lunch
  return { hour: 18, minute }; // evening
}

/**
 * UTC ISO start instant for a local civil date + local clock time in SEED_TZ.
 * Adds the (positive) UTC offset hours to convert local -> UTC.
 */
function utcStart(localDate: string, hour: number, minute: number): string {
  const base = new Date(`${localDate}T00:00:00Z`);
  base.setUTCHours(hour + SEED_TZ_OFFSET_HOURS, minute, 0, 0);
  return base.toISOString();
}

/**
 * Seconds-per-meter pace for a role, blended to plausible values for a
 * 2:36-goal marathoner: easy ~8:00–8:30/mi, quality ~6:10/mi reps blended into
 * the whole-session average (~6:45/mi), long ~7:40/mi. Returns sec per meter.
 */
function paceSecPerMeter(role: SampleWorkoutType, seed: number): number {
  let secPerMile: number;
  if (role === 'quality') secPerMile = 405 + noisePM(seed * 3 + 1, 10); // ~6:45/mi blended
  else if (role === 'long') secPerMile = 460 + noisePM(seed * 5 + 2, 8); // ~7:40/mi
  else secPerMile = 495 + noisePM(seed * 7 + 3, 12); // ~8:15/mi easy
  return secPerMile / METERS_PER_MILE;
}

/**
 * Average temperature (°C) for a run — varied 8..28 across the block. We vary it
 * smoothly-ish by week with per-run noise so the HR-vs-temp scatter spans the
 * range. Deterministic per (weekIdx, seed).
 */
function tempForRun(weekIdx: number, seed: number): number {
  // A slow seasonal warming across weeks plus diurnal/run noise.
  const seasonal = 12 + weekIdx * 1.6; // weeks push the baseline up
  const t = seasonal + noisePM(seed * 11 + 5, 6);
  return Math.round(Math.max(8, Math.min(28, t)) * 10) / 10;
}

/**
 * Easy-run base HR with a gentle DOWNWARD aerobic-adaptation drift across weeks
 * (~-1.5 bpm/week), plus a positive temp coupling (+~0.4 bpm/°C) and noise.
 * Quality ~165±4, long ~148±4. Returns an integer bpm.
 *
 * @param weeksIn  how many weeks into the activity window this run is (0-based)
 */
function hrForRun(
  role: SampleWorkoutType,
  weeksIn: number,
  tempC: number,
  seed: number,
): number {
  const tempCoupling = 0.4 * (tempC - 18); // centered ~18°C so mid temps ~neutral
  let hr: number;
  if (role === 'quality') {
    hr = 165 + noisePM(seed * 19 + 1, 4) + tempCoupling * 0.5;
  } else if (role === 'long') {
    hr = 148 + noisePM(seed * 23 + 2, 4) + tempCoupling;
  } else {
    // Easy: 142 baseline, drift down ~1.5 bpm/week, ±5 noise, +temp coupling.
    hr = 142 - 1.5 * weeksIn + noisePM(seed * 29 + 3, 5) + tempCoupling;
  }
  return Math.round(hr);
}

/**
 * Synthetic, slowly-improving best efforts for ~6 sprinkled activities. The
 * `progress` param (0 oldest -> 1 newest) interpolates the times to show
 * improvement (e.g. 5k 18:40 -> 18:05). Shape per migration 0002.
 */
function makeBestEfforts(progress: number, startIso: string): SampleBestEffort[] {
  const lerp = (from: number, to: number) => Math.round(from + (to - from) * progress);
  return [
    { name: '1k', distance_m: 1000, elapsed_s: lerp(212, 205), start_date: startIso },
    { name: '1 mile', distance_m: 1609, elapsed_s: lerp(328, 319), start_date: startIso }, // 5:28->5:19
    { name: '5k', distance_m: 5000, elapsed_s: lerp(1120, 1085), start_date: startIso }, // 18:40->18:05
    { name: '10k', distance_m: 10000, elapsed_s: lerp(2330, 2295), start_date: startIso }, // 38:50->38:15
  ];
}

// ============================================================================
// Synthetic per-activity STREAMS + route generators (pure, deterministic).
//
// All accept an integer `seed` (the activity's seedN) and are fully
// reproducible: same seed -> same output. No Math.random, no module-level
// state. Targets ~SAMPLE_COUNT samples; `d` is the running integral of `v`
// and total duration matches `movingTimeS`.
// ============================================================================

/** Number of samples per synthesized stream (<=200, per migration 0003). */
const SAMPLE_COUNT = 180;
const THRESHOLD_SEC_PER_MILE = 365; // 6:05/mi work pace for the quality reps
const REC_JOG_S = 90; // recovery jog duration between reps

/**
 * Build cumulative distance `d` from a per-sample velocity `v` and the sample
 * times `t` (trapezoidal integral), then rescale so the final distance hits
 * `distanceMeters` exactly (keeps d/v consistency tight regardless of noise).
 */
function integrateDistance(t: number[], v: number[], distanceMeters: number): number[] {
  const d: number[] = new Array(t.length);
  d[0] = 0;
  for (let i = 1; i < t.length; i++) {
    const dt = t[i]! - t[i - 1]!;
    d[i] = d[i - 1]! + ((v[i]! + v[i - 1]!) / 2) * dt;
  }
  const raw = d[d.length - 1]!;
  if (raw > 0) {
    const scale = distanceMeters / raw;
    for (let i = 0; i < d.length; i++) d[i] = Math.round(d[i]! * scale * 100) / 100;
  }
  return d;
}

/** Synthesize a gently-rolling altitude profile (meters). Deterministic. */
function altitudeProfile(t: number[], seed: number): number[] {
  const base = 180 + noisePM(seed * 41 + 9, 8);
  return t.map((sec, i) => {
    const slow = 12 * Math.sin((sec / (t[t.length - 1]! || 1)) * Math.PI * 2);
    const wobble = noisePM(seed * 47 + i, 1.5);
    return Math.round((base + slow + wobble) * 10) / 10;
  });
}

/**
 * Easy/long run streams: steady velocity near the role's target pace with small
 * noise, HR starting ~10 bpm below avg and rising to ~+5 over the duration
 * (cardiac drift). Long runs add a mild late pace fade (last quarter +3%).
 */
function makeSteadyStreams(
  role: SampleWorkoutType,
  distanceMeters: number,
  movingTimeS: number,
  avgHr: number,
  seed: number,
): SampleStreams {
  const n = SAMPLE_COUNT;
  const t: number[] = [];
  const v: number[] = [];
  const hr: (number | null)[] = [];
  const baseV = distanceMeters / movingTimeS; // m/s average
  for (let i = 0; i < n; i++) {
    const frac = i / (n - 1);
    t.push(Math.round(frac * movingTimeS));
    // Long-run late fade: slow down up to 3% in the final quarter.
    let fade = 1;
    if (role === 'long' && frac > 0.75) fade = 1 + 0.03 * ((frac - 0.75) / 0.25);
    const noise = noisePM(seed * 101 + i, 0.03); // ±3% pace noise
    v.push(Math.max(0.5, (baseV / fade) * (1 + noise)));
    // HR: starts ~10 below avg, rises to ~+5 over the run (drift), ±2 noise.
    const drift = -10 + 15 * frac;
    hr.push(Math.round(avgHr + drift + noisePM(seed * 103 + i, 2)));
  }
  const d = integrateDistance(t, v, distanceMeters);
  return { t, d, v, hr, alt: altitudeProfile(t, seed) };
}

/**
 * Quality (4×1mi @ threshold) streams: easy-pace warmup, then 4 work blocks at
 * ~6:05/mi with 90s jog recoveries, then a cooldown. Velocity is square-wave-ish
 * between work and recovery; HR lags pace transitions by ~30s. The whole session
 * is normalized so `d` integrates to `distanceMeters` and `t` spans `movingTimeS`.
 */
function makeQualityStreams(
  distanceMeters: number,
  movingTimeS: number,
  avgHr: number,
  seed: number,
): SampleStreams {
  const workV = METERS_PER_MILE / THRESHOLD_SEC_PER_MILE; // ~6:05/mi in m/s
  const easyV = METERS_PER_MILE / (495 + noisePM(seed * 7 + 3, 12)); // ~8:15/mi
  const recV = METERS_PER_MILE / 540; // ~9:00/mi jog
  const repS = THRESHOLD_SEC_PER_MILE; // ~one mile at work pace
  const reps = 4;
  // Allocate warmup/cooldown to fill the remaining time around the work set.
  const workSet = reps * repS + (reps - 1) * REC_JOG_S;
  const remaining = Math.max(120, movingTimeS - workSet);
  const warmupS = Math.round(remaining * 0.6);
  const cooldownS = Math.max(0, remaining - warmupS);

  // Build a per-second target-velocity profile, then sample to SAMPLE_COUNT.
  // We also track a "target HR" per phase that the actual HR chases with lag.
  const segs: { dur: number; v: number; hrTarget: number }[] = [];
  segs.push({ dur: warmupS, v: easyV, hrTarget: avgHr - 18 });
  for (let r = 0; r < reps; r++) {
    segs.push({ dur: repS, v: workV, hrTarget: avgHr + 14 });
    if (r < reps - 1) segs.push({ dur: REC_JOG_S, v: recV, hrTarget: avgHr - 6 });
  }
  segs.push({ dur: cooldownS, v: easyV, hrTarget: avgHr - 16 });

  const total = segs.reduce((s, seg) => s + seg.dur, 0);
  // Per-second target velocity + target HR.
  const vAt = (sec: number): number => {
    let acc = 0;
    for (const seg of segs) {
      if (sec < acc + seg.dur) return seg.v;
      acc += seg.dur;
    }
    return segs[segs.length - 1]!.v;
  };
  const hrTargetAt = (sec: number): number => {
    let acc = 0;
    for (const seg of segs) {
      if (sec < acc + seg.dur) return seg.hrTarget;
      acc += seg.dur;
    }
    return segs[segs.length - 1]!.hrTarget;
  };

  const n = SAMPLE_COUNT;
  const t: number[] = [];
  const v: number[] = [];
  const hr: (number | null)[] = [];
  const HR_LAG_S = 30; // HR responds ~30s after a pace transition
  for (let i = 0; i < n; i++) {
    const sec = Math.round((i / (n - 1)) * total);
    t.push(sec);
    v.push(Math.max(0.5, vAt(sec) * (1 + noisePM(seed * 131 + i, 0.02))));
    // HR chases the target from ~HR_LAG_S earlier (lagging the pace change).
    const lagged = hrTargetAt(Math.max(0, sec - HR_LAG_S));
    hr.push(Math.round(lagged + noisePM(seed * 137 + i, 2)));
  }
  const d = integrateDistance(t, v, distanceMeters);
  return { t, d, v, hr, alt: altitudeProfile(t, seed) };
}

/** Dispatch to the right stream generator for a role. PURE / deterministic. */
export function makeStreams(
  role: SampleWorkoutType,
  distanceMeters: number,
  movingTimeS: number,
  avgHr: number,
  seed: number,
): SampleStreams {
  if (role === 'quality') {
    return makeQualityStreams(distanceMeters, movingTimeS, avgHr, seed);
  }
  return makeSteadyStreams(role, distanceMeters, movingTimeS, avgHr, seed);
}

/**
 * Precompute `stream_summary` for a seeded activity's synthetic `streams` —
 * pace curve, duration curve, early-mile stats, and a real quality verdict —
 * using the SAME pure functions the ingest pipeline runs on real Strava data
 * (`activityPaceCurve` / `activityPaceDurationCurve` / `earlyMiles` /
 * `detectQuality` + `estimateQualityFloor`). Without this, seeded dev/demo
 * accounts write `streams` but never `stream_summary`, so `detectWeekQuality`
 * (which reads `activity.stream_summary?.quality`) always sees a flat 0/N tile
 * even though the seeded quality sessions have real interval structure.
 *
 * The moderate-effort floor is derived from the SAME easy-pace baseline the
 * seeded easy/long streams are generated around (`FALLBACK_EASY_BASELINE_SEC_PER_MI`,
 * 8:15/mi) — no HR model, so quality falls back to GAP (altitude is always
 * synthesized) — matching a real runner with streams but no HR-derived zones.
 */
function computeSampleStreamSummary(streams: SampleStreams): StreamSummary | null {
  if (!streams.t || streams.t.length < 2) return null;
  const runStream = { t: streams.t, d: streams.d, v: streams.v, hr: streams.hr, alt: streams.alt ?? null };
  const easyBaselineSecPerMi = FALLBACK_EASY_BASELINE_SEC_PER_MI;
  const floor = estimateQualityFloor({ easyBaselineSecPerMi });
  const detect = detectQuality(
    { d: streams.d, v: streams.v, t: streams.t, ...(streams.alt ? { altitude: streams.alt } : {}) },
    floor,
  );
  return {
    pace_curve: activityPaceCurve(runStream),
    pace_duration_curve: activityPaceDurationCurve(runStream),
    early_miles: earlyMiles(runStream),
    quality: { ...detect, floor: { ...floor, easyBaselineSecPerMi } },
  };
}

/** Center of the synthetic routes (Chicago-ish), and Earth radius constants. */
const ROUTE_CENTER: [number, number] = [41.88, -87.63];
const M_PER_DEG_LAT = 111_320;

/**
 * Generate a plausible closed loop route around Chicago, with a radius scaled to
 * the run distance and a per-run rotation + jitter so each run looks distinct.
 * Returns <=120 `[lat, lng]` points; first ≈ last so the loop visually closes.
 * PURE / deterministic per seed.
 */
export function makeRoute(distanceMeters: number, seed: number): SampleRoute {
  const pts = Math.min(120, 96);
  // A loop whose perimeter ~ the run distance: perimeter ≈ 2πr -> r in meters.
  const radiusM = Math.max(300, distanceMeters / (2 * Math.PI));
  const rot = rng(seed * 211 + 5) * Math.PI * 2; // per-run rotation
  const [lat0, lng0] = ROUTE_CENTER;
  const mPerDegLng = M_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180);
  const route: SampleRoute = [];
  for (let i = 0; i < pts; i++) {
    const theta = (i / pts) * Math.PI * 2;
    // Gently non-circular: vary the radius with angle + small per-point jitter.
    const wobble = 1 + 0.18 * Math.sin(theta * 3 + rot) + noisePM(seed * 311 + i, 0.04);
    const r = radiusM * wobble;
    const dxM = r * Math.cos(theta + rot);
    const dyM = r * Math.sin(theta + rot);
    const lat = lat0 + dyM / M_PER_DEG_LAT;
    const lng = lng0 + dxM / mPerDegLng;
    route.push([Math.round(lat * 1e6) / 1e6, Math.round(lng * 1e6) / 1e6]);
  }
  // Close the loop: append the first point so first ≈ last.
  route.push([route[0]![0], route[0]![1]]);
  return route;
}

/** A small structured quality workout (threshold reps) for a week's quality day. */
function qualityStructure(repMeters: number): WorkoutStructure {
  return [
    { kind: 'warmup', target: { by: 'distance', distance_m: 2400 } },
    {
      kind: 'repeat',
      sets: 4,
      children: [
        { kind: 'interval', target: { by: 'distance', distance_m: repMeters }, note: 'threshold' },
        { kind: 'recovery', target: { by: 'time', duration_s: 90 } },
      ],
    },
    { kind: 'cooldown', target: { by: 'distance', distance_m: 1600 } },
  ];
}

function qualityNotes(): string {
  return '12 mi total with 4 × 1 mi at threshold. Keep the first reps controlled, jog 90 sec between, and close steady.';
}

/**
 * A weekly micro-cycle of NON-rest day offsets (Mon=0..Sun=6) with their role.
 * Tue is the quality day; Sun is the long run; Mon is rest (omitted).
 */
const WEEK_PATTERN: { offset: number; role: SampleWorkoutType }[] = [
  { offset: 1, role: 'quality' }, // Tue
  { offset: 2, role: 'easy' }, // Wed
  { offset: 3, role: 'easy' }, // Thu
  { offset: 4, role: 'easy' }, // Fri
  { offset: 5, role: 'cross' }, // Sat (cross / easy)
  { offset: 6, role: 'long' }, // Sun
];

export function buildSampleBlock(opts: SampleBlockOpts): SampleBlock {
  const { startDate, today } = opts;
  const workoutWeeks = opts.workoutWeeks ?? 5;
  const activityWeeks = opts.activityWeeks ?? 6;

  const ramp = generateRamp(RAMP);

  const weeks: SampleWeek[] = ramp.map((w, i) => ({
    weekIndex: w.weekIndex,
    phase: w.phase,
    targetMeters: w.targetMeters,
    originalTargetMeters: w.originalTargetMeters,
    qualityTargetMeters: 0,
    longTargetMeters: 0,
    isRecovery: w.isRecovery,
    weekStart: addDays(startDate, i * 7),
  }));

  // Workouts for the first `workoutWeeks` weeks. Distance per role derives from
  // the week target so volume scales with the ramp. Long ~32%, easy ~16%,
  // quality ~14%, cross ~10% of the weekly target.
  const workouts: SampleWorkout[] = [];
  for (let wi = 0; wi < Math.min(workoutWeeks, weeks.length); wi++) {
    const week = weeks[wi]!;
    for (const { offset, role } of WEEK_PATTERN) {
      const date = addDays(week.weekStart, offset);
      if (role === 'long') {
        workouts.push({
          weekIndex: week.weekIndex,
          date,
          type: 'long',
          title: 'Long run',
          plannedDistanceMeters: round100(week.targetMeters * 0.32),
          structure: [],
          isQuality: false,
        });
      } else if (role === 'quality') {
        workouts.push({
          weekIndex: week.weekIndex,
          date,
          type: 'quality',
          title: '4 × 1mi @ threshold',
          plannedDistanceMeters: round100(week.targetMeters * 0.16),
          structure: qualityStructure(1600),
          isQuality: true,
          notes: qualityNotes(),
        });
      } else if (role === 'cross') {
        workouts.push({
          weekIndex: week.weekIndex,
          date,
          type: 'easy',
          title: 'Easy / recovery',
          plannedDistanceMeters: round100(week.targetMeters * 0.1),
          structure: [],
          isQuality: false,
        });
      } else {
        workouts.push({
          weekIndex: week.weekIndex,
          date,
          type: 'easy',
          title: 'Easy run',
          plannedDistanceMeters: round100(week.targetMeters * 0.16),
          structure: [],
          isQuality: false,
        });
      }
    }
  }

  // Capture the supporting weekly contracts from the original allocation.
  // Later planner edits may move/remove these rows, but the week-level targets
  // inserted by the seed remain unchanged.
  for (const week of weeks) {
    const targets = deriveSupportingContractTargets(
      workouts
        .filter((workout) => workout.weekIndex === week.weekIndex)
        .map((workout) => ({
          type: workout.type,
          isQuality: workout.isQuality,
          plannedDistanceMeters: workout.plannedDistanceMeters,
          structure: workout.structure,
        })),
    );
    week.qualityTargetMeters = targets.qualityTargetMeters;
    week.longTargetMeters = targets.longTargetMeters;
  }

  // Fake past activities: for the trailing `activityWeeks` weeks up to today,
  // emit a run on most non-rest days near the planned easy/long distance, with
  // some HR. Only dates strictly on/before today get an activity.
  const activities: SampleActivity[] = [];
  let seedN = 1;
  // Find which plan weeks overlap the trailing window. We anchor on the week
  // containing `today` and walk back `activityWeeks` weeks.
  const todayWeekIdx = weeks.findIndex(
    (w) => today >= w.weekStart && today < addDays(w.weekStart, 7),
  );
  const lastWeekIdx = todayWeekIdx >= 0 ? todayWeekIdx : weeks.length - 1;
  const firstWeekIdx = Math.max(0, lastWeekIdx - (activityWeeks - 1));

  for (let wi = firstWeekIdx; wi <= lastWeekIdx; wi++) {
    const week = weeks[wi];
    if (!week) continue;
    // The CURRENT (in-progress) week is seeded as a genuine shortfall so the
    // Dash has a real adaptation to propose: the runner has under-run the early
    // part of the week (~58% of plan) and is meaningfully behind the pace line.
    // Past weeks stay realistic (near plan, ±6% human noise).
    const isCurrentWeek = todayWeekIdx >= 0 && wi === lastWeekIdx;
    for (const { offset, role } of WEEK_PATTERN) {
      // Skip Saturday occasionally to look human (every other week).
      if (role === 'cross' && wi % 2 === 0) continue;
      const date = addDays(week.weekStart, offset);
      if (date > today) continue;
      const planned =
        role === 'long'
          ? week.targetMeters * 0.32
          : role === 'quality'
            ? week.targetMeters * 0.16
            : role === 'cross'
              ? week.targetMeters * 0.1
              : week.targetMeters * 0.16;
      // Past weeks: ±6% human noise. Current week: a real shortfall (~58%).
      const noise = isCurrentWeek ? 0.58 : 1 + (((seedN * 37) % 13) - 6) / 100;
      const distanceMeters = round100(planned * noise);

      // weeksIn = 0 at the oldest activity week -> increases newer; drives the
      // downward easy-HR aerobic-adaptation drift.
      const weeksIn = wi - firstWeekIdx;

      const tempC = tempForRun(weeksIn, seedN);
      const avgHr = hrForRun(role, weeksIn, tempC, seedN);
      // moving_time from a plausible pace for the role (set on ALL activities).
      const movingTimeS = Math.round(distanceMeters * paceSecPerMeter(role, seedN));
      const { hour, minute } = startClock(seedN, role);
      const startDate = utcStart(date, hour, minute);

      const streams = makeStreams(role, distanceMeters, movingTimeS, avgHr, seedN);
      activities.push({
        sourceId: `seed-${seedN}`,
        localDate: date,
        distanceMeters,
        avgHr,
        avgTempC: tempC,
        movingTimeS,
        startDate,
        streams,
        route: makeRoute(distanceMeters, seedN),
        streamSummary: computeSampleStreamSummary(streams),
      });
      seedN += 1;
    }
  }

  // Sprinkle synthetic, slowly-improving best efforts across ~6 activities
  // spanning the window (every Nth activity), so the records table is populated
  // and shows improvement oldest -> newest.
  const BEST_EFFORT_COUNT = 6;
  if (activities.length > 0) {
    const step = Math.max(1, Math.floor(activities.length / BEST_EFFORT_COUNT));
    let placed = 0;
    for (let i = 0; i < activities.length && placed < BEST_EFFORT_COUNT; i += step) {
      const a = activities[i]!;
      const progress = activities.length > 1 ? i / (activities.length - 1) : 1;
      a.bestEfforts = makeBestEfforts(progress, a.startDate ?? `${a.localDate}T12:00:00Z`);
      placed += 1;
    }
  }

  return { weeks, workouts, activities };
}

export const SAMPLE_PLAN_META = {
  raceName: 'Chicago 2026',
  distanceKind: 'marathon' as const,
  raceDate: '2026-10-11',
  goalTime: '02:36:00',
  numWeeks: RAMP.weeks,
  createdVia: 'generated' as const,
  status: 'active' as const,
};
