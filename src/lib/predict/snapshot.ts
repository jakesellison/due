/**
 * Pure builder for a daily prediction SNAPSHOT row — the self-measurement layer.
 *
 * Each day we freeze the race prediction so that, when a real race result later
 * lands, we can grade the frozen `predicted_seconds` against the actual finish.
 * This module is the PURE, node-tested half: it folds a `RacePrediction` (plus
 * the plan context) into the exact JSON payload the `prediction_snapshots` table
 * stores — no Supabase, no React, no clock. The app-side `snapshots.ts` upserts
 * whatever this returns.
 *
 * Payload discipline (keep the row small + stable):
 *  - all *seconds* fields are ROUNDED TO INTEGERS (the table columns are int),
 *  - the 39-feature vector is rounded to 4 decimal places (NaN → null) so the
 *    jsonb stays compact and diffable,
 *  - `model_version` is taken verbatim from the prediction (e.g. `ridge_v2`,
 *    `ridge_v1+anchor`, `parametric`) — derived upstream from which component
 *    drove the estimate.
 *
 * Conventions: distances metres, times seconds, dates civil 'YYYY-MM-DD'.
 */

import type { RacePrediction } from './ensemble';

/** The component estimates frozen into a snapshot (all seconds are integers). */
export interface SnapshotComponents {
  /** Ridge v2 marathon-model estimate (s), when v2 drove/contributed. */
  ridgeV2?: number;
  /** Ridge v1 fallback-model estimate (s). */
  ridge?: number;
  /** Tanda volume/pace estimate (s). */
  tanda?: number;
  /** Riegel best-effort estimate (s). */
  riegel?: number;
  /** The Tanda/Riegel parametric blend (s). */
  parametric?: number;
  /** The race anchor: projection (s) + blend weight + race date, when present. */
  anchor?: { seconds: number; weight: number; raceDate: string };
  /** The personal race curve estimate (s) — v3's primary when present. */
  personalCurve?: number;
}

/** The full row payload upserted into `prediction_snapshots`. */
export interface SnapshotPayload {
  /** Owner user id (RLS subject). */
  user_id: string;
  /** Active plan id, or null when none. */
  plan_id: string | null;
  /** Civil 'YYYY-MM-DD' this snapshot is keyed to (the upsert dedup key). */
  snapshot_date: string;
  /** Target race distance, metres. */
  target_meters: number;
  /** The plan's race date (civil 'YYYY-MM-DD'), or null. */
  race_date: string | null;
  /** Predicted finish, integer seconds. */
  predicted_seconds: number;
  /** Lower band edge (faster), integer seconds, or null. */
  low_seconds: number | null;
  /** Upper band edge (slower), integer seconds, or null. */
  high_seconds: number | null;
  /** Confidence tier. */
  confidence: 'low' | 'medium' | 'high';
  /** The model that drove the estimate (e.g. 'ridge_v2+anchor'). */
  model_version: string;
  /** Per-component estimates (seconds as integers). */
  components: SnapshotComponents;
  /** The 39-feature vector as a flat object (4dp, NaN→null), or null. */
  features: Record<string, number | null> | null;
}

/** Plan context the snapshot row needs beyond the prediction itself. */
export interface SnapshotContext {
  /** Owner user id. */
  userId: string;
  /** Active plan id, or null. */
  planId: string | null;
  /** The plan's race date (civil 'YYYY-MM-DD'), or null. */
  raceDate: string | null;
  /** Target race distance, metres. */
  targetMeters: number;
}

/** Round to an integer, leaving null/non-finite as null. */
function roundInt(n: number | null | undefined): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.round(n);
}

/** Round to 4 decimal places; non-finite (incl. NaN) → null. */
function round4(n: number): number | null {
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 1e4) / 1e4;
}

/**
 * Fold a `RacePrediction` + plan context into the `prediction_snapshots` row
 * payload. Pure + deterministic — the app layer adds `as_of`/`created_at` (DB
 * defaults) and upserts the result.
 */
export function buildSnapshotPayload(
  ctx: SnapshotContext,
  prediction: RacePrediction,
  snapshotDate: string,
): SnapshotPayload {
  const c = prediction.components;
  const components: SnapshotComponents = {};
  if (c.ridgeV2 != null) components.ridgeV2 = Math.round(c.ridgeV2);
  if (c.ridge != null) components.ridge = Math.round(c.ridge);
  if (c.tanda != null) components.tanda = Math.round(c.tanda);
  if (c.riegel != null) components.riegel = Math.round(c.riegel);
  if (c.parametric != null) components.parametric = Math.round(c.parametric);
  if (c.personalCurve != null) components.personalCurve = Math.round(c.personalCurve);
  if (c.anchorMeta != null) {
    components.anchor = {
      seconds: Math.round(c.anchorMeta.seconds),
      weight: round4(c.anchorMeta.weight) ?? c.anchorMeta.weight,
      raceDate: c.anchorMeta.raceDate,
    };
  }

  let features: Record<string, number | null> | null = null;
  if (prediction.featureVector != null) {
    features = {};
    for (const [k, v] of Object.entries(prediction.featureVector)) {
      features[k] = round4(v as number);
    }
  }

  return {
    user_id: ctx.userId,
    plan_id: ctx.planId,
    snapshot_date: snapshotDate,
    // INTEGER column AND part of the (user, date, target) dedup key — round here
    // so the app-side key matches the stored row (a float like the half's 21097.5
    // would be silently truncated by the DB, breaking dedup → duplicate rows).
    target_meters: Math.round(ctx.targetMeters),
    race_date: ctx.raceDate,
    predicted_seconds: Math.round(prediction.seconds),
    low_seconds: roundInt(prediction.lowSeconds),
    high_seconds: roundInt(prediction.highSeconds),
    confidence: prediction.confidence,
    model_version: prediction.modelVersion,
    components,
    features,
  };
}
