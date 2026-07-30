import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAppPreferences } from '@/app-lib/preferences';
import {
  buildPlanBlueprint,
  metersToUnits,
  workoutIntentLabel,
  workoutPaceBandLabel,
  workoutTone,
  type ImportedPlanDraft,
  type PlanBlueprintWeek,
} from '@/lib';
import { stripToneColor } from '@/components/dash/DayTab';
import { PlanBlueprint } from '@/components/plan/PlanBlueprint';
import { PlanLedger } from '@/components/plan/PlanLedger';
import { Chip } from '@/components/ui/Chip';
import { hairlineTop } from '@/components/ui/Divider';
import { eyebrowText } from '@/components/ui/Eyebrow';
import { statValueText } from '@/components/ui/Stat';
import { useTheme, useThemedStyles } from '@/theme/ThemeProvider';
import { fontSizes, radius, space, type Tokens } from '@/theme/tokens';

type DraftWorkout = ImportedPlanDraft['workouts'][number];

/**
 * Read-only adapter from an imported/stored plan draft to the canonical Plan
 * screen grammar. The Plan tab, import review, starter preview, and saved-plan
 * detail all render the same phase ledger; only live-only edit/drill actions
 * are omitted here.
 */
export function PlanOutlineView({ draft, showProfile = true }: { draft: ImportedPlanDraft; showProfile?: boolean }) {
  const workoutsByWeek = useMemo(() => groupWorkouts(draft), [draft]);
  const weeks = useMemo(() => blueprintFromDraft(draft, workoutsByWeek), [draft, workoutsByWeek]);
  const [selectedWeekIndex, setSelectedWeekIndex] = useState(() => weeks[0]?.weekIndex ?? -1);
  const styles = useThemedStyles(makeStyles);

  useEffect(() => {
    if (weeks.some((week) => week.weekIndex === selectedWeekIndex)) return;
    setSelectedWeekIndex(weeks[0]?.weekIndex ?? -1);
  }, [selectedWeekIndex, weeks]);

  if (weeks.length === 0) return null;

  return (
    <View style={styles.bleed}>
      {showProfile ? (
        <PlanBlueprint
          weeks={weeks}
          selectedWeekIndex={selectedWeekIndex}
          onSelectWeek={setSelectedWeekIndex}
        />
      ) : null}
      <PlanLedger
        weeks={weeks}
        selectedWeekIndex={selectedWeekIndex}
        onSelectWeek={setSelectedWeekIndex}
        renderWeekDetails={(week) => (
          <DraftWeekSchedule workouts={workoutsByWeek.get(week.weekIndex) ?? []} />
        )}
      />
    </View>
  );
}

function groupWorkouts(draft: ImportedPlanDraft): Map<number, DraftWorkout[]> {
  const grouped = new Map<number, DraftWorkout[]>();
  for (const workout of draft.workouts) {
    if (workout.type === 'rest') continue;
    const rows = grouped.get(workout.weekIndex) ?? [];
    rows.push(workout);
    grouped.set(workout.weekIndex, rows);
  }
  return grouped;
}

function blueprintFromDraft(
  draft: ImportedPlanDraft,
  workoutsByWeek: Map<number, DraftWorkout[]>,
): PlanBlueprintWeek[] {
  return buildPlanBlueprint(draft.weeks.map((week) => ({
    weekId: `outline-week-${week.weekIndex}`,
    weekIndex: week.weekIndex,
    weekStart: week.weekStart,
    phase: week.phase,
    isRecovery: week.isRecovery,
    targetMeters: week.targetMeters ?? 0,
    originalTargetMeters: week.originalTargetMeters,
    qualityTargetMeters: week.qualityTargetMeters,
    longTargetMeters: week.longTargetMeters,
    actualMeters: 0,
    isCurrent: false,
    isFuture: true,
    workouts: (workoutsByWeek.get(week.weekIndex) ?? []).map((workout, index) => ({
      id: `outline-${week.weekIndex}-${index}`,
      date: workout.date,
      type: workout.type,
      title: workout.title,
      plannedDistanceMeters: workout.plannedDistanceMeters,
      isQuality: workout.isQuality,
      structure: workout.structure,
      notes: workout.notes,
    })),
  })));
}

function DraftWeekSchedule({ workouts }: { workouts: DraftWorkout[] }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.schedule}>
      <Text style={styles.scheduleTitle}>Planned runs</Text>
      {workouts.length > 0
        ? workouts.map((workout, index) => (
          <DraftWorkoutRow key={`${workout.date}-${workout.title}-${index}`} workout={workout} />
        ))
        : <Text style={styles.scheduleEmpty}>No runs scheduled.</Text>}
    </View>
  );
}

function DraftWorkoutRow({ workout }: { workout: DraftWorkout }) {
  const C = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { preferences } = useAppPreferences();
  const units = preferences.distance;
  const tone = workoutTone({ type: workout.type, is_quality: workout.isQuality, structure: workout.structure });
  const dotColor = stripToneColor(C, tone) ?? C.mute;
  const isQuality = workout.isQuality || workout.type === 'race';
  // Intent WORD and pace BAND are split on purpose. The old single label
  // ("7:02/MI–7:18/MI · THRESHOLD") rendered as one chip that beat the
  // flex-basis-0 title in the space contest and compressed the workout NAME
  // to "T…" — on the plan PREVIEW, the screen a runner reads before
  // installing. The name wins the row now; the band is a quiet second line.
  const intent = workoutIntentLabel(workout.structure);
  const showIntent = intent != null && !workout.title.toLowerCase().includes(intent.toLowerCase());
  const paceBand = workoutPaceBandLabel(workout.structure, units);
  const distance = workout.plannedDistanceMeters && workout.plannedDistanceMeters > 0
    ? metersToUnits(workout.plannedDistanceMeters, units).toFixed(1)
    : null;

  return (
    <View style={styles.dayRow}>
      <Text style={styles.dayDate} numberOfLines={1}>{shortDay(workout.date)}</Text>
      <View style={[styles.dayDot, { backgroundColor: dotColor }]} />
      <View style={styles.dayMain}>
        <View style={styles.dayTitleRow}>
          <Text style={[styles.dayTitle, isQuality && styles.dayTitleQuality]} numberOfLines={1}>{workout.title}</Text>
          {showIntent ? <Chip label={intent} style={styles.intensityChip} /> : null}
        </View>
        {paceBand ? <Text style={styles.dayBand} numberOfLines={1}>{paceBand}</Text> : null}
      </View>
      {distance != null ? (
        <View style={styles.dayRight}>
          <Text style={styles.dayDistance}>{distance}</Text>
          <Text style={styles.dayUnit}>{units.toUpperCase()}</Text>
        </View>
      ) : null}
    </View>
  );
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function shortDay(date: string): string {
  const parsed = new Date(`${date}T12:00:00Z`);
  return `${WEEKDAYS[parsed.getUTCDay()]} ${Number(date.slice(8, 10))}`;
}

const makeStyles = (C: Tokens) => StyleSheet.create({
  // Parent review/detail screens already own a 16pt content inset. Cancel it
  // once so PlanBlueprint/PlanLedger can apply their canonical screen inset.
  bleed: { marginHorizontal: -space.lg },
  schedule: {
    ...hairlineTop(C),
    paddingHorizontal: space.lg,
    paddingBottom: space.md,
  },
  scheduleTitle: { paddingVertical: space.md, color: C.mute, fontSize: fontSizes.labelSm, fontWeight: '800' },
  scheduleEmpty: { paddingBottom: space.md, color: C.mute, fontSize: fontSizes.metadata, fontWeight: '600' },
  dayRow: {
    ...hairlineTop(C),
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
  },
  dayDate: { ...statValueText(C, 'labelSm', 'system'), width: 52, color: C.mute, lineHeight: 15, fontWeight: '600' },
  dayDot: { width: 7, height: 7, borderRadius: radius.pill },
  dayMain: { flex: 1, minWidth: 0 },
  dayTitleRow: { flexDirection: 'row', alignItems: 'center', minWidth: 0 },
  // flexShrink (not flex: 1): with basis auto the NAME keeps its content width
  // and the chip yields — the inversion of the old contest.
  dayTitle: { flexShrink: 1, minWidth: 0, color: C.ink, fontSize: fontSizes.labelLg, lineHeight: 19, fontWeight: '500', letterSpacing: -0.2 },
  dayBand: { ...statValueText(C, 'micro', 'system'), color: C.faint, marginTop: 1 },
  dayTitleQuality: { fontWeight: '700' },
  // Layout only — the pill's face comes from <Chip>'s neutral tone.
  intensityChip: { marginLeft: space.s, flexShrink: 0 },
  dayRight: { alignItems: 'flex-end' },
  dayDistance: { ...statValueText(C, 'body', 'system'), fontWeight: '700' },
  dayUnit: { ...eyebrowText(C, 'micro'), color: C.faint, marginTop: 1 },
});
