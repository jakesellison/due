/**
 * push.ts — the "run banked" push notification, sent from the webhook ingest.
 *
 * When a NEW Strava run finishes ingesting (webhook `create` only — never the
 * history backfill or `update` events), we notify the runner's device(s) via the
 * Expo push service, deep-linking into the run. Best-effort: any failure is
 * swallowed/logged and MUST NOT break ingest. Idempotent via `activities.push_sent_at`.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { resolveQuality } from '../lib/kpi/resolveQuality';
import type { QualitySummary } from '../lib/run/streamSummary';

const METERS_PER_MILE = 1609.344;
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/** Terse body: distance + detected kind when known (e.g. "6.2 mi · Tempo"). */
function bankedBody(distanceMeters: number | null, quality: QualitySummary | null | undefined): string {
  const mi = (distanceMeters ?? 0) / METERS_PER_MILE;
  const parts = [`${mi.toFixed(1)} mi`];
  if (quality) {
    const kind = resolveQuality(quality, null).kind;
    if (kind && kind !== 'none') parts.push(kind.charAt(0).toUpperCase() + kind.slice(1));
  }
  return parts.join(' · ');
}

/**
 * Send the "run banked" push for a freshly-ingested run, once. No-op if the run
 * row is missing, already pushed (`push_sent_at`), or the user has no tokens.
 * Deep-links via `data.url = duerunning://run/<activities.id>`.
 */
export async function maybeSendRunBankedPush(
  admin: SupabaseClient,
  userId: string,
  sourceActivityId: number | string,
  distanceMeters: number | null,
  quality: QualitySummary | null | undefined,
): Promise<void> {
  // The webhook works in Strava source_ids; the deep link needs the DB uuid.
  const { data: act } = await admin
    .from('activities')
    .select('id, push_sent_at')
    .eq('user_id', userId)
    .eq('source', 'strava')
    .eq('source_id', String(sourceActivityId))
    .maybeSingle();
  const row = act as { id: string; push_sent_at: string | null } | null;
  if (!row || row.push_sent_at) return; // no row, or already notified

  const { data: tokens } = await admin.from('push_tokens').select('token').eq('user_id', userId);
  const list = (tokens ?? []) as { token: string }[];
  if (list.length === 0) return;

  const url = `duerunning://run/${row.id}`;
  const body = bankedBody(distanceMeters, quality);
  const messages = list.map((t) => ({ to: t.token, title: 'Run banked', body, sound: 'default', data: { url } }));

  const res = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(messages),
  });
  if (!res.ok) {
    console.warn('[push] Expo send failed', res.status, await res.text());
    return;
  }
  // Stamp so an `update` webhook (or a retry) never double-fires for this run.
  await admin.from('activities').update({ push_sent_at: new Date().toISOString() }).eq('id', row.id);
}
