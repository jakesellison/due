import {
  metersToMiles,
  metersToKm,
  formatPace,
  type Units,
} from '../units';
import {
  actionablePaceBand,
  paceIntent,
  relativePaceLabel,
} from './pace';
import type { Segment, Target, WorkoutStructure } from './types';

const trimNum = (n: number): string => {
  const rounded = n.toFixed(1);
  return rounded.endsWith('.0') ? rounded.slice(0, -2) : rounded;
};

function dist(meters: number, units: Units): string {
  const v = units === 'mi' ? metersToMiles(meters) : metersToKm(meters);
  return `${trimNum(v)}${units}`;
}

const ABBR: Record<string, string> = { warmup: 'WU', cooldown: 'CD' };

function leafBody(target: Target, units: Units): string {
  if (target.distance_m != null) return dist(target.distance_m, units);
  if (target.duration_s != null) return `${target.duration_s}s`;
  return '';
}

function renderSegment(seg: Segment, units: Units): string {
  if (seg.kind === 'repeat') {
    const children: Segment[] = seg.children;
    const work = children[0];
    const recovery = children[1];
    // The common case: work child is a leaf (e.g. interval). If a child is
    // itself a repeat, render it recursively rather than reading a missing
    // `.target` (which would crash).
    const workBody = work
      ? work.kind === 'repeat'
        ? renderSegment(work, units)
        : leafBody(work.target, units)
      : '';
    const workStr = `${seg.sets}×${workBody}`;
    const qual = work && work.kind !== 'repeat' && work.note ? ` @ ${work.note}` : '';
    const rec = recovery
      ? recovery.kind === 'repeat'
        ? ` (${renderSegment(recovery, units)})`
        : ` (${leafBody(recovery.target, units)} ${recovery.note ?? ''}`.trimEnd() + ')'
      : '';
    return `${workStr}${qual}${rec}`;
  }
  const body = leafBody(seg.target, units);
  if (seg.kind === 'warmup' || seg.kind === 'cooldown') return `${body} ${ABBR[seg.kind]}`;
  if (seg.kind === 'steady') return `${body} easy`;
  return body;
}

export function renderStructure(structure: WorkoutStructure, units: Units): string {
  return structure.map((s) => renderSegment(s, units)).join(' + ');
}


/** Display text for a named race-relative / descriptive pace label. */
const PACE_LABEL_DISPLAY: Record<string, string> = {
  MP: 'MP', HMP: 'HMP', '10K': '10K pace', '5K': '5K pace', '3K': '3K pace',
  mile: 'mile pace', rep: 'rep pace',
  threshold: 'Threshold', tempo: 'Tempo', easy: 'Easy', steady: 'Steady', recovery: 'Recovery',
};

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

function noteOrZoneLabel(target: Target, note: string | undefined): string | null {
  const cleaned = note
    ?.replace(/\s*\([^)]*\/mi\)/g, '')
    .replace(/\/\d+:\d{2}\s*$/g, '')
    .trim();
  if (cleaned) return cleaned;
  if (!target.hr_zone || target.hr_zone === 'steady') return null;
  return cap(target.hr_zone);
}

