/**
 * changeLog.ts — normalise raw `plan_changes` rows into a clean, resolved
 * evolution log. Pure. No IO. Node-tested. The first reader of `plan_changes`
 * (the table was write-only). Feeds all three surfaces: whole-plan log, per-week,
 * per-day.
 *
 * The raw payloads are heterogeneous and NOISY — a single manual week edit
 * records every intermediate slider-scrub tick (the same workout's `setDistance`
 * fires 8851→9656→…→12875). We COLLAPSE each event's ops to their NET effect
 * (last value per workout/dimension wins; round-trip swaps cancel), resolve
 * workoutIds to their day/type off the plan's workouts, and emit one
 * `PlanChangeEvent` per row.
 *
 * Each resolved change carries STRUCTURED fields — a kind `icon`, a type `tone`,
 * a `title` (subject) and a right-aligned `value` — so the UI renders icon-led
 * rows (Jobber/Careem pattern) instead of arrow-y "A → B" text. No arrows: a
 * set-value change reads as subject + value; relations use words ("to").
 *
 * Fidelity: auto-adapt + reschedule carry from→to; manual distance edits store
 * only the new value, and `import` doesn't store the plan — so those show the
 * result, never a fabricated "from".
 */
import {
  metersToMiles,
} from '../units';

// ── Inputs ────────────────────────────────────────────────────────────────────

export interface RawPlanChange {
  id: string;
  actor_type: string | null;
  source: string | null;
  change: Record<string, unknown> | null;
  created_at: string;
}

/** A plan workout, enough to resolve an id → its day + type. */
export interface ChangeWorkout {
  id: string;
  date: string | null;
  type: string | null;
}

export interface ChangeLogInput {
  rows: RawPlanChange[];
  workouts: ChangeWorkout[];
  /** The plan's civil start date ('YYYY-MM-DD') — for date → week index. */
  startDate: string | null;
  /** The active plan id — a `switch_active` TO it reads as "activated". */
  planId: string | null;
}

// ── Outputs ───────────────────────────────────────────────────────────────────

export type ChangeActor = 'you' | 'auto' | 'import';
export type ChangeVerb = 'distance' | 'type' | 'move' | 'add' | 'rest' | 'swap' | 'target' | 'milestone';
export type ChangeTone = 'easy' | 'quality' | 'long';

export interface ResolvedChange {
  verb: ChangeVerb;
  /** The day this change lands on ('YYYY-MM-DD'), for day/week bucketing; null for plan-level. */
  date: string | null;
  weekIndex: number | null;
  /** SF Symbol for the kind (leads the row). */
  icon: string;
  /** Type colour for the icon (and the value, on a type change); null → neutral. */
  tone: ChangeTone | null;
  /** Subject, labels+numbers, no arrows (e.g. "Wed easy", "Sun", "Wed & Fri"). */
  title: string;
  /** Right-aligned result (e.g. "8.0 mi", "Quality", "Rest"); null when the title says it all. */
  value: string | null;
  /** Flat one-line form for compact contexts (teaser / a11y). Arrow-free. */
  label: string;
}

export interface PlanChangeEvent {
  id: string;
  createdAt: string;
  actor: ChangeActor;
  /** Short summary for the log header ("Plan installed" / "2 changes"). */
  summary: string;
  changes: ResolvedChange[];
  /** Unique weeks touched (for per-week filtering). */
  weekIndices: number[];
  /** Unique dates touched (for per-day filtering). */
  dates: string[];
}

// ── Date + type helpers ──────────────────────────────────────────────────────────

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function dow(date: string | null): string {
  if (!date) return '';
  const d = new Date(`${date}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? '' : DOW[d.getUTCDay()] ?? '';
}
function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T12:00:00Z`).getTime();
  const b = new Date(`${to}T12:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}
export function dateToWeek(startDate: string | null, date: string | null): number | null {
  if (!startDate || !date) return null;
  const diff = daysBetween(startDate, date);
  if (diff < 0) return null;
  return Math.floor(diff / 7) + 1;
}
const mi = (m: number): string => `${metersToMiles(m).toFixed(1)} mi`;
function typeWord(t: string | null): string {
  if (!t) return 'run';
  return t.charAt(0).toUpperCase() + t.slice(1);
}
const TONE_ICON: Record<ChangeTone, string> = { easy: 'figure.run', quality: 'bolt.fill', long: 'mountain.2.fill' };
function toneFor(type: string | null): ChangeTone | null {
  if (!type) return null;
  const t = type.toLowerCase();
  if (t === 'quality' || t === 'speed' || t === 'threshold' || t === 'interval' || t === 'tempo') return 'quality';
  if (t === 'long') return 'long';
  if (t === 'easy' || t === 'recovery') return 'easy';
  return null;
}

/** Assemble a ResolvedChange, deriving the flat `label` from title + value. */
function mk(
  startDate: string | null,
  date: string | null,
  verb: ChangeVerb,
  icon: string,
  tone: ChangeTone | null,
  title: string,
  value: string | null,
): ResolvedChange {
  return {
    verb, date, weekIndex: dateToWeek(startDate, date), icon, tone, title, value,
    label: value ? `${title}  ${value}` : title,
  };
}

// ── Op collapse ─────────────────────────────────────────────────────────────────

interface EditOp {
  kind: string;
  workoutId?: string;
  newType?: string;
  newDistanceMeters?: number;
  toDate?: string;
  onDate?: string;
  distanceMeters?: number;
  dateA?: string;
  dateB?: string;
}

/** Collapse a manual edit's op stream to its NET resolved changes. */
function collapseEdits(edits: EditOp[], woById: Map<string, ChangeWorkout>, startDate: string | null): ResolvedChange[] {
  const dist = new Map<string, number>();
  const type = new Map<string, string>();
  const rest = new Set<string>();
  const move = new Map<string, string>();
  const add = new Map<string, number>();
  const swap = new Map<string, { a: string; b: string; n: number }>();

  for (const op of edits) {
    switch (op.kind) {
      case 'setDistance':
        if (op.workoutId != null && op.newDistanceMeters != null) dist.set(op.workoutId, op.newDistanceMeters);
        break;
      case 'setType':
        if (op.workoutId != null && op.newType != null) type.set(op.workoutId, op.newType);
        break;
      case 'setRest':
        if (op.workoutId != null) rest.add(op.workoutId);
        break;
      case 'move':
        if (op.workoutId != null && op.toDate != null) move.set(op.workoutId, op.toDate);
        break;
      case 'addDouble':
        if (op.onDate != null && op.distanceMeters != null) add.set(op.onDate, op.distanceMeters);
        break;
      case 'swap': {
        if (op.dateA != null && op.dateB != null) {
          const [a, b] = [op.dateA, op.dateB].sort();
          const key = `${a}|${b}`;
          const cur = swap.get(key) ?? { a: a!, b: b!, n: 0 };
          swap.set(key, { ...cur, n: cur.n + 1 });
        }
        break;
      }
    }
  }

  const out: ResolvedChange[] = [];
  for (const wid of rest) {
    const wo = woById.get(wid);
    out.push(mk(startDate, wo?.date ?? null, 'rest', 'moon.zzz.fill', null, dow(wo?.date ?? null), 'Rest'));
  }
  for (const [wid, m] of dist) {
    if (rest.has(wid)) continue;
    const wo = woById.get(wid);
    const tone = toneFor(wo?.type ?? null);
    out.push(mk(startDate, wo?.date ?? null, 'distance', tone ? TONE_ICON[tone] : 'ruler', tone, `${dow(wo?.date ?? null)} ${typeWord(wo?.type ?? null).toLowerCase()}`, mi(m)));
  }
  for (const [wid, t] of type) {
    if (rest.has(wid)) continue;
    const wo = woById.get(wid);
    const tone = toneFor(t);
    out.push(mk(startDate, wo?.date ?? null, 'type', tone ? TONE_ICON[tone] : 'tag.fill', tone, dow(wo?.date ?? null), typeWord(t)));
  }
  for (const [wid, toDate] of move) {
    const wo = woById.get(wid);
    const tone = toneFor(wo?.type ?? null);
    out.push(mk(startDate, toDate, 'move', 'calendar', tone, `${typeWord(wo?.type ?? null)} moved`, `to ${dow(toDate)}`));
  }
  for (const [date, m] of add) {
    out.push(mk(startDate, date, 'add', 'plus.circle.fill', 'easy', `${dow(date)} 2nd run`, mi(m)));
  }
  for (const { a, b, n } of swap.values()) {
    if (n % 2 === 1) out.push(mk(startDate, a, 'swap', 'arrow.triangle.swap', null, `${dow(a)} & ${dow(b)}`, 'Swapped'));
  }
  return out;
}

// ── Row → event ──────────────────────────────────────────────────────────────────

function actorOf(row: RawPlanChange): ChangeActor {
  if (row.actor_type === 'adapt') return 'auto';
  if (row.actor_type === 'import' || row.source === 'import') return 'import';
  return 'you';
}

function resolveRow(row: RawPlanChange, input: ChangeLogInput, woById: Map<string, ChangeWorkout>): ResolvedChange[] {
  const c = row.change ?? {};
  const kind = c.kind as string | undefined;
  const s = input.startDate;

  // Milestones
  if (row.source === 'import' || kind === 'install' || 'archived' in c) {
    return [mk(s, null, 'milestone', 'square.and.arrow.down', null, 'Plan installed', null)];
  }
  if (kind === 'switch_active') {
    const activated = c.to === input.planId;
    return [mk(s, null, 'milestone', activated ? 'checkmark.circle.fill' : 'arrow.uturn.backward', null, activated ? 'Plan activated' : 'Plan set aside', null)];
  }

  // Auto-adapt kinds (these DO carry from→to → shown as "was N")
  if (kind === 'redistribute' && Array.isArray(c.edits)) {
    return (c.edits as Array<{ date?: string; fromMeters?: number; toMeters?: number }>).map((e) => {
      const ch = mk(s, e.date ?? null, 'distance', 'ruler', null, dow(e.date ?? null), mi(e.toMeters ?? 0));
      ch.title = `${dow(e.date ?? null)}  was ${mi(e.fromMeters ?? 0)}`;
      ch.label = `${dow(e.date ?? null)} ${mi(e.fromMeters ?? 0)} to ${mi(e.toMeters ?? 0)}`;
      return ch;
    });
  }
  if (kind === 'lower_target' && typeof c.newTarget === 'number') {
    return [mk(s, null, 'target', 'scope', null, 'Target lowered', mi(c.newTarget))];
  }
  if (kind === 'add_double' && Array.isArray(c.adds)) {
    return (c.adds as Array<{ date?: string; meters?: number }>).map((a) =>
      mk(s, a.date ?? null, 'add', 'plus.circle.fill', 'easy', `${dow(a.date ?? null)} 2nd run`, mi(a.meters ?? 0)),
    );
  }
  if (kind === 'reschedule' && c.move && typeof c.move === 'object') {
    const m = c.move as { from?: { date?: string; type?: string }; to?: { date?: string } };
    const tone = toneFor(m.from?.type ?? null);
    return [mk(s, m.to?.date ?? null, 'move', 'calendar', tone, `${typeWord(m.from?.type ?? null)} moved`, `${dow(m.from?.date ?? null)} to ${dow(m.to?.date ?? null)}`)];
  }

  // Manual week edit (no kind, or kind 'reflow') → collapse the op stream
  if (Array.isArray(c.edits)) {
    const changes = collapseEdits(c.edits as EditOp[], woById, s);
    if (typeof c.newTarget === 'number') {
      const wk = changes.find((ch) => ch.weekIndex != null)?.weekIndex ?? null;
      changes.push({ ...mk(s, null, 'target', 'scope', null, 'Week target', mi(c.newTarget)), weekIndex: wk });
    }
    return changes;
  }

  return [];
}

// ── Public ────────────────────────────────────────────────────────────────────

/** Build the resolved change log, newest event first. */
export function buildChangeLog(input: ChangeLogInput): PlanChangeEvent[] {
  const woById = new Map(input.workouts.map((w) => [w.id, w]));
  const events: PlanChangeEvent[] = [];

  for (const row of input.rows) {
    const changes = resolveRow(row, input, woById);
    if (changes.length === 0) continue;
    const weekIndices = [...new Set(changes.map((c) => c.weekIndex).filter((w): w is number => w != null))].sort((a, b) => a - b);
    const dates = [...new Set(changes.map((c) => c.date).filter((d): d is string => d != null))];
    const isMilestone = changes.length === 1 && changes[0]!.verb === 'milestone';
    events.push({
      id: row.id,
      createdAt: row.created_at,
      actor: actorOf(row),
      summary: isMilestone ? changes[0]!.title : `${changes.length} change${changes.length > 1 ? 's' : ''}`,
      changes,
      weekIndices,
      dates,
    });
  }

  return events.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}


