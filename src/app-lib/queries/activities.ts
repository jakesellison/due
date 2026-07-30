import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { supabase } from '../supabase';
import type { ActivityRow } from './rows';

export interface DateRange {
  /** inclusive 'YYYY-MM-DD' */
  from: string;
  /** inclusive 'YYYY-MM-DD' */
  to: string;
}

/** Lean columns for the LIST/corpus (no raw streams/route/laps — egress guard).
 *  `enriched_at` is a tiny timestamptz that lets quality fallbacks distinguish
 *  "enrichment pending" from "enrichment attempted, Strava has no streams". */
export const ACTIVITY_LIST_COLUMNS =
  'id, source, source_id, name, local_date, distance_meters, moving_time_s, elapsed_time_s, avg_hr, user_note, start_date, avg_temp_c, best_efforts, workout_type, stream_summary, quality_override, enriched_at, max_hr, suffer_score, shoe_id';

/** Heavy columns for the SINGLE run-detail view — adds streams/route/laps. */
export const ACTIVITY_DETAIL_COLUMNS = `${ACTIVITY_LIST_COLUMNS}, streams, route, laps`;

export const ACTIVITY_QUERY_STALE_MS = 5 * 60 * 1000;
const ACTIVITY_QUERY_GC_MS = 30 * 60 * 1000;

/**
 * The narrow slice of a Supabase select-query builder this module depends on.
 * `.range(from, to)` returns the same chainable builder, and the whole thing is
 * awaitable into `{ data, error }`. Typed structurally so the paginator can be
 * node-tested against a tiny stub without importing supabase-js.
 */
export interface RangeablePostgrest<Row> {
  range(
    from: number,
    to: number,
  ): PromiseLike<{ data: Row[] | null; error: { message: string } | null }> & {
    range?: unknown;
  };
}

/**
 * Page through a Supabase REST query with `.range(from, to)` until a short page
 * arrives, concatenating every row. Supabase caps a single select at 1000 rows
 * by default, so any genuinely-unbounded fetch (All-range insights, the race
 * prediction's full history, best-effort/race detection) MUST loop or it
 * silently truncates — dropping the most-recent runs once the user crosses 1k
 * activities. Pure over the injected `query` (no React, no global supabase), so
 * it is node-testable.
 *
 *  - `pageSize` is the rows-per-page (default 1000, Supabase's own ceiling).
 *  - The caller is responsible for the query's filters AND its ORDER — the order
 *    MUST be a *total* order over the same key pages are cursored on, or rows can
 *    shuffle across page (offset) boundaries and be lost or duplicated. Pass a
 *    deterministic order on the filter key plus a stable tiebreaker (e.g.
 *    `.order('local_date', desc).order('id', desc)`) so the assembled array is
 *    recent-first and stable across pages even when sort keys tie or are null.
 *  - Stops as soon as a page returns fewer than `pageSize` rows (the last page),
 *    so a fetch that fits in one page costs exactly one round-trip.
 */
export async function fetchAllActivities<Row>(
  query: RangeablePostgrest<Row>,
  pageSize = 1000,
): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await query.range(from, to);
    if (error) throw error;
    const page = data ?? [];
    out.push(...page);
    if (page.length < pageSize) break;
  }
  return out;
}

export interface UseActivitiesOptions {
  /**
   * Keep serving the PREVIOUS range's rows while a newly-selected range loads,
   * instead of dropping to `undefined`.
   *
   * Opt-in, not the default. The range here is usually derived (the plan window,
   * the current week), so its key changes only when the underlying subject
   * changes and holding the old subject's rows would be wrong. It is the right
   * behaviour only where the RUNNER retunes the range on a surface that is
   * already showing data — the run-detail pace-curve baseline (12W / 26W / All),
   * where dropping to `undefined` made the comparison curve vanish mid-read
   * until the fetch returned. `All` pages the entire history, so that gap is
   * seconds long and reads as the chart having broken.
   *
   * Callers that switch on this MUST surface the pending state (see
   * `isPlaceholderData`): serving the old window's numbers under the new
   * window's label, with nothing to say so, would be exactly the kind of
   * quietly-wrong figure this app refuses to show.
   */
  keepPrevious?: boolean;
}

/**
 * Activities for the user within a civil-date range.
 *
 * Ordered `local_date` DESC with an `id` DESC tiebreaker (recent-first, *total*)
 * and PAGINATED via `fetchAllActivities`: Supabase REST returns at most 1000
 * rows per select, so the wide-open All-range window (the full Strava backfill —
 * now 1000+ rows) would otherwise truncate and silently drop the newest runs,
 * emptying the easy-HR / efficiency / best-efforts / prediction sections.
 * Date-bounded callers (plan window, week, 4W/12W insights) stay far under 1k
 * and resolve in a single page; only the unbounded All window actually loops.
 *
 * The order key is `local_date` — the SAME column the rows are filtered and
 * cursored on — with `id` breaking ties. A previous version ordered by
 * `start_date` while keying pages on `local_date`; rows that tie on `start_date`
 * (or have a null `start_date`) sort non-deterministically across `.range`
 * offsets, so they could shuffle across page boundaries and be lost or
 * duplicated. Ordering and cursoring on a consistent, total key fixes that.
 * `nullsFirst: false` keeps null `local_date` rows deterministically last.
 */
export function useActivities(
  userId: string | null,
  range: DateRange | null,
  options?: UseActivitiesOptions,
) {
  return useQuery<ActivityRow[]>({
    queryKey: ['activities', userId, range?.from, range?.to],
    enabled: !!userId && !!range,
    ...(options?.keepPrevious ? { placeholderData: keepPreviousData } : null),
    staleTime: ACTIVITY_QUERY_STALE_MS,
    gcTime: ACTIVITY_QUERY_GC_MS,
    queryFn: async () => {
      const query = supabase
        .from('activities')
        .select(ACTIVITY_LIST_COLUMNS)
        .eq('user_id', userId)
        .gte('local_date', range!.from)
        .lte('local_date', range!.to)
        // Order on the SAME key pages are cursored on (local_date), with a
        // stable `id` tiebreaker, so `.range` offsets stay total and stable —
        // no rows lost or duplicated across page boundaries, including ties and
        // null start_date. `nullsFirst: false` sorts any null local_date last.
        .order('local_date', { ascending: false, nullsFirst: false })
        .order('id', { ascending: false });
      const rows = await fetchAllActivities<ActivityRow>(
        query as unknown as RangeablePostgrest<ActivityRow>,
      );
      if (__DEV__) {
        const leaked = rows.find((r) => (r as { streams?: unknown }).streams != null);
        if (leaked) console.warn('[egress] list query returned raw streams — use ACTIVITY_LIST_COLUMNS', leaked.id);
      }
      return rows;
    },
  });
}
