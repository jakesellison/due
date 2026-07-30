/**
 * Smoke tests for the prediction-snapshot logging runtime (`snapshots.ts`,
 * `app` Jest project). The Supabase client + AsyncStorage are mocked so we can
 * assert that:
 *   - `logPredictionSnapshot` upserts on the right conflict key and reports
 *     success/failure without ever throwing,
 *   - `maybeLogPredictionSnapshot` fires AT MOST once per (day, target) and
 *     swallows every error so the UI is never affected.
 */
jest.mock('../supabase', () => {
  const upsertCalls: Array<{ payload: any; opts: any }> = [];
  let nextError: { message: string } | null = null;
  let throwNext = false;
  const upsert = jest.fn((payload: unknown, opts: unknown) => {
    if (throwNext) {
      throwNext = false;
      throw new Error('boom');
    }
    upsertCalls.push({ payload, opts });
    return Promise.resolve({ error: nextError });
  });
  return {
    supabase: { from: jest.fn(() => ({ upsert })) },
    __upsertCalls: upsertCalls,
    __setNextError: (e: { message: string } | null) => {
      nextError = e;
    },
    __throwNext: () => {
      throwNext = true;
    },
  };
});

import {
  logPredictionSnapshot,
  maybeLogPredictionSnapshot,
  __resetSnapshotSession,
} from '../snapshots';
import type { RacePrediction, SnapshotContext } from '@/lib';
import AsyncStorage from '@react-native-async-storage/async-storage';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const supa = require('../supabase') as {
  __upsertCalls: Array<{ payload: any; opts: any }>;
  __setNextError: (e: { message: string } | null) => void;
  __throwNext: () => void;
};

const CTX: SnapshotContext = {
  userId: 'u1',
  planId: 'p1',
  raceDate: '2026-10-11',
  targetMeters: 42195,
};

const PREDICTION: RacePrediction = {
  seconds: 11068,
  lowSeconds: 9775,
  highSeconds: 12362,
  confidence: 'high',
  basis: 'model v2  14.5k blocks',
  modelVersion: 'ridge_v2',
  components: { ridgeV2: 11068 },
  featureVector: { tanda_P: 292.1 } as any,
};

/** Let the fire-and-forget async chain settle. */
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(async () => {
  supa.__upsertCalls.length = 0;
  supa.__setNextError(null);
  __resetSnapshotSession();
  await AsyncStorage.clear();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  (console.warn as jest.Mock).mockRestore?.();
});

describe('logPredictionSnapshot', () => {
  it('upserts on the (user,date,target) conflict key and returns true', async () => {
    const ok = await logPredictionSnapshot(CTX, PREDICTION, '2026-06-04');
    expect(ok).toBe(true);
    expect(supa.__upsertCalls).toHaveLength(1);
    const { payload, opts } = supa.__upsertCalls[0]!;
    expect(payload).toMatchObject({
      user_id: 'u1',
      snapshot_date: '2026-06-04',
      target_meters: 42195,
      predicted_seconds: 11068,
      model_version: 'ridge_v2',
    });
    expect(opts).toEqual({ onConflict: 'user_id,snapshot_date,target_meters' });
  });

  it('returns false and warns (never throws) on a Supabase error', async () => {
    supa.__setNextError({ message: 'rls denied' });
    const ok = await logPredictionSnapshot(CTX, PREDICTION, '2026-06-04');
    expect(ok).toBe(false);
    expect(console.warn).toHaveBeenCalled();
  });

  it('swallows a thrown client error', async () => {
    supa.__throwNext();
    await expect(logPredictionSnapshot(CTX, PREDICTION, '2026-06-04')).resolves.toBe(false);
    expect(console.warn).toHaveBeenCalled();
  });
});

describe('maybeLogPredictionSnapshot', () => {
  it('fires exactly once per (day, target) across many renders', async () => {
    for (let i = 0; i < 5; i++) maybeLogPredictionSnapshot(CTX, PREDICTION, '2026-06-04');
    await flush();
    expect(supa.__upsertCalls).toHaveLength(1);
    // The AsyncStorage marker was written for the day+target.
    expect(await AsyncStorage.getItem('snap-2026-06-04-42195')).toBe('1');
  });

  it('does not re-fire when the AsyncStorage marker already exists', async () => {
    await AsyncStorage.setItem('snap-2026-06-04-42195', '1');
    maybeLogPredictionSnapshot(CTX, PREDICTION, '2026-06-04');
    await flush();
    expect(supa.__upsertCalls).toHaveLength(0);
  });

  it('fires separately for a different target distance', async () => {
    maybeLogPredictionSnapshot(CTX, PREDICTION, '2026-06-04');
    maybeLogPredictionSnapshot({ ...CTX, targetMeters: 21097 }, PREDICTION, '2026-06-04');
    await flush();
    expect(supa.__upsertCalls).toHaveLength(2);
  });

  it('allows a retry next render after a failed upsert (no marker written)', async () => {
    supa.__setNextError({ message: 'transient' });
    maybeLogPredictionSnapshot(CTX, PREDICTION, '2026-06-04');
    await flush();
    expect(await AsyncStorage.getItem('snap-2026-06-04-42195')).toBeNull();

    // Next render: error cleared, the snapshot now lands.
    supa.__setNextError(null);
    maybeLogPredictionSnapshot(CTX, PREDICTION, '2026-06-04');
    await flush();
    expect(supa.__upsertCalls.length).toBeGreaterThanOrEqual(1);
    expect(await AsyncStorage.getItem('snap-2026-06-04-42195')).toBe('1');
  });
});
