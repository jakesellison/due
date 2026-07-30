export type WeekStart = 'mon' | 'sun';

/** UTC ISO instant -> civil date 'YYYY-MM-DD' in the given IANA tz. */
export function localDateOf(iso: string, tz: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Day index within the week. Monday=0..Sunday=6 (for weekStart 'mon'). */
function dayIndex(localDate: string, weekStart: WeekStart): number {
  const dow = new Date(`${localDate}T12:00:00Z`).getUTCDay(); // Sun=0..Sat=6
  if (weekStart === 'mon') return (dow + 6) % 7; // Mon=0..Sun=6
  return dow; // Sun=0..Sat=6
}

/** Civil 'YYYY-MM-DD' of the week-start day for the week containing localDate. */
export function weekStartOf(localDate: string, weekStart: WeekStart): string {
  const idx = dayIndex(localDate, weekStart);
  const base = new Date(`${localDate}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() - idx);
  return base.toISOString().slice(0, 10);
}

/** Fraction of the week elapsed by end of localDate's civil day, in (0,1]. */
export function weekElapsedFraction(localDate: string, weekStart: WeekStart): number {
  return (dayIndex(localDate, weekStart) + 1) / 7;
}

/**
 * Fraction of the week COMPLETED (through end of yesterday): dayIndex/7.
 * Pace lines must use this, not weekElapsedFraction — "today counts only in
 * your favor": an unfinished today never moves the line against the runner.
 */
export function completedWeekFraction(localDate: string, weekStart: WeekStart): number {
  return (weekElapsedFraction(localDate, weekStart) * 7 - 1) / 7;
}
