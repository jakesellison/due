import {
  METERS_PER_MILE,
  metersToMiles,
  milesToMeters,
  metersToKm,
  formatDistance,
  formatDuration,
  formatPace,
  formatGoalTime,
} from '../units';

describe('distance conversions', () => {
  test('mile constant and round-trip', () => {
    expect(METERS_PER_MILE).toBeCloseTo(1609.344, 3);
    expect(metersToMiles(1609.344)).toBeCloseTo(1, 6);
    expect(milesToMeters(1)).toBeCloseTo(1609.344, 3);
    expect(metersToKm(1000)).toBe(1);
  });
});

describe('formatDistance', () => {
  test('mi to one decimal', () => {
    expect(formatDistance(19473, 'mi')).toBe('12.1 mi');
  });
  test('km to one decimal', () => {
    expect(formatDistance(19473, 'km')).toBe('19.5 km');
  });
});

describe('formatDuration', () => {
  test('mm:ss under an hour', () => {
    expect(formatDuration(502)).toBe('8:22');
  });
  test('h:mm:ss over an hour', () => {
    expect(formatDuration(5025)).toBe('1:23:45');
  });
  test('pads seconds', () => {
    expect(formatDuration(65)).toBe('1:05');
  });
});

describe('formatPace', () => {
  test('per mile from seconds-per-km', () => {
    expect(formatPace(226, 'mi')).toBe('6:04/mi');
  });
  test('per km', () => {
    expect(formatPace(226, 'km')).toBe('3:46/km');
  });
});

describe('formatGoalTime', () => {
  test('marathon interval -> compact h:mm, leading zero stripped', () => {
    expect(formatGoalTime('02:36:00')).toBe('2:36');
    expect(formatGoalTime('2:36:00')).toBe('2:36');
    expect(formatGoalTime('03:05:00')).toBe('3:05');
  });
  test('sub-hour goal renders as minutes', () => {
    expect(formatGoalTime('00:48:00')).toBe('48 min');
  });
  test('null / blank / unparseable -> null', () => {
    expect(formatGoalTime(null)).toBeNull();
    expect(formatGoalTime(undefined)).toBeNull();
    expect(formatGoalTime('')).toBeNull();
    expect(formatGoalTime('nope')).toBeNull();
  });
});
