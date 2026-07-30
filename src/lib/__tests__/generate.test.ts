import {
  generateRamp,
  type RampInput,
} from '../plan/generate';

const input: RampInput = {
  weeks: 12,
  startWeeklyMeters: 48000,
  peakWeeklyMeters: 112000,
  downWeekEvery: 4,
  taperWeeks: 3,
};

describe('generateRamp', () => {
  const plan = generateRamp(input);

  test('produces one entry per week with sequential indices', () => {
    expect(plan).toHaveLength(12);
    expect(plan.map((w) => w.weekIndex)).toEqual(
      Array.from({ length: 12 }, (_, i) => i + 1),
    );
  });

  test('first build week starts at start volume; peak reached before taper', () => {
    expect(plan[0]!.targetMeters).toBe(48000);
    const prePeak = plan.slice(0, plan.length - input.taperWeeks);
    expect(Math.max(...prePeak.map((w) => w.targetMeters))).toBe(112000);
  });

  test('down weeks are marked recovery and dip below the surrounding build', () => {
    const w4 = plan[3]!;
    expect(w4.isRecovery).toBe(true);
    expect(w4.targetMeters).toBeLessThan(plan[2]!.targetMeters);
  });

  test('taper weeks descend monotonically into the race', () => {
    const taper = plan.slice(plan.length - input.taperWeeks);
    for (let i = 1; i < taper.length; i++) {
      expect(taper[i]!.targetMeters).toBeLessThan(taper[i - 1]!.targetMeters);
    }
    expect(taper.every((w) => w.phase === 'taper')).toBe(true);
  });

  test('original target is frozen equal to target at creation', () => {
    expect(plan.every((w) => w.originalTargetMeters === w.targetMeters)).toBe(true);
  });

  test('rejects invalid inputs', () => {
    expect(() => generateRamp({ ...input, weeks: 0 })).toThrow(RangeError);
    expect(() => generateRamp({ ...input, weeks: -1 })).toThrow(RangeError);
    expect(() => generateRamp({ ...input, taperWeeks: -1 })).toThrow(RangeError);
    // taperWeeks >= weeks leaves no build phase
    expect(() => generateRamp({ ...input, weeks: 3, taperWeeks: 3 })).toThrow(RangeError);
    expect(() => generateRamp({ ...input, weeks: 3, taperWeeks: 4 })).toThrow(RangeError);
  });

  test('downWeekEvery: 0 disables down weeks', () => {
    const noDown = generateRamp({ ...input, downWeekEvery: 0 });
    expect(noDown.some((w) => w.isRecovery)).toBe(false);
  });
});
