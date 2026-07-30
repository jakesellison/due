/**
 * Best-efforts records table: the single fastest effort per canonical distance
 * across all activities' best_efforts.
 */

import type { InsightActivity } from './inputs';

// ---------------------------------------------------------------------------
// 4. Best-efforts records table
// ---------------------------------------------------------------------------

/** Canonical distances surfaced in the records table, in display order. */
const CANONICAL_BEST_EFFORTS = ['1k', '1 mile', '5k', '10k'] as const;
export type CanonicalBestEffort = (typeof CANONICAL_BEST_EFFORTS)[number];

export interface BestEffortRecord {
  name: CanonicalBestEffort;
  /** Fastest (lowest) elapsed seconds seen for this distance. */
  elapsed_s: number;
  /** ISO start_date of the fastest effort. */
  date: string;
  /** Due activity that produced the effort, when the query retained identity. */
  sourceActivityId?: string | null;
  sourceActivityName?: string | null;
  /** True only when the provider explicitly tagged the source activity as a race. */
  sourceIsRace?: boolean;
}

