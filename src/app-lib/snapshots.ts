/**
 * Daily prediction-snapshot LOGGING — the runtime half of the self-measurement
 * layer.
 *
 * Each day, after the Trends prediction computes from usable data, we freeze it
 * into `prediction_snapshots` so a future real race result can grade the model.
 * The PAYLOAD shaping is the pure, node-tested `buildSnapshotPayload`; this file
 * is the thin Supabase + AsyncStorage wiring around it:
 *
 *  - `logPredictionSnapshot` upserts on the table's
 *    (user_id, snapshot_date, target_meters) unique key, so re-opening Trends on
 *    the same day overwrites rather than duplicates.
 *  - `maybeLogPredictionSnapshot` is the fire-and-forget hook entry point: it
 *    guards with an in-memory Set AND an AsyncStorage `snap-<date>-<target>`
 *    marker so we only hit the network ONCE per day per target (the upsert is
 *    idempotent regardless, but we avoid hammering it on every re-render).
 *
 * Nothing here ever blocks or throws into the UI: every failure is caught and
 * `console.warn`-ed. A missed snapshot is invisible and self-heals tomorrow.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  buildSnapshotPayload,
  type RacePrediction,
  type SnapshotContext,
} from '@/lib';

import { supabase } from './supabase';

/** AsyncStorage marker key: one snapshot attempt per civil day per target. */
function markerKey(snapshotDate: string, targetMeters: number): string {
  return `snap-${snapshotDate}-${targetMeters}`;
}

/**
 * Process-local guard so a burst of re-renders within one session never fires
 * more than one upsert per (date, target). Survives only the running process;
 * the AsyncStorage marker survives restarts.
 */
const firedThisSession = new Set<string>();

/**
 * UPSERT one prediction snapshot for `today`, keyed to
 * (user_id, snapshot_date, target_meters). Returns true on a successful write,
 * false on any error (which is also `console.warn`-ed). Never throws.
 */
export async function logPredictionSnapshot(
  ctx: SnapshotContext,
  prediction: RacePrediction,
  today: string,
): Promise<boolean> {
  try {
    const payload = buildSnapshotPayload(ctx, prediction, today);
    const { error } = await supabase
      .from('prediction_snapshots')
      .upsert(payload, { onConflict: 'user_id,snapshot_date,target_meters' });
    if (error) {
      console.warn('[snapshots] upsert failed:', error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.warn('[snapshots] upsert threw:', (e as Error)?.message ?? e);
    return false;
  }
}

/**
 * Fire-and-forget: log today's prediction at most once per day per target.
 *
 * Guard order (cheap → durable):
 *  1. in-memory Set — short-circuits re-render bursts without touching disk,
 *  2. AsyncStorage marker — short-circuits across app restarts.
 * The DB upsert is idempotent regardless, so a lost marker only costs one extra
 * (harmless) write. Any failure is swallowed + warned; the UI is never affected.
 *
 * Call this from an effect once the prediction has computed from usable data.
 */
export function maybeLogPredictionSnapshot(
  ctx: SnapshotContext,
  prediction: RacePrediction,
  today: string,
): void {
  const key = markerKey(today, ctx.targetMeters);
  if (firedThisSession.has(key)) return;
  firedThisSession.add(key); // claim immediately so concurrent calls don't race.

  void (async () => {
    try {
      const seen = await AsyncStorage.getItem(key);
      if (seen) return; // already logged today on a previous launch.
      const ok = await logPredictionSnapshot(ctx, prediction, today);
      if (ok) await AsyncStorage.setItem(key, '1');
      else firedThisSession.delete(key); // allow a retry next render on failure.
    } catch (e) {
      // AsyncStorage hiccup must never surface — drop the in-memory claim so a
      // later render can retry, and stay silent-but-warned.
      firedThisSession.delete(key);
      console.warn('[snapshots] marker check threw:', (e as Error)?.message ?? e);
    }
  })();
}

/** Test-only: clear the process-local guard between cases. */
export function __resetSnapshotSession(): void {
  firedThisSession.clear();
}
