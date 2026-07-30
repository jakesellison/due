/**
 * dayComposition.ts — what a planner day is made of.
 *
 * A day holds TWO independent facts, and the bug this module exists to prevent
 * came from collapsing them into one:
 *
 *   BANKED     what already ran. Locked; the planner never rewrites history.
 *   SCHEDULED  what is still on the calendar. Live; the whole point of the screen.
 *
 * They are not alternatives. On a two-a-day whose AM has run and whose PM has
 * not, a single date carries both at once — and the planner used to branch on
 * "does this DAY have an actual?", which meant the AM's banked row replaced the
 * entire desk and the PM's tile (which `buildBoard` correctly still places on
 * that day) was never rendered. The second run could not be edited, moved,
 * resized, or deleted, and the day cell under-reported the day by the PM's whole
 * distance.
 *
 * A day is resolved per WORKOUT, never per day. That is the rule; this module is
 * the one place it is written down.
 */

/** One banked leg of a day — `buildBoard` emits one entry per workout that ran. */
export interface DayActualEntry {
  meters: number;
  deviated: boolean;
}

/**
 * Fold every leg that ran on a day into one banked figure.
 *
 * Summed, not replaced: a two-a-day where BOTH halves ran produces two entries
 * for the same date, and keeping only the last one silently reported a single
 * leg as the day's whole output.
 */
export function sumDayActuals(entries: readonly DayActualEntry[]): DayActualEntry | null {
  if (entries.length === 0) return null;
  return entries.reduce(
    (acc, e) => ({ meters: acc.meters + e.meters, deviated: acc.deviated || e.deviated }),
    { meters: 0, deviated: false },
  );
}

export interface DayComposition {
  /** What the day cell reports: everything banked plus everything still planned. */
  totalMeters: number;
  /** Render the locked "Banked actual" row. */
  showsBanked: boolean;
  /** Render the live, editable, drag-reorderable rows. */
  showsEditableRows: boolean;
  /** Render the past-day verdict instead (Missed / Rest). */
  showsGhost: boolean;
}

/**
 * Resolve how one planner day presents itself.
 *
 * The past is deliberately still terminal — a settled day keeps its single
 * verdict and is never a drop target, exactly as before. What changed is the
 * live case: today and the future may show a banked row AND editable rows.
 */
export function dayComposition(args: {
  /** Banked meters for the day (0 or null when nothing ran). */
  bankedMeters: number | null;
  /** Meters still placed on the day. */
  scheduledMeters: number;
  /** The date is before today. */
  isPast: boolean;
}): DayComposition {
  const banked = args.bankedMeters ?? 0;
  const hasBanked = banked > 0;
  return {
    totalMeters: banked + args.scheduledMeters,
    showsBanked: hasBanked,
    // A settled day is read-only; a live day always offers its rows, because
    // even an empty one must accept a workout dragged in from the pool.
    showsEditableRows: !args.isPast,
    // Only a past day with nothing banked has a verdict to state.
    showsGhost: args.isPast && !hasBanked,
  };
}
