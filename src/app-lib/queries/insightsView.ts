import { useMemo } from 'react';

import { dedupeById, rangeWindow, type RangeKey } from '@/lib';

import { useActivities } from './activities';
import type { ActivityRow } from './rows';

// ---- Windowed activity rows -------------------------------------------------
//
// What remains after the Progress tab was deleted: the range-windowed activity
// fetch plus the canonical-run collapse that every derivation must share. The
// race-prediction hook (`prediction.ts` → SessionView) is the live consumer.

/**
 * Activities for a user over a trailing window ending TODAY (range-driven,
 * NOT clamped to the plan span). 4W=28d, 12W=84d, All=everything.
 */
export function useRangeActivities(
  userId: string | null,
  today: string,
  range: RangeKey,
  /** Explicit civil window that overrides the preset. */
  override: { from: string; to: string } | null = null,
) {
  const window = useMemo(() => override ?? rangeWindow(today, range), [override, today, range]);
  return useActivities(userId, window);
}

/** Manual sources are dev/placeholder data (the local seed); everything else is "real". */
const PLACEHOLDER_SOURCES = new Set(['manual']);

/**
 * Reduce the windowed activity rows to a SINGLE canonical run array so the
 * derivations can never double-count.
 *
 * Two collapses, in order:
 *  1. Dedupe by activity `id` (defensive: overlapping query windows / concat /
 *     a re-fetch race must never feed the same row twice).
 *  2. Real data supersedes the dev seed: when the user has ANY real (non-
 *     placeholder, e.g. Strava) activity, drop EVERY `manual` placeholder row.
 *     The dev seed injects fake `manual` runs from the plan start forward, on
 *     and around the same dates the real Strava backfill already covers — so
 *     summing both inflated weekly totals to ~2× for post-plan-start weeks
 *     while pre-plan weeks (Strava only) stayed correct. Dropping the seed
 *     wholesale yields the real-data truth.
 *
 * Only when there is NO real data at all do the placeholder rows survive, so a
 * pure-seed dev account still renders something.
 */
export function dedupeActivityRows(rows: ActivityRow[]): ActivityRow[] {
  const byId = dedupeById(rows);
  const bySource = dedupeBySourceId(byId);
  const hasReal = bySource.some((a) => !PLACEHOLDER_SOURCES.has(a.source));
  if (!hasReal) return bySource;
  return bySource.filter((a) => !PLACEHOLDER_SOURCES.has(a.source));
}

/** Higher = a more complete row (prefer one carrying stream_summary, then best_efforts). */
function rowCompleteness(a: ActivityRow): number {
  return (a.stream_summary != null ? 2 : 0) + (a.best_efforts != null ? 1 : 0);
}

/**
 * Collapse rows that are the SAME provider activity ingested twice — a re-sync
 * can mint a new app `id` for the same Strava `source_id`, which `dedupeById`
 * can't catch, so the run gets double-counted (volume, training load) and a race
 * appears twice. Keyed on `(source, source_id)`, keeping the MOST COMPLETE row
 * (the one carrying stream_summary + best_efforts), in first-best original order.
 * Rows without a `source_id` pass through untouched.
 */
export function dedupeBySourceId(rows: ActivityRow[]): ActivityRow[] {
  const bestId = new Map<string, string>();
  const bestScore = new Map<string, number>();
  for (const r of rows) {
    if (r.source_id == null) continue;
    const key = `${r.source}|${r.source_id}`;
    const score = rowCompleteness(r);
    if (!bestScore.has(key) || score > (bestScore.get(key) as number)) {
      bestScore.set(key, score);
      bestId.set(key, r.id);
    }
  }
  const emitted = new Set<string>();
  const out: ActivityRow[] = [];
  for (const r of rows) {
    if (r.source_id == null) {
      out.push(r);
      continue;
    }
    const key = `${r.source}|${r.source_id}`;
    if (bestId.get(key) === r.id && !emitted.has(key)) {
      emitted.add(key);
      out.push(r);
    }
  }
  return out;
}
