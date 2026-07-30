/**
 * qualityCredit.ts — Quality-session credit derivation + AsyncStorage undo.
 *
 * Reads the PRECOMPUTED per-activity quality verdict (`stream_summary.quality`,
 * written server-side at ingest) for each activity in a week, credits the week
 * with a detected quality session when any passes, and wires in an
 * AsyncStorage override so the user can tap-to-undo a false positive. Pattern
 * mirrors the dismissal helpers in `adapt.ts`.
 *
 * Spec: docs/superpowers/specs/2026-06-18-quality-autodetect-design.md §3 + §4
 */

import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  matchPlannedQuality,
  meetsSufficiencyGate,
  METERS_PER_MILE,
  prescribedQualityMeters,
  type QualityDetect,
} from '@/lib';
import type { WorkoutStructure } from '@/lib';
import { resolveQuality } from '@/lib/kpi/resolveQuality';

import { useActivePlan, useActivities, type DateRange } from './queries';
import type { ActivityRow } from './queries';

// ── Re-exports ───────────────────────────────────────────────────────────────

export {
  computeEasyBaselineSecPerMi,
  FALLBACK_EASY_BASELINE_SEC_PER_MI,
} from '@/lib';

// ── AsyncStorage keys ─────────────────────────────────────────────────────────

function overrideKey(activityId: string): string {
  return `quality-detect-override-${activityId}`;
}

/**
 * Persist a "this wasn't a quality session" correction for one activity.
 * Suppresses auto-credit for that run until the override is cleared.
 */
export async function setQualityOverride(activityId: string): Promise<void> {
  await AsyncStorage.setItem(overrideKey(activityId), '1');
}

/** Read the override for a single activity. */
export async function getQualityOverride(activityId: string): Promise<boolean> {
  const v = await AsyncStorage.getItem(overrideKey(activityId));
  return v === '1';
}

/**
 * Batch-read overrides for a list of activity IDs.
 * Returns the subset of IDs that have been overridden.
 */
export async function readQualityOverrides(activityIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  await Promise.all(
    activityIds.map(async (id) => {
      const v = await AsyncStorage.getItem(overrideKey(id));
      if (v === '1') out.add(id);
    }),
  );
  return out;
}

// ── Streams-missing fallback gating ──────────────────────────────────────────

/**
 * True when enrichment has ATTEMPTED this activity and Strava had no streams:
 * `enriched_at` is stamped (attempt completed) and no `stream_summary` was
 * written (the summary is computed exactly when streams arrive, so its absence
 * on an enriched row proves the streams are null). While enrichment is still
 * pending (`enriched_at` null/absent) this is FALSE — a verdict is on its way
 * and the row must not be treated as streamless.
 */
export function isProvenStreamless(
  a: Pick<ActivityRow, 'enriched_at' | 'stream_summary'>,
): boolean {
  return a.enriched_at != null && a.stream_summary == null;
}

/**
 * A streamless run may be credited as the quality session only when its
 * whole-run average pace is clearly HARDER than easy — at least this many
 * s/mi faster than the runner's easy baseline. Without streams we can't detect
 * reps, but "ran on the quality day" must never be a binary session tag: an
 * easy 8:35/mi run on a threshold day is not the workout. A real streamless
 * quality session (reps + warmup/jog/cooldown) still averages well under easy.
 */
export const QUALITY_FALLBACK_HARD_MARGIN_S = 60;

/**
 * Distance-based quality credit for a week ONLY when it cannot be judged by
 * effort: quality is HR/effort-detected, never a binary "ran the session day"
 * tag — so crediting the prescribed distance because the quality day was run
 * is allowed only for activities whose streams are PROVEN unavailable
 * (`isProvenStreamless`) AND whose average pace is plausibly a quality effort
 * (≥ `QUALITY_FALLBACK_HARD_MARGIN_S` faster than easy baseline). Rows still
 * awaiting enrichment contribute nothing (their verdict will credit when it
 * lands), and verdict-bearing rows are judged by `detectWeekQuality` alone.
 *
 * Returns the prescribed quality meters when such an activity ran on the
 * quality day, else 0. Pure.
 */
export function qualityDayFallbackMeters(
  weekActivities: Pick<
    ActivityRow,
    'local_date' | 'enriched_at' | 'stream_summary' | 'moving_time_s' | 'distance_meters'
  >[],
  qualityDayDate: string | null,
  prescribedMeters: number,
  easyBaselineSecPerMi: number,
): number {
  if (qualityDayDate == null || prescribedMeters <= 0 || easyBaselineSecPerMi <= 0) return 0;
  const hardAvgCeil = easyBaselineSecPerMi - QUALITY_FALLBACK_HARD_MARGIN_S;
  const hardStreamlessRan = weekActivities.some((a) => {
    if (a.local_date !== qualityDayDate || !isProvenStreamless(a)) return false;
    const mt = a.moving_time_s ?? 0;
    const dm = a.distance_meters ?? 0;
    if (mt <= 0 || dm <= 0) return false;
    const avgPaceSecPerMi = mt / (dm / METERS_PER_MILE);
    return avgPaceSecPerMi <= hardAvgCeil;
  });
  return hardStreamlessRan ? prescribedMeters : 0;
}

// ── Per-week detection ────────────────────────────────────────────────────────

export interface WeekQualityDetectResult {
  /** True when at least one non-overridden activity in the week detects as quality. */
  qualityDetected: boolean;
  /** ID of the best detected-quality activity (null when none). */
  bestActivityId: string | null;
  /** Full result of detectQuality for the best activity. */
  detectResult: QualityDetect | null;
  /** Matched planned-workout recognition string (null when not matched or no planned quality). */
  matchNote: string | null;
  /** Detected hard-running distance (meters) of the best quality run this week
   *  (0 when none) — the numerator of the Dash "X / Y mi" quality tile, surfaced
   *  even when below the gate. Pace-invariant: faster reps don't shrink it. */
  detectedQualityMeters: number;
  /** Prescribed quality distance (meters) for the week's planned quality workout
   *  (0 when none planned) — the denominator. */
  prescribedQualityMeters: number;
}

/**
 * Synchronously detect whether any activity in a week qualifies as a quality
 * session, reading the PRECOMPUTED verdict off each activity's
 * `stream_summary.quality` (written server-side at ingest — list rows no
 * longer carry raw streams, so this can't recompute from scratch). Picks the
 * first activity whose verdict is quality and is not overridden; optionally
 * matches it against the planned quality workout's structure to produce a
 * recognition note.
 *
 * Pure (no IO) — suitable for use inside a useMemo.
 *
 * @param weekActivities     All ActivityRow instances in the target week.
 * @param weekQualityWorkout The planned quality workout for the week (if any).
 * @param overrides          Set of overridden activity IDs (suppressed runs).
 */
export function detectWeekQuality(
  weekActivities: ActivityRow[],
  weekQualityWorkout: {
    id: string;
    structure: WorkoutStructure;
    plannedDistanceMeters?: number | null;
    prescribedQualityMeters?: number | null;
  } | null,
  overrides: Set<string>,
): WeekQualityDetectResult {
  let bestActivityId: string | null = null;
  let bestDetect: QualityDetect | null = null;

  // Prescribed quality distance for the week (the tile denominator) — computed
  // regardless of whether anything was detected, so "0 / 8 mi" reads correctly.
  const prescribedMeters = weekQualityWorkout
    ? weekQualityWorkout.prescribedQualityMeters
      ?? prescribedQualityMeters(
          weekQualityWorkout.structure,
          weekQualityWorkout.plannedDistanceMeters ?? undefined,
        )
    : 0;

  // "Best" = the quality verdict carrying the MOST quality distance — never
  // just the first in date order. A time-path verdict with zero interval
  // meters (an HR-threshold long run) must not shadow the week's real
  // interval session and read the gate against 0 m (May 12 incident).
  for (const activity of weekActivities) {
    if (overrides.has(activity.id)) continue;
    const q = activity.stream_summary?.quality;
    if (!q?.isQuality) continue;
    const meters = q.qualityDistanceMeters ?? 0;
    if (!bestDetect || meters > (bestDetect.qualityDistanceMeters ?? 0)) {
      bestDetect = q;
      bestActivityId = activity.id;
    }
  }

  const detectedMeters = bestDetect?.qualityDistanceMeters ?? 0;

  if (!bestDetect || !bestActivityId) {
    return { qualityDetected: false, bestActivityId: null, detectResult: null, matchNote: null, detectedQualityMeters: detectedMeters, prescribedQualityMeters: prescribedMeters };
  }

  // ── Sufficiency gate ───────────────────────────────────────────────────────
  // When a planned quality workout exists, credit only when the detected hard
  // DISTANCE meets ≥ 60% of the prescribed hard distance — pace-invariant, so
  // running the prescribed reps faster never turns a completed session into a miss.
  if (weekQualityWorkout) {
    if (!meetsSufficiencyGate(detectedMeters, prescribedMeters)) {
      return { qualityDetected: false, bestActivityId: null, detectResult: bestDetect, matchNote: null, detectedQualityMeters: detectedMeters, prescribedQualityMeters: prescribedMeters };
    }
  }

  let matchNote: string | null = null;
  if (
    weekQualityWorkout &&
    Array.isArray(weekQualityWorkout.structure) &&
    weekQualityWorkout.structure.length > 0
  ) {
    const { note } = matchPlannedQuality(bestDetect, weekQualityWorkout.structure);
    matchNote = note;
  }

  return { qualityDetected: true, bestActivityId, detectResult: bestDetect, matchNote, detectedQualityMeters: detectedMeters, prescribedQualityMeters: prescribedMeters };
}

// ── Blended week quality (quality banks wherever it appears) ──────────────────

export interface WeekQualityBlend {
  /** Σ prescribed hard-miles across ALL of the week's planned workouts — the
   *  tagged interval/tempo session PLUS embedded MP/tempo blocks inside long or
   *  easy runs. Meters. The quality-goal denominator. */
  prescribedMeters: number;
  /** Σ detected hard-running distance across ALL non-overridden week activities
   *  carrying a quality verdict (not just the single best). Meters. The
   *  quality-goal numerator. */
  detectedMeters: number;
}

/**
 * Blend embedded quality into the week goal: quality is distance, not sessions,
 * so it banks wherever it appears. Unlike `detectWeekQuality` (which picks the
 * single best session for the seal + match note), this SUMS the prescribed
 * hard-miles of every planned workout and the detected hard-miles of every
 * logged activity — so a long run with an MP block contributes its hard miles
 * to the quality goal while its full distance still counts toward the long /
 * mileage goals (different goals → not double-counting).
 *
 * Per workout, pass `plannedTotalMeters` ONLY for the tagged quality session
 * (where an unstructured plan may still need `prescribedQualityMeters`' 0.6×total
 * fallback); pass null for easy/long runs so their non-hard distance never
 * inflates quality — only genuine hard segments (MP/tempo/interval) count.
 *
 * Pure (no IO) — suitable for use inside a useMemo.
 */
export function blendWeekQuality(
  weekWorkouts: {
    structure: WorkoutStructure;
    plannedTotalMeters: number | null;
    prescribedQualityMeters?: number | null;
  }[],
  weekActivities: Pick<ActivityRow, 'id' | 'stream_summary' | 'quality_override'>[],
  overrides: Set<string>,
): WeekQualityBlend {
  let prescribedMeters = 0;
  for (const w of weekWorkouts) {
    prescribedMeters += w.prescribedQualityMeters
      ?? prescribedQualityMeters(w.structure ?? [], w.plannedTotalMeters ?? undefined);
  }
  let detectedMeters = 0;
  for (const a of weekActivities) {
    if (overrides.has(a.id)) continue;
    const q = a.stream_summary?.quality;
    if (!q) continue;
    const resolved = resolveQuality(q, a.quality_override);
    if (resolved.kind !== 'none') detectedMeters += resolved.qualityMi * METERS_PER_MILE;
  }
  return { prescribedMeters, detectedMeters };
}

// ── Single-activity detection (for run-detail chip) ───────────────────────────

export interface ActivityQualityResult {
  loading: boolean;
  /** True when the activity detects as quality AND is not overridden. */
  qualityDetected: boolean;
  /** Full detectQuality result, or null. */
  detectResult: QualityDetect | null;
  /** Override status (true = user has undone this detection). */
  overridden: boolean;
  /** Whether this matches a planned quality workout. */
  matchNote: string | null;
}

/**
 * Detect quality for a single activity row (for the run-detail quality chip).
 * Reads the PRECOMPUTED verdict off `activity.stream_summary?.quality` (written
 * server-side at ingest) — the SAME verdict Dash reads via `detectWeekQuality`,
 * so run detail and Dash can never disagree. Reads the AsyncStorage override
 * asynchronously. The optional `plannedStructure` enables plan matching.
 *
 * @param activity         The activity to inspect (reads .stream_summary.quality).
 * @param plannedStructure Optional planned quality workout structure to match against.
 */
export function useActivityQualityDetect(
  activity: ActivityRow | null,
  plannedStructure?: WorkoutStructure | null,
): ActivityQualityResult {
  const activityId = activity?.id ?? null;
  const stored = activity?.stream_summary?.quality ?? null;
  const columnOverride = activity?.quality_override ?? null;

  // The runner's pinned interpretation (run-detail slider) is the authority:
  // resolve the stored verdict through it (override ?? matched ?? honest) so the
  // chip agrees with the run-detail section. The legacy AsyncStorage binary undo
  // is still honored as a suppress-only fallback (older undos predate the column).
  const resolved = stored ? resolveQuality(stored, columnOverride) : null;
  const detect = useMemo<QualityDetect | null>(() => {
    if (!stored || !resolved) return stored;
    return {
      ...stored,
      kind: resolved.kind,
      isQuality: resolved.kind !== 'none',
      summary: resolved.summary,
      qualityDistanceMeters: resolved.qualityMi * METERS_PER_MILE,
    };
  }, [stored, resolved]);

  const resolvedIsQuality = (resolved?.kind ?? 'none') !== 'none';
  const overrideQ = useQuery<boolean>({
    queryKey: ['quality-override', activityId],
    enabled: !!activityId && resolvedIsQuality,
    queryFn: () => getQualityOverride(activityId as string),
    staleTime: 0,
  });

  const overridden = overrideQ.data === true || columnOverride?.choice === 'none';
  const qualityDetected = resolvedIsQuality && overrideQ.data !== true;

  const matchNote = useMemo<string | null>(() => {
    if (!qualityDetected || !detect) return null;
    if (!plannedStructure || !Array.isArray(plannedStructure) || plannedStructure.length === 0) return null;
    return matchPlannedQuality(detect, plannedStructure).note;
  }, [qualityDetected, detect, plannedStructure]);

  return {
    loading: overrideQ.isLoading,
    qualityDetected,
    detectResult: detect,
    overridden,
    matchNote,
  };
}

/**
 * Bound tap-to-undo setter for the run-detail quality chip: persists the
 * override, optimistically flips the cached result (so the chip disappears
 * without waiting on the AsyncStorage round-trip), then invalidates every
 * override query scheme that reads it — the singular per-activity key
 * `useActivityQualityDetect` uses, the plural per-week key
 * `useWeekQualityDetect` / Dash use, AND `quality-overrides-adapt`
 * (`useCurrentWeekAdaptations` in adapt.ts) — so the Dash adaptation tray
 * can't disagree with the gauge after an undo (PM#3).
 */
export function useSetQualityOverride(activityId: string | null): () => Promise<void> {
  const qc = useQueryClient();
  return useCallback(async () => {
    if (!activityId) return;
    qc.setQueryData(['quality-override', activityId], true);
    await setQualityOverride(activityId);
    await qc.invalidateQueries({
      predicate: (q) =>
        q.queryKey[0] === 'quality-override' ||
        q.queryKey[0] === 'quality-overrides' ||
        q.queryKey[0] === 'quality-overrides-adapt',
    });
  }, [qc, activityId]);
}

// ── Week-window hook ─────────────────────────────────────────────────────────

export interface WeekQualityHookResult {
  loading: boolean;
  qualityDetected: boolean;
  bestActivityId: string | null;
  detectResult: QualityDetect | null;
  matchNote: string | null;
}

/**
 * Detect quality for a specific week window.
 *
 * Loads plan workouts (to locate the week's quality workout), loads
 * activities for the target date range (each already carrying its
 * precomputed `stream_summary.quality` verdict), reads AsyncStorage
 * overrides, and returns the `detectWeekQuality` result.
 *
 * Used by the run-detail quality chip (app/run/[id].tsx).
 *
 * @param userId     Supabase user id (null → skip loading).
 * @param weekStart  Inclusive start of the target week (YYYY-MM-DD).
 * @param weekEnd    Inclusive end of the target week (YYYY-MM-DD).
 */
export function useWeekQualityDetect(
  userId: string | null,
  weekStart: string | null,
  weekEnd: string | null,
): WeekQualityHookResult {
  const planQ = useActivePlan(userId);

  // Activities for just the target week.
  const weekRange: DateRange | null = useMemo(() => {
    if (!weekStart || !weekEnd) return null;
    return { from: weekStart, to: weekEnd };
  }, [weekStart, weekEnd]);

  const weekActivitiesQ = useActivities(userId, weekRange);
  const weekActivities = weekActivitiesQ.data ?? [];

  // Locate the quality workout for this week.
  const weekQualityWorkout = useMemo(() => {
    const workouts = planQ.data?.workouts ?? [];
    if (!weekStart || !weekEnd) return null;
    const qWo = workouts.find(
      (w) => w.is_quality && w.date != null && w.date >= weekStart && w.date <= weekEnd,
    );
    return qWo
      ? {
          id: qWo.id,
          structure: qWo.structure,
          plannedDistanceMeters: qWo.planned_distance_meters,
        }
      : null;
  }, [planQ.data, weekStart, weekEnd]);

  // Read overrides for all activities in the week.
  const activityIds = useMemo(() => weekActivities.map((a) => a.id), [weekActivities]);

  const overridesQ = useQuery<Set<string>>({
    queryKey: ['quality-overrides', activityIds.join(',')],
    enabled: activityIds.length > 0,
    staleTime: 0,
    queryFn: () => readQualityOverrides(activityIds),
  });
  const overrides = overridesQ.data ?? new Set<string>();

  // Pure detection.
  const result = useMemo(
    () => detectWeekQuality(weekActivities, weekQualityWorkout, overrides),
    [weekActivities, weekQualityWorkout, overrides],
  );

  const loading = planQ.isLoading || weekActivitiesQ.isLoading;

  return {
    loading,
    qualityDetected: result.qualityDetected,
    bestActivityId: result.bestActivityId,
    detectResult: result.detectResult,
    matchNote: result.matchNote,
  };
}
