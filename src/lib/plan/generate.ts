export type Phase = 'base' | 'build' | 'peak' | 'taper' | 'recovery';

export interface RampInput {
  weeks: number;
  startWeeklyMeters: number;
  peakWeeklyMeters: number;
  downWeekEvery: number;
  taperWeeks: number;
}

export interface GeneratedWeek {
  weekIndex: number;
  phase: Phase;
  targetMeters: number;
  originalTargetMeters: number;
  isRecovery: boolean;
}

const round100 = (m: number): number => Math.round(m / 100) * 100;

export function generateRamp(input: RampInput): GeneratedWeek[] {
  const { weeks, startWeeklyMeters, peakWeeklyMeters, downWeekEvery, taperWeeks } = input;
  if (weeks <= 0) throw new RangeError(`weeks must be > 0, got ${weeks}`);
  if (taperWeeks < 0) throw new RangeError(`taperWeeks must be >= 0, got ${taperWeeks}`);
  if (taperWeeks >= weeks) {
    throw new RangeError(
      `taperWeeks (${taperWeeks}) must be < weeks (${weeks}) so the build phase has at least one week`,
    );
  }
  const buildWeeks = weeks - taperWeeks;
  const weeksOut: GeneratedWeek[] = [];

  const span = Math.max(buildWeeks - 1, 1);
  const step = (peakWeeklyMeters - startWeeklyMeters) / span;

  for (let i = 0; i < buildWeeks; i++) {
    const idx = i + 1;
    let target = startWeeklyMeters + step * i;
    const isDown = downWeekEvery > 0 && idx % downWeekEvery === 0 && idx !== buildWeeks;
    if (i === buildWeeks - 1) target = peakWeeklyMeters;
    if (isDown) target = target * 0.8;
    const phase: Phase = isDown ? 'recovery' : i < buildWeeks / 2 ? 'base' : i === buildWeeks - 1 ? 'peak' : 'build';
    weeksOut.push({
      weekIndex: idx, phase, isRecovery: isDown,
      targetMeters: round100(target), originalTargetMeters: round100(target),
    });
  }

  for (let t = 0; t < taperWeeks; t++) {
    const idx = buildWeeks + t + 1;
    const frac = 0.7 - (0.25 * t) / Math.max(taperWeeks - 1, 1);
    const target = round100(peakWeeklyMeters * frac);
    weeksOut.push({
      weekIndex: idx, phase: 'taper', isRecovery: false,
      targetMeters: target, originalTargetMeters: target,
    });
  }

  return weeksOut;
}
