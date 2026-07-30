/**
 * Node tests for the pure prediction-SNAPSHOT payload builder
 * (`src/lib/predict/snapshot.ts`). Asserts the row shape, integer/4dp rounding,
 * model_version pass-through, anchor structuring and NaN→null feature handling —
 * everything the app-side upsert relies on. Pure: no Supabase, no React.
 */
import {
  buildSnapshotPayload,
  type SnapshotContext,
} from '../predict/snapshot';
import type { RacePrediction } from '../predict/ensemble';
import type { RidgeV2FeatureVector } from '../predict/ridgeV2';

const CTX: SnapshotContext = {
  userId: 'user-123',
  planId: 'plan-abc',
  raceDate: '2026-10-11',
  targetMeters: 42195,
};

/** A minimal-but-typed v2 feature vector with a couple of telltale values. */
function featureVector(over: Partial<Record<string, number>> = {}): RidgeV2FeatureVector {
  // Only the fields we assert on need real values; cast keeps the test focused.
  return {
    tanda_P: 292.123456,
    wk_km_mean: 96.98765,
    pace_overall: 291.5,
    intensity_spread: NaN, // exercises the NaN → null path
    ...over,
  } as unknown as RidgeV2FeatureVector;
}

function basePrediction(over: Partial<RacePrediction> = {}): RacePrediction {
  return {
    seconds: 11068.4,
    lowSeconds: 9774.6,
    highSeconds: 12362.1,
    confidence: 'high',
    basis: 'model v2  14.5k blocks',
    modelVersion: 'ridge_v2',
    components: { ridgeV2: 11068.4, parametric: 11200.9 },
    featureVector: featureVector(),
    ...over,
  };
}

describe('buildSnapshotPayload', () => {
  it('produces the full row shape with plan context', () => {
    const p = buildSnapshotPayload(CTX, basePrediction(), '2026-06-04');
    expect(p.user_id).toBe('user-123');
    expect(p.plan_id).toBe('plan-abc');
    expect(p.race_date).toBe('2026-10-11');
    expect(p.target_meters).toBe(42195);
    expect(p.snapshot_date).toBe('2026-06-04');
    expect(p.confidence).toBe('high');
    expect(p.model_version).toBe('ridge_v2');
  });

  it('rounds all seconds fields to integers', () => {
    const p = buildSnapshotPayload(CTX, basePrediction(), '2026-06-04');
    expect(p.predicted_seconds).toBe(11068);
    expect(p.low_seconds).toBe(9775);
    expect(p.high_seconds).toBe(12362);
    expect(p.components.ridgeV2).toBe(11068);
    expect(p.components.parametric).toBe(11201);
    expect(Number.isInteger(p.predicted_seconds)).toBe(true);
  });

  it('rounds features to 4dp and maps NaN → null', () => {
    const p = buildSnapshotPayload(CTX, basePrediction(), '2026-06-04');
    expect(p.features).not.toBeNull();
    expect(p.features!.tanda_P).toBe(292.1235);
    expect(p.features!.wk_km_mean).toBe(96.9877);
    expect(p.features!.intensity_spread).toBeNull();
  });

  it('passes model_version through verbatim (e.g. ridge_v2+anchor)', () => {
    const p = buildSnapshotPayload(
      CTX,
      basePrediction({ modelVersion: 'ridge_v2+anchor' }),
      '2026-06-04',
    );
    expect(p.model_version).toBe('ridge_v2+anchor');
  });

  it('structures the anchor component {seconds,weight,raceDate}', () => {
    const p = buildSnapshotPayload(
      CTX,
      basePrediction({
        modelVersion: 'ridge_v2+anchor',
        components: {
          ridgeV2: 11068.4,
          anchor: 10980.7,
          anchorMeta: { seconds: 10980.7, weight: 0.6123456, raceDate: '2026-04-20' },
        },
      }),
      '2026-06-04',
    );
    expect(p.components.anchor).toEqual({
      seconds: 10981, // integer-rounded
      weight: 0.6123, // 4dp
      raceDate: '2026-04-20',
    });
  });

  it('emits null features when the parametric fallback drove it', () => {
    const p = buildSnapshotPayload(
      CTX,
      basePrediction({
        modelVersion: 'parametric',
        featureVector: undefined,
        components: { tanda: 11200, riegel: 11100, parametric: 11160 },
      }),
      '2026-06-04',
    );
    expect(p.features).toBeNull();
    expect(p.model_version).toBe('parametric');
    expect(p.components.tanda).toBe(11200);
  });

  it('tolerates a null plan + race date', () => {
    const p = buildSnapshotPayload(
      { userId: 'u', planId: null, raceDate: null, targetMeters: 21097 },
      basePrediction(),
      '2026-06-04',
    );
    expect(p.plan_id).toBeNull();
    expect(p.race_date).toBeNull();
    expect(p.target_meters).toBe(21097);
  });

  it('emits an integer target_meters so the dedup key matches the stored row', () => {
    // target_meters is an INTEGER column AND part of the snapshot dedup key
    // (user_id, snapshot_date, target_meters). The app-side key must equal the
    // value the DB stores. The half marathon used to feed 21097.5 (the column
    // truncated it), so the app key never matched the stored row → duplicate
    // snapshots accumulated. Whatever distance arrives, the payload key must be
    // an integer identical to what the INTEGER column persists.
    for (const meters of [21097, 42195, 10000, 5000]) {
      const p = buildSnapshotPayload(
        { userId: 'u', planId: null, raceDate: null, targetMeters: meters },
        basePrediction(),
        '2026-06-04',
      );
      expect(Number.isInteger(p.target_meters)).toBe(true);
      // No float drift: the emitted key equals the integer (which the DB stores
      // verbatim, so the next day's app-side key matches → dedup holds).
      expect(p.target_meters).toBe(meters);
    }
  });

  it('defensively rounds a non-integer targetMeters that slips through', () => {
    // Defense in depth: even if a caller hands the builder a raw 21097.5, the
    // emitted key is an integer (never a float a downstream INTEGER column would
    // silently round to something the app never computed).
    const p = buildSnapshotPayload(
      { userId: 'u', planId: null, raceDate: null, targetMeters: 21097.5 },
      basePrediction(),
      '2026-06-04',
    );
    expect(Number.isInteger(p.target_meters)).toBe(true);
    expect(p.target_meters).toBe(Math.round(21097.5));
  });

  it('persists personalCurve as an integer and round-trips through components', () => {
    const p = buildSnapshotPayload(
      CTX,
      basePrediction({
        modelVersion: 'personal_curve_v3',
        components: { ridgeV2: 11068.4, parametric: 11200.9, personalCurve: 10980.7 },
      }),
      '2026-06-04',
    );
    expect(p.components.personalCurve).toBe(10981); // integer-rounded
    expect(Number.isInteger(p.components.personalCurve!)).toBe(true);
    expect(p.model_version).toBe('personal_curve_v3');
  });
});
