import {
  loadZone,
  trainingLoad,
  trimp,
  type ActivityLoad,
} from '../kpi/insights/trainingLoad';

describe('trimp', () => {
  it('returns null without a duration', () => {
    expect(trimp({ movingTimeS: null, avgHr: 150, maxHr: 190 })).toBeNull();
    expect(trimp({ movingTimeS: 0, avgHr: 150, maxHr: 190 })).toBeNull();
  });

  it('scales with DURATION (volume) at the same intensity', () => {
    const short = trimp({ movingTimeS: 1800, avgHr: 150, maxHr: 190 })!; // 30 min
    const long = trimp({ movingTimeS: 3600, avgHr: 150, maxHr: 190 })!; // 60 min
    expect(long).toBeCloseTo(short * 2, 5); // twice the time → twice the load
  });

  it('scales with INTENSITY at the same duration (harder run scores more)', () => {
    const easy = trimp({ movingTimeS: 3600, avgHr: 130, maxHr: 190 })!;
    const hard = trimp({ movingTimeS: 3600, avgHr: 175, maxHr: 190 })!;
    expect(hard).toBeGreaterThan(easy);
  });

  it('still scores a run with NO HR (full coverage, by duration)', () => {
    const load = trimp({ movingTimeS: 3600, avgHr: null, maxHr: null });
    expect(load).not.toBeNull();
    expect(load as number).toBeGreaterThan(0);
  });
});


describe('trainingLoad', () => {
  it('returns a detraining, zero trend with no load data', () => {
    const t = trainingLoad([], '2026-06-01', '2026-06-10');
    expect(t.ratio).toBeNull();
    expect(t.zone).toBe('detraining');
    expect(t.coverage).toBe(0);
    expect(t.acute).toBe(0);
  });

  it('reports coverage as the share of activities with a load value', () => {
    const loads: ActivityLoad[] = [
      { date: '2026-06-02', load: 40 },
      { date: '2026-06-04', load: null },
      { date: '2026-06-06', load: 50 },
      { date: '2026-06-08', load: null },
    ];
    const t = trainingLoad(loads, '2026-06-01', '2026-06-10');
    expect(t.coverage).toBe(0.5);
  });

  it('a steady daily load yields acute≈chronic≈ratio 1 (optimal)', () => {
    // One activity of load 70 every day for 40 days → acute and chronic means
    // both 70, ratio 1.0.
    const loads: ActivityLoad[] = [];
    let d = '2026-05-01';
    const end = '2026-06-09';
    while (d <= end) {
      loads.push({ date: d, load: 70 });
      const dt = new Date(`${d}T12:00:00Z`);
      dt.setUTCDate(dt.getUTCDate() + 1);
      d = dt.toISOString().slice(0, 10);
    }
    const t = trainingLoad(loads, '2026-05-01', '2026-06-09');
    expect(Math.round(t.acute)).toBe(70);
    expect(Math.round(t.chronic)).toBe(70);
    expect(t.ratio).toBeCloseTo(1, 1);
    expect(t.zone).toBe('optimal');
  });

  it('a recent spike pushes the ratio above 1 (ramping)', () => {
    const loads: ActivityLoad[] = [];
    let d = '2026-05-01';
    const end = '2026-06-09';
    while (d <= end) {
      // Light baseline, then a heavy final week.
      const heavy = d >= '2026-06-03';
      loads.push({ date: d, load: heavy ? 140 : 35 });
      const dt = new Date(`${d}T12:00:00Z`);
      dt.setUTCDate(dt.getUTCDate() + 1);
      d = dt.toISOString().slice(0, 10);
    }
    const t = trainingLoad(loads, '2026-05-01', '2026-06-09');
    expect(t.ratio).not.toBeNull();
    expect(t.ratio as number).toBeGreaterThan(1.3);
  });

  // The Monday-morning artifact (runner#4): a partial "today" with no run
  // logged YET must not day-boundary-truncate the acute window and assert a
  // false "Detraining" read before the day's run has even posted.
  it('does not let an unstarted "today" drag the acute mean into false Detraining', () => {
    const loads: ActivityLoad[] = [];
    let d = '2026-05-01';
    const yesterday = '2026-06-08'; // steady training through Sunday
    while (d <= yesterday) {
      loads.push({ date: d, load: 70 });
      const dt = new Date(`${d}T12:00:00Z`);
      dt.setUTCDate(dt.getUTCDate() + 1);
      d = dt.toISOString().slice(0, 10);
    }
    const today = '2026-06-09'; // Monday, 8:23am — no run logged yet
    const t = trainingLoad(loads, '2026-05-01', today);
    // The series stops at end-of-yesterday, not a zeroed-out "today".
    expect(t.points[t.points.length - 1]?.date).toBe(yesterday);
    expect(Math.round(t.acute)).toBe(70);
    expect(Math.round(t.chronic)).toBe(70);
    expect(t.ratio).toBeCloseTo(1, 1);
    expect(t.zone).toBe('optimal'); // NOT 'detraining'
  });

  it("once today's own run posts, today is real data and drives the read (not skipped)", () => {
    const loads: ActivityLoad[] = [];
    let d = '2026-05-01';
    const today = '2026-06-09';
    while (d <= today) {
      loads.push({ date: d, load: 70 });
      const dt = new Date(`${d}T12:00:00Z`);
      dt.setUTCDate(dt.getUTCDate() + 1);
      d = dt.toISOString().slice(0, 10);
    }
    const t = trainingLoad(loads, '2026-05-01', today);
    expect(t.points[t.points.length - 1]?.date).toBe(today);
    expect(t.zone).toBe('optimal');
  });
});
