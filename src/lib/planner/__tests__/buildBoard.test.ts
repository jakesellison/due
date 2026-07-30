import {
  buildBoard,
  type BoardDayInput,
} from '../buildBoard';

const M = 1609.344;
const day = (o: Partial<BoardDayInput> & { workoutId: string; date: string }): BoardDayInput => ({
  type: 'easy',
  isQuality: false,
  plannedMeters: 10 * M,
  structure: [],
  actualMeters: null,
  isPast: false,
  satisfied: false,
  ...o,
});

const WEEK_START = '2026-07-06'; // Mon

test('a future day places its planned tile on the day', () => {
  const b = buildBoard(
    [
      day({ workoutId: 'thu', date: '2026-07-09' }),
      day({ workoutId: 'sat', date: '2026-07-11', type: 'long', plannedMeters: 20 * M }),
    ],
    WEEK_START,
  );
  expect(b.placement.thu).toBe(3);
  expect(b.placement.sat).toBe(5);
  expect(b.tiles.find((t) => t.id === 'thu')?.originPast).toBe(false);
  expect(b.actuals).toHaveLength(0);
});

test('a fully-missed past day frees its tile to the pool (originPast), no actual', () => {
  const b = buildBoard(
    [day({ workoutId: 'tue', date: '2026-07-07', type: 'quality', isQuality: true, plannedMeters: 10 * M, isPast: true })],
    WEEK_START,
  );
  expect(b.placement.tue).toBeNull(); // pool
  expect(b.tiles.find((t) => t.id === 'tue')?.originPast).toBe(true);
  expect(b.actuals).toHaveLength(0);
});

test('a ran-easy quality day banks the actual (deviated) and frees the quality tile', () => {
  const b = buildBoard(
    [day({ workoutId: 'tue', date: '2026-07-07', type: 'quality', isQuality: true, plannedMeters: 10 * M, actualMeters: 20 * M, isPast: true, satisfied: false })],
    WEEK_START,
  );
  expect(b.placement.tue).toBeNull(); // freed to reschedule
  expect(b.actuals).toContainEqual({ dayIdx: 1, meters: 20 * M, deviated: true });
});

test('a satisfied resolved day yields NO tile — just the banked actual', () => {
  const b = buildBoard(
    [day({ workoutId: 'wed', date: '2026-07-08', plannedMeters: 16 * M, actualMeters: 16 * M, isPast: true, satisfied: true })],
    WEEK_START,
  );
  expect(b.tiles).toHaveLength(0);
  expect(b.actuals).toContainEqual({ dayIdx: 2, meters: 16 * M, deviated: false });
});

test('a stored hard-work snapshot wins over duration-target fallback math', () => {
  const b = buildBoard(
    [day({
      workoutId: 'q-time',
      date: '2026-07-08',
      type: 'quality',
      isQuality: true,
      plannedMeters: 10000,
      prescribedQualityMeters: 4321,
      structure: [{
        kind: 'repeat',
        sets: 6,
        children: [{ kind: 'work', target: { by: ['time', 'pace'], duration_s: 180, pace: { kind: 'relative', reference: '5K', speed_fraction: 1 } } }],
      }],
    })],
    WEEK_START,
  );
  expect(b.tiles[0]?.qualityMeters).toBe(4321);
});
