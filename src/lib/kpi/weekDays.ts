/**
 * weekDays.ts — per-day model for the Dash calendar-tabs unit: each Mon→Sun day's
 * strip state PLUS its primary planned workout (structure/type/tone) + completion.
 * Pure. No IO. Node-tested. Composes weekStripDays (state) with the plan workouts.
 */
import {
  weekStripDays,
  type WeekStripDay,
} from './weekStrip';
import {
  prescribedQualityMeters,
} from './prescribedQuality';
import {
  assignMatches,
} from '../match/assign';
import {
  workoutTone,
  type WorkoutTone,
  type BarSeg,
} from '../workout/structureBar';
import type { WorkoutStructure } from '../workout/types';

export interface DayWorkout {
  id: string; type: string | null; title: string | null; isQuality: boolean;
  structure: WorkoutStructure; plannedMeters: number | null;
  prescribedQualityMeters?: number | null;
  /** True when at least one recorded activity was matched to this plan leg. */
  completed: boolean;
  /**
   * Honest per-leg plan outcome. A recorded run can still be short, while an
   * unmatched leg is only missed after its civil date has elapsed.
   */
  outcome: 'planned' | 'met' | 'short' | 'missed';
  actualMeters: number; tone: WorkoutTone;
  /**
   * Activity ids attributed to this workout. On a planned double the
   * distance-aware matcher keeps each recording with its closest plan leg,
   * instead of treating one run as completion of the entire day.
   */
  matchedActivityIds?: string[];
  /**
   * True when this is NOT a tagged quality workout yet its structure embeds hard
   * (quality) work — e.g. a long run with an MP/tempo block. The day-strip pip
   * renders it half type-colour / half quality-pink so a run that's BOTH reads
   * as both. A tagged quality workout stays fully pink (this is false for it).
   * Optional in the type (fixtures omit it); the buildWeekDays path always sets it.
   */
  hasEmbeddedQuality?: boolean;
  /**
   * True when the day's SUCCESS mark (checkmark seal) may render. For
   * non-quality workouts this equals `completed` (distance banked on the day).
   * For QUALITY workouts a distance/day match is NOT success — the seal
   * additionally requires the intrinsic quality verdict (a day activity whose
   * stored `isQuality` is true and is not user-overridden). Pending verdicts
   * (no verdict yet) stay neutral: `completed` still shows the ran mileage,
   * just without the seal. See workoutSealed.
   */
  sealed: boolean;
}
/**
 * A single LOGGED activity on a day — one openable run-detail target. Used to
 * render one tappable row per activity on a completed day (a double/triple, or
 * a dead-watch split into 2 recordings), each routing to that run's detail.
 */
export interface DayActivity {
  id: string;
  distanceMeters: number;
  /** Moving time (s) for this run; null when unknown. Sum across the day's
   *  activities gives the day's actual pace (plan-vs-actual ledger). */
  movingTimeS: number | null;
  /** UTC ISO instant of the activity start (time-of-day bucketing); null when unknown. */
  startDate: string | null;
  /** Precomputed quality verdict (`stream_summary.quality.isQuality`); null = no verdict. */
  qualityDetected: boolean | null;
  /**
   * The run's ACTUAL-shape bar (`stream_summary.quality.actualBar`) — what was
   * really run, positioned by distance. Null on rows written before v5 (the Dash
   * card falls back to the prescription bar then). */
  actualBar: BarSeg[] | null;
}

/** A calendar-tab day: a week-strip day PLUS its planned workout(s) and its
 *  logged activities. (Named CalendarDay to avoid colliding with adapt/propose's
 *  WeekDay.) */
export interface CalendarDay extends WeekStripDay {
  workouts: DayWorkout[];
  primary: DayWorkout | null;
  /** The day's logged activities, sorted by start_date ascending (nulls last). */
  activities: DayActivity[];
}

export interface WeekDaysWorkout {
  id: string; date: string | null; type: string | null; title: string | null;
  is_quality: boolean; structure: WorkoutStructure; planned_distance_meters: number | null;
  prescribed_quality_meters?: number | null;
}
export interface WeekDaysActivity {
  id: string; local_date: string | null; distance_meters: number | null;
  /** Moving time (s); optional. Feeds the day's actual pace. */
  moving_time_s?: number | null;
  /** UTC ISO instant of the activity start (time-of-day bucketing); optional. */
  start_date?: string | null;
  /** Precomputed quality verdict (`stream_summary.quality.isQuality`).
   *  Null/absent = no stored verdict (enrichment pending or streamless). */
  qualityDetected?: boolean | null;
  /** The run's ACTUAL-shape bar (`stream_summary.quality.actualBar`).
   *  Null/absent = no stored bar (pre-v5, enrichment pending, or streamless). */
  actualBar?: BarSeg[] | null;
}
export interface WeekDaysInput {
  workouts: WeekDaysWorkout[]; activities: WeekDaysActivity[]; today: string; weekStartDate?: string;
  /** Activity ids the user tap-to-undid (suppressed quality detections). */
  qualityOverrides?: ReadonlySet<string>;
}

/**
 * Whether a day workout's SUCCESS seal may render. Non-quality workouts keep
 * distance-based completion. Quality workouts require the intrinsic verdict:
 * some activity on the day with a stored `isQuality === true` verdict that the
 * user has not overridden — a distance/day match alone is neutral (ran
 * mileage, no seal), and a pending verdict is neutral too, never failed.
 * Pure; node-tested.
 */
export function workoutSealed(
  isQuality: boolean,
  completed: boolean,
  dayActivities: WeekDaysActivity[],
  overrides?: ReadonlySet<string>,
): boolean {
  if (!completed) return false;
  if (!isQuality) return true;
  return dayActivities.some(
    (a) => a.qualityDetected === true && !(overrides?.has(a.id) ?? false),
  );
}

function pickPrimary(ws: DayWorkout[]): DayWorkout | null {
  if (ws.length === 0) return null;
  const quality = ws.filter((w) => w.isQuality || (w.type ?? '').toLowerCase() === 'race');
  const pool = quality.length ? quality : ws;
  return pool.reduce((a, b) => ((b.plannedMeters ?? 0) > (a.plannedMeters ?? 0) ? b : a));
}

/** Explicit "(2nd)/(3rd)" titles outrank database tie order for planned doubles. */
function plannedOrdinal(title: string | null): number {
  if (!title) return 1;
  const match = title.match(/\((\d+)(?:st|nd|rd|th)\)/i);
  return match ? Number(match[1]) : 1;
}

// Keep the week ledger aligned with run detail: GPS/rounding drift inside 0.1 mi
// still meets a distance prescription; a material deficit remains short.
const DISTANCE_TOLERANCE_METERS = 161;

export function buildWeekDays(input: WeekDaysInput): CalendarDay[] {
  const { workouts, activities, today, weekStartDate, qualityOverrides } = input;
  const matchableWorkouts = workouts.filter(
    (w): w is WeekDaysWorkout & { date: string } =>
      w.date != null && (w.type ?? '').toLowerCase() !== 'rest',
  );
  const matchableActivities = activities.filter(
    (a): a is WeekDaysActivity & { local_date: string } => a.local_date != null,
  );
  const assignments = assignMatches(
    matchableWorkouts.map((w) => ({
      workoutId: w.id,
      localDate: w.date,
      isQuality: w.is_quality,
      plannedMeters: w.planned_distance_meters ?? 0,
    })),
    matchableActivities.map((a) => ({
      activityId: a.id,
      localDate: a.local_date,
      distanceMeters: a.distance_meters ?? 0,
    })),
  );
  const strip = weekStripDays(
    workouts.filter((w) => w.date != null).map((w) => ({ id: w.id, date: w.date!, type: w.type ?? '', plannedMeters: w.planned_distance_meters ?? 0, isQuality: w.is_quality })),
    activities.filter((a) => a.local_date != null).map((a) => ({ id: a.id, localDate: a.local_date!, distanceMeters: a.distance_meters ?? 0 })),
    today,
    { weekStartDate },
  );
  return strip.map((day) => {
    const dayWos = workouts
      .map((workout, sourceIndex) => ({ workout, sourceIndex }))
      .filter(({ workout }) => workout.date === day.localDate && (workout.type ?? '').toLowerCase() !== 'rest')
      .sort((a, b) => plannedOrdinal(a.workout.title) - plannedOrdinal(b.workout.title) || a.sourceIndex - b.sourceIndex)
      .map(({ workout }) => workout);
    const dayActs = activities.filter((a) => a.local_date === day.localDate);
    const ws: DayWorkout[] = dayWos.map((w) => {
      const rollup = assignments.byWorkout[w.id];
      const matchedActivityIds = rollup?.activityIds ?? [];
      const matchedActivities = dayActs.filter((a) => matchedActivityIds.includes(a.id));
      const completed = rollup != null;
      const plannedMeters = w.planned_distance_meters ?? 0;
      const outcome: DayWorkout['outcome'] = completed
        ? plannedMeters <= 0 || (rollup?.totalMeters ?? 0) >= plannedMeters - DISTANCE_TOLERANCE_METERS
          ? 'met'
          : 'short'
        : (w.date as string) < today
          ? 'missed'
          : 'planned';
      return {
        id: w.id, type: w.type, title: w.title, isQuality: w.is_quality,
        structure: w.structure ?? [], plannedMeters: w.planned_distance_meters,
        prescribedQualityMeters: w.prescribed_quality_meters,
        completed,
        outcome,
        actualMeters: rollup?.totalMeters ?? 0,
        matchedActivityIds,
        sealed: workoutSealed(w.is_quality, outcome === 'met', matchedActivities, qualityOverrides),
        tone: workoutTone({ type: w.type, is_quality: w.is_quality, structure: w.structure ?? [] }),
        // A non-quality workout carrying embedded hard work (long run w/ MP block).
        hasEmbeddedQuality: !w.is_quality && prescribedQualityMeters(w.structure ?? []) > 0,
      };
    });
    // One openable row per logged activity, sorted by start_date ascending
    // (nulls last) so a double/triple reads morning→evening.
    const acts: DayActivity[] = dayActs
      .map((a) => ({
        id: a.id,
        distanceMeters: a.distance_meters ?? 0,
        movingTimeS: a.moving_time_s ?? null,
        startDate: a.start_date ?? null,
        qualityDetected: a.qualityDetected ?? null,
        actualBar: a.actualBar ?? null,
      }))
      .sort((a, b) => {
        if (a.startDate == null && b.startDate == null) return 0;
        if (a.startDate == null) return 1;
        if (b.startDate == null) return -1;
        return a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0;
      });
    return { ...day, workouts: ws, primary: pickPrimary(ws), activities: acts };
  });
}
