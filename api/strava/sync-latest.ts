import type { ApiRequest, ApiResponse } from '../../src/server/httpTypes';
import { methodAllowed, requireUser } from '../../src/server/apiAuth';
import { rateLimit } from '../../src/server/rateLimit';
import { createAdminClient } from '../../src/server/supabaseAdmin';
import { captureError } from '../../src/server/report';
import { retryAfterSeconds } from '../../src/server/strava';
import {
  ensureFreshAccessToken,
  getUserTz,
  upsertSummaryActivities,
  type ActivityRow,
  type StravaConnection,
} from '../../src/server/ingest';
import {
  afterUnixSeconds,
  isRunActivity,
  mapStravaSummary,
  nextSummariesCursor,
  SUMMARY_PER_PAGE,
  summariesPageFromCursor,
  type StravaSummaryActivity,
} from '../../src/server/backfill';

const STRAVA_API = 'https://www.strava.com/api/v3';

class RateLimited extends Error {
  constructor(readonly retryAfterS: number) { super('strava rate limited'); }
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (!methodAllowed(req, res, ['POST'])) return;

  const userId = await requireUser(req, res);
  if (!userId) return;

  // Runs on every app open and calls the app-wide Strava quota — see backfill.
  if (!rateLimit(req, res, { key: 'strava-sync-latest', limit: 60, windowMs: 60_000, subject: userId })) {
    return;
  }

  const admin = createAdminClient();
  const conn = await getConnectionByUser(admin, userId);
  if (!conn) {
    res.status(409).json({ error: 'Strava not connected' });
    return;
  }

  try {
    await runLatestSummaries(admin, conn, (req.body as { cursor?: unknown } | undefined)?.cursor, res);
  } catch (err) {
    if (err instanceof RateLimited) {
      res.status(200).json({ phase: 'summaries', mode: 'latest', rateLimited: true, retryAfterS: err.retryAfterS });
      return;
    }
    console.error('strava/sync-latest failed:', err);
    await captureError(err, { route: 'strava/sync-latest' });
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function getConnectionByUser(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
): Promise<StravaConnection | null> {
  // active-only: a revoked connection must surface as 409 "not connected", not
  // be retried forever with a dead refresh token.
  const { data, error } = await admin
    .from('integration_connections')
    .select('user_id, access_token, refresh_token, expires_at')
    .eq('provider', 'strava')
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle();
  if (error) throw new Error(`getConnectionByUser failed: ${error.message}`);
  return (data as StravaConnection | null) ?? null;
}

async function runLatestSummaries(
  admin: ReturnType<typeof createAdminClient>,
  conn: StravaConnection,
  cursor: unknown,
  res: ApiResponse,
): Promise<void> {
  const page = summariesPageFromCursor(cursor);
  const after = await latestAfterUnixSeconds(admin, conn.user_id);
  const accessToken = await ensureFreshAccessToken(admin, conn);
  const tz = await getUserTz(admin, conn.user_id);

  const url =
    `${STRAVA_API}/athlete/activities?per_page=${SUMMARY_PER_PAGE}` +
    `&page=${page}&after=${after}`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (resp.status === 429) throw new RateLimited(retryAfterSeconds(resp) ?? 900);
  if (!resp.ok) throw new Error(`athlete/activities failed: ${resp.status} ${await resp.text()}`);

  const list = (await resp.json()) as StravaSummaryActivity[];
  const returnedCount = Array.isArray(list) ? list.length : 0;
  const runs = list.filter(isRunActivity);
  const existing = await existingSourceIds(admin, conn.user_id, runs.map((summary) => String(summary.id)));

  // The newest activity is ALWAYS in this latest-sync window and this runs on
  // every app open, so the guard against nulling an enriched row's detail
  // (the summaries-nuke) is CRITICAL here — it lives in upsertSummaryActivities,
  // shared with the history summaries loop so it can't drift out of one endpoint.
  const rows = runs.map((summary) => mapStravaSummary(summary, tz));
  const imported = await upsertSummaryActivities(admin, conn.user_id, rows, existing);

  res.status(200).json({
    phase: 'summaries',
    mode: 'latest',
    imported,
    scanned: returnedCount,
    nextCursor: nextSummariesCursor(page, returnedCount),
  });
}

async function latestAfterUnixSeconds(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
): Promise<number> {
  const { data, error } = await admin
    .from('activities')
    .select('start_date')
    .eq('user_id', userId)
    .eq('source', 'strava')
    .order('start_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`latest activity select failed: ${error.message}`);
  const start = (data as { start_date?: string | null } | null)?.start_date;
  if (!start) return afterUnixSeconds(new Date());
  return Math.max(0, Math.floor(new Date(start).getTime() / 1000) - 60);
}

async function existingSourceIds(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  ids: string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { data, error } = await admin
    .from('activities')
    .select('source_id')
    .eq('user_id', userId)
    .eq('source', 'strava')
    .in('source_id', ids);
  if (error) throw new Error(`existing source ids select failed: ${error.message}`);
  return new Set((data ?? []).map((row) => String((row as { source_id: string }).source_id)));
}
