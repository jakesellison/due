/**
 * resolveQuality.ts — resolve the CREDITED reading for one activity, applying a
 * user override on top of the stored plan-conditioned verdict.
 *
 * Precedence: `override ?? matched ?? honest` (design doc §5). The interpreter
 * stores a plan-agnostic `honest` read, a plan-`matched` read (when a
 * prescription fit), and the CROPS candidate ladder; the user can pin a
 * different interpretation via the run-detail granularity slider (Task E). This
 * pure resolver is the single place that precedence lives, so credit reads
 * (weekly mileage, goals, day panel) all agree.
 *
 * Pure. No IO. Node-tested.
 */
import {
  METERS_PER_MILE,
} from '../units';
import type { Reading } from './interpretWorkout';
import type { QualitySummary } from '../run/streamSummary';

/**
 * The user's pinned interpretation for one activity, stored in
 * `activities.quality_override` (jsonb, nullable). Absent = use the computed
 * default. `blocks`/custom tap-drag interpretations are a documented v2 — not
 * part of this shape yet.
 */
export interface QualityOverride {
  /**
   * - `'candidate'`: credit `candidates[idx]` — the granularity-slider position.
   * - `'plan'`:      force the plan-`matched` read (falls back to honest).
   * - `'none'`:      "not a workout" — suppress quality credit entirely.
   */
  choice: 'candidate' | 'plan' | 'none';
  /** Index into `candidates[]`; required (and only read) when `choice === 'candidate'`. */
  idx?: number;
}

const NONE_READING: Reading = { kind: 'none', qualityMi: 0, blocks: [], summary: '' };

/**
 * The subset of the stored quality verdict a resolver chooses among. A subset of
 * `QualitySummary` so callers can pass the whole `stream_summary.quality` object.
 */
export type ResolvableQuality = Pick<
  QualitySummary,
  'kind' | 'summary' | 'qualityDistanceMeters' | 'honest' | 'matched' | 'candidates'
>;

/**
 * The verdict a row credits BEFORE any override — `matched ?? honest`, with a
 * flat-field fallback for pre-v8 rows written before the nested readings existed
 * (there, the flat QualityDetect credit fields ARE the verdict).
 */
function storedCredit(q: ResolvableQuality): Reading {
  if (q.matched) return q.matched;
  if (q.honest) return q.honest;
  return {
    kind: q.kind,
    qualityMi: (q.qualityDistanceMeters ?? 0) / METERS_PER_MILE,
    blocks: [],
    summary: q.summary ?? '',
  };
}

/**
 * Resolve the credited reading for an activity: a user override wins, else the
 * stored credit (`matched ?? honest`). Precedence: `override ?? matched ?? honest`.
 */
export function resolveQuality(
  q: ResolvableQuality,
  override: QualityOverride | null | undefined,
): Reading {
  if (!override) return storedCredit(q);
  switch (override.choice) {
    case 'none':
      return NONE_READING;
    case 'plan':
      return q.matched ?? q.honest ?? storedCredit(q);
    case 'candidate': {
      const cand = override.idx != null ? q.candidates?.[override.idx] : undefined;
      return cand ?? storedCredit(q);
    }
    default:
      return storedCredit(q);
  }
}
