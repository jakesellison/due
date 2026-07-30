/**
 * Type-only definitions for the per-activity stream summary stored in
 * `activities.stream_summary`.  Lives in `src/lib/run` so both the server-side
 * compute code (`src/server/streams.ts`) and the client query layer
 * (`src/app-lib/queries/rows.ts`) can import these without crossing the
 * server→client boundary.
 */

import type { ActivityCurvePoint, ActivityDurationCurvePoint } from './paceCurve';
import type { EarlyMiles } from '../kpi/insights/comparableMile';
import type { QualityDetect } from '../kpi/qualityDetect';
import type { BarSeg } from '../workout/structureBar';
import type { Reading } from '../kpi/interpretWorkout';

export type { ActivityCurvePoint, ActivityDurationCurvePoint, EarlyMiles };

/** Precomputed quality verdict for an activity, stored in `stream_summary.quality`. */
export interface QualitySummary extends QualityDetect {
  floor: {
    paceFloorSecPerMi: number;
    hrFloor: number | null;
    easyBaselineSecPerMi: number;
    /** The workout-interpreter's genuinely-fast floor (sec/mi). Optional:
     *  absent on rows written before this field was derived (see
     *  qualityFloor.ts deriveQualityFloor); callers fall back to deriving it
     *  from paceFloorSecPerMi/easyBaselineSecPerMi. */
    qualityFloorSecPerMi?: number;
    /** Estimated MP the floor was derived from — part of the point-in-time
     *  snapshot; absent on rows written before it was stored. */
    mpSecPerMi?: number;
  };
  /** Which evidence produced the verdict — 'laps' (marked reps) or 'stream'.
   *  Absent on rows written before the laps+stream+HR ingest verdict. */
  source?: 'laps' | 'stream';
  /**
   * The ACTUAL-shape bar — the run's real structure positioned by distance from
   * its stream (see actualBarSegments). The Dash today card draws this on a
   * completed day instead of the prescription. Absent on rows written before
   * v5 (the card falls back to the prescription bar then). */
  actualBar?: BarSeg[];
  /** Detector policy version (see STREAM_SUMMARY_VERSION: 2 = laps+stream+HR,
   *  3 = 1 Hz block-level recovery merge, 4 = hysteresis regime, 5 = actualBar,
   *  8 = plan-conditioned change-point interpreter, 9 = honest-read precision
   *  floor, 10 = plan-aligned reps with lap-derived metrics). Absent/1 on older
   *  rows; drives the backfill re-enrich predicate
   *  (ENRICH_SELECT_FILTER). */
  v?: number;
  /**
   * The plan-conditioned interpreter's (`interpretWorkout`) honest read — the
   * data-only argmax candidate, ignoring any plan, gated by the honest-quality
   * floor (a run banking < ~1 mi of grade-adjusted-fast work reads `none`, so a
   * couple of surges on an easy run don't credit as intervals). The rich
   * sub-floor reading is still retained in `candidates` for the slider + plan
   * matching. Absent on rows written before v8 (the flat fields above are the
   * only signal on those rows).
   */
  honest?: Reading;
  /**
   * The plan-conditioned interpreter's plan-matched read, when a prescribed
   * workout was in play and a candidate cleared the data-support floor AND
   * the plan-fit threshold. Null when no plan matched (including: no plan
   * wired at all — Task C1 always stores null here). Absent (not just null)
   * on rows written before v8.
   */
  matched?: (Reading & { matchesPlan: boolean; confidence: number; planWorkoutId?: string }) | null;
  /**
   * The CROPS coarse→fine candidate ladder — the segmentations the run-detail
   * granularity slider (Task E3) scrubs. Absent on rows written before v8.
   */
  candidates?: Reading[];
  /** Index into `candidates` for the computed default (`honest === candidates[defaultIdx]`). */
  defaultIdx?: number;
}

export interface StreamSummary {
  pace_curve: ActivityCurvePoint[];
  pace_duration_curve: ActivityDurationCurvePoint[];
  early_miles: EarlyMiles;
  /** Precomputed quality verdict. Optional: rows written before this change lack it. */
  quality?: QualitySummary;
}
