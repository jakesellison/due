/**
 * catalog.ts — the bundled starter-plan index.
 *
 * A literal metadata table describing the 12 shipped starter blocks (4 race
 * distances × 3 mileage tiers), each able to lazily `load()` its canonical
 * `.due` content into a normalized `RelativePlan`.
 *
 * The content files (`assets/starters/<id>.due.json`) land in Task 8. They are
 * named `*.due.json` so metro and jest import them as JSON with zero new deps —
 * they remain canonical `.due` content (exports/shares use the `.due` name).
 * Until Task 8 drops the real files, every entry's `load()` throws a clear
 * "content lands in Task 8" error EXCEPT the first, which is temporarily wired
 * to the placeholder so the load() path is exercisable end-to-end.
 *
 * Pure module (no IO at import time); `load()` requires + memoizes on demand.
 *
 * Task 8 landed the real content: all 12 `<id>.due.json` files exist and the
 * `numWeeks`/`peakMiles` rows below are reconciled against them.
 */

import type { DraftPlanDistanceKind } from '../draft';
import {
  normalizeRelativePlan,
  type RelativePlan,
} from '../relative';

export interface StarterMeta {
  /** Stable id, e.g. 'half-45' — matches the `<id>.due.json` filename. */
  id: string;
  /** Display label, e.g. 'Half · 45 mpw'. */
  name: string;
  distanceKind: DraftPlanDistanceKind;
  /** Recent-volume tier used to match a runner to the block (miles/week). */
  tierMpw: 30 | 45 | 60;
  numWeeks: number;
  /** Actual peak weekly mileage authored in the block. */
  peakMiles: number;
  /** Lazily require + normalize this starter's `.due` content (memoized). */
  load(): RelativePlan;
}

/**
 * Lazy require thunks keyed by starter id. `require()` (not ESM import) keeps
 * these deferred so the module imports cleanly, and json resolves via
 * metro/jest's moduleFileExtensions with no extra deps.
 */
const STARTER_REQUIRES: Record<string, () => unknown> = {
  '5k-30': () => require('../../../../assets/starters/5k-30.due.json'),
  '5k-45': () => require('../../../../assets/starters/5k-45.due.json'),
  '5k-60': () => require('../../../../assets/starters/5k-60.due.json'),
  '10k-30': () => require('../../../../assets/starters/10k-30.due.json'),
  '10k-45': () => require('../../../../assets/starters/10k-45.due.json'),
  '10k-60': () => require('../../../../assets/starters/10k-60.due.json'),
  'half-30': () => require('../../../../assets/starters/half-30.due.json'),
  'half-45': () => require('../../../../assets/starters/half-45.due.json'),
  'half-60': () => require('../../../../assets/starters/half-60.due.json'),
  'marathon-30': () => require('../../../../assets/starters/marathon-30.due.json'),
  'marathon-45': () => require('../../../../assets/starters/marathon-45.due.json'),
  'marathon-60': () => require('../../../../assets/starters/marathon-60.due.json'),
};

/** Memoized normalized plans, keyed by id. */
const loadedCache = new Map<string, RelativePlan>();

function loadStarter(id: string): RelativePlan {
  const cached = loadedCache.get(id);
  if (cached) return cached;
  const req = STARTER_REQUIRES[id];
  let raw: unknown;
  try {
    if (!req) throw new Error('no require registered');
    raw = req();
  } catch {
    // A missing/malformed content file surfaces clearly instead of an opaque
    // MODULE_NOT_FOUND.
    throw new Error(`Starter "${id}" content is missing or unreadable (assets/starters/${id}.due.json).`);
  }
  const plan = normalizeRelativePlan(raw);
  loadedCache.set(id, plan);
  return plan;
}

/**
 * The metadata rows, reconciled against the shipped `.due.json` content:
 * `numWeeks` and `peakMiles` mirror each file's authored block shape (the
 * invariant suite is the referee).
 */
interface StarterRow {
  id: string;
  name: string;
  distanceKind: DraftPlanDistanceKind;
  tierMpw: 30 | 45 | 60;
  numWeeks: number;
  peakMiles: number;
}

const ROWS: StarterRow[] = [
  { id: '5k-30', name: '5K · 30 mpw', distanceKind: '5k', tierMpw: 30, numWeeks: 8, peakMiles: 34 },
  { id: '5k-45', name: '5K · 45 mpw', distanceKind: '5k', tierMpw: 45, numWeeks: 8, peakMiles: 49 },
  { id: '5k-60', name: '5K · 60 mpw', distanceKind: '5k', tierMpw: 60, numWeeks: 8, peakMiles: 64 },
  { id: '10k-30', name: '10K · 30 mpw', distanceKind: '10k', tierMpw: 30, numWeeks: 10, peakMiles: 35 },
  { id: '10k-45', name: '10K · 45 mpw', distanceKind: '10k', tierMpw: 45, numWeeks: 10, peakMiles: 50 },
  { id: '10k-60', name: '10K · 60 mpw', distanceKind: '10k', tierMpw: 60, numWeeks: 10, peakMiles: 65 },
  { id: 'half-30', name: 'Half · 30 mpw', distanceKind: 'half', tierMpw: 30, numWeeks: 12, peakMiles: 36 },
  { id: 'half-45', name: 'Half · 45 mpw', distanceKind: 'half', tierMpw: 45, numWeeks: 12, peakMiles: 52 },
  { id: 'half-60', name: 'Half · 60 mpw', distanceKind: 'half', tierMpw: 60, numWeeks: 12, peakMiles: 67 },
  { id: 'marathon-30', name: 'Marathon · 30 mpw', distanceKind: 'marathon', tierMpw: 30, numWeeks: 14, peakMiles: 38 },
  { id: 'marathon-45', name: 'Marathon · 45 mpw', distanceKind: 'marathon', tierMpw: 45, numWeeks: 14, peakMiles: 55 },
  { id: 'marathon-60', name: 'Marathon · 60 mpw', distanceKind: 'marathon', tierMpw: 60, numWeeks: 14, peakMiles: 70 },
];

/** Ordered: 5k, 10k, half, marathon; within each distance 30 → 60. */
export const STARTER_CATALOG: StarterMeta[] = ROWS.map((row) => ({
  ...row,
  load: () => loadStarter(row.id),
}));

/** Look up a starter by id; `null` when unknown. */
export function starterById(id: string): StarterMeta | null {
  return STARTER_CATALOG.find((s) => s.id === id) ?? null;
}
