/**
 * Shared input shapes for the insight derivations.
 *
 * Every insight function is a deterministic transform over plain arrays — no
 * Supabase, no React. The query/hook layer maps DB rows into these plain input
 * shapes and feeds them in; the UI renders the outputs.
 *
 * Conventions: distances in meters, durations in seconds, temperatures in °C,
 * dates are civil 'YYYY-MM-DD' or UTC ISO instants as noted per field.
 */

// ---------------------------------------------------------------------------
// Shared input shapes
// ---------------------------------------------------------------------------

/** A run, reduced to the fields the insight derivations read. */
export interface InsightRun {
  /** Civil 'YYYY-MM-DD' the run is attributed to. */
  localDate: string;
  /** True when this run is an EASY-typed run matched to an easy workout. */
  isEasy: boolean;
  /** Average heart rate (bpm), or null/undefined when unknown. */
  avgHr?: number | null;
  /** Average temperature (°C), or null/undefined when unknown. */
  avgTempC?: number | null;
}

/** One activity's best-effort segments (Strava-style), for the records table. */
export interface InsightActivity {
  /** Stable Due activity id, retained so an evidence row can open its source run. */
  id?: string | null;
  /** Human activity name, when known. */
  name?: string | null;
  /** Strava workout_type (1 = tagged race), when known. */
  workoutType?: number | null;
  /** UTC ISO instant of the activity start (used for time-of-day bucketing). */
  startDate?: string | null;
  bestEfforts?: BestEffortInput[] | null;
}

/** A normalized best-effort entry as persisted in `activities.best_efforts`. */
export interface BestEffortInput {
  name: string;
  distance_m: number;
  elapsed_s: number;
  start_date: string;
}

/** A plan/calendar week's total volume, for rolling-mileage. */
export interface WeekVolume {
  /** Civil 'YYYY-MM-DD' week-start. */
  weekStart: string;
  meters: number;
}

/** A run reduced to an identity + date + distance, for weekly bucketing. */
export interface IdentifiedDistanceRun {
  /** Stable activity id — the dedupe key. */
  id: string;
  /** Civil 'YYYY-MM-DD'. */
  localDate: string;
  /** Run distance in meters. */
  meters: number;
}

/** A run reduced to a date + distance, for daily bucketing. */
export interface DistanceRun {
  /** Civil 'YYYY-MM-DD'. */
  localDate: string;
  /** Run distance in meters. */
  meters: number;
}
