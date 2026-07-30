import { useCallback, useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import type { QueryClient } from '@tanstack/react-query';

import { invalidateActivityCaches, runBackfill } from './backfill';
import { captureException } from './sentry';

const MIN_SYNC_INTERVAL_MS = 10 * 60 * 1000;

let lastStartedAt = 0;
let inFlight: Promise<void> | null = null;
// Deduped failure reporting: auto-sync stays silent in the UI (the Dash
// reconnect row covers the actionable 409 case via the status probe), but a
// persistent OTHER failure means silently stale data — report it once per
// app session, reset on the next success.
let consecutiveFailures = 0;
let reportedThisSession = false;

export function useAutoStravaSync(enabled: boolean, queryClient: QueryClient, navKey?: string): void {
  const runLatest = useCallback(() => {
    if (!enabled) return;
    const now = Date.now();
    if (inFlight || now - lastStartedAt < MIN_SYNC_INTERVAL_MS) return;
    lastStartedAt = now;
    inFlight = runBackfill({ mode: 'latest' })
      .then(async (result) => {
        consecutiveFailures = 0;
        if (result.imported > 0 || result.enriched > 0) {
          await invalidateActivityCaches(queryClient);
        }
      })
      .catch((err: unknown) => {
        consecutiveFailures += 1;
        // 409 = Strava not connected — expected + already surfaced by the Dash
        // reconnect row; never report it. Anything else that fails twice in a
        // row goes to Sentry once so a broad sync outage isn't invisible.
        const msg = err instanceof Error ? err.message : String(err);
        const notConnected = msg.includes(' 409');
        if (!notConnected && consecutiveFailures >= 2 && !reportedThisSession) {
          reportedThisSession = true;
          captureException(err, { source: 'autoStravaSync', consecutiveFailures });
        }
      })
      .finally(() => {
        inFlight = null;
      });
  }, [enabled, queryClient]);

  useEffect(() => {
    runLatest();
  }, [runLatest, navKey]);

  const wasActive = useRef(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      const active = next === 'active';
      if (active && !wasActive.current) runLatest();
      wasActive.current = active;
    });
    return () => sub.remove();
  }, [runLatest]);
}
