import {
  effortQualityWeight,
  extractStreamEfforts,
  extractStreamEffortsFromActivities,
} from '../predict/streamEfforts';
import type { RunStreams } from '../run/analysis';

function phasedStream(phases: { seconds: number; speed: number; hr?: number | null }[]): RunStreams {
  const t: number[] = [0];
  const d: number[] = [0];
  const v: number[] = [0];
  const hr: (number | null)[] = [phases[0]?.hr ?? null];
  let elapsed = 0;
  let meters = 0;
  for (const phase of phases) {
    for (let i = 0; i < phase.seconds; i++) {
      elapsed += 1;
      meters += phase.speed;
      t.push(elapsed);
      d.push(meters);
      v.push(phase.speed);
      hr.push(phase.hr ?? null);
    }
  }
  return { t, d, v, hr, alt: null };
}

describe('extractStreamEfforts', () => {
  it('extracts the fastest distance windows with interpolated moving time', () => {
    const streams = phasedStream([
      { seconds: 1000, speed: 4, hr: 145 },
      { seconds: 1000, speed: 5, hr: 175 },
      { seconds: 700, speed: 3, hr: 140 },
    ]);
    const efforts = extractStreamEfforts({ streams, maxHr: 190 });
    const fiveK = efforts.find((e) => e.label === '5k')!;
    expect(fiveK.distanceMeters).toBeCloseTo(5000, 6);
    expect(fiveK.seconds).toBeCloseTo(1000, 6);
    expect(fiveK.avgHr).toBeCloseTo(175, 6);
    expect(fiveK.hrFraction).toBeCloseTo(175 / 190, 6);
    expect(fiveK.qualityWeight).toBeCloseTo(0.5, 6);
  });

  it('extracts the best 30-minute effort by maximizing distance', () => {
    const streams = phasedStream([
      { seconds: 1800, speed: 3, hr: 140 },
      { seconds: 1800, speed: 4, hr: 170 },
    ]);
    const thirty = extractStreamEfforts({ streams, maxHr: 190 }).find((e) => e.label === '30min')!;
    expect(thirty.seconds).toBe(1800);
    expect(thirty.distanceMeters).toBeCloseTo(7200, 6);
    expect(thirty.avgHr).toBeCloseTo(170, 6);
  });

  it('filters future activities and tagged races in the multi-activity helper', () => {
    const streams = phasedStream([{ seconds: 1800, speed: 4, hr: 160 }]);
    const efforts = extractStreamEffortsFromActivities(
      [
        { localDate: '2026-05-01', streams, workoutType: 0, maxHr: 190 },
        { localDate: '2026-05-02', streams, workoutType: 1, maxHr: 190 },
        { localDate: '2026-07-01', streams, workoutType: 0, maxHr: 190 },
      ],
      '2026-06-01',
    );
    expect(efforts.length).toBeGreaterThan(0);
    expect(new Set(efforts.map((e) => e.localDate))).toEqual(new Set(['2026-05-01']));
  });

  it('keeps low-HR efforts low weight and unknown-HR efforts small', () => {
    expect(effortQualityWeight(0.7)).toBeCloseTo(0.05, 6);
    expect(effortQualityWeight(null)).toBeCloseTo(0.08, 6);
    expect(effortQualityWeight(0.835)).toBeGreaterThan(0.05);
  });

  it('resolves the DB max_hr spelling when maxHr is absent', () => {
    const streams = phasedStream([{ seconds: 1200, speed: 5, hr: 175 }]);
    const efforts = extractStreamEfforts({ streams, max_hr: 190 });
    const fiveK = efforts.find((e) => e.label === '5k')!;
    expect(fiveK.hrFraction).toBeCloseTo(175 / 190, 6);
  });
});

describe('extractStreamEfforts — memoization (perf, identical results)', () => {
  it('computes once per activity object and reuses across calls', () => {
    const streams = phasedStream([
      { seconds: 1000, speed: 4, hr: 150 },
      { seconds: 1000, speed: 5, hr: 178 },
    ]);
    const activity = { streams, maxHr: 190 };

    const first = extractStreamEfforts(activity);
    const second = extractStreamEfforts(activity);

    // Memo hit ⇒ the SAME array reference is returned (the O(n·m) sliding
    // window ran exactly once for this activity object), and the result is
    // identical content.
    expect(second).toBe(first);
    expect(second).toEqual(first);
  });

  it('returns identical efforts across as-of points (trendline reuse)', () => {
    // The trendline predicts at many as-of dates over the SAME activity objects;
    // earlier as-ofs filter out future activities but must not change the
    // extraction for activities that ARE in-window.
    const streams = phasedStream([{ seconds: 1800, speed: 4, hr: 165 }]);
    const activities = [{ localDate: '2026-05-01', workoutType: 0, streams, maxHr: 190 }];

    const early = extractStreamEffortsFromActivities(activities, '2026-05-15');
    const later = extractStreamEffortsFromActivities(activities, '2026-06-15');

    expect(early.length).toBeGreaterThan(0);
    expect(later).toEqual(early);
    // The per-activity effort set is the shared memoized array (same reference
    // backing both as-of results).
    expect(extractStreamEfforts(activities[0]!)).toBe(
      extractStreamEfforts(activities[0]!),
    );
  });
});
