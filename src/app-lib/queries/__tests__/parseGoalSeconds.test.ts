/**
 * Unit tests for `parseGoalSeconds` (the Postgres-`interval` → seconds parser
 * that feeds the Trends goal line). Runs under the `app` Jest project because
 * the module transitively imports RN/Supabase code; the goal parser itself is
 * pure.
 */
// The module transitively imports the real Supabase client (which throws when
// config isn't baked into the test build), so stub it out.
jest.mock('../../supabase', () => ({ supabase: {} }));

import { parseGoalSeconds } from '../prediction';

describe('parseGoalSeconds', () => {
  it('parses H:MM:SS marathon-style goal times', () => {
    expect(parseGoalSeconds('02:36:00')).toBe(2 * 3600 + 36 * 60);
    expect(parseGoalSeconds('2:36:00')).toBe(2 * 3600 + 36 * 60);
    expect(parseGoalSeconds('0:48:00')).toBe(48 * 60);
    expect(parseGoalSeconds('3:07:42')).toBe(3 * 3600 + 7 * 60 + 42);
  });

  it('parses the two-field H:MM form (no seconds) as hours:minutes', () => {
    // The regex makes the seconds group optional → "1:30" is 1h30m.
    expect(parseGoalSeconds('1:30')).toBe(3600 + 30 * 60);
    expect(parseGoalSeconds('0:48')).toBe(48 * 60);
  });

  it('trims surrounding whitespace', () => {
    expect(parseGoalSeconds('  2:36:00  ')).toBe(2 * 3600 + 36 * 60);
  });

  it('returns null for missing input', () => {
    expect(parseGoalSeconds(null)).toBeNull();
    expect(parseGoalSeconds(undefined)).toBeNull();
    expect(parseGoalSeconds('')).toBeNull();
  });

  it('returns null for unparseable shapes', () => {
    expect(parseGoalSeconds('abc')).toBeNull();
    expect(parseGoalSeconds('2h36m')).toBeNull();
    expect(parseGoalSeconds('2:36:00:00')).toBeNull(); // too many fields
    expect(parseGoalSeconds('2:360:00')).toBeNull(); // minutes field >2 digits
    expect(parseGoalSeconds('36')).toBeNull(); // single field
  });

  it('handles large hour values', () => {
    expect(parseGoalSeconds('10:00:00')).toBe(10 * 3600);
    expect(parseGoalSeconds('100:00:00')).toBe(100 * 3600);
  });
});
