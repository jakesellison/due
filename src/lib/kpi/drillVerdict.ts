/**
 * drillVerdict.ts — build the plan-match drill view-model for one run.
 *
 * Pure. No IO. Node-tested. Renders nothing; emits a flat DrillVerdict the
 * PlanMatchBand renders directly. Quality days compare detected effort to the
 * prescribed structure (matched/partial/missed), grouping reps into the plan's
 * sets (e.g. 4×800 + 8×400) so each set is judged against its own target;
 * non-quality days reduce to a distance-met verdict.
 */
import type { QualityDetect, RunStream } from './qualityDetect';
import {
  detectQuality,
  matchPlannedQuality,
  extractPlannedIntervals,
} from './qualityDetect';
import {
  avgHrOver,
  snapIntervals,
} from './intervalSnap';
import {
  repsFromLaps,
} from './lapIntervals';
import {
  reconcileLapsWithRegime,
} from './lapsRegime';
import {
  prescribedQualityMinutes,
  meetsSufficiencyGate,
} from './prescribedQuality';
import type { QualityFloor } from './qualityFloor';
import {
  resolveTargetPace,
  type RacePaces,
} from './targetPace';
import type { Target, WorkoutStructure } from '../workout/types';
import {
  paceIntent,
} from '../workout/pace';
import type { StravaLap } from '../run/analysis';
import {
  METERS_PER_MILE,
} from '../units';

/** The minimal rep shape the drill groups + renders, from laps OR stream snap. */
interface SourceRep {
  distanceMeters: number;
  paceSecPerMi: number;
  avgHr: number | null;
  startIdx: number;
  endIdx: number;
}

const V_MIN = 0.3;
const DIST_TOL_M = 161; // 0.1 mi

export type DrillKind = 'quality' | 'distance';
export type QualityState = 'matched' | 'partial' | 'missed';
export type DistanceState = 'met' | 'short';

export interface RepRow {
  index: number;         // 1-based across the whole session
  setIndex: number;      // which planned set this rep belongs to (0-based)
  distanceMeters: number;
  paceSecPerMi: number;
  deltaSec: number | null; // vs THIS rep's set target; null when no target
  avgHr: number | null;
  startIdx: number;
  endIdx: number;
}
export interface RecoveryRow { index: number; distanceMeters: number; paceSecPerMi: number }

/** One prescribed set (a `repeat` block) with the reps detected for it. */
export interface DrillSet {
  kind?: 'planned' | 'extra';
  plannedReps: number;
  distPerRepMeters: number;
  targetSecPerMi: number | null;
  zoneLabel: string | null;
  reps: RepRow[];
}

export interface DrillVerdict {
  kind: DrillKind;
  qualityState?: QualityState;
  plannedStructure?: string;
  plannedZoneLabel?: string | null;
  targetSecPerMi?: number | null;
  runAvgSecPerMi?: number;
  repCount?: number;
  /** Reps grouped by planned set — the primary structure the UI renders. */
  sets?: DrillSet[];
  /** Flat reps across all sets (for chart/route highlight indexing). */
  reps?: RepRow[];
  recoveries?: RecoveryRow[];
  distanceState?: DistanceState;
  plannedMeters?: number;
  runMeters?: number;
}

export interface DrillInput {
  planned: {
    is_quality: boolean;
    structure: WorkoutStructure;
    planned_distance_meters: number | null;
    prescribed_quality_meters?: number | null;
  } | null;
  stream: RunStream | null;
  /** Canonical resolved interpretation. When present, the drill must not run a
   * second detector with different boundaries/counts. */
  detected?: QualityDetect | null;
  /** The run's Strava laps — the exact source for reps when the athlete marked them. */
  laps?: StravaLap[] | null;
  floor: QualityFloor;
  runMeters: number;
  paces: RacePaces | null;
}

export interface PlannedSetDef { reps: number; distPerRepMeters: number; target: Target | null }

/** Every `repeat` block in the structure, in order, with its work target. */
export function extractPlannedSets(
  structure: WorkoutStructure,
  paces: RacePaces | null = null,
  prescribedTotalMeters?: number | null,
): PlannedSetDef[] {
  const intervalPlan = extractPlannedIntervals(structure, {
    paces,
    prescribedTotalMeters,
  });
  const out: PlannedSetDef[] = [];
  let groupIndex = 0;
  for (const seg of structure) {
    if (seg.kind === 'repeat') {
      const work = seg.children.find((child) => (
        child.kind === 'work' || child.kind === 'interval' || child.kind === 'steady'
      )) ?? seg.children[0];
      const target = work && work.kind !== 'repeat' ? work.target : null;
      out.push({
        reps: seg.sets,
        distPerRepMeters: intervalPlan?.groups[groupIndex]?.distPerRepMeters ?? 0,
        target,
      });
      groupIndex += 1;
    }
  }
  return out;
}

function fmtRepDist(meters: number): string {
  return meters >= 1500 ? `${(meters / METERS_PER_MILE).toFixed(2)}mi` : `${Math.round(meters)}m`;
}

/** Moving pace (sec/mi) over inclusive indices a..b; null if too short. */
function recoveryBetween(stream: RunStream, aEnd: number, bStart: number): RecoveryRow | null {
  const { d, v, t } = stream;
  if (bStart <= aEnd + 1) return null;
  const distM = (d[bStart] ?? 0) - (d[aEnd] ?? 0);
  if (distM <= 0) return null;
  let sec = 0;
  for (let i = aEnd + 1; i <= bStart; i++) {
    if ((v[i] ?? 0) > V_MIN) sec += (t[i] ?? 0) - (t[i - 1] ?? 0);
  }
  if (sec <= 0) return null;
  return { index: 0, distanceMeters: distM, paceSecPerMi: sec / (distM / METERS_PER_MILE) };
}

export function buildDrillVerdict(input: DrillInput): DrillVerdict | null {
  const { planned, stream, floor, runMeters, paces } = input;
  if (planned == null) return null;

  const isQualityDay = planned.is_quality && planned.structure.length > 0;

  if (!isQualityDay) {
    const plannedMeters = planned.planned_distance_meters ?? 0;
    // No positive target = nothing to grade: an unplanned/rest-day run must
    // read as unplanned (no MET chip, no "x / 0.00 mi OVER" card), not as
    // trivially meeting a zero target (beta-readiness audit U2).
    if (plannedMeters <= 0) return null;
    const met = runMeters >= plannedMeters - DIST_TOL_M;
    return { kind: 'distance', distanceState: met ? 'met' : 'short', plannedMeters, runMeters };
  }

  // ── Quality day ──
  const structure = planned.structure;
  const intervalContext = {
    paces,
    prescribedTotalMeters: planned.prescribed_quality_meters,
  };
  const intervals = extractPlannedIntervals(structure, intervalContext);
  const setDefs = extractPlannedSets(
    structure,
    paces,
    planned.prescribed_quality_meters,
  );
  const resolved = setDefs.map((sd) => ({
    plannedReps: sd.reps,
    distPerRepMeters: sd.distPerRepMeters,
    targetSecPerMi: sd.target ? resolveTargetPace(sd.target, paces) : null,
    zoneLabel: paceIntent(sd.target?.pace),
  }));
  const targetSecPerMi = resolved[0]?.targetSecPerMi ?? null;
  const plannedZoneLabel = resolved[0]?.zoneLabel ?? null;
  const plannedStructure = intervals
    ? intervals.groups
      .map((group) => `${group.reps}×${fmtRepDist(group.distPerRepMeters)}`)
      .join(' + ')
    : undefined;

  if (stream == null) {
    return {
      kind: 'quality', qualityState: 'missed',
      plannedStructure, plannedZoneLabel, targetSecPerMi,
      repCount: intervals?.reps,
      sets: resolved.map((rs) => ({ ...rs, reps: [] })),
      reps: [], recoveries: [],
    };
  }

  const detect = input.detected ?? detectQuality(stream, floor);
  const prescribedMin = prescribedQualityMinutes(structure, floor, planned.planned_distance_meters ?? undefined, paces);
  const matchedByPlan = matchPlannedQuality(detect, structure, intervalContext).matched;
  const sufficientQuality = detect.isQuality && meetsSufficiencyGate(detect.qualityTimeMin, prescribedMin);

  // Reps come from the athlete's own lap marks when present (exact splits),
  // reconciled with the stream regime so per-mile lapping INSIDE a 2-mile rep
  // collapses into the true rep (matches the intrinsic verdict chip — no 8 rows
  // under a "4×2mi" header); only when there are no lap marks do we fall back to
  // detecting reps from the stream (which blurs short efforts).
  const lapReps = repsFromLaps(input.laps, {
    paceFloorSecPerMi: floor.paceFloorSecPerMi,
    hrFloor: floor.hrFloor,
    stream,
  });
  const snap = snapIntervals(stream, detect.blocks, {
    unit: 'mi',
    prescribed: structure,
    prescribedContext: intervalContext,
  });
  const sourceReps: SourceRep[] = lapReps.length >= 2
    ? reconcileLapsWithRegime(lapReps, detect.blocks)
    : snap.reps.map((r) => ({
        distanceMeters: r.targetDistMeters,
        paceSecPerMi: r.achievedPaceSecPerMi,
        avgHr: r.avgHr,
        startIdx: r.startIdx,
        endIdx: r.endIdx,
      }));

  // A plan matcher can accept interval volume even when reconciliation yields
  // fewer concrete reps than the prescription. The drill and hero must never
  // call that "matched" while showing (for example) four rows under a five-rep
  // plan. Require the same reconciled evidence the UI renders to cover every
  // prescribed rep; genuine extras may still sit beyond that core count.
  const totalPlanned = resolved.reduce((sum, set) => sum + set.plannedReps, 0);
  const displayedRepsCoverPlan = !intervals || totalPlanned === 0 || sourceReps.length >= totalPlanned;
  const qualityState: QualityState = matchedByPlan
    ? displayedRepsCoverPlan ? 'matched' : 'partial'
    : sufficientQuality
      ? 'partial'
      : 'missed';

  const mkRep = (r: SourceRep, index: number, setIndex: number, tgt: number | null): RepRow => ({
    index, setIndex,
    distanceMeters: r.distanceMeters,
    paceSecPerMi: r.paceSecPerMi,
    deltaSec: tgt != null ? Math.round(r.paceSecPerMi - tgt) : null,
    avgHr: r.avgHr,
    startIdx: r.startIdx,
    endIdx: r.endIdx,
  });

  // Group detected reps into planned sets when the counts line up; otherwise a
  // single inferred set (one block, or detection that didn't match the plan).
  const grouped = resolved.length > 1 && sourceReps.length === totalPlanned;
  const reps: RepRow[] = [];
  const sets: DrillSet[] = [];

  if (grouped) {
    let cursor = 0;
    resolved.forEach((rs, si) => {
      const slice = sourceReps.slice(cursor, cursor + rs.plannedReps);
      cursor += rs.plannedReps;
      const setReps = slice.map((r, i) => mkRep(r, reps.length + i + 1, si, rs.targetSecPerMi));
      reps.push(...setReps);
      sets.push({ ...rs, reps: setReps });
    });
  } else {
    const tgt = resolved[0]?.targetSecPerMi ?? null;
    const setReps = sourceReps.map((r, i) => mkRep(r, i + 1, 0, tgt));
    reps.push(...setReps);
    sets.push({
      plannedReps: intervals?.reps ?? sourceReps.length,
      distPerRepMeters: resolved[0]?.distPerRepMeters ?? intervals?.distPerRepMeters ?? 0,
      targetSecPerMi: tgt,
      zoneLabel: resolved[0]?.zoneLabel ?? null,
      reps: setReps,
    });
  }

  const coreRepCount = reps.length;

  // A plan-aligned interpretation may retain genuine additional reps separately
  // from the prescribed core. Keep them visible without letting them rewrite the
  // plan header or the matched summary. Incidental fragments never reach this
  // field (the aligner already discarded them).
  const extraBlocks = detect.extraBlocks ?? [];
  if (extraBlocks.length > 0) {
    const setIndex = sets.length;
    const extraReps = extraBlocks.map((block, i) => mkRep({
      distanceMeters: block.distanceMeters,
      paceSecPerMi: block.paceSecPerMi,
      avgHr: avgHrOver(stream, block.startIdx, block.endIdx),
      startIdx: block.startIdx,
      endIdx: block.endIdx,
    }, reps.length + i + 1, setIndex, null));
    reps.push(...extraReps);
    sets.push({
      kind: 'extra',
      plannedReps: extraReps.length,
      distPerRepMeters: extraReps[0]!.distanceMeters,
      targetSecPerMi: null,
      zoneLabel: null,
      reps: extraReps,
    });
  }

  const recoveries: RecoveryRow[] = [];
  for (let i = 0; i + 1 < sourceReps.length; i++) {
    const rec = recoveryBetween(stream, sourceReps[i]!.endIdx, sourceReps[i + 1]!.startIdx);
    if (rec) recoveries.push({ ...rec, index: i + 1 });
  }

  const runAvgSecPerMi = coreRepCount > 0
    ? reps.slice(0, coreRepCount).reduce((s, r) => s + r.paceSecPerMi, 0) / coreRepCount
    : undefined;

  return {
    kind: 'quality', qualityState,
    plannedStructure, plannedZoneLabel, targetSecPerMi,
    runAvgSecPerMi, repCount: reps.length, sets, reps, recoveries,
  };
}
