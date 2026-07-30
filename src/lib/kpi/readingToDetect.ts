/**
 * readingToDetect.ts — adapt a plan-conditioned interpreter `Reading` into the
 * flat `QualityDetect` shape the run-detail views (IntervalAnalysis /
 * ProgressionView / sustained block) already consume.
 *
 * The interpreter is the source of truth for WHICH samples are quality (the
 * blocks' stream-index ranges); this fills in the per-block geometry the views
 * draw (distance / moving-duration / achieved pace) from the same stream those
 * indices point into. Distance comes straight from the Reading (so it always
 * matches the credited quality miles); duration/pace are measured on the stream
 * with the shared moving-time helpers.
 *
 * Pure. No IO. Node-tested.
 */
import type { Reading } from './interpretWorkout';
import type { QualityDetect, HardBlock, RunStream } from './qualityDetect';
import {
  movingSeconds,
} from './intervalSnap';
import {
  METERS_PER_MILE,
} from '../units';

export function readingToDetect(reading: Reading, stream: RunStream): QualityDetect {
  const mapBlock = (b: Reading['blocks'][number]): HardBlock => {
    const distanceMeters = b.mi * METERS_PER_MILE;
    const durationS = movingSeconds(stream, b.startIdx, b.endIdx);
    const paceSecPerMi = b.mi > 0 ? durationS / b.mi : b.gapPaceSecPerMi;
    return { distanceMeters, paceSecPerMi, durationS, startIdx: b.startIdx, endIdx: b.endIdx };
  };
  const blocks: HardBlock[] = reading.blocks.map(mapBlock);
  const extraBlocks = reading.extras?.map(mapBlock) ?? [];
  return {
    isQuality: reading.kind !== 'none',
    kind: reading.kind,
    blocks,
    ...(extraBlocks.length ? { extraBlocks } : {}),
    summary: reading.summary,
    qualityTimeMin: blocks.reduce((s, b) => s + b.durationS, 0) / 60,
    qualityDistanceMeters: blocks.reduce((s, b) => s + b.distanceMeters, 0),
  };
}
