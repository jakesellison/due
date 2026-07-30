import {
  boardToWeekEdits,
  type BoardSaveInput,
  type OriginalWorkout,
} from '../boardSave';
import type { PlanTile, Placement } from '../weekPlan';

const DATES = ['2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10', '2026-07-11', '2026-07-12'];

const orig = (workoutId: string, dayIdx: number, over: Partial<OriginalWorkout> = {}): OriginalWorkout => ({
  workoutId,
  date: DATES[dayIdx]!,
  title: 'Easy Run',
  type: 'easy',
  isQuality: false,
  plannedMeters: 10000,
  ...over,
});

const tile = (id: string, over: Partial<PlanTile> = {}): PlanTile => ({
  id,
  type: 'easy',
  meters: 10000,
  workoutId: id,
  ...over,
});

function run(over: Partial<BoardSaveInput>): ReturnType<typeof boardToWeekEdits> {
  const base: BoardSaveInput = {
    tiles: [],
    placement: {},
    originalPlacement: {},
    dayDates: DATES,
    originals: [],
    ...over,
  };
  return boardToWeekEdits(base);
}

describe('boardToWeekEdits', () => {
  test('moving an existing workout to another day → dated EditableDay + MoveOp, original fields kept', () => {
    // Wed workout (idx 2) dragged to Fri (idx 4). Quality session — type/title preserved.
    const w = orig('w1', 2, { type: 'quality', isQuality: true, title: '4×2mi threshold', plannedMeters: 16000 });
    const { finalDays, ops } = run({
      tiles: [tile('w1', { type: 'quality', meters: 16000 })],
      originalPlacement: { w1: 2 },
      placement: { w1: 4 },
      originals: [w],
    });
    expect(finalDays).toHaveLength(1);
    expect(finalDays[0]).toMatchObject({
      id: 'w1', date: DATES[4], type: 'quality', title: '4×2mi threshold',
      plannedDistanceMeters: 16000, isQuality: true, isInserted: false,
    });
    expect(ops).toEqual([{ kind: 'move', workoutId: 'w1', toDate: DATES[4] }]);
  });

  test('an unmoved workout is a no-op (no rewrite, no op) so an untouched Save writes nothing', () => {
    const { finalDays, ops } = run({
      tiles: [tile('w1'), tile('w2')],
      originalPlacement: { w1: 1, w2: 3 },
      placement: { w1: 1, w2: 3 },
      originals: [orig('w1', 1), orig('w2', 3)],
    });
    expect(finalDays).toEqual([]);
    expect(ops).toEqual([]);
  });

  test('an edited workout persists its full prescription without requiring a move', () => {
    const structure = [
      { kind: 'warmup', target: { by: 'distance', distance_m: 3219 } },
      { kind: 'work', target: { by: ['distance', 'pace'], distance_m: 16093, pace: { kind: 'relative', reference: 'threshold', speed_fraction: 1 } } },
      { kind: 'cooldown', target: { by: 'distance', distance_m: 6437 } },
    ] as any;
    const { finalDays, ops } = run({
      tiles: [tile('w1', {
        type: 'quality',
        title: 'Quality Run',
        meters: 25749,
        qualityMeters: 16093,
        structure,
        edited: true,
      })],
      originalPlacement: { w1: 1 },
      placement: { w1: 1 },
      originals: [orig('w1', 1, { type: 'quality', isQuality: true, plannedMeters: 22531 })],
    });

    expect(finalDays[0]).toMatchObject({
      id: 'w1', date: DATES[1], type: 'quality', title: 'Quality Run',
      plannedDistanceMeters: 25749, prescribedQualityMeters: 16093, structure,
    });
    expect(ops).toEqual([expect.objectContaining({
      kind: 'updateWorkout', workoutId: 'w1', plannedDistanceMeters: 25749,
      prescribedQualityMeters: 16093, structure,
    })]);
  });

  test('a scheduled workout dragged to the pool becomes rest', () => {
    const { finalDays, ops } = run({
      tiles: [tile('w1')],
      originalPlacement: { w1: 3 },
      placement: { w1: null },
      originals: [orig('w1', 3)],
    });
    expect(finalDays).toEqual([{ id: 'w1', date: DATES[3], type: 'rest', title: 'Rest Day', plannedDistanceMeters: 0, isQuality: false }]);
    expect(ops).toEqual([{ kind: 'setRest', workoutId: 'w1' }]);
  });

  test('a MISSED workout left unplaced is untouched (no write, no op)', () => {
    // originPast tile that was already in the pool (originalPlacement null) and stays there.
    const { finalDays, ops } = run({
      tiles: [tile('w1', { originPast: true })],
      originalPlacement: { w1: null },
      placement: { w1: null },
      originals: [orig('w1', 0)],
    });
    expect(finalDays).toEqual([]);
    expect(ops).toEqual([]);
  });

  test('rescheduling a missed workout from the pool onto a day → move', () => {
    const { finalDays, ops } = run({
      tiles: [tile('w1', { originPast: true })],
      originalPlacement: { w1: null },
      placement: { w1: 5 },
      originals: [orig('w1', 0)], // originally a past date
    });
    expect(finalDays[0]).toMatchObject({ id: 'w1', date: DATES[5] });
    expect(ops).toEqual([{ kind: 'move', workoutId: 'w1', toDate: DATES[5] }]);
  });

  test('a new tile placed on a day inserts with its structure; unplaced new tile is dropped', () => {
    const structure = [{ kind: 'rep' as const }] as any;
    const { finalDays, ops } = run({
      tiles: [
        { id: 'new-1', type: 'quality', meters: 12000, qualityMeters: 4828.4, workoutId: null, structureLabel: '3×1mi', structure },
        { id: 'new-2', type: 'easy', meters: 8000, workoutId: null },
      ],
      originalPlacement: {},
      placement: { 'new-1': 2, 'new-2': null },
      originals: [],
    });
    expect(finalDays).toHaveLength(1);
    expect(finalDays[0]).toMatchObject({
      id: null, date: DATES[2], type: 'quality', title: '3×1mi',
      plannedDistanceMeters: 12000, isQuality: true, isInserted: true, structure,
      prescribedQualityMeters: 4828,
    });
    expect(ops).toEqual([{ kind: 'addDouble', onDate: DATES[2], distanceMeters: 12000 }]);
  });
});
