/**
 * Time-of-day histogram: bucket activities by local clock hour into five
 * named slots.
 */

import type { InsightActivity } from './inputs';

// ---------------------------------------------------------------------------
// 5. Time-of-day histogram
// ---------------------------------------------------------------------------

export type TimeOfDayLabel = 'early' | 'morning' | 'lunch' | 'afternoon' | 'evening';

export interface TimeOfDayBucket {
  label: TimeOfDayLabel;
  count: number;
  /** count / total, 0 when there are no activities. */
  share: number;
}

/** Bucket order, with their local-hour ranges (start inclusive). */
const TOD_ORDER: TimeOfDayLabel[] = ['early', 'morning', 'lunch', 'afternoon', 'evening'];

/**
 * The device's own IANA timezone (e.g. 'America/New_York'), falling back to
 * 'UTC' on the rare runtime that doesn't expose it. Used as the default zone
 * for time-of-day bucketing — the activity's UTC `start_date` is read as the
 * runner's OWN wall clock, not a hardcoded city.
 */
function deviceTimeZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz && tz.length > 0 ? tz : 'UTC';
  } catch {
    return 'UTC';
  }
}


function bucketForHour(hour: number): TimeOfDayLabel {
  if (hour < 7) return 'early';
  if (hour < 11) return 'morning';
  if (hour < 14) return 'lunch';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

