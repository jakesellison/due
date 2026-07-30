// src/lib/kpi/__tests__/intervalSnap.test.ts
import {
  canonicalGrid,
  nearestCanonical,
} from '../intervalSnap';
import {
  extendBlock,
  type Effort,
} from '../intervalSnap';
import {
  detectQuality,
  type RunStream,
} from '../qualityDetect';
import type { QualityFloor } from '../qualityFloor';
import type { HardBlock } from '../qualityDetect';

const MPM = 1609.344;
/** Build a stream from {distM, paceSecMi, hr} parts at ~5s/sample. */
export function buildStream(parts: { distM: number; paceSecMi: number; hr?: number }[], dt = 5): RunStream {
  const d: number[] = [], v: number[] = [], t: number[] = [], hr: number[] = [];
  let cd = 0, ct = 0;
  for (const p of parts) {
    const speed = MPM / p.paceSecMi;
    const dur = p.distM / speed;
    const steps = Math.max(1, Math.round(dur / dt));
    for (let k = 0; k < steps; k++) {
      cd += p.distM / steps; ct += dur / steps;
      d.push(cd); v.push(speed); t.push(ct); hr.push(p.hr ?? 150);
    }
  }
  return { d, v, t, hr };
}

describe('canonical grid', () => {
  test('imperial grid snaps 1.93mi (3105m) to 2 mi, not 3 km', () => {
    const grid = canonicalGrid('mi');
    expect(grid.some((c) => c.label === '3 km')).toBe(false); // 3km not in imperial road grid
    const hit = nearestCanonical(1.93 * 1609.344, grid);
    expect(hit?.label).toBe('2 mi');
  });

  test('snaps 405m to 400 m (track is metric in both units)', () => {
    expect(nearestCanonical(405, canonicalGrid('mi'))?.label).toBe('400 m');
  });

  test('returns null when nothing is within tolerance', () => {
    // 1.6 mi = 2575m: nearest canon is 1.5mi(2414) at 6.6% — inside 12%. Use a true gap.
    expect(nearestCanonical(2700, canonicalGrid('mi'), 0.05)).toBeNull();
  });

  test('metric grid offers 3 km and snaps 3105m there', () => {
    expect(nearestCanonical(3105, canonicalGrid('km'))?.label).toBe('3 km');
  });
});

describe('effort-boundary extension', () => {
  test('extends a hard core outward through the accel/decel ramp', () => {
    // 0.1mi accel @ 7:30, 1.7mi hard @ 6:00, 0.1mi decel @ 7:30 — floor 7:00 clips the ramps.
    const stream = buildStream([
      { distM: 0.1 * MPM, paceSecMi: 450 },
      { distM: 1.7 * MPM, paceSecMi: 360 },
      { distM: 0.1 * MPM, paceSecMi: 450 },
    ]);
    const floor: QualityFloor = { paceFloorSecPerMi: 420, hrFloor: null, qualityFloorSecPerMi: 400 }; // 7:00
    const det = detectQuality(stream, floor);
    const core = det.blocks[0]!;
    const eff = extendBlock(stream, core, 480); // still-working = 8:00
    // Extended span should exceed the clipped hard core and approach ~1.9mi.
    expect(eff.distMeters).toBeGreaterThan(core.distanceMeters);
    expect(eff.distMeters / MPM).toBeGreaterThan(1.85);
  });
});

import {
  creditRep,
  type Credit,
} from '../intervalSnap';
import {
  snapIntervals,
  type IntervalSnap,
} from '../intervalSnap';
import type { Segment } from '../../workout/types';

const floor = { paceFloorSecPerMi: 420, hrFloor: null, qualityFloorSecPerMi: 400 };
/** Warmup, 3 reps (~2mi hard @ ~6:00 with decel) each + 0.2mi recovery, cooldown. */
function threeByTwoMile(repHardMiles: number[]): RunStream {
  const parts: { distM: number; paceSecMi: number }[] = [{ distM: 2 * MPM, paceSecMi: 540 }];
  for (const hardMi of repHardMiles) {
    // v4 regime: the hard core must clear ENTER (floor 420 − 50 = 370); 6:00 is a
    // realistic threshold rep (60 s under a 7:00 floor) that latches WORK, where
    // the old 6:12 (372) sat 2 s inside the hysteresis dead-band.
    parts.push({ distM: hardMi * MPM, paceSecMi: 360 });          // hard 6:00
    parts.push({ distM: (2 - hardMi) * MPM, paceSecMi: 450 });    // decel fills to 2mi
    parts.push({ distM: 0.2 * MPM, paceSecMi: 600 });             // recovery jog
  }
  parts.push({ distM: 2 * MPM, paceSecMi: 540 });
  return buildStream(parts);
}

describe('snapIntervals', () => {
  test('inference: three ~1.9mi cores snap the set to "3 × 2 mi"', () => {
    const stream = threeByTwoMile([1.85, 1.95, 1.9]);
    const det = detectQuality(stream, floor);
    const snap: IntervalSnap = snapIntervals(stream, det.blocks, { unit: 'mi' });
    expect(snap.label).toBe('3 × 2 mi');
    expect(snap.uniform).toBe(true);
    expect(snap.snapped).toBe(true);
    expect(snap.source).toBe('inference');
    expect(snap.reps).toHaveLength(3);
    expect(Math.round(snap.reps[0]!.targetDistMeters)).toBe(Math.round(2 * MPM));
  });

  test('prescription wins: plan 3×2mi sets source=prescription', () => {
    const stream = threeByTwoMile([1.85, 1.95, 1.9]);
    const det = detectQuality(stream, floor);
    const prescribed: Segment[] = [
      { kind: 'repeat', sets: 3, children: [
        { kind: 'interval', target: { by: 'distance', distance_m: 3218.7, hr_zone: 'threshold' } },
        { kind: 'recovery', target: { by: 'time', duration_s: 120 } },
      ] },
    ];
    const snap = snapIntervals(stream, det.blocks, { unit: 'mi', prescribed });
    expect(snap.source).toBe('prescription');
    expect(snap.label).toBe('3 × 2 mi');
  });

  test('non-uniform set → "N hard reps", not snapped', () => {
    // A ladder of genuinely different reps (0.25 / 0.5 / 1.0 mi) with jog recoveries.
    // The 10:00/mi recoveries sit above the 8:00 still-working threshold, so
    // extendBlock can't equalize the cores — the set stays non-uniform.
    const stream = buildStream([
      { distM: 1 * MPM, paceSecMi: 540 }, // warmup
      { distM: 0.25 * MPM, paceSecMi: 372 }, { distM: 0.25 * MPM, paceSecMi: 600 },
      { distM: 0.5 * MPM, paceSecMi: 372 }, { distM: 0.25 * MPM, paceSecMi: 600 },
      { distM: 1.0 * MPM, paceSecMi: 372 }, { distM: 0.25 * MPM, paceSecMi: 600 },
      { distM: 1 * MPM, paceSecMi: 540 }, // cooldown
    ]);
    const det = detectQuality(stream, floor);
    const snap = snapIntervals(stream, det.blocks, { unit: 'mi' });
    expect(snap.uniform).toBe(false);
    expect(snap.label).toMatch(/hard reps$/);
  });
});

describe('forgiving credit', () => {
  const target = 2 * MPM;

  test('clean rep: clipped 1.88mi decel fills to 2mi, not faded', () => {
    const stream = buildStream([
      { distM: 1.85 * MPM, paceSecMi: 360 }, // hard
      { distM: 0.15 * MPM, paceSecMi: 450 }, // decel to 2.0 (7:30 — still running)
      { distM: 0.2 * MPM, paceSecMi: 600 },  // recovery jog
    ]);
    const det = require('../qualityDetect').detectQuality(stream, { paceFloorSecPerMi: 420, hrFloor: null });
    const eff = extendBlock(stream, det.blocks[0], 480);
    const c: Credit = creditRep(stream, eff, target, stream.d.length - 1, det.blocks[0].paceSecPerMi);
    expect(Math.round(c.creditedMeters)).toBe(Math.round(target));
    expect(c.faded).toBe(false);
  });

  test('blow-up rep: walked the last 0.15mi → credited 2mi but faded, pace slower', () => {
    const stream = buildStream([
      { distM: 1.85 * MPM, paceSecMi: 360 }, // hard
      { distM: 0.15 * MPM, paceSecMi: 1080 },// WALK (18:00/mi)
      { distM: 0.2 * MPM, paceSecMi: 600 },  // recovery
    ]);
    const det = require('../qualityDetect').detectQuality(stream, { paceFloorSecPerMi: 420, hrFloor: null });
    const eff = extendBlock(stream, det.blocks[0], 480);
    const c: Credit = creditRep(stream, eff, target, stream.d.length - 1, det.blocks[0].paceSecPerMi);
    expect(Math.round(c.creditedMeters)).toBe(Math.round(target)); // still credited 2mi
    expect(c.faded).toBe(true);
    expect(c.achievedPaceSecPerMi).toBeGreaterThan(det.blocks[0].paceSecPerMi); // slower than hard pace
  });

  test('over-covered rep: 264m effort credited to a 200m target keeps the real pace', () => {
    // A 200 m rep whose GPS/effort trace measures 264 m at a steady 5:36/mi. The
    // pace must reflect the ground actually covered (~5:36), NOT the real 264 m
    // time divided by the 200 m target (which would report ~7:24 — the bug).
    const stream = buildStream([
      { distM: 400, paceSecMi: 540 }, // easy lead-in (9:00/mi)
      { distM: 264, paceSecMi: 336 }, // the hard 200 m rep, over-measured to 264 m
      { distM: 400, paceSecMi: 600 }, // recovery jog (10:00/mi)
    ]);
    const det = require('../qualityDetect').detectQuality(stream, { paceFloorSecPerMi: 420, hrFloor: null });
    const eff = extendBlock(stream, det.blocks[0], 480);
    const c: Credit = creditRep(stream, eff, 200, stream.d.length - 1, det.blocks[0].paceSecPerMi);
    expect(Math.round(c.creditedMeters)).toBe(200);          // labelled as the 200 m target
    expect(c.achievedPaceSecPerMi).toBeLessThan(400);        // NOT the ~444 (7:24) artefact
    expect(c.achievedPaceSecPerMi).toBeGreaterThan(300);     // and honestly near the 5:36 core
  });
});
