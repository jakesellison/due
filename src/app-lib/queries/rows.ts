import type {
  BestEffortInput,
  RunStreams,
  StravaLap,
  SummaryWeekInput,
  WorkoutStructure,
} from '@/lib';
import type { StreamSummary } from '../../lib/run/streamSummary';
import type { QualityOverride } from '../../lib/kpi/resolveQuality';

// ---- Row shapes (subset of the DB columns we read) -------------------------

export interface PlanRow {
  id: string;
  race_name: string | null;
  race_date: string | null;
  distance_kind: string | null;
  start_date: string | null;
  num_weeks: number | null;
  status: string | null;
  /** Postgres interval, e.g. "02:36:00". */
  goal_time: string | null;
}

export interface PlanWeekRow {
  id: string;
  week_index: number;
  phase: SummaryWeekInput['phase'];
  target_meters: number | null;
  original_target_meters: number | null;
  /** Stored weekly hard-work contract; null only on pre-migration rows. */
  quality_target_meters?: number | null;
  /** Stored continuous long-run contract; null only on pre-migration rows. */
  long_target_meters?: number | null;
  is_recovery: boolean;
}

export interface WorkoutRow {
  id: string;
  week_id: string | null;
  date: string | null;
  type: string | null;
  title: string | null;
  planned_distance_meters: number | null;
  planned_duration_s: number | null;
  structure: WorkoutStructure;
  is_quality: boolean;
  /** Stable hard-work distance for duration-based prescriptions. */
  prescribed_quality_meters?: number | null;
  notes: string | null;
  /**
   * Row insertion instant (timestamptz ISO string). Selected by the plan
   * loaders as the within-date AM/PM ordering key (first row per date = AM
   * run, later rows = PM doubles). Optional: locally-built rows (tests,
   * previews) may omit it.
   */
  created_at?: string | null;
}

export interface ActivityRow {
  id: string;
  source: string;
  source_id: string;
  /** Strava activity name (e.g. "Lunch Run"), when known. */
  name: string | null;
  local_date: string | null;
  distance_meters: number | null;
  moving_time_s: number | null;
  elapsed_time_s: number | null;
  avg_hr: number | null;
  user_note: string | null;
  /** UTC ISO instant of the activity start (time-of-day bucketing). */
  start_date: string | null;
  /** Average temperature (°C), when known (Strava / open-meteo backfill). */
  avg_temp_c: number | null;
  /** Strava-style best-effort segments (jsonb), when present. */
  best_efforts: BestEffortInput[] | null;
  /** Strava workout_type (1 = race for runs), when known. Lean column, not `raw`. */
  workout_type: number | null;
  /** Pre-computed summary (pace curve + early miles) from stream data, when present. */
  stream_summary: StreamSummary | null;
  /** The runner's pinned interpretation for this run (run-detail slider), when set.
   *  Resolved on top of the stored verdict via resolveQuality (override ?? matched ?? honest).
   *  Optional: locally-built rows (manual entries, tests) may omit it. */
  quality_override?: QualityOverride | null;
  /**
   * When the streams enrich attempt COMPLETED (timestamptz ISO string) — set
   * whether or not Strava had streams. Null/absent = enrichment still pending.
   * With `stream_summary` this distinguishes "verdict on its way" from
   * "proven streamless" (see isProvenStreamless). Optional: locally-built
   * rows (manual entries, tests) may omit it.
   */
  enriched_at?: string | null;
  /** Compact columnar time-series (≤200 samples), when present. */
  streams: RunStreams | null;
  /** Simplified GPS polyline as [[lat, lng], ...], when present. */
  route: [number, number][] | null;
  /** Strava-style lap objects (jsonb), when present. */
  laps: StravaLap[] | null;
  /** Max heart rate (bpm), when known. */
  max_hr: number | null;
  /** Strava relative-effort / suffer score, when known. */
  suffer_score: number | null;
  /** Assigned shoe (gear tracking), when any. */
  shoe_id: string | null;
}

export interface ActivePlan {
  plan: PlanRow;
  weeks: PlanWeekRow[];
  workouts: WorkoutRow[];
}
