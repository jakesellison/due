import {
  METERS_PER_MILE,
} from '../units';
import type { LeafSegment, PaceLabel, Segment, Target, WorkoutStructure } from './types';

const MI = METERS_PER_MILE;

/** Parse human plan prescriptions like "2mi WU + 3x2mi @ threshold ..." into segments. */
export function parseWorkoutDescription(description: string, plannedMeters?: number): WorkoutStructure {
  const cleaned = description
    .replace(/^Already completed\s+—\s*/i, '')
    .replace(/^(Pre-race sharpener|Canova 1k\/1k float|KEY SESSION):\s*/i, '')
    .trim();
  if (!cleaned) return [];
  const wholeRun = parseWholeRun(cleaned, plannedMeters);
  if (wholeRun) return wholeRun;
  const race = parseRace(cleaned, plannedMeters);
  if (race) return race;
  const longMiddle = parseDistanceWithMiddle(cleaned);
  if (longMiddle) return longMiddle;
  return splitTopLevel(cleaned, '+').flatMap(parsePart);
}

function parseWholeRun(description: string, plannedMeters?: number): WorkoutStructure | null {
  if (!plannedMeters || plannedMeters <= 0) return null;
  const lower = description.toLowerCase();
  if (
    !lower.startsWith('easy run') &&
    !lower.startsWith('easy recovery') &&
    !lower.startsWith('easy shakeout') &&
    !lower.startsWith('easy pre-race') &&
    !lower.startsWith('easy pm double') &&
    !lower.startsWith('long run')
  ) {
    return null;
  }

  const target: Target = { by: 'distance', distance_m: plannedMeters };
  applyPaceOrZone(target, description);
  if (lower.includes('recovery')) target.hr_zone = 'easy';
  else if (lower.startsWith('long run')) target.hr_zone = target.hr_zone ?? 'easy';
  else target.hr_zone = target.hr_zone ?? 'easy';

  const mp = description.match(/w\/\s*([\d.]+)\s*mi\s*@\s*(.+?)\s+in middle/i);
  if (mp) {
    const workMeters = mi(mp[1]!);
    const easyMeters = Math.max(0, plannedMeters - workMeters);
    const structure: WorkoutStructure = [];
    if (easyMeters > 0) {
      structure.push(leaf('steady', { ...target, distance_m: easyMeters, hr_zone: 'easy' }, 'easy'));
    }
    const workTarget: Target = { by: 'distance', distance_m: workMeters };
    applyPaceOrZone(workTarget, mp[2]!.trim());
    structure.push(leaf('steady', workTarget, mp[2]!.trim()));
    return structure;
  }

  const strides = description.match(/w\/\s*(\d+)x(\d+)s\s+strides/i);
  if (!strides) return [leaf('steady', target)];

  return [
    leaf('steady', target),
    {
      kind: 'repeat',
      sets: Number(strides[1]),
      children: [leaf('interval', { by: 'time', duration_s: Number(strides[2]) }, 'strides')],
    },
  ];
}

function parseRace(description: string, plannedMeters?: number): WorkoutStructure | null {
  if (!plannedMeters || plannedMeters <= 0 || !/race|marathon/i.test(description)) return null;
  const target: Target = { by: 'distance', distance_m: plannedMeters };
  applyPaceOrZone(target, description);
  target.hr_zone = 'steady';
  return [leaf('steady', target)];
}

function parseDistanceWithMiddle(description: string): WorkoutStructure | null {
  const m = description.match(/^([\d.]+)\s*mi\s+w\/\s*([\d.]+)\s*mi\s*@\s*(.+?)\s+in middle/i);
  if (!m) return null;
  const totalMeters = mi(m[1]!);
  const workMeters = mi(m[2]!);
  const easyMeters = Math.max(0, totalMeters - workMeters);
  const structure: WorkoutStructure = [];
  if (easyMeters > 0) {
    structure.push(leaf('steady', { by: 'distance', distance_m: easyMeters, hr_zone: 'easy' }, 'easy'));
  }
  const workTarget: Target = { by: 'distance', distance_m: workMeters };
  applyPaceOrZone(workTarget, m[3]!.trim());
  structure.push(leaf('steady', workTarget, m[3]!.trim()));
  return structure;
}

function parsePart(raw: string): Segment[] {
  const part = raw.trim();
  const warm = part.match(/^([\d.]+)\s*mi\s+WU$/i);
  if (warm) return [leaf('warmup', { by: 'distance', distance_m: mi(warm[1]!) })];

  const cool = part.match(/^([\d.]+)\s*mi\s+CD$/i);
  if (cool) return [leaf('cooldown', { by: 'distance', distance_m: mi(cool[1]!) })];

  const canova = part.match(/^(\d+)\s*x\s*\((.+)\)$/i);
  if (canova) {
    const children = splitTopLevel(canova[2]!, ',').flatMap(parseRepeatChild);
    if (children.length > 0) return [{ kind: 'repeat', sets: Number(canova[1]), children, note: 'float' }];
  }

  const repeat = part.match(/^(\d+)\s*x\s*([\d.]+)\s*(mi|km|m)\s*@\s*(.+?)(?:\s*\((.+)\))?$/i);
  if (repeat) {
    const workTarget = distanceTarget(repeat[2]!, repeat[3]!);
    applyPaceOrZone(workTarget, repeat[4]!.trim());
    const children: Segment[] = [leaf('interval', workTarget, repeat[4]!.trim())];
    const recovery = repeat[5] ? parseRecovery(repeat[5]) : null;
    if (recovery) children.push(recovery);
    return [{ kind: 'repeat', sets: Number(repeat[1]), children }];
  }

  const steady = part.match(/^([\d.]+)\s*mi\s+(.+)$/i);
  if (steady) {
    const target: Target = { by: 'distance', distance_m: mi(steady[1]!) };
    applyPaceOrZone(target, steady[2]!.trim());
    return [leaf('steady', target, steady[2]!.trim())];
  }

  return [];
}

function parseRepeatChild(raw: string): Segment[] {
  const part = raw.trim();
  const m = part.match(/^([\d.]+)\s*(km|m|mi)\s*@\s*(.+)$/i);
  if (!m) return [];
  const target = distanceTarget(m[1]!, m[2]!);
  applyPaceOrZone(target, m[3]!.trim());
  const zone = (target.hr_zone ?? '').toLowerCase();
  const kind: LeafSegment['kind'] = zone === 'easy' || m[3]!.toLowerCase().includes('85%') ? 'steady' : 'interval';
  return [leaf(kind, target, m[3]!.trim())];
}

function parseRecovery(raw: string): Segment | null {
  const text = raw.trim();
  const time = text.match(/^(\d+)\s*(?:s|sec|secs|second|seconds)\s*(.*)$/i);
  if (time) return leaf('recovery', { by: 'time', duration_s: Number(time[1]) }, time[2]?.trim() || undefined);
  const min = text.match(/^(\d+)\s*min\s*(.*)$/i);
  if (min) return leaf('recovery', { by: 'time', duration_s: Number(min[1]) * 60 }, min[2]?.trim() || undefined);
  const dist = text.match(/^([\d.]+)\s*(m|km|mi)\s*(.*)$/i);
  if (dist) return leaf('recovery', distanceTarget(dist[1]!, dist[2]!), dist[3]?.trim() || undefined);
  return null;
}

function leaf(kind: LeafSegment['kind'], target: Target, note?: string): LeafSegment {
  return { kind, target, ...(note ? { note } : {}) };
}

function distanceTarget(value: string, unit: string): Target {
  const n = Number(value);
  const u = unit.toLowerCase();
  const distance_m = u === 'mi' ? mi(value) : u === 'km' ? Math.round(n * 1000) : Math.round(n);
  return { by: 'distance', distance_m };
}

function applyPaceOrZone(target: Target, raw: string): void {
  const text = raw.toLowerCase();
  let absoluteBand: { fast_s_per_km: number; slow_s_per_km: number } | null = null;
  const range = raw.match(/(\d+):(\d{2})\s*-\s*(\d+):(\d{2})\s*\/\s*mi/);
  if (range) {
    target.by = ['distance', 'pace'];
    const a = secPerMileToKm(Number(range[1]) * 60 + Number(range[2]));
    const b = secPerMileToKm(Number(range[3]) * 60 + Number(range[4]));
    absoluteBand = {
      fast_s_per_km: Math.min(a, b),
      slow_s_per_km: Math.max(a, b),
    };
  } else {
    const pace = raw.match(/(\d+):(\d{2})\s*\/\s*mi/) ?? raw.match(/(?:^|[^\d])(\d+):(\d{2})(?:\s*\/\s*mi)?/);
    if (pace) {
      target.by = ['distance', 'pace'];
      const secondsPerKm = secPerMileToKm(Number(pace[1]) * 60 + Number(pace[2]));
      absoluteBand = {
        fast_s_per_km: secondsPerKm,
        slow_s_per_km: secondsPerKm,
      };
    }
  }

  let reference: PaceLabel | null = null;
  if (text.includes('5k')) { target.hr_zone = 'interval'; reference = '5K'; }
  else if (text.includes('10k')) { target.hr_zone = 'interval'; reference = '10K'; }
  else if (text.includes('threshold') || text.includes('lt')) { target.hr_zone = 'threshold'; reference = 'threshold'; }
  else if (text.includes('tempo')) { target.hr_zone = 'threshold'; reference = 'tempo'; }
  else if (text.includes('hmp') || text.includes('half marathon') || text.includes('hm pace')) { target.hr_zone = 'threshold'; reference = 'HMP'; }
  else if (text.includes('mp') || text.includes('marathon')) { target.hr_zone = 'steady'; reference = 'MP'; }
  else if (text.includes('easy') || text.includes('jog')) target.hr_zone = 'easy';

  const fraction = reference
    ? raw.match(/(\d+(?:\.\d+)?)\s*%\s*(?:of\s*)?(?:MP|HMP|marathon pace|half marathon pace)/i)
    : null;

  if (reference && fraction) {
    target.pace = {
      kind: 'relative',
      reference,
      speed_fraction: Number(fraction[1]) / 100,
      ...(absoluteBand ? { resolved: absoluteBand } : {}),
    };
  } else if (absoluteBand) {
    target.pace = {
      kind: 'absolute',
      band: absoluteBand,
      ...(reference ? { intent: reference } : {}),
    };
  } else if (reference) {
    target.pace = {
      kind: 'relative',
      reference,
      speed_fraction: 1,
    };
  }

  const effort = raw.match(/\b(RPE\s*\d+|comfortably hard|controlled|steady effort)\b/i);
  if (effort) target.effort = effort[1];
}

function mi(value: string): number {
  return Math.round(Number(value) * MI);
}

function secPerMileToKm(secPerMile: number): number {
  return Math.round((secPerMile / MI) * 1000);
}

function splitTopLevel(input: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of input) {
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === sep && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
