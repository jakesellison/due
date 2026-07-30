import { buildBoard, type BoardDayInput } from '../buildBoard';
import { dayComposition, sumDayActuals } from '../dayComposition';

const MI = 1609.34;
const WEEK_START = '2026-07-27';
const WEDNESDAY = '2026-07-29'; // idx 2

// ── The invariant the planner screen depends on ──────────────────────────────
// The board already models a day per WORKOUT. These tests pin that, so a future
// change to buildBoard can't quietly take the planner's live tile away again.

test('the unrun half of a two-a-day keeps a placed, editable tile', () => {
  const days: BoardDayInput[] = [
    { workoutId: 'wed-am', date: WEDNESDAY, type: 'easy', isQuality: false, plannedMeters: 5 * MI, structure: [], actualMeters: 5.6 * MI, isPast: false, satisfied: true },
    { workoutId: 'wed-pm', date: WEDNESDAY, type: 'easy', isQuality: false, plannedMeters: 4 * MI, structure: [], actualMeters: null, isPast: false, satisfied: false },
  ];

  const board = buildBoard(days, WEEK_START);

  // The AM banked and yields no tile; the PM is still live and sits on its day.
  expect(board.tiles.map((t) => t.id)).toEqual(['wed-pm']);
  expect(board.placement['wed-pm']).toBe(2);
  expect(board.actuals).toEqual([{ dayIdx: 2, meters: 5.6 * MI, deviated: false }]);
});

// ── Banked legs fold together ────────────────────────────────────────────────

test('a fully-run two-a-day banks BOTH legs, not just the last one', () => {
  const summed = sumDayActuals([
    { meters: 5.6 * MI, deviated: false },
    { meters: 4.0 * MI, deviated: false },
  ]);

  expect(summed?.meters).toBeCloseTo(9.6 * MI);
  expect(summed?.deviated).toBe(false);
});

test('one deviated leg makes the day deviated', () => {
  expect(sumDayActuals([
    { meters: 5 * MI, deviated: false },
    { meters: 3 * MI, deviated: true },
  ])?.deviated).toBe(true);
});

test('a day with nothing banked has no actual at all', () => {
  expect(sumDayActuals([])).toBeNull();
});

// ── The composition rule ─────────────────────────────────────────────────────

test('a partially-run two-a-day shows the banked leg AND stays editable', () => {
  const day = dayComposition({ bankedMeters: 5.6 * MI, scheduledMeters: 4 * MI, isPast: false });

  expect(day.showsBanked).toBe(true);
  // The regression: this used to be false, which hid the PM's tile entirely.
  expect(day.showsEditableRows).toBe(true);
  expect(day.showsGhost).toBe(false);
  // And the cell reports the whole day, not just the half that ran.
  expect(day.totalMeters).toBeCloseTo(9.6 * MI);
});

test('an ordinary completed day still shows only its banked row', () => {
  const day = dayComposition({ bankedMeters: 8 * MI, scheduledMeters: 0, isPast: false });

  expect(day.showsBanked).toBe(true);
  expect(day.totalMeters).toBeCloseTo(8 * MI);
  // Rows stay available even with nothing left to run: a live day must accept a
  // workout dragged in from the pool.
  expect(day.showsEditableRows).toBe(true);
});

test('an untouched future day is all plan', () => {
  const day = dayComposition({ bankedMeters: null, scheduledMeters: 10 * MI, isPast: false });

  expect(day.showsBanked).toBe(false);
  expect(day.showsEditableRows).toBe(true);
  expect(day.showsGhost).toBe(false);
  expect(day.totalMeters).toBeCloseTo(10 * MI);
});

// ── The past is unchanged: settled, read-only, never a drop target ───────────

test('a past day that ran is banked and terminal', () => {
  const day = dayComposition({ bankedMeters: 12 * MI, scheduledMeters: 0, isPast: true });

  expect(day.showsBanked).toBe(true);
  expect(day.showsEditableRows).toBe(false);
  expect(day.showsGhost).toBe(false);
});

test('a past day that did not run states its verdict instead', () => {
  const day = dayComposition({ bankedMeters: null, scheduledMeters: 0, isPast: true });

  expect(day.showsBanked).toBe(false);
  expect(day.showsEditableRows).toBe(false);
  expect(day.showsGhost).toBe(true);
});
