import {
  STARTER_CATALOG,
  starterById,
} from '../catalog';

const DISTANCE_ORDER = ['5k', '10k', 'half', 'marathon'];

describe('STARTER_CATALOG', () => {
  it('exposes well-formed metadata for every entry', () => {
    // 12 rows (4 distances × 3 tiers); numWeeks/peakMiles are reconciled against
    // the shipped `.due.json` content by the invariant suite.
    expect(STARTER_CATALOG.length).toBe(12);

    const ids = new Set<string>();
    for (const s of STARTER_CATALOG) {
      expect(typeof s.id).toBe('string');
      expect(s.id.length).toBeGreaterThan(0);
      expect(ids.has(s.id)).toBe(false); // ids unique
      ids.add(s.id);
      expect(typeof s.name).toBe('string');
      expect(s.name.length).toBeGreaterThan(0);
      expect(DISTANCE_ORDER).toContain(s.distanceKind);
      expect([30, 45, 60]).toContain(s.tierMpw);
      expect(s.numWeeks).toBeGreaterThan(0);
      expect(s.peakMiles).toBeGreaterThan(0);
      expect(typeof s.load).toBe('function');
    }
  });

  it('is ordered by distance (5k → marathon), then tier 30 → 60', () => {
    const order = STARTER_CATALOG.map((s) => `${s.distanceKind}-${s.tierMpw}`);
    const expected: string[] = [];
    for (const d of DISTANCE_ORDER) for (const t of [30, 45, 60]) expected.push(`${d}-${t}`);
    expect(order).toEqual(expected);
  });

  it('looks up by id and returns null for unknown ids', () => {
    expect(starterById('half-45')?.name).toBe('Half · 45 mpw');
    expect(starterById('nope')).toBe(null);
  });

  it('load() lazily normalizes .due content and memoizes', () => {
    const first = STARTER_CATALOG[0]!;
    const plan = first.load();
    expect(plan.formatVersion).toBe(3);
    expect(plan.source).toBe('starter');
    expect(plan.workouts.length).toBeGreaterThan(0);
    // Reconciled: catalog numWeeks matches the authored content.
    expect(plan.plan.numWeeks).toBe(first.numWeeks);
    // Memoized: same reference on a second call.
    expect(first.load()).toBe(plan);
  });
});
