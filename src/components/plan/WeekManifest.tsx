import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SymbolView } from 'expo-symbols';

import { useAppPreferences, type DistancePreference } from '@/app-lib/preferences';
import type { PlanDay, UnplannedRun } from '@/app-lib/queries';
import { addDays, formatDurationApprox, metersToUnits, structureLines, workoutTone } from '@/lib';
import { stripToneColor } from '@/components/dash/DayTab';
import { hairlineBottom, hairlineTop } from '@/components/ui/Divider';
import { eyebrowText } from '@/components/ui/Eyebrow';
import { statValueText } from '@/components/ui/Stat';
import { useTheme, useThemedStyles } from '@/theme/ThemeProvider';
import { display, fontSizes, radius, space, type Tokens } from '@/theme/tokens';

type ManifestTone = 'easy' | 'quality' | 'long' | 'cross';

interface ManifestDay {
  date: string;
  planned: PlanDay[];
  unplanned: UnplannedRun[];
}

export function WeekManifest({
  weekStart,
  today,
  days,
  unplanned,
  showActual,
  onPressWorkout,
  onPressActivity,
}: {
  weekStart: string;
  today: string;
  days: PlanDay[];
  unplanned: UnplannedRun[];
  showActual: boolean;
  onPressWorkout: (workoutId: string) => void;
  onPressActivity: (activityId: string) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const manifest = buildManifest(weekStart, days, unplanned);

  return (
    <View style={styles.ledger} testID="week-manifest">
      {manifest.map((day) => (
        <ManifestDayRow
          key={day.date}
          day={day}
          today={today}
          showActual={showActual}
          onPressWorkout={onPressWorkout}
          onPressActivity={onPressActivity}
        />
      ))}
    </View>
  );
}

function ManifestDayRow({
  day,
  today,
  showActual,
  onPressWorkout,
  onPressActivity,
}: {
  day: ManifestDay;
  today: string;
  showActual: boolean;
  onPressWorkout: (workoutId: string) => void;
  onPressActivity: (activityId: string) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { fontScale } = useWindowDimensions();
  const accessible = fontScale >= 1.5;
  const plannedWorkouts = day.planned.filter((entry) => entry.workout.type?.toLowerCase() !== 'rest');
  const hasWorkouts = plannedWorkouts.length > 0 || day.unplanned.length > 0;
  const isToday = day.date === today;

  return (
    <View style={[styles.dayRow, accessible && styles.dayRowAccessible, isToday && styles.dayToday]} testID={`manifest-day-${day.date}`}>
      <View style={[styles.dateCol, accessible && styles.dateColAccessible]}>
        <Text style={[styles.dow, isToday && styles.dateToday]}>{weekday(day.date)}</Text>
        <Text style={[styles.dayNum, isToday && styles.dateToday]}>{Number(day.date.slice(8, 10))}</Text>
        {isToday ? <Text style={[styles.todayLabel, accessible && styles.todayLabelAccessible]}>TODAY</Text> : null}
      </View>

      <View style={styles.allocations}>
        {!hasWorkouts ? (
          <View style={styles.restRow} accessible accessibilityRole="text" accessibilityLabel={`${weekdayLong(day.date)}, rest day`}>
            <SymbolView name="pause.fill" size={10} tintColor={styles.restText.color} resizeMode="scaleAspectFit" />
          <Text style={styles.restText}>Rest</Text>
          </View>
        ) : null}

        {plannedWorkouts.map((entry) => (
          <PlannedAllocation
            key={entry.workout.id}
            day={entry}
            showActual={showActual}
            onPress={() => onPressWorkout(entry.workout.id)}
          />
        ))}

        {day.unplanned.map((run) => (
          <UnplannedAllocation key={run.activityId} run={run} onPress={() => onPressActivity(run.activityId)} />
        ))}
      </View>
    </View>
  );
}

function PlannedAllocation({ day, showActual, onPress }: { day: PlanDay; showActual: boolean; onPress: () => void }) {
  const C = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { fontScale } = useWindowDimensions();
  const accessible = fontScale >= 1.5;
  const { preferences } = useAppPreferences();
  const units = preferences.distance;
  const tone = manifestTone(day);
  const color = toneColor(C, tone);
  const prescription = prescriptionLine(day, units);
  const plannedDistance = metersToUnits(day.workout.planned_distance_meters ?? 0, units);
  const actualDistance = day.actual ? metersToUnits(day.actual.distanceMeters, units) : null;
  const value = tone === 'cross'
    ? durationValue(day.workout.planned_duration_s)
    : distanceValue({ plannedDistance, actualDistance, isPast: day.isPast, showActual, units });
  const type = tone === 'quality' ? 'Quality' : tone === 'long' ? 'Long run' : tone === 'cross' ? 'Cross training' : 'Easy';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${weekdayLong(day.workout.date ?? '')}, ${day.workout.title ?? type}, ${value.accessibility}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.allocation,
        tone === 'quality' && styles.qualityAllocation,
        tone === 'long' && styles.longAllocation,
        accessible && styles.allocationAccessible,
        pressed && styles.pressed,
      ]}
      testID={`manifest-workout-${day.workout.id}`}
    >
      <View style={[styles.typeIcon, { backgroundColor: tintHex(color, 0.13) }]}>
        <SymbolView name={toneIcon(tone)} size={12} tintColor={color} resizeMode="scaleAspectFit" />
      </View>

      <View style={styles.copy}>
        <Text style={styles.title} numberOfLines={accessible ? undefined : 1}>{day.workout.title ?? type}</Text>
        {prescription ? (
          <Text style={[styles.prescription, { color }]} numberOfLines={accessible ? undefined : 2}>
            {prescription}
          </Text>
        ) : null}
      </View>

      <View style={[styles.distance, accessible && styles.distanceAccessible]}>
        <Text style={[styles.distanceValue, value.dim && styles.distanceDim]} numberOfLines={1}>{value.text}</Text>
      </View>
      <SymbolView name="chevron.right" size={9} tintColor={C.mute} resizeMode="scaleAspectFit" />
    </Pressable>
  );
}

function UnplannedAllocation({ run, onPress }: { run: UnplannedRun; onPress: () => void }) {
  const C = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { fontScale } = useWindowDimensions();
  const accessible = fontScale >= 1.5;
  const { preferences } = useAppPreferences();
  const units = preferences.distance;
  const unitWord = units === 'mi' ? 'miles' : 'kilometers';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${run.name}, added run, ${formatMiles(metersToUnits(run.distanceMeters, units))} ${unitWord}`}
      onPress={onPress}
      style={({ pressed }) => [styles.allocation, styles.unplannedAllocation, accessible && styles.allocationAccessible, pressed && styles.pressed]}
      testID={`manifest-activity-${run.activityId}`}
    >
      <View style={[styles.typeIcon, styles.unplannedIcon]}>
        <SymbolView name="plus" size={12} tintColor={C.mute} weight="bold" resizeMode="scaleAspectFit" />
      </View>
      <View style={styles.copy}>
        <Text style={styles.unplannedTitle} numberOfLines={accessible ? undefined : 1}>{run.name}</Text>
        <Text style={styles.unplannedMeta}>Added run</Text>
      </View>
      <View style={[styles.distance, accessible && styles.distanceAccessible]}>
        <Text style={styles.distanceValue}>{formatMiles(metersToUnits(run.distanceMeters, units))}</Text>
      </View>
      <SymbolView name="chevron.right" size={9} tintColor={C.mute} resizeMode="scaleAspectFit" />
    </Pressable>
  );
}

function buildManifest(weekStart: string, days: PlanDay[], unplanned: UnplannedRun[]): ManifestDay[] {
  return Array.from({ length: 7 }, (_, index) => {
    const date = addDays(weekStart, index);
    return {
      date,
      planned: days
        .filter((day) => day.workout.date === date)
        .sort((a, b) => (a.workout.created_at ?? '').localeCompare(b.workout.created_at ?? '')),
      unplanned: unplanned
        .filter((run) => run.localDate === date)
        .sort((a, b) => (a.startDate ?? '').localeCompare(b.startDate ?? '')),
    };
  });
}

function manifestTone(day: PlanDay): ManifestTone {
  if (day.workout.type?.toLowerCase() === 'cross') return 'cross';
  const tone = workoutTone({
    type: day.workout.type,
    is_quality: day.workout.is_quality,
    structure: day.workout.structure ?? [],
  });
  if (tone === 'long') return 'long';
  if (tone === 'quality' || tone === 'speed') return 'quality';
  return 'easy';
}

function toneColor(C: Tokens, tone: ManifestTone): string {
  if (tone === 'quality') return C.qualText;
  if (tone === 'long') return C.cyanText;
  if (tone === 'cross') return C.mute;
  return stripToneColor(C, 'easy') ?? C.ink;
}

function toneIcon(tone: ManifestTone): 'bolt.fill' | 'mountain.2.fill' | 'figure.run' | 'dumbbell.fill' {
  if (tone === 'quality') return 'bolt.fill';
  if (tone === 'long') return 'mountain.2.fill';
  if (tone === 'cross') return 'dumbbell.fill';
  return 'figure.run';
}

function prescriptionLine(day: PlanDay, units: DistancePreference): string | null {
  const lines = structureLines(day.workout.structure ?? [], units);
  if (lines.length === 0) return null;
  const definingWork = lines.find((line) => line.strong && !/@ easy$/i.test(line.text));
  if (definingWork) return definingWork.text;
  const informative = lines.find((line) => (
    !/^(warm-up|cool-down)\b/i.test(line.text)
    && !/@ easy$/i.test(line.text)
  ));
  if (lines.length === 1 && informative == null) return null;
  return informative?.text ?? null;
}

function distanceValue({
  plannedDistance,
  actualDistance,
  isPast,
  showActual,
  units,
}: {
  plannedDistance: number;
  actualDistance: number | null;
  isPast: boolean;
  showActual: boolean;
  units: DistancePreference;
}): { text: string; accessibility: string; dim: boolean } {
  const unitWord = units === 'mi' ? 'miles' : 'kilometers';
  if (showActual && actualDistance != null) {
    return {
      text: `${formatMiles(actualDistance)} / ${formatMiles(plannedDistance)}`,
      accessibility: `${formatMiles(actualDistance)} actual of ${formatMiles(plannedDistance)} planned ${unitWord}`,
      dim: false,
    };
  }
  if (showActual && isPast) {
    return {
      text: `— / ${formatMiles(plannedDistance)}`,
      accessibility: `no distance banked of ${formatMiles(plannedDistance)} planned ${unitWord}`,
      dim: true,
    };
  }
  return {
    text: formatMiles(plannedDistance),
    accessibility: `${formatMiles(plannedDistance)} planned ${unitWord}`,
    dim: false,
  };
}

function durationValue(seconds: number | null): { text: string; accessibility: string; dim: boolean } {
  if (seconds == null || seconds <= 0) {
    return { text: '—', accessibility: 'duration not set', dim: true };
  }
  const minutes = Math.round(seconds / 60);
  return {
    text: formatDurationApprox(seconds).replace(/^~/, ''),
    accessibility: `${minutes} planned minutes`,
    dim: false,
  };
}

function weekday(date: string): string {
  if (!date) return '—';
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }).toUpperCase();
}

function weekdayLong(date: string): string {
  if (!date) return 'day';
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
}

function formatMiles(value: number): string {
  const nearestWhole = Math.round(value);
  return Math.abs(value - nearestWhole) < 0.05 ? `${nearestWhole}` : value.toFixed(1);
}

function tintHex(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(value)) return hex;
  const number = Number.parseInt(value, 16);
  return `rgba(${(number >> 16) & 255}, ${(number >> 8) & 255}, ${number & 255}, ${alpha})`;
}

const makeStyles = (C: Tokens) =>
  StyleSheet.create({
    ledger: hairlineTop(C),
    dayRow: {
      ...hairlineBottom(C),
      minHeight: 58,
      flexDirection: 'row',
      paddingLeft: space.lg,
    },
    dayToday: { backgroundColor: C.fill },
    dayRowAccessible: { flexDirection: 'column', paddingLeft: 0 },
    dateCol: { width: 48, paddingTop: space.md, paddingRight: space.sm },
    dateColAccessible: { width: '100%', minHeight: 48, flexDirection: 'row', alignItems: 'baseline', gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.sm },
    dow: eyebrowText(C, 'micro'),
    dayNum: { marginTop: 1, color: C.ink, fontFamily: display, fontSize: 20, lineHeight: 22, fontVariant: ['tabular-nums'] },
    dateToday: { color: C.yellowText },
    todayLabel: { ...eyebrowText(C, 'micro'), color: C.yellowText, marginTop: space.xxs },
    todayLabelAccessible: { marginTop: 0 },
    allocations: { flex: 1, minWidth: 0 },
    restRow: { minHeight: 57, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingRight: space.lg },
    restText: { color: C.mute, fontSize: fontSizes.label, fontWeight: '700' },
    allocation: {
      ...hairlineTop(C),
      minHeight: 57,
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
      paddingVertical: space.sm,
      paddingLeft: space.sm,
      paddingRight: space.lg,
    },
    allocationAccessible: { minHeight: 0, flexDirection: 'column', alignItems: 'stretch', paddingVertical: space.lg },
    qualityAllocation: { backgroundColor: tintHex(C.qual, 0.045) },
    longAllocation: { backgroundColor: tintHex(C.cyan, 0.04) },
    unplannedAllocation: { backgroundColor: C.fill },
    typeIcon: { width: 28, height: 28, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
    unplannedIcon: { backgroundColor: C.fill },
    copy: { flex: 1, minWidth: 0 },
    title: { color: C.ink, fontSize: fontSizes.label, fontWeight: '800', letterSpacing: -0.15 },
    prescription: { marginTop: space.xxs, fontSize: fontSizes.micro, lineHeight: 14, fontWeight: '700' },
    unplannedTitle: { color: C.mute, fontSize: fontSizes.label, fontWeight: '700' },
    unplannedMeta: { marginTop: space.xxs, color: C.mute, fontSize: fontSizes.micro, fontWeight: '700' },
    distance: { minWidth: 58, alignItems: 'flex-end' },
    distanceAccessible: { width: '100%', minWidth: 0, marginLeft: 0, alignItems: 'flex-start' },
    distanceValue: { ...statValueText(C, 'label', 'system'), fontWeight: '900' },
    distanceDim: { color: C.mute },
    pressed: { opacity: 0.58 },
  });
