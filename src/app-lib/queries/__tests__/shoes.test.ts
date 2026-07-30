/**
 * shapeShoes — merges the shoes table rows with the shoe_mileage view rows
 * into the UI's Shoe shape: camelCase, mileage totals attached, active shoes
 * first (default leading), retired shoes last.
 *
 * deleteShoe / setDefaultShoe — exercise the supabase chain to prove the
 * orphaned photo is removed from storage and the old default is cleared before
 * the new one is set (required by the unique idx_shoes_one_default index).
 */
// The supabase client throws at import time without baked config. shapeShoes is
// pure (ignores the stub); the query helpers drive this chainable mock.
// (`mock`-prefixed names are the only out-of-scope vars jest.mock() permits.)
const mockState: { calls: string[]; nextSelectData: unknown } = {
  calls: [],
  nextSelectData: null,
};
const mockStorageRemove = jest.fn(() => Promise.resolve({ data: [], error: null }));

// A query builder that is both chainable (every method returns it) and
// awaitable (resolves to { data, error }), recording method+arg trace order.
function mockMakeBuilder() {
  const data = mockState.nextSelectData;
  const builder: Record<string, unknown> = {};
  const record = (name: string) =>
    jest.fn((...args: unknown[]) => {
      mockState.calls.push(`${name}(${args.map((a) => JSON.stringify(a ?? '')).join(',')})`);
      return builder;
    });
  for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'neq', 'order']) {
    builder[m] = record(m);
  }
  builder.maybeSingle = jest.fn(() => Promise.resolve({ data, error: null }));
  builder.single = jest.fn(() => Promise.resolve({ data, error: null }));
  builder.then = (resolve: (v: unknown) => unknown) => resolve({ data, error: null });
  return builder;
}

const mockSupabase = {
  from: jest.fn(() => mockMakeBuilder()),
  storage: { from: jest.fn(() => ({ remove: mockStorageRemove })) },
};

// Lazy getter so the factory doesn't touch `mockSupabase` before it's assigned
// (jest hoists jest.mock above the const declarations above).
jest.mock('../../supabase', () => ({
  get supabase() {
    return mockSupabase;
  },
}));

import { deleteShoe, setDefaultShoe, shapeShoes } from '../shoes';

beforeEach(() => {
  mockState.calls = [];
  mockState.nextSelectData = null;
  mockStorageRemove.mockClear();
  mockSupabase.from.mockClear();
  mockSupabase.storage.from.mockClear();
});

const row = (over: Record<string, unknown>) => ({
  id: 'a',
  name: 'Pegasus',
  photo_path: null,
  starting_meters: 0,
  is_default: false,
  retired_at: null,
  ...over,
});

describe('shapeShoes', () => {
  test('attaches view totals and falls back to starting meters when unassigned', () => {
    const shoes = shapeShoes(
      [row({ id: 'a', starting_meters: 5000 }), row({ id: 'b', name: 'Vaporfly' })],
      [{ shoe_id: 'b', total_meters: 42_000, activity_count: 3 }],
    );
    expect(shoes.find((s) => s.id === 'a')).toMatchObject({
      totalMeters: 5000,
      activityCount: 0,
    });
    expect(shoes.find((s) => s.id === 'b')).toMatchObject({
      name: 'Vaporfly',
      totalMeters: 42_000,
      activityCount: 3,
    });
  });

  test('orders default first, then active, retired last', () => {
    const shoes = shapeShoes(
      [
        row({ id: 'retired', retired_at: '2026-01-01T00:00:00Z' }),
        row({ id: 'plain' }),
        row({ id: 'def', is_default: true }),
      ],
      [],
    );
    expect(shoes.map((s) => s.id)).toEqual(['def', 'plain', 'retired']);
  });

  test('attaches the signed photo URL by storage path (private bucket — never getPublicUrl)', () => {
    const photoUrls = new Map([['user-1/shoe-a.jpg', 'https://signed.example/a?token=1']]);
    const shoes = shapeShoes(
      [row({ id: 'a', photo_path: 'user-1/shoe-a.jpg' }), row({ id: 'b', photo_path: null })],
      [],
      photoUrls,
    );
    expect(shoes.find((s) => s.id === 'a')?.photoUrl).toBe('https://signed.example/a?token=1');
    // No photo on the shoe → no lookup, regardless of what's in the map.
    expect(shoes.find((s) => s.id === 'b')?.photoUrl).toBeNull();
  });

  test('a photo path with no matching signed URL (mint failed) falls back to null, not a guess', () => {
    const shoes = shapeShoes([row({ id: 'a', photo_path: 'user-1/shoe-a.jpg' })], [], new Map());
    expect(shoes[0]?.photoUrl).toBeNull();
  });

  test('omitting the photoUrls map entirely (no photos to sign) yields null photoUrl', () => {
    const shoes = shapeShoes([row({ id: 'a', photo_path: 'user-1/shoe-a.jpg' })], []);
    expect(shoes[0]?.photoUrl).toBeNull();
  });
});

describe('deleteShoe', () => {
  test('removes the orphaned storage photo with the shoe', async () => {
    mockState.nextSelectData = { photo_path: 'user-1/shoe-1.jpg' };
    await deleteShoe('shoe-1');
    expect(mockSupabase.storage.from).toHaveBeenCalledWith('shoe-photos');
    expect(mockStorageRemove).toHaveBeenCalledWith(['user-1/shoe-1.jpg']);
  });

  test('skips storage removal when the shoe has no photo', async () => {
    mockState.nextSelectData = { photo_path: null };
    await deleteShoe('shoe-2');
    expect(mockStorageRemove).not.toHaveBeenCalled();
  });
});

describe('setDefaultShoe', () => {
  test('clears the existing default before setting the new one', async () => {
    await setDefaultShoe('shoe-9');
    // The unique partial index idx_shoes_one_default forbids two live defaults,
    // so the old default MUST be cleared (update is_default:false) before the
    // new one is set (update is_default:true) — setting first would trip the
    // constraint against real Postgres.
    const clearIdx = mockState.calls.indexOf('update({"is_default":false})');
    const setIdx = mockState.calls.indexOf('update({"is_default":true})');
    expect(clearIdx).toBeGreaterThanOrEqual(0);
    expect(setIdx).toBeGreaterThanOrEqual(0);
    expect(clearIdx).toBeLessThan(setIdx);
  });
});
