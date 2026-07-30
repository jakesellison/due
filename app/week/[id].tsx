/**
 * Week manifest — a temporary inspection sheet opened from Plan.
 *
 * Plan owns the block architecture, this sheet owns the complete seven-day
 * prescription, and Reshape owns editing. The same content sits in both native
 * detents: the compact height is a quick read; dragging taller gives long
 * prescriptions and doubles more room without changing interaction models.
 */
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';

import { useSession } from '@/app-lib/auth';
import { closeScreen } from '@/app-lib/nav';
import { useAppPreferences, type DistancePreference } from '@/app-lib/preferences';
import { invalidatePlanActivityCaches, useWeek } from '@/app-lib/queries';
import { addDays, blueprintAllocationGaps, buildPlanBlueprint, metersToUnits, type PlanBlueprintWeek } from '@/lib';
import { ErrorState } from '@/components/ErrorState';
import { PoweredByStrava } from '@/components/StravaAttribution';
import { SheetHeader } from '@/components/SheetHeader';
import { WeekManifest } from '@/components/plan/WeekManifest';
import { hairlineBottom, hairlineTop } from '@/components/ui/Divider';
import { eyebrowText } from '@/components/ui/Eyebrow';
import { statValueText } from '@/components/ui/Stat';
import { useTheme, useThemedStyles } from '@/theme/ThemeProvider';
import { display, fontSizes, radius, space, type Tokens } from '@/theme/tokens';

export default function WeekDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const styles = useThemedStyles(makeStyles);
  const C = useTheme();
  const { userId, ready } = useSession();
  const { preferences } = useAppPreferences();
  const units = preferences.distance;
  const weekIndex = id != null ? Number(id) : null;
  const detail = useWeek(ready ? userId : null, Number.isFinite(weekIndex) ? weekIndex : null);
  const queryClient = useQueryClient();

  const retry = () => {
    void invalidatePlanActivityCaches(queryClient);
  };

  if (detail.error) {
    return (
      <SafeAreaView style={styles.root} edges={['bottom']}>
        <SheetHeader onClose={() => closeScreen(router)} title="Week unavailable" style={styles.sheetHeader} />
        <View style={styles.centered}>
          <ErrorState title="Couldn’t load this week" message={detail.error.message} onRetry={retry} />
        </View>
      </SafeAreaView>
    );
  }

  if (!ready || detail.loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={C.mute} />
      </View>
    );
  }

  if (!detail.bar || detail.weekIndex == null || !detail.weekStart) {
    return (
      <SafeAreaView style={styles.root} edges={['bottom']}>
        <SheetHeader onClose={() => closeScreen(router)} title="Week unavailable" style={styles.sheetHeader} />
        <View style={styles.centered}>
          <Text style={styles.errorTitle}>Week not found</Text>
          <Text style={styles.errorBody}>This contract is no longer part of the active plan.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const bar = detail.bar;
  const canEdit = bar.isCurrent || bar.isFuture;
  const editLabel = 'Adjust';
  const allDays = detail.editableDays?.length ? detail.editableDays : detail.days;
  const runDays = new Set(
    allDays
      .filter((day) => {
        const type = day.workout.type?.toLowerCase();
        return type !== 'rest' && type !== 'cross' && day.workout.date;
      })
      .map((day) => day.workout.date as string),
  ).size;
  const allocationWeek = buildPlanBlueprint([{
    weekId: detail.weekId ?? `week-${detail.weekIndex}`,
    weekIndex: detail.weekIndex,
    weekStart: detail.weekStart,
    phase: detail.phase ?? 'base',
    isRecovery: detail.isRecovery,
    targetMeters: bar.targetMeters,
    originalTargetMeters: detail.originalTargetMeters ?? null,
    qualityTargetMeters: detail.qualityTargetMeters ?? null,
    longTargetMeters: detail.longTargetMeters ?? null,
    actualMeters: bar.actualMeters,
    isCurrent: bar.isCurrent,
    isFuture: bar.isFuture,
    workouts: allDays.map((day) => ({
      id: day.workout.id,
      date: day.workout.date,
      type: day.workout.type,
      title: day.workout.title,
      plannedDistanceMeters: day.workout.planned_distance_meters,
      actualDistanceMeters: day.actual?.distanceMeters ?? null,
      isPast: day.isPast,
      isQuality: day.workout.is_quality,
      structure: day.workout.structure,
      prescribedQualityMeters: day.workout.prescribed_quality_meters ?? null,
      notes: day.workout.notes,
    })),
  }])[0] ?? null;

  return (
    <SafeAreaView style={styles.root} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="automatic"
        stickyHeaderIndices={[0]}
      >
        <SheetHeader
          onClose={() => closeScreen(router)}
          context={`${formatWeekRange(detail.weekStart)} · ${phaseLabel(detail.phase ?? 'base', detail.isRecovery)}`}
          title={`Week ${detail.weekIndex}`}
          style={styles.sheetHeader}
          right={canEdit ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Adjust week ${detail.weekIndex}`}
              onPress={() => router.replace({ pathname: '/planner/[id]', params: { id: String(detail.weekIndex) } })}
              style={({ pressed }) => [styles.editAction, pressed && styles.pressed]}
            >
              <SymbolView name="pencil" size={12} tintColor={C.yellowText} weight="bold" resizeMode="scaleAspectFit" />
              <Text style={styles.editActionText}>{editLabel}</Text>
            </Pressable>
          ) : undefined}
        />

        <ContractBand
          targetDistance={metersToUnits(bar.targetMeters, units)}
          actualDistance={metersToUnits(bar.actualMeters, units)}
          runDays={runDays}
          isCurrent={bar.isCurrent}
          isFuture={bar.isFuture}
          originalTargetDistance={detail.originalTargetMeters == null ? null : metersToUnits(detail.originalTargetMeters, units)}
          units={units}
        />

        {canEdit && allocationWeek ? <AllocationNotice week={allocationWeek} units={units} /> : null}

        <View style={styles.manifestHead}>
          <Text style={styles.manifestTitle}>Week allocation</Text>
          <Text style={styles.manifestLegend}>{bar.isFuture ? 'Plan' : 'Actual / plan'}</Text>
        </View>

        {allDays.some((day) => day.workout.type !== 'rest') || detail.unplanned.length > 0 ? (
          <WeekManifest
            weekStart={detail.weekStart}
            today={detail.today}
            days={allDays}
            unplanned={detail.unplanned}
            showActual={!bar.isFuture}
            onPressWorkout={(workoutId) => router.push({ pathname: '/workout/[id]', params: { id: workoutId } })}
            onPressActivity={(activityId) => router.push({ pathname: '/run/[id]', params: { id: activityId } })}
          />
        ) : (
          <View style={styles.empty}>
            <SymbolView name="calendar.badge.plus" size={20} tintColor={C.faint} resizeMode="scaleAspectFit" />
            <View style={styles.emptyCopy}>
              <Text style={styles.emptyTitle}>No workouts allocated yet</Text>
              <Text style={styles.emptyBody}>This mileage contract is ready for workouts.</Text>
            </View>
          </View>
        )}

        <PoweredByStrava />
      </ScrollView>
    </SafeAreaView>
  );
}

function AllocationNotice({ week, units }: { week: PlanBlueprintWeek; units: DistancePreference }) {
  const styles = useThemedStyles(makeStyles);
  const unitWord = units === 'mi' ? 'miles' : 'kilometers';
  const gaps = blueprintAllocationGaps(week);
  const threshold = 0.05 * 1609.344;
  const overMeters = week.allocationDeltaMeters < -threshold ? Math.abs(week.allocationDeltaMeters) : 0;
  if (gaps.length === 0 && overMeters === 0) return null;
  const detail = gaps.length > 0
    ? `${overMeters > 0 ? `${formatMiles(metersToUnits(overMeters, units))} ${units} over · ` : ''}${gaps.map((gap) => `${formatMiles(metersToUnits(gap.meters, units))} ${units} ${gap.shortLabel}`).join(' · ')} open`
    : `${formatMiles(metersToUnits(overMeters, units))} ${units} over contract`;
  return (
    <View
      style={styles.allocationNotice}
      accessible
      accessibilityRole="alert"
      accessibilityLabel={gaps.length > 0
        ? `Allocation gap. ${overMeters > 0 ? `${formatMiles(metersToUnits(overMeters, units))} ${unitWord} over the weekly contract. ` : ''}${gaps.map((gap) => `${formatMiles(metersToUnits(gap.meters, units))} ${unitWord} ${gap.label}`).join(', ')} still open.`
        : `Allocation is ${formatMiles(metersToUnits(overMeters, units))} ${unitWord} over the weekly contract.`}
    >
      <View style={styles.allocationNoticeDot} />
      <Text style={styles.allocationNoticeText}>
        <Text style={styles.allocationNoticeLead}>{gaps.length > 0 ? 'Allocation gap · ' : 'Allocation · '}</Text>
        {detail}
      </Text>
    </View>
  );
}

function ContractBand({
  targetDistance,
  actualDistance,
  runDays,
  isCurrent,
  isFuture,
  originalTargetDistance,
  units,
}: {
  targetDistance: number;
  actualDistance: number;
  runDays: number;
  isCurrent: boolean;
  isFuture: boolean;
  originalTargetDistance: number | null;
  units: DistancePreference;
}) {
  const styles = useThemedStyles(makeStyles);
  const revised = originalTargetDistance != null && Math.round(originalTargetDistance) !== Math.round(targetDistance);
  return (
    <View
      style={styles.contractBand}
      accessible
      accessibilityRole="summary"
      accessibilityLabel={contractAccessibility(targetDistance, actualDistance, runDays, isCurrent, isFuture, units)}
      testID="week-contract-band"
    >
      <View>
        <Text style={styles.contractLabel}>WEEKLY CONTRACT</Text>
        <View style={styles.contractValueRow}>
          <Text style={styles.contractValue}>{formatMiles(targetDistance)}</Text>
          <Text style={styles.contractUnit}>{units.toUpperCase()}</Text>
        </View>
        {revised ? <Text style={styles.revised}>{`Imported at ${formatMiles(originalTargetDistance!)} ${units}`}</Text> : null}
      </View>
      <View style={styles.contractState}>
        {isFuture ? (
          <>
            <Text style={styles.stateValue}>{runDays}</Text>
            <Text style={styles.stateLabel}>{runDays === 1 ? 'RUN DAY' : 'RUN DAYS'}</Text>
            <Text style={styles.stateDetail}>allocated</Text>
          </>
        ) : (
          <>
            <Text style={styles.stateValue}>{formatMiles(actualDistance)}</Text>
            <Text style={styles.stateLabel}>{units.toUpperCase()} BANKED</Text>
            <Text style={styles.stateDetail}>{contractDelta(targetDistance, actualDistance, isCurrent)}</Text>
          </>
        )}
      </View>
    </View>
  );
}

function contractDelta(targetMi: number, actualMi: number, isCurrent: boolean): string {
  const delta = actualMi - targetMi;
  if (isCurrent) return `${formatMiles(Math.max(0, -delta))} still open`;
  if (delta > 0) return `${formatMiles(delta)} beyond contract`;
  if (delta < 0) return `${formatMiles(Math.abs(delta))} unbanked`;
  return 'contract matched';
}

function contractAccessibility(target: number, actual: number, runDays: number, isCurrent: boolean, isFuture: boolean, units: DistancePreference): string {
  const unitWord = units === 'mi' ? 'mile' : 'kilometer';
  if (isFuture) return `${formatMiles(target)} ${unitWord} weekly contract, allocated across ${runDays} run days`;
  return `${formatMiles(target)} ${unitWord} weekly contract, ${formatMiles(actual)} ${unitWord}s banked, ${contractDelta(target, actual, isCurrent)}`;
}

function formatWeekRange(weekStart: string): string {
  const end = addDays(weekStart, 6);
  const startDate = new Date(`${weekStart}T12:00:00Z`);
  const endDate = new Date(`${end}T12:00:00Z`);
  const start = startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const endLabel = endDate.toLocaleDateString('en-US', {
    month: startDate.getUTCMonth() === endDate.getUTCMonth() ? undefined : 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
  return `${start}–${endLabel}`;
}

function phaseLabel(phase: string, isRecovery: boolean): string {
  if (isRecovery) return 'Recovery';
  return phase.charAt(0).toUpperCase() + phase.slice(1);
}

function formatMiles(value: number): string {
  const nearestWhole = Math.round(value);
  return Math.abs(value - nearestWhole) < 0.05 ? `${nearestWhole}` : value.toFixed(1);
}

const makeStyles = (C: Tokens) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: C.bg },
    scroll: { paddingBottom: space.xxl },
    sheetHeader: { paddingTop: space.lg, backgroundColor: C.bg },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, backgroundColor: C.bg },
    editAction: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: space.s, paddingHorizontal: space.sm, borderRadius: radius.md },
    editActionText: { color: C.yellowText, fontSize: fontSizes.label, fontWeight: '900' },
    pressed: { opacity: 0.58 },
    contractBand: {
      minHeight: 98,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: space.lg,
      paddingHorizontal: space.lg,
      paddingVertical: space.lg,
      backgroundColor: C.recess,
      ...hairlineTop(C),
      ...hairlineBottom(C),
    },
    allocationNotice: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.sm, ...hairlineBottom(C), backgroundColor: C.fill },
    allocationNoticeDot: { width: 7, height: 7, borderRadius: radius.pill, backgroundColor: C.warningText },
    allocationNoticeText: { flex: 1, minWidth: 0, color: C.warningText, fontSize: fontSizes.labelSm, lineHeight: 16, fontWeight: '700' },
    allocationNoticeLead: { fontWeight: '900' },
    // The contract band's keys keep their heavier weight and wider tracking than
    // the canonical eyebrow: this is the sheet's masthead, and it is set against
    // a 32pt display numeral rather than body copy.
    contractLabel: { ...eyebrowText(C, 'micro'), },
    contractValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.s, marginTop: space.xs },
    contractValue: { color: C.ink, fontFamily: display, fontSize: 32, lineHeight: 34, letterSpacing: -0.8, fontVariant: ['tabular-nums'] },
    contractUnit: { ...eyebrowText(C, 'labelSm'), },
    revised: { ...statValueText(C, 'micro', 'system'), marginTop: space.xxs, color: C.faint, fontWeight: '700' },
    contractState: { alignItems: 'flex-end' },
    stateValue: { color: C.ink, fontFamily: display, fontSize: 20, lineHeight: 22, fontVariant: ['tabular-nums'] },
    stateLabel: { ...eyebrowText(C, 'micro'), marginTop: space.xxs },
    stateDetail: { ...statValueText(C, 'micro', 'system'), marginTop: space.xxs, color: C.faint, fontWeight: '700' },
    manifestHead: {
      minHeight: 56,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: space.lg,
      paddingHorizontal: space.lg,
      paddingTop: space.lg,
      paddingBottom: space.md,
    },
    manifestTitle: { color: C.ink, fontSize: fontSizes.sectionTitle, fontWeight: '900', letterSpacing: -0.25 },
    manifestLegend: { color: C.faint, fontSize: fontSizes.micro, fontWeight: '800', paddingBottom: 1 },
    empty: { minHeight: 116, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, ...hairlineTop(C), ...hairlineBottom(C) },
    emptyCopy: { flex: 1 },
    emptyTitle: { color: C.ink, fontSize: fontSizes.labelLg, fontWeight: '800' },
    emptyBody: { marginTop: space.xs, color: C.mute, fontSize: fontSizes.metadata, lineHeight: 17, fontWeight: '600' },
    errorTitle: { color: C.ink, fontSize: fontSizes.sectionTitle, fontWeight: '800', marginBottom: space.sm },
    errorBody: { color: C.mute, fontSize: fontSizes.label, lineHeight: 20, textAlign: 'center' },
  });
