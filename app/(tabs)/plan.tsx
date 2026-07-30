import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useQueryClient } from '@tanstack/react-query';

import { useSession } from '@/app-lib/auth';
import { showChoiceSheet } from '@/app-lib/choiceSheet';
import { exportPlanDue, promptRenamePlan } from '@/app-lib/planLibraryActions';
import { invalidatePlanActivityCaches, planHeaderInfo, useMyPlans, usePlanChangeLog, usePlanView, useWeeklyMileage } from '@/app-lib/queries';
import {
  buildPlanBlueprint,
  planDistanceLabel,
  type PlanBlueprintWeek,
} from '@/lib';
import { Screen } from '@/components/Screen';
import { ErrorState } from '@/components/ErrorState';
import { ActionButton, ActionButtonLabel } from '@/components/ActionButton';
import { PlanBlueprint } from '@/components/plan/PlanBlueprint';
import { PlanLedger } from '@/components/plan/PlanLedger';
import { PlanOverviewContext } from '@/components/plan/PlanOverviewContext';
import { PlanTabSkeleton, TabHeaderActionSkeleton } from '@/components/loading/TabSkeletons';
import { hairlineBottom, hairlineTop } from '@/components/ui/Divider';
import { TAB_BAR_INSET } from '@/components/GlassTabBar';
import { useTheme, useThemedStyles } from '@/theme/ThemeProvider';
import { display, fontSizes, radius, space, type Tokens } from '@/theme/tokens';

/**
 * Plan is the runner's training blueprint: race context, the complete weekly
 * mileage shape, then phase-owned week strategy. Execution lives on Week;
 * durable plans and runner setup live on You. This surface owns the active
 * contract and makes the route from plan intent to week-level allocation clear.
 */
export default function PlanScreen() {
  const { userId, ready } = useSession();
  const view = usePlanView(ready ? userId : null);
  const weekly = useWeeklyMileage(ready ? userId : null);
  const changeLog = usePlanChangeLog(ready ? userId : null, view.plan?.id ?? null);
  const myPlans = useMyPlans(ready ? userId : null);
  const router = useRouter();
  const { week: requestedWeek } = useLocalSearchParams<{ week?: string }>();
  const queryClient = useQueryClient();
  const C = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { fontScale } = useWindowDimensions();
  const usesAccessibilityLayout = fontScale >= 1.6;
  const scrollRef = useRef<ScrollView | null>(null);

  const [refreshing, setRefreshing] = useState(false);
  const [selectedWeekIndex, setSelectedWeekIndex] = useState<number | null>(null);

  const requestedWeekIndex = useMemo(() => {
    if (requestedWeek == null) return null;
    const parsed = Number(requestedWeek);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }, [requestedWeek]);

  const blueprint = useMemo(
    () =>
      buildPlanBlueprint(
        view.sections.map((section) => ({
          weekId: section.weekId,
          weekIndex: section.weekIndex,
          weekStart: section.weekStart,
          phase: section.bar?.phase ?? 'base',
          isRecovery: section.bar?.isRecovery ?? false,
          targetMeters: section.bar?.targetMeters ?? 0,
          originalTargetMeters: section.originalTargetMeters ?? null,
          qualityTargetMeters: section.qualityTargetMeters ?? null,
          longTargetMeters: section.longTargetMeters ?? null,
          actualMeters: section.bar?.actualMeters ?? 0,
          isCurrent: section.bar?.isCurrent ?? false,
          isFuture: section.bar?.isFuture ?? false,
          workouts: (section.editableDays ?? section.days).map((day) => ({
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
        })),
      ),
    [view.sections],
  );
  useEffect(() => {
    if (blueprint.length === 0) {
      setSelectedWeekIndex(null);
      return;
    }
    if (requestedWeekIndex != null && blueprint.some((week) => week.weekIndex === requestedWeekIndex)) {
      setSelectedWeekIndex(requestedWeekIndex);
      return;
    }
    setSelectedWeekIndex((current) => {
      if (current != null && blueprint.some((week) => week.weekIndex === current)) return current;
      return blueprint.find((week) => week.isCurrent)?.weekIndex ?? blueprint.find((week) => week.state === 'future')?.weekIndex ?? blueprint[blueprint.length - 1]!.weekIndex;
    });
  }, [blueprint, requestedWeekIndex]);

  useEffect(() => {
    if (requestedWeekIndex == null || selectedWeekIndex !== requestedWeekIndex) return;
    const reveal = () => {
      scrollRef.current?.scrollTo({ y: 0, animated: true });
      router.setParams({ week: undefined });
    };
    if (typeof requestAnimationFrame !== 'function') {
      reveal();
      return;
    }
    const frame = requestAnimationFrame(reveal);
    return () => cancelAnimationFrame(frame);
  }, [requestedWeekIndex, router, selectedWeekIndex]);

  const selectedWeek = blueprint.find((week) => week.weekIndex === selectedWeekIndex) ?? blueprint[0] ?? null;
  const currentWeek = blueprint.find((week) => week.isCurrent) ?? null;
  const baseHeader = planHeaderInfo(view.plan, null, view.today);
  const header = {
    ...baseHeader,
    weekN: currentWeek?.weekIndex ?? null,
    numWeeks: (view.plan?.num_weeks ?? blueprint.length) || null,
    phaseLabel: currentWeek ? phaseLabel(currentWeek) : null,
  };

  const activePlanId = view.plan?.id ?? myPlans.data?.find((plan) => plan.status === 'active')?.id ?? null;
  const activeLibraryPlan = myPlans.data?.find((plan) => plan.id === activePlanId) ?? null;

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await invalidatePlanActivityCaches(queryClient);
    } finally {
      setRefreshing(false);
    }
  }, [queryClient]);

  const openActiveMenu = useCallback(() => {
    // Dispatch on the KEY, not the visible label — renaming a menu item used to
    // silently disconnect its action.
    showChoiceSheet({
      title: header.raceName,
      options: [
        { key: 'history' as const, label: 'Plan history' },
        { key: 'export' as const, label: 'Export .due' },
        { key: 'rename' as const, label: 'Rename' },
      ],
      onPick: (key) => {
        if (key === 'history' && activePlanId) {
          router.push({ pathname: '/plan/history', params: { planId: activePlanId } });
        } else if (key === 'export' && activePlanId) {
          void exportPlanDue(activePlanId, header.raceName);
        } else if (key === 'rename' && activeLibraryPlan) {
          promptRenamePlan(activeLibraryPlan, queryClient);
        }
      },
    });
  }, [activeLibraryPlan, activePlanId, header.raceName, queryClient, router]);

  if (view.error) {
    return (
      <Screen title="Plan">
        <View style={styles.centered}>
          <ErrorState title="Couldn’t load your plan" message={view.error.message} onRetry={onRefresh} />
        </View>
      </Screen>
    );
  }

  if (!ready || view.loading) {
    return (
      <Screen
        title="Plan"
        headerDivider
        headerRight={<TabHeaderActionSkeleton accessibilityLabel="Loading plan actions" />}
      >
        <PlanTabSkeleton />
      </Screen>
    );
  }

  if (!view.plan || view.sections.length === 0) {
    return (
      <Screen title="Plan">
        <View style={styles.centered}>
          <Text style={styles.emptyTitle}>Establish your weekly contracts</Text>
          <Text style={styles.emptyBody}>Import a plan to see the complete training shape and make each future week your own.</Text>
          <ActionButton color={C.yellow} accessibilityLabel="Import plan" onPress={() => router.push('/plans/install')} variant="commit" style={styles.emptyButtonOuter}>
            <ActionButtonLabel>Import plan</ActionButtonLabel>
          </ActionButton>
        </View>
      </Screen>
    );
  }

  return (
    <PlanShell
      headerRight={
        <View style={styles.headerRight}>
          <Pressable accessibilityRole="button" accessibilityLabel="Plan options" onPress={openActiveMenu} style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}>
            <SymbolView name="ellipsis" size={18} tintColor={C.ink} weight="bold" resizeMode="scaleAspectFit" />
          </Pressable>
        </View>
      }
    >
      <ScrollView ref={scrollRef} style={styles.scrollView} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.mute} />}>
        <PlanContext plan={view.plan} header={header} currentWeek={currentWeek} />

        {selectedWeek ? (
          <View>
            <PlanBlueprint
              weeks={blueprint}
              selectedWeekIndex={selectedWeek.weekIndex}
              onSelectWeek={setSelectedWeekIndex}
              progress={weekly.weekGoals.length > 0 ? { weekGoals: weekly.weekGoals } : null}
            />
          </View>
        ) : null}

        <PlanLedger
          weeks={blueprint}
          selectedWeekIndex={selectedWeek?.weekIndex ?? -1}
          onSelectWeek={setSelectedWeekIndex}
          onAdjustWeek={(weekIndex) =>
            router.push({
              pathname: '/planner/[id]',
              params: { id: String(weekIndex) },
            })
          }
          onOpenWeek={(weekIndex) =>
            router.push({
              pathname: '/week/[id]',
              params: { id: String(weekIndex) },
            })
          }
        />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open plan history"
          onPress={() =>
            router.push({
              pathname: '/plan/history',
              params: { planId: view.plan!.id },
            })
          }
          style={({ pressed }) => [styles.historyRow, usesAccessibilityLayout && styles.historyRowAccessible, pressed && styles.pressed]}
        >
          <SymbolView name="clock.arrow.circlepath" size={14} tintColor={C.mute} resizeMode="scaleAspectFit" />
          <View style={styles.historyCopy}>
            <Text style={[styles.historyTitle, usesAccessibilityLayout && styles.historyTitleAccessible]}>Plan history</Text>
            <Text style={[styles.historyMeta, usesAccessibilityLayout && styles.historyMetaAccessible]}>{changeLog.events.length > 0 ? `${changeLog.events.length} recorded ${changeLog.events.length === 1 ? 'revision' : 'revisions'}` : 'Imported intent and deliberate changes'}</Text>
          </View>
          <View style={styles.historyChevron}>
            <SymbolView name="chevron.right" size={12} tintColor={C.mute} resizeMode="scaleAspectFit" />
          </View>
        </Pressable>
      </ScrollView>
    </PlanShell>
  );
}

function PlanShell({ headerRight, children }: { headerRight: ReactNode; children: ReactNode }) {
  return (
    <Screen title="Plan" headerRight={headerRight} headerDivider>
      {children}
    </Screen>
  );
}

function PlanContext({ plan, header, currentWeek }: { plan: NonNullable<ReturnType<typeof usePlanView>['plan']>; header: ReturnType<typeof planHeaderInfo>; currentWeek: PlanBlueprintWeek | null }) {
  const distance = planDistanceLabel(plan.distance_kind);
  const raceDate = plan.race_date ? dateLabel(plan.race_date) : 'Date open';
  const countdown = countdownLabel(header.daysToRace);
  const position = currentWeek ? `Week ${currentWeek.weekIndex} of ${header.numWeeks ?? '—'} · ${phaseLabel(currentWeek)}` : `${header.numWeeks ?? '—'} weeks`;
  return (
    <PlanOverviewContext
      name={header.raceName}
      goalTime={header.goalTime ? `Goal ${header.goalTime}` : null}
      primaryFacts={`${distance} · ${raceDate}${countdown ? ` · ${countdown}` : ''}`}
      secondaryFacts={position}
    />
  );
}

function countdownLabel(days: number | null): string | null {
  if (days == null) return null;
  if (days === 0) return 'Race day';
  if (days < 0) return 'Complete';
  return `${days} days to race`;
}

function dateLabel(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function phaseLabel(week: PlanBlueprintWeek): string {
  if (week.isRecovery) return 'Recovery';
  return `${week.phase.charAt(0).toUpperCase()}${week.phase.slice(1)}`;
}

const makeStyles = (C: Tokens) =>
  StyleSheet.create({
    scroll: { paddingTop: space.sm, paddingBottom: TAB_BAR_INSET },
    scrollView: { flex: 1, zIndex: 0 },
    centered: {
      flex: 1,
      minHeight: 360,
      alignItems: 'center',
      justifyContent: 'center',
      padding: space.xl,
    },
    headerRight: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: space.sm,
    },
    headerButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pressed: { opacity: 0.58 },

    historyRow: {
      minHeight: 64,
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.md,
      marginHorizontal: space.lg,
      marginBottom: space.lg,
      paddingVertical: space.sm,
      // Ruled on BOTH edges: the history teaser is the scroll's last block, so
      // it needs a closing rule as well as the one separating it from the ledger.
      ...hairlineTop(C),
      ...hairlineBottom(C),
    },
    historyRowAccessible: {
      minHeight: 0,
      alignItems: 'stretch',
      paddingVertical: space.md,
    },
    historyCopy: { flex: 1, minWidth: 0 },
    historyTitle: { color: C.ink, fontSize: fontSizes.label, fontWeight: '800' },
    historyTitleAccessible: { fontSize: fontSizes.label },
    historyMeta: {
      marginTop: space.xxs,
      color: C.mute,
      fontSize: fontSizes.labelSm,
      fontWeight: '700',
    },
    historyMetaAccessible: { fontSize: fontSizes.labelSm },
    historyChevron: {
      width: 44,
      flexShrink: 0,
      alignSelf: 'stretch',
      alignItems: 'center',
      justifyContent: 'center',
    },

    emptyTitle: {
      color: C.ink,
      fontSize: 20,
      fontWeight: '800',
      textAlign: 'center',
    },
    emptyBody: {
      maxWidth: 310,
      marginTop: space.sm,
      color: C.mute,
      fontSize: fontSizes.labelLg,
      lineHeight: 20,
      fontWeight: '600',
      textAlign: 'center',
    },
    emptyButtonOuter: { marginTop: space.xl },
  });
