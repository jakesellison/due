/**
 * invalidatePlanActivityCaches — must refresh every derived view a plan/activity
 * write can affect, and qualityOverridesKey must be stable per plan + week range
 * (independent of the activity-id set) so cache entries are reused and matched by
 * a single invalidation key.
 */
import { invalidatePlanActivityCaches, qualityOverridesKey } from '../cache';

describe('invalidatePlanActivityCaches', () => {
  test('invalidates activePlan, activities, activity (detail), shoes, plan identities, and quality-overrides keys', async () => {
    const invalidateQueries = jest.fn().mockResolvedValue(undefined);
    const qc = { invalidateQueries } as unknown as Parameters<
      typeof invalidatePlanActivityCaches
    >[0];

    await invalidatePlanActivityCaches(qc);

    const families = invalidateQueries.mock.calls.map((c) => c[0].queryKey[0]);
    expect(families).toEqual(
      expect.arrayContaining(['activePlan', 'activities', 'activity', 'shoes', 'planIdentitySources', 'quality-overrides']),
    );
  });

  // audit-code Lane 4 Low: the helper used to invalidate only the ['activities']
  // LIST key, leaving an already-open single-activity detail row
  // (['activity', id], see activityDetail.ts's useActivityRow) stale after a
  // re-sync/enrich wrote new streams/route/laps for it.
  test('the activity-detail invalidation uses the partial (prefix) key so it matches every id', async () => {
    const invalidateQueries = jest.fn().mockResolvedValue(undefined);
    const qc = { invalidateQueries } as unknown as Parameters<
      typeof invalidatePlanActivityCaches
    >[0];

    await invalidatePlanActivityCaches(qc);

    const detailCall = invalidateQueries.mock.calls.find((c) => c[0].queryKey[0] === 'activity');
    expect(detailCall?.[0].queryKey).toEqual(['activity']);
  });

  test('the quality-overrides invalidation uses the partial (prefix) key', async () => {
    const invalidateQueries = jest.fn().mockResolvedValue(undefined);
    const qc = { invalidateQueries } as unknown as Parameters<
      typeof invalidatePlanActivityCaches
    >[0];

    await invalidatePlanActivityCaches(qc);

    const qoCall = invalidateQueries.mock.calls.find(
      (c) => c[0].queryKey[0] === 'quality-overrides',
    );
    // Prefix-only key matches every per-week entry under react-query.
    expect(qoCall?.[0].queryKey).toEqual(['quality-overrides']);
  });
});

describe('qualityOverridesKey', () => {
  test('is stable for a given plan + week range, regardless of activity IDs', () => {
    // The key is built from plan id + week bounds only — it must NOT depend on
    // which activities fall in the week, so the cache entry is reused.
    const a = qualityOverridesKey('plan-1', '2026-06-15', '2026-06-21');
    const b = qualityOverridesKey('plan-1', '2026-06-15', '2026-06-21');
    expect(a).toEqual(b);
    expect(a).toEqual(['quality-overrides', 'plan-1', '2026-06-15', '2026-06-21']);
  });

  test('distinct plan/week ranges produce distinct keys', () => {
    expect(qualityOverridesKey('plan-1', '2026-06-15', '2026-06-21')).not.toEqual(
      qualityOverridesKey('plan-1', '2026-06-22', '2026-06-28'),
    );
    expect(qualityOverridesKey('plan-1', '2026-06-15', '2026-06-21')).not.toEqual(
      qualityOverridesKey('plan-2', '2026-06-15', '2026-06-21'),
    );
  });

  test('omits absent segments so the prefix key matches the full key', () => {
    expect(qualityOverridesKey()).toEqual(['quality-overrides']);
    expect(qualityOverridesKey('plan-1')).toEqual(['quality-overrides', 'plan-1']);
    // Full per-week key starts with the invalidation prefix.
    const full = qualityOverridesKey('plan-1', '2026-06-15', '2026-06-21');
    const prefix = qualityOverridesKey();
    expect(full.slice(0, prefix.length)).toEqual(prefix);
  });
});
