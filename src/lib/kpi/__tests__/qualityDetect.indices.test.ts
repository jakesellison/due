// src/lib/kpi/__tests__/qualityDetect.indices.test.ts
import {
  detectQuality,
  type RunStream,
} from '../qualityDetect';
import type { QualityFloor } from '../qualityFloor';

// 5s samples: 30s easy (4 m/s ≈ slow), then 60s hard (5.5 m/s ≈ fast), then 30s easy.
function streamFix(): RunStream {
  const d: number[] = [], v: number[] = [], t: number[] = [];
  let cd = 0, ct = 0;
  const push = (speed: number) => { cd += speed * 5; ct += 5; d.push(cd); v.push(speed); t.push(ct); };
  for (let i = 0; i < 6; i++) push(3.0);   // easy ~8:57/mi
  for (let i = 0; i < 12; i++) push(5.5);  // hard ~4:52/mi
  for (let i = 0; i < 6; i++) push(3.0);
  return { d, v, t };
}

test('blocks carry inclusive stream indices', () => {
  const floor: QualityFloor = { paceFloorSecPerMi: 420, hrFloor: null, qualityFloorSecPerMi: 400 };
  const det = detectQuality(streamFix(), floor);
  expect(det.blocks).toHaveLength(1);
  const b = det.blocks[0]!;
  // v4 regime: the ±20s smoothing shifts the WORK boundaries inward vs the old
  // per-sample threshold (was 6/17) — the regime latches once the smoothed pace
  // clears ENTER and releases once it clears EXIT.
  expect(b.startIdx).toBe(8);
  expect(b.endIdx).toBe(18);
});
