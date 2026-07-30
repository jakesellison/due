/**
 * WorkoutBuilder — a reusable composer that emits a full workout
 * ({ type, title, distanceMeters, durationSeconds, structure }) matching the
 * .due schema (src/lib/workout/types). Easy/Long/Cross collapse to a single
 * distance-or-time dial. Quality starts with a template and readable workout
 * prescription; its ordered steps and Repeat blocks move to a separate
 * customization screen, and each target opens in a focused editor. This keeps
 * the common path compact while still emitting the same .due structure.
 *
 * Intended for reuse (e.g. a manual workout bank you drag from), so it takes no
 * planner state — just onAdd / onClose.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Alert, findNodeHandle, LayoutAnimation, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { SymbolView, type SFSymbol } from 'expo-symbols';

/** A soft ease for structure reflow (add/remove/template/type swap) so the
 *  panel content settles rather than snapping. */
const REFLOW_ANIM = { duration: 220, update: { type: 'easeInEaseOut' }, create: { type: 'easeInEaseOut', property: 'opacity' }, delete: { type: 'easeInEaseOut', property: 'opacity' } } as const;
const animateReflow = () => LayoutAnimation.configureNext(REFLOW_ANIM);

import {
  estimatedStructureDistanceMeters,
  metersToUnits,
  paceIntent,
  structureLines,
  unitsToMeters,
  type LeafSegment,
  type PaceLabel,
  type Segment,
  type Target,
  type WorkoutStructure,
} from '@/lib';
import { useAppPreferences } from '@/app-lib/preferences';
import { clampPaceSecPerMi, fmtPace, secPerMiToKm, seedPaceBand } from '@/lib/planner/paceBands';
import type { RacePaces } from '@/lib/kpi/targetPace';
import { CloseButton } from '@/components/CloseButton';
import { SheetHeader } from '@/components/SheetHeader';
import { ActionButton, ActionButtonLabel } from '@/components/ActionButton';
import { ModalFooter } from '@/components/ModalFooter';
import { RoundIconButton } from '@/components/RoundIconButton';
import { Divider, hairlineBottom, hairlineLeft, hairlineRight, hairlineTop } from '@/components/ui/Divider';
import { eyebrowText } from '@/components/ui/Eyebrow';
import { statValueText } from '@/components/ui/Stat';
import { useTheme, useThemedStyles } from '@/theme/ThemeProvider';
import { display, fontSizes, radius, sheetPresentation, space, type Tokens } from '@/theme/tokens';

const M = 1609.344;

export type BuilderType = 'easy' | 'quality' | 'long' | 'cross';
const BUILDER_TYPE_OPTIONS: { key: BuilderType; label: string; accessibilityLabel: string; icon: SFSymbol }[] = [
  { key: 'easy', label: 'Easy', accessibilityLabel: 'Easy run workout', icon: 'figure.run' },
  { key: 'quality', label: 'Quality', accessibilityLabel: 'Quality workout', icon: 'bolt.fill' },
  { key: 'long', label: 'Long', accessibilityLabel: 'Long run workout', icon: 'mountain.2.fill' },
  { key: 'cross', label: 'Cross', accessibilityLabel: 'Cross training workout', icon: 'dumbbell.fill' },
];

function builderTypeColor(C: Tokens, type: BuilderType): string {
  if (type === 'quality') return C.qualText;
  if (type === 'long') return C.cyanText;
  if (type === 'easy') return C.ink;
  return C.mute;
}

export interface BuiltWorkout {
  type: BuilderType;
  title: string;
  distanceMeters: number;
  durationSeconds: number | null;
  structure: WorkoutStructure;
}

// ── Editable model (flattened; converted to Segment[] on emit) ─────────────
type StepKind = 'warmup' | 'work' | 'recovery' | 'cooldown' | 'strides';
type DistanceUnit = 'mi' | 'km' | 'm';
interface EStep {
  id: string;
  kind: StepKind;
  by: 'distance' | 'time';
  meters: number;
  unit: DistanceUnit;
  seconds: number;
  pace: PaceLabel;
  paceKind: 'relative' | 'absolute';
  speedFraction: number;
  /** Optional per-segment pace-band OVERRIDE (sec/mi, lo=faster). When unset the
   *  band is auto-derived from the named pace + the runner's easy baseline. */
  bandLo?: number;
  bandHi?: number;
}
type ERow = { id: string; kind: 'step'; step: EStep } | { id: string; kind: 'repeat'; sets: number; children: EStep[] };

const PACES: { key: PaceLabel; label: string }[] = [
  { key: 'easy', label: 'Easy' },
  { key: 'steady', label: 'Steady' },
  { key: 'MP', label: 'MP' },
  { key: 'HMP', label: 'HMP' },
  { key: 'threshold', label: 'Threshold' },
  { key: '10K', label: '10K' },
  { key: '5K', label: '5K' },
  { key: '3K', label: '3K' },
  { key: 'mile', label: 'Mile' },
  { key: 'rep', label: 'Rep' },
  { key: 'recovery', label: 'Recovery' },
];
const HARD_PACES = PACES.filter((pace) => !['easy', 'steady', 'recovery'].includes(pace.key));
const SUPPORT_PACES: Record<Exclude<StepKind, 'work' | 'strides'>, typeof PACES> = {
  warmup: PACES.filter((pace) => pace.key === 'easy' || pace.key === 'steady'),
  recovery: PACES.filter((pace) => pace.key === 'recovery' || pace.key === 'easy'),
  cooldown: PACES.filter((pace) => pace.key === 'easy' || pace.key === 'steady'),
};
const pacesForKind = (kind: StepKind) =>
  kind === 'work' || kind === 'strides' ? HARD_PACES : SUPPORT_PACES[kind];
const paceLabel = (p: PaceLabel) => p === 'recovery' ? 'Easy jog' : PACES.find((x) => x.key === p)?.label ?? p;

// Pace bands (seed/format/convert) are pure + shared — see lib/planner/paceBands.
// A segment's band is the override when set, else the seed for its named pace.
function effBand(s: EStep, easyBaseline: number): { lo: number; hi: number } {
  return s.bandLo != null && s.bandHi != null ? { lo: s.bandLo, hi: s.bandHi } : seedPaceBand(s.pace, easyBaseline);
}

// Only the HARD segments carry the quality accent; support segments stay neutral
// so colour marks effort, not decoration (keeps the panel focused).
const KIND_META: Record<StepKind, { label: string; hard: boolean }> = {
  warmup: { label: 'Warm-up', hard: false },
  work: { label: 'Work', hard: true },
  recovery: { label: 'Recovery', hard: false },
  cooldown: { label: 'Cool-down', hard: false },
  strides: { label: 'Strides', hard: true },
};

let uid = 0;
const nextId = () => `b${uid++}`;
const inferDistanceUnit = (meters: number): DistanceUnit => {
  if (meters < 1500) return 'm';
  const nearestTenthMile = Math.round((meters / M) * 10) / 10;
  return Math.abs(meters - nearestTenthMile * M) <= 3 ? 'mi' : 'm';
};
const dStep = (kind: StepKind, meters: number, pace: PaceLabel): EStep => ({
  id: nextId(),
  kind,
  by: 'distance',
  meters,
  unit: inferDistanceUnit(meters),
  seconds: 0,
  pace,
  paceKind: 'relative',
  speedFraction: 1,
});
const rep = (sets: number, children: EStep[]): ERow => ({ id: nextId(), kind: 'repeat', sets, children });
const wrap = (s: EStep): ERow => ({ id: nextId(), kind: 'step', step: s });
const rowsForUnit = (rows: ERow[], unit: 'mi' | 'km'): ERow[] => rows.map((row) => row.kind === 'step'
  ? { ...row, step: row.step.unit === 'm' ? row.step : { ...row.step, unit } }
  : { ...row, children: row.children.map((child) => child.unit === 'm' ? child : { ...child, unit }) });

function paceFromTarget(target: Target, kind: StepKind): PaceLabel {
  const intent = paceIntent(target.pace);
  if (intent) return intent;
  if (target.hr_zone === 'easy') return kind === 'recovery' ? 'recovery' : 'easy';
  if (target.hr_zone === 'steady') return 'steady';
  if (target.hr_zone === 'threshold') return 'threshold';
  if (target.hr_zone === 'interval') return '5K';
  if (target.hr_zone === 'rep') return 'rep';
  if (kind === 'recovery') return 'recovery';
  if (kind === 'warmup' || kind === 'cooldown') return 'easy';
  if (kind === 'strides') return 'rep';
  return 'threshold';
}

function stepKindFromSegment(kind: Exclude<Segment['kind'], 'repeat'>): StepKind {
  if (kind === 'warmup' || kind === 'cooldown' || kind === 'recovery' || kind === 'strides') return kind;
  return 'work';
}

function editableStepFromSegment(segment: Exclude<Segment, { kind: 'repeat' }>): EStep {
  const kind = stepKindFromSegment(segment.kind);
  const by = segment.target.duration_s != null && segment.target.distance_m == null ? 'time' : 'distance';
  const band = segment.target.pace?.kind === 'absolute'
    ? segment.target.pace.band
    : segment.target.pace?.resolved;
  const lo = band?.fast_s_per_km;
  const hi = band?.slow_s_per_km;
  return {
    id: nextId(),
    kind,
    by,
    meters: segment.target.distance_m ?? Math.round(M),
    unit: inferDistanceUnit(segment.target.distance_m ?? Math.round(M)),
    seconds: segment.target.duration_s ?? 0,
    pace: paceFromTarget(segment.target, kind),
    paceKind: segment.target.pace?.kind ?? 'relative',
    speedFraction: segment.target.pace?.kind === 'relative'
      ? segment.target.pace.speed_fraction
      : 1,
    ...(lo != null && hi != null
      ? { bandLo: Math.round(lo * (M / 1000)), bandHi: Math.round(hi * (M / 1000)) }
      : {}),
  };
}

/** Rehydrate persisted .due structure into the builder's editable row model.
 * Unknown nested repeats are flattened conservatively instead of discarded. */
function editableRowsFromStructure(structure: WorkoutStructure): ERow[] {
  const rows: ERow[] = [];
  for (const segment of structure) {
    if (segment.kind !== 'repeat') {
      rows.push(wrap(editableStepFromSegment(segment)));
      continue;
    }
    const children = segment.children.flatMap((child) =>
      child.kind === 'repeat'
        ? child.children.filter((nested): nested is Exclude<Segment, { kind: 'repeat' }> => nested.kind !== 'repeat')
        : [child],
    );
    rows.push(rep(segment.sets, children.map(editableStepFromSegment)));
  }
  return rows;
}

// ── Template gallery — coach-vetted starting points, not one hardcoded default.
interface Template {
  key: string;
  label: string;
  compactLabel: string;
  detail: string;
  title: string;
  build: () => ERow[];
}
const TEMPLATES: Template[] = [
  { key: 'vo2', label: '6 × 800 m', compactLabel: '6×800', detail: '5K pace · 400 m jog', title: '6×800m @ 5K', build: () => [wrap(dStep('warmup', Math.round(1.5 * M), 'easy')), rep(6, [dStep('work', 800, '5K'), dStep('recovery', 400, 'recovery')]), wrap(dStep('cooldown', Math.round(M), 'easy'))] },
  { key: 'cruise', label: '4 × 1 mi', compactLabel: '4×1mi', detail: 'Threshold · 400 m jog', title: '4×1mi @ threshold', build: () => [wrap(dStep('warmup', Math.round(1.5 * M), 'easy')), rep(4, [dStep('work', Math.round(M), 'threshold'), dStep('recovery', 400, 'recovery')]), wrap(dStep('cooldown', Math.round(M), 'easy'))] },
  { key: 'tempo', label: '4 mi tempo', compactLabel: '4mi tempo', detail: 'Threshold · continuous', title: '4mi tempo', build: () => [wrap(dStep('warmup', Math.round(1.5 * M), 'easy')), wrap(dStep('work', Math.round(4 * M), 'threshold')), wrap(dStep('cooldown', Math.round(M), 'easy'))] },
  { key: 'speed', label: '12 × 400 m', compactLabel: '12×400', detail: '3K pace · 200 m jog', title: '12×400m @ 3K', build: () => [wrap(dStep('warmup', Math.round(1.5 * M), 'easy')), rep(12, [dStep('work', 400, '3K'), dStep('recovery', 200, 'recovery')]), wrap(dStep('cooldown', Math.round(M), 'easy'))] },
];
const DEFAULT_TPL = TEMPLATES[0]!;
const templateDisplay = (template: Template, units: 'mi' | 'km'): Pick<Template, 'label' | 'compactLabel' | 'detail' | 'title'> => {
  if (units === 'mi') return template;
  if (template.key === 'cruise') return { label: '4 × 1.6 km', compactLabel: '4×1.6km', detail: template.detail, title: '4×1.6km @ threshold' };
  if (template.key === 'tempo') return { label: '6.4 km tempo', compactLabel: '6.4km tempo', detail: template.detail, title: '6.4km tempo' };
  return template;
};

// ── Distance / time display + step math ────────────────────────────────────
const distanceValue = (meters: number, unit: DistanceUnit) => unit === 'm'
  ? String(Math.round(meters))
  : String(Number(metersToUnits(meters, unit).toFixed(2)));
const bumpDist = (meters: number, unit: DistanceUnit, dir: 1 | -1) => {
  if (unit === 'm') return Math.max(50, Math.round(meters / 100) * 100 + dir * 100);
  const distance = Math.max(0.1, Math.round((metersToUnits(meters, unit) + dir * 0.1) * 100) / 100);
  return Math.round(unitsToMeters(distance, unit));
};
const showTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const bumpTime = (s: number, dir: 1 | -1) => Math.max(15, s + dir * 15);
const stepAmount = (s: EStep) => {
  if (s.by !== 'distance') return showTime(s.seconds);
  const unit = s.unit ?? inferDistanceUnit(s.meters);
  return `${distanceValue(s.meters, unit)} ${unit}`;
};
const sentencePace = (p: PaceLabel) => p === 'threshold' ? 'threshold' : p === 'recovery' ? 'easy jog' : paceLabel(p);
const stepIcon = (kind: StepKind) => kind === 'work' || kind === 'strides'
  ? 'bolt.fill'
  : kind === 'warmup'
    ? 'sun.horizon'
    : kind === 'recovery'
      ? 'arrow.clockwise'
      : 'flag.checkered';

function repeatCopy(row: Extract<ERow, { kind: 'repeat' }>): { title: string; detail: string | null } {
  const work = row.children.find((child) => KIND_META[child.kind].hard) ?? row.children[0];
  const recovery = row.children.find((child) => child.kind === 'recovery');
  const title = work ? `${row.sets} × ${stepAmount(work)} at ${sentencePace(work.pace)}` : `${row.sets} rounds`;
  const detail = recovery ? `${stepAmount(recovery)} ${sentencePace(recovery.pace)} after each rep` : null;
  return { title, detail };
}

function qualityHeadline(rows: ERow[]): string {
  const repeatRow = rows.find((row): row is Extract<ERow, { kind: 'repeat' }> => row.kind === 'repeat');
  if (repeatRow) return repeatCopy(repeatRow).title;
  const hardStep = rows.find((row): row is Extract<ERow, { kind: 'step' }> => row.kind === 'step' && KIND_META[row.step.kind].hard);
  return hardStep ? `${stepAmount(hardStep.step)} at ${sentencePace(hardStep.step.pace)}` : 'Custom quality workout';
}

function stepToLeaf(s: EStep): LeafSegment {
  const band = s.bandLo != null && s.bandHi != null
    ? {
        fast_s_per_km: secPerMiToKm(s.bandLo),
        slow_s_per_km: secPerMiToKm(s.bandHi),
      }
    : null;
  const pace = s.paceKind === 'absolute' && band
    ? { kind: 'absolute' as const, band, intent: s.pace }
    : {
        kind: 'relative' as const,
        reference: s.pace,
        speed_fraction: s.speedFraction,
        ...(band ? { resolved: band } : {}),
      };
  const target: Target = s.by === 'distance'
    ? { by: ['distance', 'pace'], distance_m: s.meters, pace }
    : { by: ['time', 'pace'], duration_s: s.seconds, pace };
  return { kind: s.kind, target };
}
function toStructure(rows: ERow[]): WorkoutStructure {
  return rows.map<Segment>((r) =>
    r.kind === 'repeat' ? { kind: 'repeat', sets: r.sets, children: r.children.map(stepToLeaf) } : stepToLeaf(r.step),
  );
}

function hasTimeOnlyLeaf(structure: WorkoutStructure): boolean {
  return structure.some((segment) =>
    segment.kind === 'repeat'
      ? hasTimeOnlyLeaf(segment.children)
      : segment.target.duration_s != null && segment.target.distance_m == null,
  );
}

function DistanceAmountControl({
  step,
  mode = 'step',
  workoutTotalMeters,
  onEdit,
  onUnitChange,
  C,
  styles,
}: {
  step: EStep;
  mode?: 'step' | 'finish';
  workoutTotalMeters?: number;
  onEdit: (patch: Partial<EStep>) => void;
  onUnitChange: (unit: DistanceUnit) => void;
  C: Tokens;
  styles: ReturnType<typeof makeStyles>;
}) {
  const { preferences } = useAppPreferences();
  const preferredLargeUnit: DistanceUnit = preferences.distance;
  const unit = step.unit ?? inferDistanceUnit(step.meters);
  const displayedMeters = mode === 'finish' ? workoutTotalMeters ?? step.meters : step.meters;
  const anchor = useRef({ stepMeters: step.meters, totalMeters: workoutTotalMeters ?? step.meters }).current;
  const [draft, setDraft] = useState(() => distanceValue(displayedMeters, unit));
  const [focused, setFocused] = useState(false);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(distanceValue(displayedMeters, unit));
  }, [displayedMeters, focused, step.id, unit]);

  const parsedMeters = (value: string, selectedUnit = unit): number | null => {
    const normalized = value.replace(',', '.').trim();
    if (!normalized || normalized === '.') return null;
    const amount = Number(normalized);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    return Math.round(selectedUnit === 'm' ? amount : unitsToMeters(amount, selectedUnit));
  };

  const applyDisplayedMeters = (meters: number): boolean => {
    const stepMeters = mode === 'finish'
      ? anchor.stepMeters + (meters - anchor.totalMeters)
      : meters;
    if (stepMeters < 50) {
      setInvalid(true);
      return false;
    }
    setInvalid(false);
    onEdit({ meters: Math.round(stepMeters) });
    return true;
  };

  const commit = (value: string) => {
    const meters = parsedMeters(value);
    if (meters == null || !applyDisplayedMeters(meters)) {
      setInvalid(false);
      setDraft(distanceValue(displayedMeters, unit));
      return;
    }
    setDraft(distanceValue(meters, unit));
  };

  const selectUnit = (nextUnit: DistanceUnit) => {
    if (nextUnit === unit) return;
    onUnitChange(nextUnit);
    setInvalid(false);
    setDraft(distanceValue(displayedMeters, nextUnit));
  };

  const bump = (dir: 1 | -1) => {
    const base = parsedMeters(draft) ?? displayedMeters;
    const meters = bumpDist(base, unit, dir);
    if (applyDisplayedMeters(meters)) setDraft(distanceValue(meters, unit));
  };

  const minimumTotalMeters = Math.max(50, anchor.totalMeters - anchor.stepMeters + 50);

  return (
    <>
      <View style={styles.amountHead}>
        <Text style={[styles.popLbl, styles.amountLabel]}>{mode === 'finish' ? 'Workout total' : 'Amount'}</Text>
      </View>
      <View style={styles.amountStep}>
        <Pressable accessibilityRole="button" accessibilityLabel={mode === 'finish' ? 'Decrease workout total' : 'Decrease step amount'} onPress={() => bump(-1)} style={[styles.amountTick, styles.amountTickLeft]}>
          <SymbolView name="minus" size={18} tintColor={C.ink} resizeMode="scaleAspectFit" />
        </Pressable>
        <View style={styles.amountValueGroup}>
          <TextInput
            accessibilityLabel={`${mode === 'finish' ? 'Workout total' : 'Step distance'} in ${unit === 'mi' ? 'miles' : unit === 'km' ? 'kilometers' : 'meters'}`}
            accessibilityHint="Enter an exact distance"
            value={draft}
            onFocus={() => setFocused(true)}
            onBlur={() => { setFocused(false); commit(draft); }}
            onChangeText={(value) => {
              const normalized = value.replace(',', '.');
              const valid = unit === 'm' ? /^\d{0,6}$/.test(normalized) : /^\d{0,3}(?:\.\d{0,2})?$/.test(normalized);
              if (!valid) return;
              setDraft(value);
              const meters = parsedMeters(value);
              if (meters != null && !normalized.endsWith('.')) applyDisplayedMeters(meters);
            }}
            keyboardType="decimal-pad"
            returnKeyType="done"
            selectTextOnFocus
            maxLength={6}
            selectionColor={C.yellow}
            style={styles.amountInput}
          />
          <View style={styles.unitToggle} accessibilityLabel="Distance unit">
            {([preferredLargeUnit, 'm'] as const).map((candidate) => {
              const selected = unit === candidate;
              return (
                <Pressable
                  key={candidate}
                  accessibilityRole="radio"
                  accessibilityLabel={candidate === 'mi' ? 'Use miles' : candidate === 'km' ? 'Use kilometers' : 'Use meters'}
                  accessibilityState={{ selected }}
                  onPress={() => selectUnit(candidate)}
                  style={[styles.unitOption, selected && styles.unitOptionOn]}
                >
                  <Text style={[styles.unitText, selected && styles.unitTextOn]}>{candidate}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={mode === 'finish' ? 'Increase workout total' : 'Increase step amount'} onPress={() => bump(1)} style={[styles.amountTick, styles.amountTickRight]}>
          <SymbolView name="plus" size={18} tintColor={C.ink} resizeMode="scaleAspectFit" />
        </Pressable>
      </View>
      {mode === 'finish' ? (
        <View style={styles.remainderRow}>
          <Text style={invalid ? styles.amountError : styles.remainderLabel}>{invalid ? 'Minimum total' : 'Cool-down'}</Text>
          <Text style={invalid ? styles.amountErrorValue : styles.remainderValue}>
            {invalid ? distanceValue(minimumTotalMeters, unit) : distanceValue(step.meters, unit)} {unit}
          </Text>
        </View>
      ) : null}
    </>
  );
}

export function WorkoutBuilder({
  onAdd,
  onClose,
  onDelete,
  easyBaseline,
  racePaces = null,
  bottomInset = 0,
  initialWorkout,
  submitLabel,
}: {
  onAdd: (w: BuiltWorkout) => void | Promise<void>;
  onClose: () => void;
  /** Existing workouts may expose a confirmed destructive action. */
  onDelete?: () => void;
  easyBaseline: number;
  /** Current race-equivalent paces resolve named time targets for preview only;
   * they are not written into the portable workout structure. */
  racePaces?: RacePaces | null;
  /** Supplied by the modal host so the primary action clears the home indicator. */
  bottomInset?: number;
  /** Existing prescription to edit. Presence switches copy and initializes the
   *  builder without changing the emitted BuiltWorkout contract. */
  initialWorkout?: BuiltWorkout | null;
  /** Contextual commit language: "Apply changes" in Adjust Week, "Save workout"
   *  in the standalone detail. */
  submitLabel?: string;
}) {
  const C = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { preferences } = useAppPreferences();
  const units = preferences.distance;
  // A FIXED sheet height (filling to the bottom) — so switching type/template
  // never jerks the panel and there's no black gap below the content.
  const { height: winH } = useWindowDimensions();
  const editing = initialWorkout != null;
  const initialMiles = initialWorkout?.distanceMeters
    ? Math.round(metersToUnits(initialWorkout.distanceMeters, units) * 10) / 10
    : units === 'mi' ? 6 : 10;
  const initialMinutes = initialWorkout?.durationSeconds
    ? Math.max(5, Math.round(initialWorkout.durationSeconds / 60))
    : 45;
  const initialBy = initialWorkout?.durationSeconds && !initialWorkout.distanceMeters ? 'time' : 'distance';
  const [type, setType] = useState<BuilderType>(initialWorkout?.type ?? 'easy');
  const [title, setTitle] = useState(initialWorkout?.title ?? '');
  const [by, setBy] = useState<'distance' | 'time'>(initialBy);
  const [miles, setMiles] = useState(initialMiles);
  const priorUnits = useRef(units);
  const [minutes, setMinutes] = useState(initialMinutes);
  const [rows, setRows] = useState<ERow[]>(() => initialWorkout?.structure?.length
    ? editableRowsFromStructure(initialWorkout.structure)
    : DEFAULT_TPL.build());
  useEffect(() => {
    if (priorUnits.current !== units) {
      const previous = priorUnits.current;
      setMiles((value) => Math.round(metersToUnits(unitsToMeters(value, previous), units) * 10) / 10);
      priorUnits.current = units;
    }
    setRows((current) => rowsForUnit(current, units));
  }, [units]);
  // Persisted prescriptions can have an exact day total while some leaves are
  // time based (for example, 90-second jog recoveries). Anchor edit mode to the
  // exact total and apply only the structure delta; opening and saving a 14.0 mi
  // workout must never round it down to the structure estimate of 13.9 mi.
  const initialStructuredMeters = useRef(
    initialWorkout?.type === 'quality' && initialWorkout.structure.length > 0
      ? estimatedStructureDistanceMeters(initialWorkout.structure, easyBaseline, racePaces)
      : null,
  ).current;
  const [tpl, setTpl] = useState<string | null>(editing ? null : DEFAULT_TPL.key); // active template, cleared on manual edit
  const [editFor, setEditFor] = useState<string | null>(null); // step id whose segment sheet is open
  const [finishAtFor, setFinishAtFor] = useState<string | null>(null); // cool-down authoring lens; serializes as distance
  const [editRepeatFor, setEditRepeatFor] = useState<string | null>(null);
  const [showAddChoices, setShowAddChoices] = useState(false);
  const [customizing, setCustomizing] = useState(editing && initialWorkout.type === 'quality' && initialWorkout.structure.length > 0);
  const [hasStructureEdits, setHasStructureEdits] = useState(false);
  const [hasWorkoutEdits, setHasWorkoutEdits] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const stepRefs = useRef<Record<string, View | null>>({});
  const rowRefs = useRef<Record<string, View | null>>({});

  const isQuality = type === 'quality';
  const structure = useMemo(() => (isQuality ? toStructure(rows) : []), [isQuality, rows]);
  const structTotal = useMemo(
    () => estimatedStructureDistanceMeters(structure, easyBaseline, racePaces),
    [structure, easyBaseline, racePaces],
  );
  const prescription = useMemo(() => structureLines(structure, units), [structure, units]);
  const estimatedTotal = useMemo(() => hasTimeOnlyLeaf(structure), [structure]);
  const selectedTemplate = TEMPLATES.find((t) => t.key === tpl) ?? null;

  const hasAnchoredQualityTotal = isQuality
    && initialWorkout?.type === 'quality'
    && initialStructuredMeters != null
    && initialWorkout.distanceMeters > 0;
  const qualityTotalMeters = hasAnchoredQualityTotal
    ? Math.max(0, initialWorkout.distanceMeters + (structTotal - initialStructuredMeters))
    : structTotal;
  const totalMeters = isQuality ? Math.round(qualityTotalMeters) : by === 'distance' ? Math.round(unitsToMeters(miles, units)) : 0;
  const totalLabel = isQuality ? metersToUnits(qualityTotalMeters, units).toFixed(1) : by === 'distance' ? String(miles) : String(minutes);
  const showEstimatedTotal = estimatedTotal && !hasAnchoredQualityTotal;
  const canSubmit = !isQuality || (structure.length > 0 && structTotal > 0);

  // ── step mutations (any manual edit detaches the active template) ─────────
  const dirty = () => {
    setTpl(null);
    setHasStructureEdits(true);
    setHasWorkoutEdits(true);
  };
  const editStep = (id: string, patch: Partial<EStep>) => {
    dirty();
    if ('by' in patch) animateReflow(); // unit swap changes the row's value width
    setRows((rs) =>
      rs.map((r) => {
        if (r.kind === 'step' && r.step.id === id) return { ...r, step: { ...r.step, ...patch } };
        if (r.kind === 'repeat') return { ...r, children: r.children.map((c) => (c.id === id ? { ...c, ...patch } : c)) };
        return r;
      }),
    );
  };
  // Unit is an authoring lens over the meter-based .due value, not a change to
  // the prescription itself. Switching mi/m should not create a dirty draft.
  const setStepUnit = (id: string, unit: DistanceUnit) => {
    setRows((rs) =>
      rs.map((r) => {
        if (r.kind === 'step' && r.step.id === id) return { ...r, step: { ...r.step, unit } };
        if (r.kind === 'repeat') return { ...r, children: r.children.map((c) => (c.id === id ? { ...c, unit } : c)) };
        return r;
      }),
    );
  };
  const removeRow = (rowId: string) => {
    dirty();
    animateReflow();
    setRows((rs) => rs.filter((r) => r.id !== rowId));
  };
  const setSets = (rowId: string, dir: 1 | -1) => {
    dirty();
    setRows((rs) => rs.map((r) => (r.id === rowId && r.kind === 'repeat' ? { ...r, sets: Math.max(1, r.sets + dir) } : r)));
  };
  const insertBeforeCooldown = (currentRows: ERow[], row: ERow) => {
    const cooldownIndex = currentRows.findIndex((candidate) => candidate.kind === 'step' && candidate.step.kind === 'cooldown');
    return cooldownIndex < 0
      ? [...currentRows, row]
      : [...currentRows.slice(0, cooldownIndex), row, ...currentRows.slice(cooldownIndex)];
  };
  const addStep = (kind: 'warmup' | 'work' | 'cooldown') => {
    const step = {
      ...dStep(kind, Math.round(unitsToMeters(1, units)), kind === 'work' ? 'threshold' : 'easy'),
      unit: units,
    };
    const row = wrap(step);
    dirty();
    animateReflow();
    setRows((currentRows) => {
      if (kind === 'warmup') {
        const firstNonWarmup = currentRows.findIndex((candidate) => candidate.kind !== 'step' || candidate.step.kind !== 'warmup');
        const insertAt = firstNonWarmup < 0 ? currentRows.length : firstNonWarmup;
        return [...currentRows.slice(0, insertAt), row, ...currentRows.slice(insertAt)];
      }
      if (kind === 'cooldown') return [...currentRows, row];
      return insertBeforeCooldown(currentRows, row);
    });
    setShowAddChoices(false);
    setEditFor(step.id);
  };
  const addRepeat = () => {
    const row = rep(4, [dStep('work', 400, '5K'), dStep('recovery', 200, 'recovery')]);
    dirty();
    animateReflow();
    setRows((currentRows) => insertBeforeCooldown(currentRows, row));
    setShowAddChoices(false);
    setEditRepeatFor(row.id);
  };
  const applyTemplate = (t: Template) => {
    animateReflow();
    setRows(rowsForUnit(t.build(), units));
    setTpl(t.key);
    setHasStructureEdits(t.key !== tpl);
    setHasWorkoutEdits(true);
  };
  const switchType = (t: BuilderType) => {
    animateReflow();
    setCustomizing(false);
    setEditFor(null);
    setFinishAtFor(null);
    setEditRepeatFor(null);
    setShowAddChoices(false);
    setType(t);
    setHasWorkoutEdits(true);
  };
  const openCustomizer = () => {
    animateReflow();
    setCustomizing(true);
  };
  const closeCustomizer = () => {
    setEditFor(null);
    setFinishAtFor(null);
    setEditRepeatFor(null);
    setShowAddChoices(false);
    animateReflow();
    setCustomizing(false);
  };
  const closeRepeatEditor = () => {
    const repeatId = editRepeatFor;
    setEditRepeatFor(null);
    if (!repeatId) return;
    setTimeout(() => {
      const node = findNodeHandle(rowRefs.current[repeatId] ?? null);
      if (node != null) AccessibilityInfo.setAccessibilityFocus(node);
    }, 0);
  };
  const closeStepEditor = () => {
    const editedId = editFor;
    setEditFor(null);
    setFinishAtFor(null);
    if (!editedId) return;
    setTimeout(() => {
      const node = findNodeHandle(stepRefs.current[editedId] ?? null);
      if (node != null) AccessibilityInfo.setAccessibilityFocus(node);
    }, 0);
  };
  const requestClose = () => {
    if (!hasStructureEdits && !hasWorkoutEdits) {
      onClose();
      return;
    }
    Alert.alert(
      'Discard workout changes?',
      'Your edited workout will not be saved.',
      [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: onClose },
      ],
    );
  };
  // Nudge by two displayed seconds while preserving the canonical sec/mi store.
  const editBand = (step: EStep, which: 'lo' | 'hi', dir: 1 | -1) => {
    const b = effBand(step, easyBaseline);
    const displayStepInSecPerMi = units === 'mi' ? 2 : 2 * 1.609344;
    const lo = which === 'lo' ? clampPaceSecPerMi(b.lo + dir * displayStepInSecPerMi) : b.lo;
    const hi = which === 'hi' ? clampPaceSecPerMi(b.hi + dir * displayStepInSecPerMi) : b.hi;
    editStep(step.id, {
      paceKind: 'absolute',
      speedFraction: 1,
      bandLo: Math.min(lo, hi),
      bandHi: Math.max(lo, hi),
    });
  };

  const submit = () => {
    if (!canSubmit || submitting) return;
    const result = onAdd({
      type,
      title: title.trim() || (isQuality ? selectedTemplate ? templateDisplay(selectedTemplate, units).title : qualityHeadline(rows) : ''),
      distanceMeters: totalMeters,
      durationSeconds: !isQuality && by === 'time' ? minutes * 60 : null,
      structure,
    });
    if (result && typeof result.then === 'function') {
      setSubmitting(true);
      void result
        .then(onClose)
        .catch(() => {
          // The host owns the user-facing error. Keeping the editor mounted
          // preserves the in-progress prescription for a retry.
        })
        .finally(() => setSubmitting(false));
    } else {
      onClose();
    }
  };

  // The overview is a workout navigator, not a miniature timeline editor.
  // Each structural block gets one clear destination; mechanics live one level
  // deeper so the full prescription remains legible at a glance.
  const StepBlock = ({ s }: { s: EStep }) => {
    const meta = KIND_META[s.kind];
    const amount = stepAmount(s);
    return (
      <Pressable
        ref={(node) => { stepRefs.current[s.id] = node; }}
        accessibilityRole="button"
        accessibilityLabel={`Edit ${meta.label}, ${amount}, ${paceLabel(s.pace)}`}
        onPress={() => setEditFor(s.id)}
        style={({ pressed }) => [styles.blockRow, pressed && styles.pressed]}
      >
        <View style={styles.blockIcon}>
          <SymbolView name={stepIcon(s.kind)} size={19} tintColor={meta.hard ? C.qualText : C.mute} resizeMode="scaleAspectFit" />
        </View>
        <View style={styles.blockCopy}>
          <Text style={styles.blockTitle}>{meta.label}</Text>
          <Text style={styles.blockMeta}>{`${amount} · ${paceLabel(s.pace)}`}</Text>
        </View>
        <View style={styles.blockChevron}>
          <SymbolView name="chevron.right" size={13} tintColor={C.faint} resizeMode="scaleAspectFit" />
        </View>
      </Pressable>
    );
  };

  const openStep = editFor ? findStep(rows, editFor) : null;
  const finishAt = openStep?.kind === 'cooldown' && finishAtFor === openStep.id;
  const openRepeat = editRepeatFor
    ? rows.find((row): row is Extract<ERow, { kind: 'repeat' }> => row.kind === 'repeat' && row.id === editRepeatFor) ?? null
    : null;
  const topLevelStepRow = openStep
    ? rows.find((row): row is Extract<ERow, { kind: 'step' }> => row.kind === 'step' && row.step.id === openStep.id) ?? null
    : null;
  const headline = qualityHeadline(rows);

  return (
    <View testID="workout-builder" style={[styles.root, { height: Math.round(winH * (customizing ? 0.94 : isQuality ? 0.78 : 0.64)) }]}>
      {/* One header primitive. This was a hand-rolled row: a conditional
          back-or-close leading control, a CENTERED fontSize-20 title, and a
          32x32 spacer opposite to balance that centering. SheetHeader's
          `navigation` prop already models back-vs-close, and its `right` slot
          takes the customiser's close. */}
      <SheetHeader
        navigation={customizing ? 'back' : 'close'}
        navigationLabel={
          customizing
            ? (openRepeat ? 'Back to workout blocks' : 'Back to workout summary')
            : (editing ? 'Close workout editor' : 'Close new workout')
        }
        title={openRepeat ? 'Edit intervals' : customizing || editing ? 'Edit workout' : 'New workout'}
        onClose={customizing ? (openRepeat ? closeRepeatEditor : closeCustomizer) : requestClose}
        style={styles.head}
      />

      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        pointerEvents={openStep ? 'none' : 'auto'}
        accessibilityElementsHidden={!!openStep}
        importantForAccessibility={openStep ? 'no-hide-descendants' : 'auto'}
      >
        {customizing ? (
          <>
            {openRepeat ? (
              <>
                <View style={styles.intervalSummary}>
                  <Text style={styles.advancedEyebrow}>Interval block</Text>
                  <Text style={styles.intervalHeadline}>{repeatCopy(openRepeat).title}</Text>
                  {repeatCopy(openRepeat).detail ? <Text style={styles.intervalMeta}>{repeatCopy(openRepeat).detail}</Text> : null}
                </View>

                <Text style={styles.sectionLabel}>Rounds</Text>
                <View style={styles.roundsRow}>
                  <View>
                    <Text style={styles.roundsValue}>{openRepeat.sets}</Text>
                    <Text style={styles.roundsMeta}>rounds</Text>
                  </View>
                  <View testID="repeat-stepper" style={styles.roundsControl}>
                    <Pressable accessibilityRole="button" accessibilityLabel="Decrease rounds" onPress={() => setSets(openRepeat.id, -1)} style={styles.roundsTick}>
                      <SymbolView name="minus" size={15} tintColor={C.ink} resizeMode="scaleAspectFit" />
                    </Pressable>
                    <Divider vertical style={styles.roundsDivider} />
                    <Pressable accessibilityRole="button" accessibilityLabel="Increase rounds" onPress={() => setSets(openRepeat.id, 1)} style={styles.roundsTick}>
                      <SymbolView name="plus" size={15} tintColor={C.ink} resizeMode="scaleAspectFit" />
                    </Pressable>
                  </View>
                </View>

                <Text style={styles.sectionLabel}>One round</Text>
                <View style={styles.blockList}>
                  {openRepeat.children.map((child, childIndex) => (
                    <View key={child.id}>
                      {childIndex > 0 ? <Divider style={styles.blockDivider} /> : null}
                      <StepBlock s={child} />
                    </View>
                  ))}
                </View>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Delete interval block"
                  onPress={() => {
                    const repeatId = openRepeat.id;
                    setEditRepeatFor(null);
                    removeRow(repeatId);
                  }}
                  style={({ pressed }) => [styles.removeBlock, pressed && styles.pressed]}
                >
                  <Text style={styles.removeBlockText}>Remove interval block</Text>
                </Pressable>
              </>
            ) : (
              <>
                <View style={styles.advancedSummary}>
                  <View style={styles.advancedSummaryCopy}>
                    <Text style={styles.advancedEyebrow}>Workout</Text>
                    <Text style={styles.advancedHeadline}>{headline}</Text>
                  </View>
                  <Text style={[styles.total, styles.advancedTotal]}>
                    {showEstimatedTotal ? '~' : ''}{totalLabel}
                    <Text style={styles.totalU}> {units}</Text>
                  </Text>
                </View>

                <View style={styles.blockList}>
                  {rows.map((row, index) => (
                    <View key={row.id}>
                      {index > 0 ? <Divider style={styles.blockDivider} /> : null}
                      {row.kind === 'step' ? (
                        <StepBlock s={row.step} />
                      ) : (() => {
                        const copy = repeatCopy(row);
                        return (
                          <Pressable
                            ref={(node) => { rowRefs.current[row.id] = node; }}
                            accessibilityRole="button"
                            accessibilityLabel={`Edit Intervals, ${copy.title}${copy.detail ? `, ${copy.detail}` : ''}`}
                            onPress={() => setEditRepeatFor(row.id)}
                            style={({ pressed }) => [styles.blockRow, styles.intervalBlockRow, pressed && styles.pressed]}
                          >
                            <View style={[styles.blockIcon, styles.intervalIcon]}>
                              <SymbolView name="repeat" size={20} tintColor={C.qualText} resizeMode="scaleAspectFit" />
                            </View>
                            <View style={styles.blockCopy}>
                              <Text style={styles.intervalLabel}>Intervals</Text>
                              <Text style={styles.blockTitle}>{copy.title}</Text>
                              {copy.detail ? <Text style={styles.blockMeta}>{copy.detail}</Text> : null}
                            </View>
                            <View style={styles.blockChevron}>
                              <SymbolView name="chevron.right" size={13} tintColor={C.faint} resizeMode="scaleAspectFit" />
                            </View>
                          </Pressable>
                        );
                      })()}
                    </View>
                  ))}
                </View>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={showAddChoices ? 'Hide block choices' : 'Add block'}
                  accessibilityState={{ expanded: showAddChoices }}
                  onPress={() => {
                    animateReflow();
                    setShowAddChoices((shown) => !shown);
                  }}
                  style={({ pressed }) => [styles.addBlockRow, pressed && styles.pressed]}
                >
                  <SymbolView name="plus" size={15} tintColor={C.mute} resizeMode="scaleAspectFit" />
                  <Text style={styles.addBlockText}>Add block</Text>
                  <View style={{ flex: 1 }} />
                  <SymbolView name={showAddChoices ? 'chevron.up' : 'chevron.down'} size={11} tintColor={C.faint} resizeMode="scaleAspectFit" />
                </Pressable>
                {showAddChoices ? (
                  <View style={styles.addChoices}>
                    <Pressable accessibilityRole="button" accessibilityLabel="Add a warm-up block" onPress={() => addStep('warmup')} style={({ pressed }) => [styles.addChoice, pressed && styles.pressed]}>
                      <View style={styles.addChoiceIcon}><SymbolView name="sun.horizon" size={17} tintColor={C.mute} resizeMode="scaleAspectFit" /></View>
                      <View style={styles.blockCopy}>
                        <Text style={styles.addChoiceTitle}>Warm-up</Text>
                        <Text style={styles.addChoiceMeta}>Easy preparation</Text>
                      </View>
                    </Pressable>
                    <Divider style={styles.addChoiceDivider} />
                    <Pressable accessibilityRole="button" accessibilityLabel="Add a work effort block" onPress={() => addStep('work')} style={({ pressed }) => [styles.addChoice, pressed && styles.pressed]}>
                      <View style={styles.addChoiceIcon}><SymbolView name="bolt.fill" size={17} tintColor={C.qualText} resizeMode="scaleAspectFit" /></View>
                      <View style={styles.blockCopy}>
                        <Text style={styles.addChoiceTitle}>Work effort</Text>
                        <Text style={styles.addChoiceMeta}>One continuous hard effort</Text>
                      </View>
                    </Pressable>
                    <Divider style={styles.addChoiceDivider} />
                    <Pressable accessibilityRole="button" accessibilityLabel="Add a repeat interval block" onPress={addRepeat} style={({ pressed }) => [styles.addChoice, pressed && styles.pressed]}>
                      <View style={styles.addChoiceIcon}><SymbolView name="repeat" size={17} tintColor={C.qualText} resizeMode="scaleAspectFit" /></View>
                      <View style={styles.blockCopy}>
                        <Text style={styles.addChoiceTitle}>Repeat interval</Text>
                        <Text style={styles.addChoiceMeta}>Work and recovery rounds</Text>
                      </View>
                    </Pressable>
                    <Divider style={styles.addChoiceDivider} />
                    <Pressable accessibilityRole="button" accessibilityLabel="Add a cool-down block" onPress={() => addStep('cooldown')} style={({ pressed }) => [styles.addChoice, pressed && styles.pressed]}>
                      <View style={styles.addChoiceIcon}><SymbolView name="flag.checkered" size={17} tintColor={C.mute} resizeMode="scaleAspectFit" /></View>
                      <View style={styles.blockCopy}>
                        <Text style={styles.addChoiceTitle}>Cool-down</Text>
                        <Text style={styles.addChoiceMeta}>Easy finish</Text>
                      </View>
                    </Pressable>
                  </View>
                ) : null}
              </>
            )}
          </>
        ) : (
        <>
        {/* Type */}
        <View style={styles.seg} accessibilityRole="tablist">
          {BUILDER_TYPE_OPTIONS.map((option) => {
            const on = type === option.key;
            const color = builderTypeColor(C, option.key);
            return (
              <Pressable
                key={option.key}
                accessibilityRole="tab"
                accessibilityLabel={option.accessibilityLabel}
                accessibilityState={{ selected: on }}
                onPress={() => switchType(option.key)}
                style={({ pressed }) => [styles.segb, pressed && styles.pressed]}
              >
                <SymbolView
                  testID={`workout-type-icon-${option.key}`}
                  name={option.icon}
                  size={17}
                  weight={on ? 'semibold' : 'regular'}
                  tintColor={on ? color : C.faint}
                  resizeMode="scaleAspectFit"
                />
                <Text style={[styles.segTxt, on && styles.segTxtOn]}>{option.label}</Text>
                <View testID={`workout-type-mark-${option.key}`} style={[styles.segMark, on && { backgroundColor: color }]} />
              </Pressable>
            );
          })}
        </View>

        {/* Name */}
        <Text style={styles.lbl}>
          Name <Text style={styles.opt}>optional</Text>
        </Text>
        <TextInput
          value={title}
          onChangeText={(value) => {
            setTitle(value);
            setHasWorkoutEdits(true);
          }}
          placeholder={isQuality ? 'e.g. Threshold intervals' : 'e.g. Easy shakeout'}
          placeholderTextColor={C.mute}
          style={styles.input}
          returnKeyType="done"
        />

        {isQuality ? (
          <>
            <View style={styles.suggestionHead}>
              <Text style={styles.suggestionHeading}>Start with</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Build a custom workout"
                onPress={openCustomizer}
                style={({ pressed }) => [styles.customizeLink, pressed && styles.pressed]}
              >
                <SymbolView name="slider.horizontal.3" size={12} tintColor={C.mute} resizeMode="scaleAspectFit" />
                <Text style={styles.customizeText}>Custom</Text>
                <SymbolView name="chevron.right" size={9} tintColor={C.faint} resizeMode="scaleAspectFit" />
              </Pressable>
            </View>
            <View testID="workout-template-rail" style={styles.suggestionList} accessibilityRole="radiogroup">
              {TEMPLATES.map((t) => {
                const on = tpl === t.key;
                const copy = templateDisplay(t, units);
                return (
                  <Pressable
                    key={t.key}
                    accessibilityRole="radio"
                    accessibilityLabel={`Use ${copy.label}: ${copy.detail}`}
                    accessibilityState={{ checked: on }}
                    onPress={() => applyTemplate(t)}
                    style={({ pressed }) => [styles.suggestionRow, pressed && styles.pressed]}
                  >
                    <Text style={[styles.suggestionName, on && styles.suggestionNameOn]} numberOfLines={1}>{copy.compactLabel}</Text>
                    <View testID={`workout-suggestion-mark-${t.key}`} style={[styles.suggestionMark, on && { backgroundColor: C.qualText }]} />
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.previewHead}>
              <Text style={styles.previewTitle}>Workout</Text>
              <Text style={styles.total}>
                {showEstimatedTotal ? '~' : ''}{totalLabel}
                <Text style={styles.totalU}> {units}</Text>
              </Text>
            </View>
            <View style={styles.prescription}>
              {prescription.map((line, index) => (
                <View key={`${line.text}-${index}`}>
                  {index > 0 ? <Divider style={styles.prescriptionDivider} /> : null}
                  <View style={styles.prescriptionRow}>
                    <View style={[styles.prescriptionDot, { backgroundColor: line.strong ? C.qual : C.slate }]} />
                    <Text style={[styles.prescriptionText, line.strong && styles.prescriptionStrong]}>{line.text}</Text>
                  </View>
                </View>
              ))}
            </View>

          </>
        ) : (
          <>
            <Text style={styles.lbl}>Target</Text>
            <View style={styles.toggle}>
              <Pressable accessibilityRole="button" accessibilityLabel="Measure workout by distance" accessibilityState={{ selected: by === 'distance' }} onPress={() => { setBy('distance'); setHasWorkoutEdits(true); }} style={[styles.toggleb, by === 'distance' && styles.toggleOn]}>
                <Text style={[styles.toggleTxt, by === 'distance' && { color: C.ink }]}>Distance</Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Measure workout by time" accessibilityState={{ selected: by === 'time' }} onPress={() => { setBy('time'); setHasWorkoutEdits(true); }} style={[styles.toggleb, by === 'time' && styles.toggleOn]}>
                <Text style={[styles.toggleTxt, by === 'time' && { color: C.ink }]}>Time</Text>
              </Pressable>
            </View>
            <View style={styles.bigStep}>
              <Pressable accessibilityRole="button" accessibilityLabel="Decrease workout target" onPress={() => { setHasWorkoutEdits(true); if (by === 'distance') setMiles((m) => Math.max(1, m - 1)); else setMinutes((m) => Math.max(5, m - 5)); }} style={styles.bigTick}>
                <SymbolView name="minus" size={18} tintColor={C.ink} resizeMode="scaleAspectFit" />
              </Pressable>
              <Text style={styles.bigVal}>
                {by === 'distance' ? miles : minutes}
                <Text style={styles.bigUnit}> {by === 'distance' ? units : 'min'}</Text>
              </Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Increase workout target" onPress={() => { setHasWorkoutEdits(true); if (by === 'distance') setMiles((m) => m + 1); else setMinutes((m) => m + 5); }} style={styles.bigTick}>
                <SymbolView name="plus" size={18} tintColor={C.ink} resizeMode="scaleAspectFit" />
              </Pressable>
            </View>
          </>
        )}
        </>
        )}
      </ScrollView>

      <ModalFooter
        testID="workout-builder-footer"
        surface="panel"
        bottomInset={bottomInset}
        pointerEvents={openStep ? 'none' : 'auto'}
        accessibilityElementsHidden={!!openStep}
        importantForAccessibility={openStep ? 'no-hide-descendants' : 'auto'}
      >
        {editing && onDelete && !customizing && !openRepeat ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Delete run"
            onPress={onDelete}
            disabled={submitting}
            style={({ pressed }) => [styles.deleteWorkout, pressed && styles.pressed]}
          >
            <Text style={styles.deleteWorkoutText}>Delete run</Text>
          </Pressable>
        ) : null}
        <ActionButton
          color={C.yellow}
          accessibilityLabel={openRepeat ? 'Done editing intervals' : editing ? submitLabel ?? 'Save workout' : customizing ? 'Review workout' : 'Add workout'}
          loadingAccessibilityLabel={editing ? 'Saving workout' : 'Adding workout'}
          loadingLabel="Saving…"
          onPress={openRepeat ? closeRepeatEditor : editing ? submit : customizing ? closeCustomizer : submit}
          disabled={!customizing && !canSubmit}
          loading={submitting}
          variant="commit"
          style={styles.addBtnOuter}
        >
          <ActionButtonLabel>{openRepeat ? 'Done' : editing ? submitLabel ?? 'Save workout' : customizing ? 'Review workout' : 'Add workout'}</ActionButtonLabel>
        </ActionButton>
      </ModalFooter>

      {/* Segment sheet (for the open step): target type + pace. */}
      {openStep ? (
        <>
        <Pressable accessibilityRole="button" accessibilityLabel="Close step editor" onPress={closeStepEditor} style={styles.paceScrim} />
        <View style={styles.pacePop} accessibilityViewIsModal>
          <View style={styles.pacePopHead}>
            <Text style={styles.pacePopTitle}>{KIND_META[openStep.kind].label}</Text>
            <CloseButton onPress={closeStepEditor} accessibilityLabel="Close step editor" />
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.pacePopBody, { paddingBottom: Math.max(space.xl, bottomInset + space.lg) }]}>
            <Text style={styles.popLbl}>{openStep.kind === 'cooldown' ? 'Target' : 'Measure by'}</Text>
            <View style={styles.toggle}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Measure step by distance"
                accessibilityState={{ selected: openStep.by === 'distance' && !finishAt }}
                onPress={() => {
                  setFinishAtFor(null);
                  if (openStep.by !== 'distance') editStep(openStep.id, { by: 'distance', meters: openStep.meters || 400 });
                }}
                style={[styles.toggleb, openStep.by === 'distance' && !finishAt && styles.toggleOn]}
              >
                <Text style={[styles.toggleTxt, openStep.by === 'distance' && !finishAt && { color: C.ink }]}>Distance</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Measure step by time"
                accessibilityState={{ selected: openStep.by === 'time' }}
                onPress={() => {
                  setFinishAtFor(null);
                  if (openStep.by !== 'time') editStep(openStep.id, { by: 'time', seconds: openStep.seconds || (KIND_META[openStep.kind].hard ? 180 : 60) });
                }}
                style={[styles.toggleb, openStep.by === 'time' && styles.toggleOn]}
              >
                <Text style={[styles.toggleTxt, openStep.by === 'time' && { color: C.ink }]}>Time</Text>
              </Pressable>
              {openStep.kind === 'cooldown' ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Finish workout at total distance"
                  accessibilityState={{ selected: finishAt }}
                  onPress={() => {
                    setFinishAtFor(openStep.id);
                    if (openStep.by !== 'distance') editStep(openStep.id, { by: 'distance', meters: openStep.meters || 400 });
                  }}
                  style={[styles.toggleb, finishAt && styles.toggleOn]}
                >
                  <Text style={[styles.toggleTxt, finishAt && { color: C.ink }]}>Finish at</Text>
                </Pressable>
              ) : null}
            </View>

            {openStep.by === 'distance' ? (
              <>
                <DistanceAmountControl
                  key={`${openStep.id}-${finishAt ? 'finish' : 'step'}`}
                  step={openStep}
                  mode={finishAt ? 'finish' : 'step'}
                  workoutTotalMeters={finishAt ? qualityTotalMeters : undefined}
                  onEdit={(patch) => editStep(openStep.id, patch)}
                  onUnitChange={(unit) => setStepUnit(openStep.id, unit)}
                  C={C}
                  styles={styles}
                />
                {openStep.kind === 'cooldown' && !finishAt ? <View style={styles.cooldownDetailSlot} /> : null}
              </>
            ) : (
              <>
                <Text style={styles.popLbl}>Amount</Text>
                <View style={styles.amountStep}>
                  <Pressable accessibilityRole="button" accessibilityLabel="Decrease step amount" onPress={() => editStep(openStep.id, { seconds: bumpTime(openStep.seconds, -1) })} style={[styles.amountTick, styles.amountTickLeft]}>
                    <SymbolView name="minus" size={18} tintColor={C.ink} resizeMode="scaleAspectFit" />
                  </Pressable>
                  <View style={styles.amountValueGroup}>
                    <Text style={styles.bigVal}>{showTime(openStep.seconds)}</Text>
                  </View>
                  <Pressable accessibilityRole="button" accessibilityLabel="Increase step amount" onPress={() => editStep(openStep.id, { seconds: bumpTime(openStep.seconds, 1) })} style={[styles.amountTick, styles.amountTickRight]}>
                    <SymbolView name="plus" size={18} tintColor={C.ink} resizeMode="scaleAspectFit" />
                  </Pressable>
                </View>
                {openStep.kind === 'cooldown' ? <View style={styles.cooldownDetailSlot} /> : null}
              </>
            )}

            <Text style={styles.popLbl}>Pace</Text>
            <View style={[styles.chips, KIND_META[openStep.kind].hard && styles.hardPaceGrid]}>
              {pacesForKind(openStep.kind).map((p) => {
                const on = openStep.pace === p.key;
                return (
                  // Picking a pace re-seeds the band from that zone (clears any override).
                  <Pressable key={p.key} accessibilityRole="button" accessibilityLabel={`Set pace to ${p.label}`} accessibilityState={{ selected: on }} onPress={() => editStep(openStep.id, { pace: p.key, paceKind: 'relative', speedFraction: 1, bandLo: undefined, bandHi: undefined })} style={[styles.chip, KIND_META[openStep.kind].hard && styles.hardPaceChip]}>
                    <Text style={[styles.chipTxt, on && styles.chipTxtOn]}>{p.label}</Text>
                    <View style={[styles.chipMark, on && styles.chipMarkOn]} />
                  </Pressable>
                );
              })}
            </View>

            {openStep.bandLo != null && openStep.bandHi != null ? (
              <>
                <View style={styles.bandHead}>
                  <Text style={styles.popLbl}>Exact pace band <Text style={styles.opt}>/{units}</Text></Text>
                  <Pressable accessibilityRole="button" accessibilityLabel="Use named pace only" onPress={() => editStep(openStep.id, { paceKind: 'relative', speedFraction: 1, bandLo: undefined, bandHi: undefined })} style={styles.bandResetHit}>
                    <Text style={styles.bandReset}>Remove</Text>
                  </Pressable>
                </View>
                <View style={styles.bandRow}>
                  {(['lo', 'hi'] as const).map((which, i) => (
                    <View key={which} style={styles.bandCol}>
                      {i === 1 ? <Text style={styles.bandTo}>–</Text> : null}
                      <Pressable accessibilityRole="button" accessibilityLabel={`Decrease ${which === 'lo' ? 'faster' : 'slower'} pace bound`} onPress={() => editBand(openStep, which, -1)} style={styles.tick}>
                        <SymbolView name="minus" size={13} tintColor={C.ink} resizeMode="scaleAspectFit" />
                      </Pressable>
                      <Text style={styles.bandBig}>{fmtPace(units === 'mi' ? effBand(openStep, easyBaseline)[which] : effBand(openStep, easyBaseline)[which] / 1.609344)}</Text>
                      <Pressable accessibilityRole="button" accessibilityLabel={`Increase ${which === 'lo' ? 'faster' : 'slower'} pace bound`} onPress={() => editBand(openStep, which, 1)} style={styles.tick}>
                        <SymbolView name="plus" size={13} tintColor={C.ink} resizeMode="scaleAspectFit" />
                      </Pressable>
                    </View>
                  ))}
                </View>
              </>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Set an exact pace band"
                onPress={() => {
                  const band = seedPaceBand(openStep.pace, easyBaseline);
                  editStep(openStep.id, { paceKind: 'absolute', speedFraction: 1, bandLo: band.lo, bandHi: band.hi });
                }}
                style={({ pressed }) => [styles.exactBandRow, pressed && styles.pressed]}
              >
                <Text style={styles.exactBandText}>Set exact pace band</Text>
                <SymbolView name="chevron.right" size={11} tintColor={C.faint} resizeMode="scaleAspectFit" />
              </Pressable>
            )}

            {topLevelStepRow ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${KIND_META[openStep.kind].label} block`}
                onPress={() => {
                  const rowId = topLevelStepRow.id;
                  setEditFor(null);
                  removeRow(rowId);
                }}
                style={({ pressed }) => [styles.removeStepBlock, pressed && styles.pressed]}
              >
                <Text style={styles.removeBlockText}>Remove {KIND_META[openStep.kind].label.toLowerCase()} block</Text>
              </Pressable>
            ) : null}
          </ScrollView>
        </View>
        </>
      ) : null}
    </View>
  );
}

function findStep(rows: ERow[], id: string): EStep | null {
  for (const r of rows) {
    if (r.kind === 'step' && r.step.id === id) return r.step;
    if (r.kind === 'repeat') {
      const c = r.children.find((x) => x.id === id);
      if (c) return c;
    }
  }
  return null;
}

const makeStyles = (C: Tokens) =>
  StyleSheet.create({
    root: { overflow: 'hidden', backgroundColor: C.panel, borderTopLeftRadius: sheetPresentation.cornerRadius, borderTopRightRadius: sheetPresentation.cornerRadius },
    scroll: { flex: 1 },
    head: { minHeight: 60 },
    body: { paddingHorizontal: space.lg, paddingBottom: space.lg },
    addBtnOuter: { width: '100%' },
    deleteWorkout: {
      minHeight: 42,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: space.xs,
    },
    deleteWorkoutText: {
      color: C.dangerText,
      fontSize: fontSizes.labelLg,
      fontWeight: '700',
    },
    pressed: { opacity: 0.58 },

    // Four equal icon tabs keep the workout families scannable without making
    // each one a separate box. Label weight + the short mark carry selection
    // in addition to colour.
    seg: { flexDirection: 'row', marginTop: space.xs },
    segb: { position: 'relative', flex: 1, minHeight: 54, alignItems: 'center', justifyContent: 'center', gap: space.xs, paddingBottom: space.xs },
    segMark: { position: 'absolute', bottom: 0, width: 22, height: 3, borderRadius: 2, backgroundColor: 'transparent' },
    segTxt: { color: C.mute, fontSize: fontSizes.metadata, fontWeight: '700' },
    segTxtOn: { color: C.ink, fontWeight: '800' },

    lbl: { ...eyebrowText(C, 'micro'), marginTop: space.lg, marginBottom: space.sm, marginHorizontal: space.xxs },
    opt: { color: C.mute, textTransform: 'none', letterSpacing: 0, fontWeight: '600' },
    input: { backgroundColor: C.recess, borderWidth: 1, borderColor: C.line, borderRadius: 11, paddingHorizontal: space.l, paddingVertical: space.md, color: C.ink, fontSize: fontSizes.labelLg, fontWeight: '600' },

    // The preview below owns the prescription details; this rail only chooses
    // a starting point. Removing repeated pace/recovery copy keeps it compact.
    suggestionHead: { minHeight: 36, marginTop: space.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    suggestionHeading: { color: C.mute, fontSize: fontSizes.labelSm, fontWeight: '700', marginHorizontal: space.xxs },
    suggestionList: { minHeight: 40, flexDirection: 'row', ...hairlineBottom(C) },
    suggestionRow: { position: 'relative', flex: 1, minWidth: 0, minHeight: 40, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xxs },
    suggestionName: { ...statValueText(C, 'labelSm', 'system'), color: C.mute, fontWeight: '700' },
    suggestionNameOn: { color: C.qualText },
    suggestionMark: { position: 'absolute', bottom: -StyleSheet.hairlineWidth, width: 18, height: 2.5, borderRadius: 2, backgroundColor: 'transparent' },
    customizeLink: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: space.xxs },
    customizeText: { color: C.ink, fontSize: fontSizes.labelSm, fontWeight: '800' },

    previewHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: space.lg, marginBottom: space.xs },
    previewTitle: { color: C.ink, fontSize: fontSizes.body, fontWeight: '800', letterSpacing: -0.15 },
    total: { color: C.ink, fontFamily: display, fontSize: 19, letterSpacing: -0.4 },
    totalU: { color: C.mute, fontSize: fontSizes.labelSm, fontWeight: '700' },
    prescription: { ...hairlineTop(C), ...hairlineBottom(C) },
    prescriptionRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.s, paddingVertical: space.sm },
    // The rule starts past the intensity dot, so the column of dots reads as one
    // list rather than as separated pairs. Asymmetric, so it is a Divider style
    // rather than Divider's (symmetric) `inset`.
    prescriptionDivider: { marginLeft: space.xl },
    prescriptionDot: { width: 7, height: 7, borderRadius: radius.xs },
    prescriptionText: { flex: 1, color: C.mute, fontSize: fontSizes.label, fontWeight: '600', lineHeight: 18 },
    prescriptionStrong: { color: C.ink, fontWeight: '800' },
    advancedSummary: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: space.lg, paddingTop: space.sm, paddingBottom: space.xl },
    advancedSummaryCopy: { flex: 1, minWidth: 0 },
    advancedEyebrow: { ...eyebrowText(C, 'micro'), marginBottom: space.s },
    advancedHeadline: { color: C.ink, fontFamily: display, fontSize: 22, lineHeight: 27, letterSpacing: -0.55 },
    advancedTotal: { fontSize: 22, paddingBottom: 1 },

    // The overview stays on open ground like the Week screen. Structure is
    // carried by a single row group and confident icons, not a diagram rail.
    blockList: { ...hairlineTop(C), ...hairlineBottom(C) },
    // Indented past the 40pt icon tile + its gap, so the icons stay one column.
    blockDivider: { marginLeft: 56 },
    blockRow: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingLeft: space.xs, paddingRight: 0, paddingVertical: space.md },
    intervalBlockRow: { minHeight: 90 },
    blockIcon: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: C.fill, alignItems: 'center', justifyContent: 'center' },
    intervalIcon: { backgroundColor: C.fill },
    blockCopy: { flex: 1, minWidth: 0 },
    blockTitle: { color: C.ink, fontSize: fontSizes.body, fontWeight: '800', letterSpacing: -0.15 },
    blockMeta: { ...statValueText(C, 'metadata', 'system'), color: C.mute, fontWeight: '600', lineHeight: 17, marginTop: space.xxs },
    intervalLabel: { ...eyebrowText(C, 'micro'), color: C.qualText, marginBottom: space.xs },
    blockChevron: { width: 36, height: 44, alignItems: 'center', justifyContent: 'center' },

    addBlockRow: { minHeight: 52, marginTop: space.sm, paddingHorizontal: space.sm, flexDirection: 'row', alignItems: 'center', gap: space.sm },
    addBlockText: { color: C.mute, fontSize: fontSizes.label, fontWeight: '800' },
    addChoices: { backgroundColor: C.fill, borderRadius: radius.md, paddingHorizontal: space.md, overflow: 'hidden' },
    addChoice: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: space.md },
    addChoiceIcon: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
    addChoiceTitle: { color: C.ink, fontSize: fontSizes.label, fontWeight: '800' },
    addChoiceMeta: { color: C.mute, fontSize: fontSizes.labelSm, fontWeight: '600', marginTop: space.xxs },
    addChoiceDivider: { marginLeft: 44 },

    intervalSummary: { paddingTop: space.sm, paddingBottom: space.xl },
    intervalHeadline: { color: C.ink, fontFamily: display, fontSize: 24, lineHeight: 29, letterSpacing: -0.6 },
    intervalMeta: { color: C.mute, fontSize: fontSizes.label, lineHeight: 18, fontWeight: '600', marginTop: space.s },
    sectionLabel: { ...eyebrowText(C, 'micro'), marginTop: space.l, marginBottom: space.sm, marginHorizontal: space.xs },
    roundsRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: space.sm, paddingRight: 0, ...hairlineTop(C), ...hairlineBottom(C) },
    roundsValue: { color: C.ink, fontFamily: display, fontSize: 23, letterSpacing: -0.4 },
    roundsMeta: { color: C.mute, fontSize: fontSizes.labelSm, fontWeight: '600', marginTop: space.xxs },
    roundsControl: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.fill, borderRadius: radius.md, overflow: 'hidden' },
    roundsTick: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
    // Height only: <Divider vertical> owns the width and the colour, and a fixed
    // cross-size keeps its `alignSelf: 'stretch'` inert inside the centered row.
    roundsDivider: { height: 24 },
    removeBlock: { minHeight: 50, marginTop: space.lg, alignItems: 'center', justifyContent: 'center' },
    removeStepBlock: { minHeight: 50, marginTop: space.lg, ...hairlineTop(C), alignItems: 'center', justifyContent: 'center' },
    removeBlockText: { color: C.dangerText, fontSize: fontSizes.metadata, fontWeight: '800' },

    tick: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: C.fill, alignItems: 'center', justifyContent: 'center' },
    bandHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
    bandResetHit: { minWidth: 44, minHeight: 44, alignItems: 'flex-end', justifyContent: 'center' },
    bandReset: { color: C.mute, fontSize: fontSizes.labelSm, fontWeight: '800' },
    bandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.s },
    bandCol: { flexDirection: 'row', alignItems: 'center', gap: space.s },
    bandTo: { color: C.faint, fontSize: fontSizes.body, fontWeight: '800', marginRight: space.xxs },
    bandBig: { ...statValueText(C, 'body', 'system'), fontWeight: '800', minWidth: 46, textAlign: 'center' },

    toggle: { flexDirection: 'row', backgroundColor: C.recess, borderWidth: 1, borderColor: C.line, borderRadius: 11, padding: 3, marginBottom: space.m },
    toggleb: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
    toggleOn: { backgroundColor: C.card },
    toggleTxt: { color: C.mute, fontSize: fontSizes.metadata, fontWeight: '800' },
    amountHead: { marginTop: space.md, marginBottom: space.sm, marginHorizontal: space.xs },
    amountLabel: { marginTop: 0, marginBottom: 0, marginHorizontal: 0 },
    amountStep: { minHeight: 60, flexDirection: 'row', alignItems: 'stretch', backgroundColor: C.recess, borderWidth: 1, borderColor: C.line, borderRadius: radius.md, overflow: 'hidden' },
    amountTick: { width: 54, minHeight: 58, alignItems: 'center', justifyContent: 'center' },
    amountTickLeft: hairlineRight(C),
    amountTickRight: hairlineLeft(C),
    amountValueGroup: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs },
    unitToggle: { height: 44, flexDirection: 'row', alignItems: 'center' },
    unitOption: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: space.s },
    unitOptionOn: { backgroundColor: C.card },
    unitText: { ...statValueText(C, 'metadata', 'system'), color: C.mute, fontWeight: '800' },
    unitTextOn: { color: C.ink },
    bigStep: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.recess, borderWidth: 1, borderColor: C.line, borderRadius: radius.md, padding: space.sm },
    bigTick: { width: 44, height: 44, borderRadius: 9, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' },
    bigVal: { color: C.ink, fontSize: 26, fontFamily: display, letterSpacing: -0.5 },
    bigUnit: { color: C.mute, fontSize: fontSizes.label, fontWeight: '700' },
    amountInput: { width: 96, height: 58, paddingVertical: space.xs, paddingHorizontal: space.xs, color: C.ink, fontSize: 26, fontFamily: display, letterSpacing: -0.5, textAlign: 'center', fontVariant: ['tabular-nums'] },
    remainderRow: { minHeight: space.xxl + space.xxs, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.xs },
    cooldownDetailSlot: { minHeight: space.xxl + space.xxs },
    remainderLabel: { color: C.mute, fontSize: fontSizes.labelSm, fontWeight: '700' },
    remainderValue: { ...statValueText(C, 'labelSm', 'system'), fontWeight: '800' },
    amountError: { color: C.dangerText, fontSize: fontSizes.labelSm, fontWeight: '700' },
    amountErrorValue: { ...statValueText(C, 'labelSm', 'system'), color: C.dangerText, fontWeight: '800' },

    // NOT the shared SCRIM, deliberately: this is a NESTED scrim inside the
    // already-scrimmed workout modal, and stacking two SCRIMs compounds to
    // near-black. Named exception, recorded in the SCRIM token's doc comment.
    paceScrim: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(0,0,0,0.35)' },
    pacePop: { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '82%', backgroundColor: C.card, borderTopWidth: 1, borderTopColor: C.line, borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingTop: space.lg },
    pacePopHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.lg, marginBottom: space.sm },
    pacePopTitle: { color: C.ink, fontSize: fontSizes.body, fontWeight: '800' },
    pacePopBody: { paddingHorizontal: space.lg },
    popLbl: { color: C.mute, fontSize: fontSizes.labelSm, fontWeight: '700', marginTop: space.md, marginBottom: space.sm, marginHorizontal: space.xxs },
    chips: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.xs, rowGap: space.xxs },
    hardPaceGrid: { columnGap: 0 },
    chip: { position: 'relative', minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, paddingHorizontal: space.m, paddingBottom: space.xxs },
    hardPaceChip: { width: '25%', paddingHorizontal: space.xs },
    chipTxt: { color: C.mute, fontSize: fontSizes.metadata, fontWeight: '800' },
    chipTxtOn: { color: C.ink },
    chipMark: { position: 'absolute', bottom: 1, width: 18, height: 3, borderRadius: radius.xs, backgroundColor: 'transparent' },
    chipMarkOn: { backgroundColor: C.yellow },
    exactBandRow: { minHeight: 48, marginTop: space.md, paddingHorizontal: space.xs, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', ...hairlineTop(C) },
    exactBandText: { color: C.ink, fontSize: fontSizes.metadata, fontWeight: '800' },
  });
