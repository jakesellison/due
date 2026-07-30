/**
 * resolveQuality.test.ts — override ?? matched ?? honest precedence.
 */
import {
  resolveQuality,
  type ResolvableQuality,
} from '../resolveQuality';
import type { Reading } from '../interpretWorkout';

const reading = (kind: Reading['kind'], qualityMi: number, summary = ''): Reading => ({
  kind,
  qualityMi,
  blocks: [],
  summary,
});

// A v8+ verdict: honest tempo 9mi, no plan match, a candidate ladder whose
// index 1 is a finer intervals reading.
const q: ResolvableQuality = {
  kind: 'tempo',
  summary: '9.0mi tempo',
  qualityDistanceMeters: 9 * 1609.344,
  honest: reading('tempo', 9),
  matched: null,
  candidates: [reading('tempo', 9), reading('intervals', 6), reading('none', 0)],
};

describe('resolveQuality — override ?? matched ?? honest', () => {
  test('no override → matched ?? honest (honest here)', () => {
    const r = resolveQuality(q, null);
    expect(r.kind).toBe('tempo');
    expect(r.qualityMi).toBe(9);
  });

  test('matched wins over honest when present and no override', () => {
    const withMatch: ResolvableQuality = {
      ...q,
      matched: { ...reading('intervals', 6), matchesPlan: true, confidence: 0.9 },
    };
    expect(resolveQuality(withMatch, null).qualityMi).toBe(6);
  });

  test("choice 'candidate' credits candidates[idx]", () => {
    expect(resolveQuality(q, { choice: 'candidate', idx: 1 }).qualityMi).toBe(6);
  });

  test("choice 'none' suppresses credit", () => {
    const r = resolveQuality(q, { choice: 'none' });
    expect(r.kind).toBe('none');
    expect(r.qualityMi).toBe(0);
  });

  test("choice 'plan' forces the matched read (falls back to honest when no match)", () => {
    const withMatch: ResolvableQuality = {
      ...q,
      matched: { ...reading('intervals', 6), matchesPlan: true, confidence: 0.9 },
    };
    expect(resolveQuality(withMatch, { choice: 'plan' }).qualityMi).toBe(6);
    // no matched → falls back to honest
    expect(resolveQuality(q, { choice: 'plan' }).qualityMi).toBe(9);
  });

  test("candidate override with an out-of-range idx falls back to stored credit", () => {
    expect(resolveQuality(q, { choice: 'candidate', idx: 99 }).qualityMi).toBe(9);
  });

  test('pre-v8 row (no honest/matched/candidates) resolves from flat fields', () => {
    const flat: ResolvableQuality = {
      kind: 'intervals',
      summary: '4×1mi',
      qualityDistanceMeters: 4 * 1609.344,
      honest: undefined,
      matched: undefined,
      candidates: undefined,
    };
    const r = resolveQuality(flat, null);
    expect(r.kind).toBe('intervals');
    expect(r.qualityMi).toBeCloseTo(4);
    // an override still applies on top of the flat fallback
    expect(resolveQuality(flat, { choice: 'none' }).kind).toBe('none');
  });
});
