import { useMemo } from 'react';

import { weekElapsedFraction, type WeeklyBar } from '@/lib';

import { WEEK_START } from './internal';
import { usePlanView, type PlanDay, type PlanWeekSection, type UnplannedRun } from './planView';

// ---- Week detail -----------------------------------------------------------

export interface WeekDetail {
  loading: boolean;
  error: Error | null;
  /** The plan week's index (1-based), echoing the requested id. */
  weekIndex: number | null;
  phase: WeeklyBar['phase'] | null;
  isRecovery: boolean;
  /** Derived bar (target/actual/band/isCurrent/isFuture) for this week. */
  bar: WeeklyBar | null;
  /** Fraction of the week elapsed by end of `today` (current week only). */
  elapsedFraction: number;
  /** Day rows for this week (same shape the Plan list uses; rest excluded). */
  days: PlanDay[];
  /** The full week including rest rows (real ids) — for the editor. */
  editableDays?: PlanDay[];
  /** Unplanned runs in this week (doubles / extra days). */
  unplanned: UnplannedRun[];
  /** 'YYYY-MM-DD' Monday this plan week starts (null until loaded). */
  weekStart: string | null;
  today: string;
  /** The immutable original target before any adaptations (null if unknown). */
  originalTargetMeters?: number | null;
  /** Stored supporting contracts. Null only for legacy rows. */
  qualityTargetMeters?: number | null;
  longTargetMeters?: number | null;
  /** plan_weeks.id — used by saveWeekEdits to target the right week. */
  weekId: string | null;
}

/**
 * A single plan week resolved by its 1-based `week_index`: the derived
 * `WeeklyBar` (target/actual/band) plus its day rows (with same-day actuals),
 * reusing the shared `usePlanView` derivation so the row anatomy and matching
 * stay identical to the Plan screen.
 */
export function useWeek(userId: string | null, weekIndex: number | null): WeekDetail {
  const view = usePlanView(userId);

  const section = useMemo<PlanWeekSection | null>(() => {
    if (weekIndex == null) return null;
    return view.sections.find((s) => s.weekIndex === weekIndex) ?? null;
  }, [view.sections, weekIndex]);

  const elapsedFraction = useMemo(() => {
    if (!section?.bar?.isCurrent) return 0;
    return weekElapsedFraction(view.today, WEEK_START);
  }, [section?.bar?.isCurrent, view.today]);

  return {
    loading: view.loading,
    error: view.error,
    weekIndex: section?.weekIndex ?? null,
    phase: section?.bar?.phase ?? null,
    isRecovery: section?.bar?.isRecovery ?? false,
    bar: section?.bar ?? null,
    elapsedFraction,
    days: section?.days ?? [],
    editableDays: section?.editableDays ?? [],
    unplanned: section?.unplanned ?? [],
    weekStart: section?.weekStart ?? null,
    today: view.today,
    originalTargetMeters: section?.originalTargetMeters ?? null,
    qualityTargetMeters: section?.qualityTargetMeters ?? null,
    longTargetMeters: section?.longTargetMeters ?? null,
    weekId: section?.weekId ?? null,
  };
}
