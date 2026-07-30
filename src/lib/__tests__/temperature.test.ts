import {
  celsiusToFahrenheit,
  formatTemperature,
} from '../temperature';

describe('temperature formatting', () => {
  test('converts Celsius to Fahrenheit', () => {
    expect(celsiusToFahrenheit(20)).toBe(68);
  });

  test('defaults to Fahrenheit for existing callers', () => {
    expect(formatTemperature(20)).toBe('68°F');
  });

  test('formats values and deltas in Celsius when selected', () => {
    expect(formatTemperature(20.4, 'celsius')).toBe('20°C');
  });

  test('keeps missing values neutral in either unit', () => {
    expect(formatTemperature(null, 'celsius')).toBe('—');
    expect(formatTemperature(Number.NaN, 'fahrenheit')).toBe('—');
  });
});
