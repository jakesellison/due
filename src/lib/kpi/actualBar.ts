/**
 * actualBar.ts — the ACTUAL-shape bar: what a run really was, positioned by
 * real distance from its stream, for the Dash today card's completed state.
 *
 * Pure. No IO. Node-tested.
 *
 * The prescription StructureBar draws the PLAN. Post-run the owner wants the
 * card to show WHAT WAS RUN, per logged activity, honest by construction: an
 * easy run on a quality day shows a flat green bar, never phantom reps.
 *
 * Stored `quality.blocks` carry sample indices (startIdx/endIdx) but NO distance
 * positions, and lean Dash rows have no streams — so the shape can't be
 * positioned client-side. We compute it at ingest (where full-res streams live)
 * and store `quality.actualBar`.
 *
 * Given the detected hard BLOCKS and the run's cumulative distance stream, walk
 * the stream: each work block (d[startIdx]..d[endIdx]) is a `work` span; the span
 * before the first block is the `wu`; spans between blocks are `rest` (recovery
 * jog); the span after the last block is the `cd`. Every span is sized by its
 * real distance. A non-quality run (kind 'none') is one flat `steady` bar.
 */
import type { BarSeg } from '../workout/structureBar';
import type { HardBlock, QualityKind } from './qualityDetect';

/**
 * Build the ordered ACTUAL bar segments for a run from its detected hard blocks
 * and cumulative distance stream.
 *
 * @param blocks         Detected hard/work blocks (with startIdx/endIdx into `d`).
 * @param d              Cumulative distance stream (meters), index-aligned to the
 *                       source stream the block indices reference.
 * @param totalMeters    The run's total distance — sizes the flat easy bar and
 *                       the sub-segment merge floor.
 * @param kind           The quality verdict kind ('none' | 'tempo' | 'intervals').
 * @returns              Bar segments whose meters sum to ~the stream distance
 *                       (~totalMeters). 'none' → a single flat `steady` bar.
 */
export function actualBarSegments(
  blocks: readonly HardBlock[] | null | undefined,
  d: readonly number[] | null | undefined,
  totalMeters: number,
  kind: QualityKind,
): BarSeg[] {
  const total = Math.max(0, totalMeters);
  // Non-quality (or no usable blocks/stream) → one flat easy bar.
  if (kind === 'none' || !blocks || blocks.length === 0 || !d || d.length === 0) {
    return [{ kind: 'steady', meters: total }];
  }

  const last = d.length - 1;
  const at = (i: number): number => d[Math.max(0, Math.min(last, i))] ?? 0;
  const start0 = at(0);

  const sorted = [...blocks].sort((a, b) => a.startIdx - b.startIdx);
  const raw: BarSeg[] = [];

  // Warm-up: the span before the first work block.
  const wu = at(sorted[0]!.startIdx) - start0;
  if (wu > 0) raw.push({ kind: 'wu', meters: wu });

  for (let i = 0; i < sorted.length; i++) {
    const b = sorted[i]!;
    const work = at(b.endIdx) - at(b.startIdx);
    raw.push({ kind: 'work', meters: Math.max(0, work) });
    if (i < sorted.length - 1) {
      // Recovery jog between this block and the next.
      const rest = at(sorted[i + 1]!.startIdx) - at(b.endIdx);
      if (rest > 0) raw.push({ kind: 'rest', meters: rest });
    }
  }

  // Cool-down: the span after the last work block.
  const cd = at(last) - at(sorted[sorted.length - 1]!.endIdx);
  if (cd > 0) raw.push({ kind: 'cd', meters: cd });

  return mergeTiny(raw, total);
}

/**
 * Fold any sub-~1% segment into an adjacent one so the bar stays glanceable and
 * the segment meters are preserved (sum unchanged). A tiny span merges into the
 * previous kept segment; a tiny leading span merges forward into the next.
 */
function mergeTiny(segs: BarSeg[], total: number): BarSeg[] {
  if (segs.length <= 1) return segs;
  const min = Math.max(1, total * 0.01);
  const out: BarSeg[] = [];
  for (const s of segs) {
    const prev = out[out.length - 1];
    if (s.meters < min && prev) prev.meters += s.meters;
    else out.push({ ...s });
  }
  // A tiny leading segment had no previous to fold into — fold it forward.
  if (out.length > 1 && out[0]!.meters < min) {
    out[1]!.meters += out[0]!.meters;
    out.shift();
  }
  return out;
}
