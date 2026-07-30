/**
 * Civil-date helpers. A "civil date" is a 'YYYY-MM-DD' string with no time or
 * timezone — a calendar day. These functions are tz-agnostic: they anchor at
 * noon UTC so that adding/subtracting whole days never crosses a DST boundary
 * or rolls the date due to host-timezone offsets.
 */

/** Civil 'YYYY-MM-DD' `days` after `localDate` (negative `days` goes back). */
export function addDays(localDate: string, days: number): string {
  const base = new Date(`${localDate}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

/** Today's local civil date 'YYYY-MM-DD' (host-timezone calendar day). */
export function todayLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
