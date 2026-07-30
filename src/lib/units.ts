export type Units = 'mi' | 'km';
export const METERS_PER_MILE = 1609.344;

export const metersToMiles = (m: number): number => m / METERS_PER_MILE;
export const milesToMeters = (mi: number): number => mi * METERS_PER_MILE;
export const metersToKm = (m: number): number => m / 1000;
export const metersToUnits = (m: number, units: Units): number =>
  units === 'mi' ? metersToMiles(m) : metersToKm(m);
export const unitsToMeters = (value: number, units: Units): number =>
  units === 'mi' ? milesToMeters(value) : value * 1000;

export function formatDistance(meters: number, units: Units): string {
  const value = units === 'mi' ? metersToMiles(meters) : metersToKm(meters);
  return `${value.toFixed(1)} ${units}`;
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.round(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const ss = String(sec).padStart(2, '0');
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`;
  return `${m}:${ss}`;
}

export function formatPace(secPerKm: number, units: Units): string {
  const secPerUnit = units === 'mi' ? secPerKm * (METERS_PER_MILE / 1000) : secPerKm;
  return `${formatDuration(secPerUnit)}/${units}`;
}

/**
 * Format a Postgres `interval` goal time (e.g. "02:36:00" or "2:36:00") as a
 * compact race-goal label "2:36" (hours:minutes, hour leading zero stripped).
 * Sub-hour goals (e.g. a 10k "0:48:00") render as "48 min". Returns null for
 * a missing/unparseable value.
 */
export function formatGoalTime(interval: string | null | undefined): string | null {
  if (!interval) return null;
  const m = interval.trim().match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  if (hours <= 0) return `${minutes} min`;
  return `${hours}:${String(minutes).padStart(2, '0')}`;
}
