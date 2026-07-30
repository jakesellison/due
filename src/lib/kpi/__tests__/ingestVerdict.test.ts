/**
 * ingestVerdict.test.ts — pins the corpus-validated panel cases from
 * `.git/sdd/detector-study.md` §2 as synthetic fixtures. Each fixture reproduces
 * the SHAPE (not the raw data) of a real panel run so the verdict tree is exercised
 * end-to-end: lap-first, the strides guard, the GAP/HR time-path gate, and tempo.
 *
 * Corpus floor: paceFloor = 456 s/mi (7:36/mi); derived hrFloor = 163 bpm.
 */

import {
  computeIngestVerdict,
} from '../ingestVerdict';
import {
  detectQuality,
  formatPaceMi,
  type RunStream,
} from '../qualityDetect';
import type { QualityFloor } from '../qualityFloor';
import type { StravaLap } from '../../run/analysis';

const METERS_PER_MILE = 1609.344;
const SAMPLE_S = 11;

const FLOOR: QualityFloor = { paceFloorSecPerMi: 456, hrFloor: 163, qualityFloorSecPerMi: 432 };
const FLOOR_NO_HR: QualityFloor = { paceFloorSecPerMi: 456, hrFloor: null, qualityFloorSecPerMi: 432 };

/** velocity (m/s) for a sec/mi pace. */
const vel = (secPerMi: number) => METERS_PER_MILE / secPerMi;

/**
 * Build a RunStream from [durationS, paceSecPerMi, hr?, gradePct?] segments at
 * ~11 s cadence (or `sampleS`, e.g. 1 for full-res 1 Hz streams). `gradePct`
 * (as a fraction, e.g. 0.08) drives the altitude array.
 */
function buildStream(
  segs: Array<{ durationS: number; paceSecPerMi: number; hr?: number; gradeFrac?: number }>,
  sampleS = SAMPLE_S,
): RunStream {
  const d: number[] = [], v: number[] = [], t: number[] = [], hr: number[] = [], alt: number[] = [];
  let cumD = 0, cumT = 0, cumAlt = 100;
  let anyHr = false, anyAlt = false;
  for (const s of segs) {
    const speed = vel(s.paceSecPerMi);
    const nSamples = Math.max(1, Math.round(s.durationS / sampleS));
    const dPer = speed * sampleS;
    for (let i = 0; i < nSamples; i++) {
      cumT += sampleS; cumD += dPer;
      t.push(cumT); d.push(cumD); v.push(speed);
      if (s.hr != null) { hr.push(s.hr); anyHr = true; } else hr.push(0);
      if (s.gradeFrac != null) { cumAlt += dPer * s.gradeFrac; anyAlt = true; }
      alt.push(cumAlt);
    }
  }
  const stream: RunStream = { d, v, t };
  if (anyHr) stream.hr = hr;
  if (anyAlt) stream.altitude = alt;
  return stream;
}

// ── (a) 6×200 m lap-marked session → intervals, 6 reps FROM LAPS ──────────────
// Mirrors 2026-06-30 (stored as the mangled `3×0.1mi @5:60 + 3×0.1mi @5:22`).
describe('lap-first: 6×200m marked session', () => {
  function laps(): StravaLap[] {
    const work = { distance: 221, moving_time: 47, average_heartrate: 176 }; // ~5:42/mi
    const rec = { distance: 200, moving_time: 67, average_heartrate: 150 };  // ~9:00/mi
    const easy = { distance: 1609, moving_time: 480, average_heartrate: 145 }; // 8:00/mi warmup/cooldown
    const out: StravaLap[] = [{ ...easy }];
    for (let i = 0; i < 6; i++) { out.push({ ...work }); out.push({ ...rec }); }
    out.push({ ...easy });
    return out;
  }
  // A coarse stream (HR present) — only used for lap→sample index mapping.
  const stream = buildStream([{ durationS: 3400, paceSecPerMi: 456, hr: 165 }]);

  test('kind is intervals, 6 reps, sourced from laps', () => {
    const v = computeIngestVerdict({ streams: stream, laps: laps(), floor: FLOOR });
    expect(v.isQuality).toBe(true);
    expect(v.kind).toBe('intervals');
    expect(v.source).toBe('laps');
    expect(v.blocks).toHaveLength(6);
  });

  test('quality distance banks measured 6×221 m; summary snaps the label to 200m', () => {
    const v = computeIngestVerdict({ streams: stream, laps: laps(), floor: FLOOR });
    // Banking stays MEASURED (221m reps) — the snap is display-only.
    expect(v.qualityDistanceMeters).toBeCloseTo(6 * 221, 0);
    // The label snaps 221m → the nominal 200m mark.
    expect(v.summary).toMatch(/6×200m @ 5:42/);
    // honest: no unearned "@ threshold" zone claim on a lap-sourced verdict
    expect(v.summary).not.toMatch(/threshold/);
  });
});

// ── (a2) 4×2mi lapped EVERY mile → reconciled to 4×2mi, not 8×1mi ─────────────
// Mirrors 2026-06-23: the athlete presses lap for his own mile splits INSIDE
// each 2-mile threshold rep, so the laps read 8 mile-reps while regime detection
// sees the 4 true 2-mile blocks. Reconciliation collapses each block's two
// mile-laps into one 2mi rep.
describe('lap↔regime reconciliation: 4×2mi lapped every mile', () => {
  // Stream: 1mi warmup, then 4×(2mi @ 6:10 + 0.25mi recovery), 1mi cooldown.
  const stream = buildStream([
    { durationS: 510, paceSecPerMi: 510, hr: 150 }, // 1mi warmup @ 8:30
    ...Array.from({ length: 4 }, () => [
      { durationS: 2 * 370, paceSecPerMi: 370, hr: 172 }, // 2mi rep @ 6:10
      { durationS: 135, paceSecPerMi: 540, hr: 150 },     // 0.25mi recovery @ 9:00
    ]).flat(),
    { durationS: 510, paceSecPerMi: 510, hr: 150 }, // 1mi cooldown @ 8:30
  ]);
  // Laps: warmup mi, then per rep TWO mile-laps + a recovery lap, then cooldown mi.
  function laps(): StravaLap[] {
    const out: StravaLap[] = [{ distance: 1609, moving_time: 510, average_heartrate: 150 }];
    for (let i = 0; i < 4; i++) {
      out.push({ distance: 1609, moving_time: 372, average_heartrate: 172 }); // mile split @ 6:12
      out.push({ distance: 1609, moving_time: 372, average_heartrate: 172 }); // mile split @ 6:12
      out.push({ distance: 402, moving_time: 135, average_heartrate: 150 });  // recovery
    }
    out.push({ distance: 1609, moving_time: 510, average_heartrate: 150 });
    return out;
  }

  test('reps collapse to 4×2mi (regime boundaries), source laps', () => {
    const v = computeIngestVerdict({ streams: stream, laps: laps(), floor: FLOOR });
    expect(v.isQuality).toBe(true);
    expect(v.kind).toBe('intervals');
    expect(v.source).toBe('laps');
    expect(v.blocks).toHaveLength(4); // NOT 8 mile-splits
    expect(v.summary).toMatch(/4×2mi @ 6:1\d/);
    // each reconciled rep is ~2 miles, not ~1
    for (const b of v.blocks) expect(b.distanceMeters).toBeGreaterThan(1.7 * METERS_PER_MILE);
  });
});

// ── (b) easy long run + 4 short strides (streams only) → NOT quality ──────────
// Mirrors 2026-07-02 (stored `intervals · 4×0.1mi @7:13`, 840 m). No laps, no HR.
describe('strides guard: easy long run + 4 strides', () => {
  const stream = buildStream([
    { durationS: 14 * 8 * 60, paceSecPerMi: 510 }, // ~14mi @ 8:30, above floor
    ...Array.from({ length: 4 }, () => [
      { durationS: 60, paceSecPerMi: 433 }, // 7:13/mi stride — just under floor
      { durationS: 90, paceSecPerMi: 540 }, // recovery
    ]).flat(),
  ]);

  test('the strides ARE detected as near-floor blocks but demoted to NOT quality', () => {
    const v = computeIngestVerdict({ streams: stream, laps: null, floor: FLOOR_NO_HR });
    // pace-only, median stride pace 433 > floor−60 (396) and no HR → guard kills it
    expect(v.isQuality).toBe(false);
    expect(v.kind).toBe('none');
    expect(v.summary).toBe('');
  });
});

// ── (b2) 1 Hz strides run stays non-quality under v4 regime detection ─────────
// The known-bad 2026-07-02 shape: near-floor strides (7:13/mi) on a long easy
// run. Under v4 hysteresis they never even enter a WORK regime — the stride pace
// (433) sits ABOVE ENTER (floor − 50 = 406), so no blocks form at all, and the
// verdict is not quality at the source (no fake reps to gate out).
describe('strides guard at 1 Hz: six ~45s strides with ~120s jogs', () => {
  const stream = buildStream(
    [
      { durationS: 40 * 60, paceSecPerMi: 510 }, // long easy body, above floor
      ...Array.from({ length: 6 }, () => [
        { durationS: 45, paceSecPerMi: 433 }, // 7:13/mi stride — above ENTER (406)
        { durationS: 120, paceSecPerMi: 540 }, // real jog recovery
      ]).flat(),
    ],
    1, // 1 Hz
  );

  test('near-floor strides never enter a WORK regime → no blocks', () => {
    const det = detectQuality(stream, FLOOR_NO_HR);
    expect(det.blocks).toHaveLength(0);
  });

  test('ingest verdict stays NOT quality', () => {
    const v = computeIngestVerdict({ streams: stream, laps: null, floor: FLOOR_NO_HR });
    expect(v.isQuality).toBe(false);
    expect(v.kind).toBe('none');
    expect(v.summary).toBe('');
  });
});

// ── (c) long run, GAP-under-floor 54 min, avg HR ~140, hrFloor present → NOT ──
// Mirrors the FM-1 family: HR present wins over GAP; 140 < 163 → not quality.
describe('time-path gate: downhill long run at easy HR', () => {
  const stream = buildStream([
    // 14 mi @ 8:00 raw (480, above floor) but steadily downhill (GAP would dip
    // under the floor) — yet HR sits at 140, well below the 163 floor.
    { durationS: 14 * 8 * 60, paceSecPerMi: 480, hr: 140, gradeFrac: -0.05 },
  ]);

  test('HR present + below floor → not quality (GAP time alone cannot bank it)', () => {
    const v = computeIngestVerdict({ streams: stream, laps: null, floor: FLOOR });
    expect(v.isQuality).toBe(false);
    expect(v.kind).toBe('none');
  });
});

// ── (d) genuine tempo with HR confirmation → quality tempo ────────────────────
describe('tempo: HR-confirmed sustained effort', () => {
  const stream = buildStream([
    { durationS: 2 * 540, paceSecPerMi: 540, hr: 150 },   // 2mi warmup @ 9:00, clearly easy
    { durationS: 4 * 390, paceSecPerMi: 390, hr: 172 },   // 4mi @ 6:30, HR 172 ≥ 163
    { durationS: 1 * 540, paceSecPerMi: 540, hr: 150 },   // 1mi cooldown @ 9:00 (> EXIT 486)
  ]);

  test('kind is tempo, quality, honest pace-named summary', () => {
    const v = computeIngestVerdict({ streams: stream, laps: null, floor: FLOOR });
    expect(v.isQuality).toBe(true);
    expect(v.kind).toBe('tempo');
    expect(v.source).toBe('stream');
    // v4 regime: the ±10s smoothing lets the WORK regime absorb ~1 transition
    // sample at each end, so the measured tempo pace lands a hair off 6:30 (~6:3x).
    expect(v.summary).toMatch(/min tempo @ 6:3\d/);
  });
});

// ── (e) formatPace boundary — %60 rounds carry into the minute ────────────────
describe('formatPace boundary (5:60 bug fix)', () => {
  test('359.6 → 6:00, not 5:60', () => {
    expect(formatPaceMi(359.6)).toBe('6:00');
  });
  test('carries at any minute boundary', () => {
    expect(formatPaceMi(419.7)).toBe('7:00');
    expect(formatPaceMi(659.8)).toBe('11:00');
  });
  test('normal cases unaffected', () => {
    expect(formatPaceMi(342)).toBe('5:42');
    expect(formatPaceMi(456)).toBe('7:36');
    expect(formatPaceMi(390)).toBe('6:30');
  });
});

// ── Guard: a REAL fast lap session still passes (regression floor) ────────────
describe('lap-first: genuine 3×1mi reps still credited', () => {
  function laps(): StravaLap[] {
    const work = { distance: 1609, moving_time: 352, average_heartrate: 178 }; // 5:52/mi
    const rec = { distance: 400, moving_time: 150, average_heartrate: 150 };
    const easy = { distance: 1609, moving_time: 480, average_heartrate: 140 };
    return [{ ...easy }, { ...work }, { ...rec }, { ...work }, { ...rec }, { ...work }, { ...easy }];
  }
  const stream = buildStream([{ durationS: 2600, paceSecPerMi: 456, hr: 165 }]);

  test('3 mile reps credited from laps', () => {
    const v = computeIngestVerdict({ streams: stream, laps: laps(), floor: FLOOR });
    expect(v.kind).toBe('intervals');
    expect(v.source).toBe('laps');
    expect(v.blocks).toHaveLength(3);
    expect(v.summary).toMatch(/3×1mi @ 5:52/);
  });
});
