import {
  suggestTier,
} from '../suggestTier';

describe('suggestTier', () => {
  it('returns null when recent mileage is unknown', () => {
    expect(suggestTier(null)).toBe(null);
  });

  it('snaps to the nearest tier of [30, 45, 60]', () => {
    // Brief test vector.
    expect(suggestTier(0)).toBe(30);
    expect(suggestTier(25)).toBe(30);
    expect(suggestTier(38)).toBe(45); // midpoint 37.5 rounds up
    expect(suggestTier(51)).toBe(45);
    expect(suggestTier(55)).toBe(60);
    expect(suggestTier(90)).toBe(60);
  });

  it('breaks exact ties upward', () => {
    expect(suggestTier(37.5)).toBe(45); // equidistant 30 vs 45 → up
    expect(suggestTier(52.5)).toBe(60); // equidistant 45 vs 60 → up
  });
});
