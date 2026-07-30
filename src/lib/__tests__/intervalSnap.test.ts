import {
  snapIntervals,
} from '../kpi/intervalSnap';
import type { RunStream } from '../kpi/qualityDetect';
import type { HardBlock } from '../kpi/qualityDetect';

// Minimal synthetic stream: 1 Hz, two 400 m hard reps at ~5:00/mi (3.0 m/s)
// separated by a slow jog, over a flat course.
function synthStream(): RunStream {
  const d: number[] = [], v: number[] = [], t: number[] = [];
  let dist = 0;
  const push = (speed: number, secs: number) => {
    for (let i = 0; i < secs; i++) { dist += speed; d.push(dist); v.push(speed); t.push(t.length); }
  };
  push(3.0, 134);  // rep 1: ~400 m hard
  push(1.6, 90);   // jog
  push(3.0, 134);  // rep 2: ~400 m hard
  return { d, v, t };
}

test('snapIntervals exposes each rep startIdx/endIdx', () => {
  const s = synthStream();
  const blocks: HardBlock[] = [
    { distanceMeters: 402, paceSecPerMi: 300, durationS: 134, startIdx: 0, endIdx: 133 },
    { distanceMeters: 402, paceSecPerMi: 300, durationS: 134, startIdx: 224, endIdx: 357 },
  ];
  const snap = snapIntervals(s, blocks, { unit: 'mi' });
  expect(snap.reps).toHaveLength(2);
  expect(snap.reps[0]!.startIdx).toBe(0);
  expect(snap.reps[1]!.startIdx).toBeGreaterThanOrEqual(224);
  expect(snap.reps[1]!.endIdx).toBeGreaterThanOrEqual(snap.reps[1]!.startIdx);
});
