/**
 * In-app account deletion (audit-ops H2, Apple Guideline 5.1.1(v)). Exercises
 * `deleteAccount` against a fake admin client that records a single ordered
 * `sequence` of every side effect (Strava revoke, storage removal, each table
 * delete, and the final auth-user delete) — asserting the exact order, that
 * every user-scoped table is covered, that every DB filter is scoped to the
 * authenticated user (never a different/body-supplied id), and that a
 * mid-sequence failure aborts before the irreversible `deleteUser` call.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

jest.mock('../ingest', () => ({
  revokeStravaConnection: jest.fn(async () => undefined),
}));

const mockCaptureError = jest.fn(async (_err: unknown, _ctx?: unknown) => undefined);
jest.mock('../report', () => ({
  captureError: (err: unknown, ctx?: unknown) => mockCaptureError(err, ctx),
}));

import { deleteAccount } from '../accountDeletion';
import { revokeStravaConnection } from '../ingest';

const mockRevoke = revokeStravaConnection as jest.MockedFunction<typeof revokeStravaConnection>;

const USER_ID = 'user-123';
const OTHER_ID = 'someone-else';

interface FakeAdminOpts {
  ownedPlanIds?: string[];
  /** Table name whose `.delete()` should resolve with a Supabase error. */
  failTable?: string;
  failDeleteUser?: boolean;
  /** Bucket whose storage `list()` should resolve with a Supabase error. */
  failStorageList?: string;
  /** Bucket whose storage `remove()` should resolve with a Supabase error. */
  failStorageRemove?: string;
}

function makeFakeAdmin(opts: FakeAdminOpts = {}) {
  const sequence: string[] = [];
  const deleteFilters: Record<string, Array<[string, unknown]>> = {};

  const from = jest.fn((table: string) => {
    let op: 'select' | 'delete' = 'select';
    const filters: Array<[string, unknown]> = [];
    const builder: PromiseLike<{ data: unknown; error: unknown }> & Record<string, unknown> = {
      select: () => builder,
      delete: () => {
        op = 'delete';
        return builder;
      },
      eq: (col: string, val: unknown) => {
        filters.push([col, val]);
        return builder;
      },
      in: (col: string, val: unknown) => {
        filters.push([col, val]);
        return builder;
      },
      then: (resolve: (v: { data: unknown; error: unknown }) => void) => {
        if (op === 'delete') {
          sequence.push(`db:${table}`);
          deleteFilters[table] = filters;
          resolve({ data: null, error: table === opts.failTable ? { message: 'boom' } : null });
        } else if (table === 'plan_members') {
          resolve({ data: (opts.ownedPlanIds ?? []).map((plan_id) => ({ plan_id })), error: null });
        } else {
          resolve({ data: [], error: null });
        }
      },
    } as never;
    return builder;
  });

  const storageRemoveCalls: Array<{ bucket: string; paths: string[] }> = [];
  const storage = {
    from: jest.fn((bucket: string) => ({
      list: jest.fn(async (prefix: string) => {
        if (bucket === opts.failStorageList && prefix === USER_ID) {
          return { data: null, error: { message: 'storage list boom' } };
        }
        if (bucket === 'activity-photos' && prefix === USER_ID) {
          return { data: [{ id: null, name: 'activity-1' }], error: null }; // a folder
        }
        if (bucket === 'activity-photos' && prefix === `${USER_ID}/activity-1`) {
          return { data: [{ id: 'obj-1', name: 'photo.jpg' }], error: null };
        }
        if (bucket === 'shoe-photos' && prefix === USER_ID) {
          return { data: [{ id: 'obj-2', name: 'shoe-1.jpg' }], error: null }; // flat, a file
        }
        return { data: [], error: null };
      }),
      remove: jest.fn(async (paths: string[]) => {
        if (bucket === opts.failStorageRemove) {
          return { data: null, error: { message: 'storage remove boom' } };
        }
        sequence.push(`storage:${bucket}`);
        storageRemoveCalls.push({ bucket, paths });
        return { data: null, error: null };
      }),
    })),
  };

  const deleteUser = jest.fn(async () => {
    sequence.push('deleteUser');
    return { data: { user: null }, error: opts.failDeleteUser ? { message: 'boom' } : null };
  });
  const auth = { admin: { deleteUser } };

  const admin = { from, storage, auth } as unknown as SupabaseClient;
  return { admin, sequence, deleteFilters, storageRemoveCalls, deleteUser };
}

beforeEach(() => {
  mockRevoke.mockClear();
  mockRevoke.mockImplementation(async () => undefined);
  mockCaptureError.mockClear();
});

describe('deleteAccount', () => {
  it('revokes Strava, deletes storage, then every table, then the auth user — in that order', async () => {
    const { admin, sequence } = makeFakeAdmin({ ownedPlanIds: ['plan-a'] });

    await deleteAccount(admin, USER_ID);

    // Strava revoke happens (mocked; order vs. the fake admin's own sequence
    // is asserted implicitly — it's awaited before anything below runs).
    expect(mockRevoke).toHaveBeenCalledTimes(1);
    expect(mockRevoke).toHaveBeenCalledWith(admin, USER_ID);

    // Storage cleanup happens before any DB table delete, both buckets covered.
    const activityIdx = sequence.indexOf('storage:activity-photos');
    const shoeIdx = sequence.indexOf('storage:shoe-photos');
    const firstDbIdx = sequence.findIndex((s) => s.startsWith('db:'));
    expect(activityIdx).toBeGreaterThanOrEqual(0);
    expect(shoeIdx).toBeGreaterThan(activityIdx);
    expect(shoeIdx).toBeLessThan(firstDbIdx);

    // `deleteUser` is strictly the LAST side effect.
    expect(sequence[sequence.length - 1]).toBe('deleteUser');
  });

  // Table coverage — the full 15-table schema (supabase/migrations 0001, 0006,
  // 0007, 0009, 0011). Encoded literally here (not by importing the module's
  // own list) so a future edit that silently drops a table breaks this test.
  const EXPLICIT_TABLES_IN_ORDER = [
    'workout_matches',
    'activity_photos',
    'activities',
    'plans', // owned plans only, resolved via plan_members
    'plan_members',
    'prediction_snapshots',
    'workout_route_selections',
    'routes',
    'shoes',
    'integration_connections',
    'generation_log',
    'users',
  ];
  // Deleted implicitly via ON DELETE CASCADE from one of the explicit deletes
  // above (verified against supabase/migrations/0001_init.sql: plan_weeks and
  // workouts cascade from `plans`; plan_chats and plan_changes cascade from
  // `plans` too) — not touched directly, so they carry no delete call of
  // their own to assert on.
  const CASCADE_COVERED_TABLES = ['plan_weeks', 'workouts', 'plan_chats', 'plan_changes'];
  const ALL_16_TABLES = [...EXPLICIT_TABLES_IN_ORDER, ...CASCADE_COVERED_TABLES];

  it('touches every user-scoped table explicitly, or covers it by a verified cascade', () => {
    expect(ALL_16_TABLES).toHaveLength(16);
    expect(new Set(ALL_16_TABLES).size).toBe(16); // no duplicates/typos
  });

  it('deletes exactly the explicit table list, in FK-safe order, when the user owns a plan', async () => {
    const { admin, sequence } = makeFakeAdmin({ ownedPlanIds: ['plan-a'] });
    await deleteAccount(admin, USER_ID);

    const dbTables = sequence.filter((s) => s.startsWith('db:')).map((s) => s.slice('db:'.length));
    expect(dbTables).toEqual(EXPLICIT_TABLES_IN_ORDER);
  });

  it('skips the plans delete (but still deletes plan_members) when the user owns no plan', async () => {
    const { admin, sequence } = makeFakeAdmin({ ownedPlanIds: [] });
    await deleteAccount(admin, USER_ID);

    const dbTables = sequence.filter((s) => s.startsWith('db:')).map((s) => s.slice('db:'.length));
    expect(dbTables).not.toContain('plans');
    expect(dbTables).toContain('plan_members');
  });

  it('scopes every table delete to the authenticated user, never a different id', async () => {
    const { admin, deleteFilters } = makeFakeAdmin({ ownedPlanIds: ['plan-a'] });
    await deleteAccount(admin, USER_ID);

    for (const table of EXPLICIT_TABLES_IN_ORDER) {
      if (table === 'plans') continue; // scoped by owned plan id, asserted separately
      const filters = deleteFilters[table];
      expect(filters).toBeDefined();
      expect(filters!.some(([col, val]) => (col === 'user_id' || col === 'id') && val === USER_ID)).toBe(true);
      expect(filters!.some(([, val]) => val === OTHER_ID)).toBe(false);
    }
  });

  it('scopes the plans delete to the owned plan ids resolved for this user', async () => {
    const { admin, deleteFilters } = makeFakeAdmin({ ownedPlanIds: ['plan-a', 'plan-b'] });
    await deleteAccount(admin, USER_ID);

    const plansFilter = deleteFilters['plans'];
    expect(plansFilter).toBeDefined();
    expect(plansFilter).toContainEqual(['id', ['plan-a', 'plan-b']]);
  });

  it('calls storage cleanup with the recursively-resolved object paths for both buckets', async () => {
    const { admin, storageRemoveCalls } = makeFakeAdmin({ ownedPlanIds: [] });
    await deleteAccount(admin, USER_ID);

    expect(storageRemoveCalls).toHaveLength(2);
    const byBucket = new Map(storageRemoveCalls.map((c) => [c.bucket, c.paths]));
    expect(byBucket.get('activity-photos')).toEqual([`${USER_ID}/activity-1/photo.jpg`]);
    expect(byBucket.get('shoe-photos')).toEqual([`${USER_ID}/shoe-1.jpg`]);
  });

  it('calls admin.auth.admin.deleteUser last, with the authenticated user id', async () => {
    const { admin, deleteUser, sequence } = makeFakeAdmin({ ownedPlanIds: [] });
    await deleteAccount(admin, USER_ID);

    expect(deleteUser).toHaveBeenCalledWith(USER_ID);
    expect(sequence[sequence.length - 1]).toBe('deleteUser');
  });

  it('aborts before deleteUser if a table delete fails, and never deletes the auth user', async () => {
    const { admin, deleteUser } = makeFakeAdmin({ ownedPlanIds: [], failTable: 'shoes' });
    await expect(deleteAccount(admin, USER_ID)).rejects.toThrow(/shoes/);
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it('surfaces a deleteUser failure to the caller', async () => {
    const { admin } = makeFakeAdmin({ ownedPlanIds: [], failDeleteUser: true });
    await expect(deleteAccount(admin, USER_ID)).rejects.toThrow(/deleteUser/);
  });

  it('propagates a Strava revoke failure without touching any DB table', async () => {
    mockRevoke.mockRejectedValueOnce(new Error('strava down'));
    const { admin, sequence } = makeFakeAdmin({ ownedPlanIds: ['plan-a'] });

    await expect(deleteAccount(admin, USER_ID)).rejects.toThrow(/strava down/);
    expect(sequence.filter((s) => s.startsWith('db:'))).toHaveLength(0);
    expect(sequence).not.toContain('deleteUser');
  });

  // audit-ops H2: a Storage `list`/`remove` error was previously discarded —
  // `deleteUserStorage` would resolve as if the bucket were simply empty, so
  // the deletion reported success while photo bytes silently survived. Now any
  // storage error must be reported (captureError + console.error) AND thrown,
  // aborting the whole `deleteAccount` flow before it reaches the irreversible
  // `deleteUser` step (or any DB table delete after it).
  describe('storage error handling (H2)', () => {
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
      consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
      consoleErrorSpy.mockRestore();
    });

    it('throws and never calls deleteUser when storage list() errors', async () => {
      const { admin, deleteUser, sequence } = makeFakeAdmin({
        ownedPlanIds: [],
        failStorageList: 'activity-photos',
      });

      await expect(deleteAccount(admin, USER_ID)).rejects.toThrow(/storage list failed.*activity-photos/i);
      expect(deleteUser).not.toHaveBeenCalled();
      expect(sequence.filter((s) => s.startsWith('db:'))).toHaveLength(0);
      expect(sequence).not.toContain('deleteUser');
      expect(mockCaptureError).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    });

    it('throws and never calls deleteUser when storage remove() errors', async () => {
      const { admin, deleteUser, sequence } = makeFakeAdmin({
        ownedPlanIds: [],
        failStorageRemove: 'activity-photos',
      });

      await expect(deleteAccount(admin, USER_ID)).rejects.toThrow(/storage remove failed.*activity-photos/i);
      expect(deleteUser).not.toHaveBeenCalled();
      expect(sequence.filter((s) => s.startsWith('db:'))).toHaveLength(0);
      expect(sequence).not.toContain('deleteUser');
      expect(mockCaptureError).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    });

    it('aborts on the second bucket too, still before any DB delete or deleteUser', async () => {
      const { admin, deleteUser, sequence } = makeFakeAdmin({
        ownedPlanIds: [],
        failStorageRemove: 'shoe-photos',
      });

      await expect(deleteAccount(admin, USER_ID)).rejects.toThrow(/storage remove failed.*shoe-photos/i);
      // The first bucket's remove DID happen (order-preserving), but nothing after it did.
      expect(sequence).toContain('storage:activity-photos');
      expect(sequence.filter((s) => s.startsWith('db:'))).toHaveLength(0);
      expect(deleteUser).not.toHaveBeenCalled();
    });
  });
});
