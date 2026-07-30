import {
  localDateOf,
  weekStartOf,
  weekElapsedFraction,
  completedWeekFraction,
} from '../time/week';

describe('localDateOf', () => {
  test('converts a UTC instant to local civil date', () => {
    expect(localDateOf('2026-06-01T02:30:00Z', 'America/Chicago')).toBe('2026-05-31');
    expect(localDateOf('2026-06-01T12:00:00Z', 'America/Chicago')).toBe('2026-06-01');
  });
});

describe('weekStartOf', () => {
  test('Monday-anchored week for a Wednesday', () => {
    expect(weekStartOf('2026-06-03', 'mon')).toBe('2026-06-01');
  });
  test('Monday maps to itself', () => {
    expect(weekStartOf('2026-06-01', 'mon')).toBe('2026-06-01');
  });
  test('Sunday belongs to the prior Monday week', () => {
    expect(weekStartOf('2026-06-07', 'mon')).toBe('2026-06-01');
  });
});

describe('weekElapsedFraction', () => {
  test('Wednesday end-of-day is ~3/7 of the week', () => {
    expect(weekElapsedFraction('2026-06-03', 'mon')).toBeCloseTo(3 / 7, 6);
  });
  test('Monday is 1/7', () => {
    expect(weekElapsedFraction('2026-06-01', 'mon')).toBeCloseTo(1 / 7, 6);
  });
});

describe('Sunday-anchored weeks', () => {
  // 2026-06-07 is a Sunday, 2026-06-10 is the following Wednesday.
  test('weekStartOf anchors to the prior Sunday', () => {
    expect(weekStartOf('2026-06-07', 'sun')).toBe('2026-06-07');
    expect(weekStartOf('2026-06-10', 'sun')).toBe('2026-06-07');
  });
  test('weekElapsedFraction counts from Sunday', () => {
    expect(weekElapsedFraction('2026-06-07', 'sun')).toBeCloseTo(1 / 7, 6);
    expect(weekElapsedFraction('2026-06-10', 'sun')).toBeCloseTo(4 / 7, 6);
  });
});

describe('completedWeekFraction — today counts only in your favor', () => {
  test('Thursday counts 3 completed days (through Wednesday)', () => {
    expect(completedWeekFraction('2026-06-04', 'mon')).toBeCloseTo(3 / 7, 6);
  });
  test('Monday counts zero completed days', () => {
    expect(completedWeekFraction('2026-06-01', 'mon')).toBeCloseTo(0, 6);
  });
  test('Sunday counts six', () => {
    expect(completedWeekFraction('2026-06-07', 'mon')).toBeCloseTo(6 / 7, 6);
  });
});
