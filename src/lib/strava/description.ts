/**
 * description.ts — the compact plan-context block Due appends to a Strava run
 * description. Strava already shows the activity name, distance and time; this
 * block supplies the information Strava does not have: where the day sits in
 * the plan and what the run just banked against the weekly contracts.
 *
 * Example:
 *   Quality day · 14/17 mi
 *   Due 10/23 · Build · 36/50 mi
 *
 *   🟨🟨🟨🟨⬛ 36/50 mi mileage
 *   🟪 6/12 mi quality
 *   🟦 14/14 mi long run
 *
 *   due.run
 *
 * `mergeDescription` re-writes only OUR block (found via the DUE_MARK sentinel),
 * preserving whatever the athlete wrote above it — so repeated ingests never
 * clobber their words and never stack duplicate blocks.
 *
 * Pure. No IO. Node-tested.
 */
import {
  GOAL_GATES,
} from '../kpi/weekGoals';

/** Visible start of the current share block. Legacy blocks began `🏃 Due`; the
 * merge matcher recognizes both so rollout never stacks duplicate receipts. */
export const DUE_MARK = 'Due ';

const GRID_CELLS = 5;
const EMPTY_CELL = '⬛';
const MILEAGE_CELL = '🟨';
const PILLAR_CELL: Record<Exclude<Pillar, 'mileage'>, string> = { quality: '🟪', long: '🟦' };
const PILLAR_LABEL: Record<Exclude<Pillar, 'mileage'>, string> = { quality: 'quality', long: 'long run' };

export type Pillar = 'mileage' | 'quality' | 'long';

export interface PillarProgress {
  actualMi: number;
  targetMi: number;
}

export interface DescriptionInput {
  weekNumber: number;
  totalWeeks: number;
  phase?: string | null;
  /** The selected plan day's aggregate allocation. Day-level wording is
   *  deliberate: a double on a quality day must not label both runs Quality. */
  allocation?: {
    label: string;
    actualMi: number;
    targetMi: number;
  } | null;
  /** Per-pillar week progress; a pillar with targetMi ≤ 0 is omitted. */
  pillars: Partial<Record<Pillar, PillarProgress>>;
}

/** Whole number when integral, else one decimal (e.g. 36, 6.2). */
const mi = (n: number) => {
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
};

function cap(value: string): string {
  return value.length > 0 ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : value;
}

function allocationLine(allocation: NonNullable<DescriptionInput['allocation']>): string {
  const { label, actualMi, targetMi } = allocation;
  if (targetMi <= 0) return `${label} · ${mi(actualMi)} mi`;
  return `${label} · ${mi(actualMi)}/${mi(targetMi)} mi`;
}

function supportingPillarLine(
  pillar: Exclude<Pillar, 'mileage'>,
  value: PillarProgress,
): string {
  return `${PILLAR_CELL[pillar]} ${mi(value.actualMi)}/${mi(value.targetMi)} mi ${PILLAR_LABEL[pillar]}`;
}

function mileageProgressLine(value: PillarProgress): string {
  const gateTarget = GOAL_GATES.mileage * value.targetMi;
  const fraction = gateTarget > 0 ? Math.max(0, Math.min(1, value.actualMi / gateTarget)) : 0;
  let filled = Math.round(fraction * GRID_CELLS);
  if (value.actualMi > 0 && filled === 0) filled = 1;
  const cells = MILEAGE_CELL.repeat(filled) + EMPTY_CELL.repeat(GRID_CELLS - filled);
  return `${cells} ${mi(value.actualMi)}/${mi(value.targetMi)} mi mileage`;
}

/** Build the plan-progress block (no leading/trailing whitespace). */
export function buildDescriptionBlock(input: DescriptionInput): string {
  const mileage = input.pillars.mileage;
  const context = [
    `${DUE_MARK}${input.weekNumber}/${input.totalWeeks}`,
    input.phase ? cap(input.phase) : null,
    mileage && mileage.targetMi > 0 ? `${mi(mileage.actualMi)}/${mi(mileage.targetMi)} mi` : null,
  ]
    .filter(Boolean).join(' · ');
  const lines: string[] = [];

  if (input.allocation) {
    lines.push(allocationLine(input.allocation));
  }
  lines.push(context);

  const quality = input.pillars.quality;
  const long = input.pillars.long;
  if (
    (mileage && mileage.targetMi > 0)
    || (quality && quality.targetMi > 0)
    || (long && long.targetMi > 0)
  ) lines.push('');
  if (mileage && mileage.targetMi > 0) lines.push(mileageProgressLine(mileage));
  if (quality && quality.targetMi > 0) lines.push(supportingPillarLine('quality', quality));
  if (long && long.targetMi > 0) lines.push(supportingPillarLine('long', long));

  lines.push('');
  lines.push('due.run');
  return lines.join('\n');
}

/**
 * Merge our block into an existing description: strip any prior Due block (from
 * DUE_MARK to the end) and append the fresh one below the athlete's own text.
 */
export function mergeDescription(existing: string | null | undefined, block: string): string {
  const prior = existing ?? '';
  // Outcome-first blocks put the allocation on the line immediately before the
  // Due marker. Match both lines so refreshing the receipt cannot strand the
  // old outcome above the replacement. Pre-rollout blocks still begin at Due.
  const current = /(?:^|\n)(?:(?:(?:Long \+ quality|Quality day|Long run|Easy double|Easy run|Easy day)(?: (?:met|in progress|short|over))? · [^\n]+|Unscheduled run · [\d.]+ mi)\n)?Due \d+\/\d+(?: ·[^\n]*)?/m.exec(prior);
  const legacy = /(?:^|\n)🏃 Due(?: · Week)?/m.exec(prior);
  const match = current && legacy
    ? (current.index <= legacy.index ? current : legacy)
    : current ?? legacy;
  const idx = match ? match.index + (prior[match.index] === '\n' ? 1 : 0) : -1;
  if (idx < 0) {
    const base = prior.replace(/\s+$/, '');
    return base ? `${base}\n\n${block}` : block;
  }

  // The visible `due.run` footer is also the end marker. Preserve anything the
  // athlete added after our block instead of assuming Due owns the description
  // from its start to EOF. Legacy malformed blocks without a footer retain the
  // old replace-to-end behavior.
  const footer = 'due.run';
  const footerAt = prior.indexOf(footer, idx);
  const before = prior.slice(0, idx).replace(/\s+$/, '');
  const after = footerAt >= 0
    ? prior.slice(footerAt + footer.length).replace(/^\s+/, '').replace(/\s+$/, '')
    : '';
  return [before, block, after].filter(Boolean).join('\n\n');
}
