// src/lib/kpi/__tests__/intervalSnap.integration.test.ts
import {
  detectQuality,
  type RunStream,
} from '../qualityDetect';
import {
  snapIntervals,
} from '../intervalSnap';

const MPM = 1609.344;
function buildStream(parts: { distM: number; paceSecMi: number; hr?: number }[], dt = 5): RunStream {
  const d: number[] = [], v: number[] = [], t: number[] = [], hr: number[] = [];
  let cd = 0, ct = 0;
  for (const p of parts) {
    const speed = MPM / p.paceSecMi; const dur = p.distM / speed;
    const steps = Math.max(1, Math.round(dur / dt));
    for (let k = 0; k < steps; k++) { cd += p.distM / steps; ct += dur / steps; d.push(cd); v.push(speed); t.push(ct); hr.push(p.hr ?? 150); }
  }
  return { d, v, t, hr };
}
const floor = { paceFloorSecPerMi: 454, hrFloor: null, qualityFloorSecPerMi: 420 }; // ≈7:34/mi, Jake's real session

test('b0feb4cf shape: 3×2mi @ ~6:20 with a blown-up third rep', () => {
  const stream = buildStream([
    { distM: 2 * MPM, paceSecMi: 540, hr: 140 },                 // warmup
    { distM: 1.88 * MPM, paceSecMi: 361, hr: 176 }, { distM: 0.12 * MPM, paceSecMi: 470, hr: 178 }, { distM: 0.2 * MPM, paceSecMi: 600, hr: 156 },
    { distM: 1.9 * MPM, paceSecMi: 388, hr: 183 }, { distM: 0.1 * MPM, paceSecMi: 470, hr: 184 }, { distM: 0.24 * MPM, paceSecMi: 600, hr: 155 },
    { distM: 1.7 * MPM, paceSecMi: 395, hr: 185 }, { distM: 0.3 * MPM, paceSecMi: 1020, hr: 165 }, // rep 3: blew up, walked the last 0.3
    { distM: 2 * MPM, paceSecMi: 540, hr: 140 },                 // cooldown
  ]);
  const det = detectQuality(stream, floor);
  const snap = snapIntervals(stream, det.blocks, { unit: 'mi' });

  expect(snap.label).toBe('3 × 2 mi');
  expect(snap.reps).toHaveLength(3);
  for (const r of snap.reps) expect(Math.round(r.targetDistMeters)).toBe(Math.round(2 * MPM));
  expect(snap.reps[2]!.faded).toBe(true);                        // third rep walked the finish
  expect(snap.reps[2]!.achievedPaceSecPerMi).toBeGreaterThan(snap.reps[0]!.achievedPaceSecPerMi);
});
