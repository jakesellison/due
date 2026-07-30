export function celsiusToFahrenheit(tempC: number): number {
  return tempC * 1.8 + 32;
}

export type TemperatureUnit = 'fahrenheit' | 'celsius';

export function formatTemperature(
  tempC: number | null | undefined,
  unit: TemperatureUnit = 'fahrenheit',
): string {
  if (tempC == null || !Number.isFinite(tempC)) return '—';
  if (unit === 'celsius') return `${Math.round(tempC)}°C`;
  return `${Math.round(celsiusToFahrenheit(tempC))}°F`;
}

