import type { QueryClient } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { invalidatePlanActivityCaches } from './queries/cache';
import { supabase } from './supabase';
import { API_BASE, resilientFetch } from './api';

/**
 * The client-side backfill RUNNER: drives the chunked
 * `POST /api/strava/backfill` endpoint to completion.
 *
 * The endpoint does one short chunk per call (Vercel Hobby ~10s limit), so the
 * loop here owns the cursor: first it pages all SUMMARIES (≤52 weeks of runs),
 * then ENRICHES the most-recent runs (detail + streams + weather) a few at a
 * time. Progress is reported through an `onProgress` callback so the settings
 * sheet can show "Imported 87 runs · enriching 12/30…". On a Strava rate-limit
 * the loop stops gracefully and reports `rateLimited` so the UI shows a resume
 * affordance. The whole thing is resumable: re-running re-pages summaries
 * (upserts are idempotent) and re-enriches whatever still lacks streams.
 */

export interface BackfillProgress {
  phase: 'summaries' | 'enrich' | 'done';
  /** Total run summaries imported so far this run. */
  imported: number;
  /** Activities enriched so far this run. */
  enriched: number;
  /** Remaining to enrich, when known (from the latest enrich response). */
  remaining: number | null;
  /** True if Strava rate-limited us; the run halted and can resume later. */
  rateLimited: boolean;
}

export interface BackfillResult {
  imported: number;
  enriched: number;
  rateLimited: boolean;
  /** True if every phase ran to completion (no rate-limit halt). */
  complete: boolean;
}

interface SummariesResponse {
  phase: 'summaries';
  mode?: 'latest' | 'history';
  imported: number;
  scanned: number;
  nextCursor: { page: number } | null;
  rateLimited?: boolean;
  retryAfterS?: number;
}

interface EnrichResponse {
  phase: 'enrich';
  enriched: number;
  remaining: number;
  nextCursor: { offset: number } | null;
  rateLimited?: boolean;
  retryAfterS?: number;
}

/** A hard cap on chunk calls per phase so a server bug can't loop forever. */
const MAX_CHUNKS = 200;

async function postChunk<T>(
  accessToken: string,
  phase: 'summaries' | 'enrich',
  cursor: unknown,
  mode: BackfillMode,
): Promise<T> {
  const latestSummaries = mode === 'latest' && phase === 'summaries';
  const endpoint = latestSummaries ? '/api/strava/sync-latest' : '/api/strava/backfill';
  const body = latestSummaries ? { cursor } : { phase, cursor, mode };

  // Each chunk is a short, idempotent/resumable upsert (re-running re-pages and
  // re-enriches safely), so a transient network/5xx blip is retried with backoff.
  const res = await resilientFetch(`${API_BASE}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
    retries: 2,
  });
  if (!res.ok) {
    throw new Error(`backfill ${phase} failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as T;
}

export interface RunBackfillOpts {
  mode?: BackfillMode;
  onProgress?: (p: BackfillProgress) => void;
}

export type BackfillMode = 'latest' | 'history';

/**
 * Run the full backfill loop. Resolves with totals and whether it completed.
 * Never throws on a Strava rate-limit (returns `rateLimited: true`); only a
 * transport/auth failure rejects.
 */
export async function runBackfill(opts: RunBackfillOpts = {}): Promise<BackfillResult> {
  const { mode = 'history', onProgress } = opts;
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) throw new Error('Not signed in');

  let imported = 0;
  let enriched = 0;

  // ---- Phase 1: summaries ----
  let summariesCursor: { page: number } | null = { page: 1 };
  for (let i = 0; i < MAX_CHUNKS && summariesCursor; i++) {
    const r: SummariesResponse = await postChunk<SummariesResponse>(
      accessToken,
      'summaries',
      summariesCursor,
      mode,
    );
    if (r.rateLimited) {
      onProgress?.({ phase: 'summaries', imported, enriched, remaining: null, rateLimited: true });
      return { imported, enriched, rateLimited: true, complete: false };
    }
    imported += r.imported;
    summariesCursor = r.nextCursor;
    onProgress?.({
      phase: 'summaries',
      imported,
      enriched,
      remaining: null,
      rateLimited: false,
    });
  }

  // ---- Phase 2: enrich ----
  let enrichCursor: { offset: number } | null = { offset: 0 };
  let remaining: number | null = null;
  for (let i = 0; i < MAX_CHUNKS && enrichCursor; i++) {
    const r: EnrichResponse = await postChunk<EnrichResponse>(accessToken, 'enrich', enrichCursor, mode);
    if (r.rateLimited) {
      onProgress?.({ phase: 'enrich', imported, enriched, remaining, rateLimited: true });
      return { imported, enriched, rateLimited: true, complete: false };
    }
    enriched += r.enriched;
    remaining = r.remaining;
    enrichCursor = r.nextCursor;
    onProgress?.({ phase: 'enrich', imported, enriched, remaining, rateLimited: false });
  }

  onProgress?.({ phase: 'done', imported, enriched, remaining: 0, rateLimited: false });
  return { imported, enriched, rateLimited: false, complete: true };
}

// ── Interrupted-mode persistence ─────────────────────────────────────────────
//
// A rate-limited backfill halts mid-mode — a rate-limited 'history' import
// must RESUME as 'history', not silently downgrade to 'latest' and skip the
// rest of older history (audit-ops H5). The settings screen's `sync` state is
// component memory only, so an app relaunch after a rate-limit forgot which
// mode was interrupted and Resume fell back to 'latest'. Persist it per-user
// in AsyncStorage (same pattern as the quality-override / dismissal helpers)
// so Resume survives a relaunch.

function interruptedModeKey(userId: string): string {
  return `backfill-interrupted-mode-${userId}`;
}

/** Persist the mode a rate-limited backfill halted in, so Resume survives a relaunch. */
export async function persistInterruptedMode(userId: string, mode: BackfillMode): Promise<void> {
  await AsyncStorage.setItem(interruptedModeKey(userId), mode);
}

/** Read back the mode a previous rate-limited backfill halted in, if any. */
export async function getInterruptedMode(userId: string): Promise<BackfillMode | null> {
  const v = await AsyncStorage.getItem(interruptedModeKey(userId));
  return v === 'latest' || v === 'history' ? v : null;
}

/** Clear the persisted interrupted mode — the backfill completed (or is no longer relevant). */
export async function clearInterruptedMode(userId: string): Promise<void> {
  await AsyncStorage.removeItem(interruptedModeKey(userId));
}

/**
 * SEED RETIREMENT — one-time, on first successful Strava connect.
 *
 * Deletes this user's DEV-seed activities (`source='manual'` AND
 * `source_id like 'seed-%'`) so the Dash charts become real-Strava-only. The
 * seeded PLAN (plans/plan_weeks/workouts) is deliberately KEPT — only the fake
 * activities go. Client deletes are allowed under the activities owner-all RLS
 * policy. Returns the number of rows deleted (0 if already retired). Idempotent.
 */
export async function retireSeedActivities(userId: string): Promise<number> {
  const { data, error } = await supabase
    .from('activities')
    .delete()
    .eq('user_id', userId)
    .eq('source', 'manual')
    .like('source_id', 'seed-%')
    .select('id');
  if (error) throw new Error(`retireSeedActivities failed: ${error.message}`);
  return data?.length ?? 0;
}

/** Invalidate the react-query caches the Dash/Plan/Trends read, post-backfill. */
export async function invalidateActivityCaches(queryClient: QueryClient): Promise<void> {
  await invalidatePlanActivityCaches(queryClient);
}
