import { useEffect, useState } from 'react';
import type { BackfillMode } from './backfill';

/**
 * Shared, cross-screen mirror of the sync state the You → Strava screen
 * tracks locally. Backfilling can run
 * for minutes, and until now progress was invisible outside that one screen
 * — a brand-new tester who lands on Dash right after connecting Strava saw
 * silent zeros with no clue anything was happening (PM#1). This is a plain
 * module-level pub/sub (no new state library) so Dash's compact sync row can
 * read the SAME running status without owning any trigger logic itself —
 * the dedicated connection screen stays the only place that starts/resumes a
 * backfill.
 */
export type BackfillStatus =
  | {
      kind: 'running';
      label: string;
      /** 0..1 when the enrich phase reports a known remaining count; `null`
       *  during the summaries page-in (an unknown-sized total) — Dash renders
       *  an indeterminate spinner rather than fabricate a percentage. */
      fraction: number | null;
    }
  // A rate-limited halt: distinct from idle so a stale "importing" row never
  // lingers, but still surfaced (Dash links to You to resume).
  | { kind: 'rate_limited'; mode: BackfillMode }
  | { kind: 'done'; imported: number; enriched: number }
  | { kind: 'idle' };

let current: BackfillStatus = { kind: 'idle' };
const listeners = new Set<(s: BackfillStatus) => void>();

/** Publish the latest backfill status. Called by the Strava connection screen. */
export function setBackfillStatus(status: BackfillStatus): void {
  current = status;
  listeners.forEach((l) => l(status));
}

/** Read the current status without subscribing (e.g. a one-off idle check). */
export function getBackfillStatus(): BackfillStatus {
  return current;
}

/** TEST-ONLY — this module is a process-lifetime singleton (by design, so any
 *  screen can read it without a Provider), which means it otherwise leaks
 *  between test cases in the same file. Call from `beforeEach` wherever a
 *  test drives `you.tsx`'s backfill flow. */
export function resetBackfillStatusForTests(): void {
  current = { kind: 'idle' };
}

/** Subscribe to the shared backfill status. */
export function useBackfillStatus(): BackfillStatus {
  const [status, setStatus] = useState(current);
  useEffect(() => {
    // Pick up anything published between module load and this effect mounting.
    setStatus(current);
    const listener = (s: BackfillStatus) => setStatus(s);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return status;
}
