import { useCallback, useEffect, useMemo } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import * as FileSystem from 'expo-file-system/legacy';

import { useSession } from '@/app-lib/auth';
import { exportPlanToRelative, planDueFilename, usePlanById, type ActivePlan } from '@/app-lib/queries';
import {
  anchorPlan,
  derivePlanIdentity,
  normalizePlanDraft,
  normalizeRelativePlan,
  todayIsoDate,
  type ImportedPlanDraft,
} from '@/lib';
import { ErrorState } from '@/components/ErrorState';
import { PlanOutlineView } from '@/components/plan/PlanOutlineView';
import { PlanIdentityCard, type PlanIdentityState } from '@/components/plan/PlanIdentityCard';
import { RoundIconButton } from '@/components/RoundIconButton';
import { SheetHeader } from '@/components/SheetHeader';
import { useTheme, useThemedStyles } from '@/theme/ThemeProvider';
import { fontSizes, space, type Tokens } from '@/theme/tokens';
import { PoweredByStrava } from '@/components/StravaAttribution';

/**
 * Read-only plan detail — "what was my Boston block?". Renders a NON-ACTIVE
 * stored plan (archived or completed) as a planned-volume chart + week-by-week
 * outline, reusing the import-review vocabulary by exporting the stored rows
 * back into a draft. No editing, no actuals — just the prescription.
 *
 * The ACTIVE plan is not one of this screen's subjects: it already has a
 * window — the Plan tab, plus `week/[id]` beneath it — and rendering it here
 * too would be a second view of the same thing. Nothing in the app links here
 * for the active plan any more, but deep links do exist, so an active id is
 * redirected to the tab rather than rendered.
 */
export default function PlanDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { userId, ready } = useSession();
  const router = useRouter();
  const C = useTheme();
  const styles = useThemedStyles(makeStyles);

  const q = usePlanById(ready ? userId : null, id ?? null);
  const bundle = q.data ?? null;

  // One window per plan: the active plan's is the Plan tab. `dismissTo` leaves
  // the Plans modal task and lands there (falling back to a navigate when this
  // screen is the stack root, i.e. a cold deep link).
  const isActivePlan = bundle?.plan.status === 'active';
  useEffect(() => {
    if (isActivePlan) router.dismissTo('/plan');
  }, [isActivePlan, router]);

  // The stored plan, re-projected into the same normalized draft the importer
  // produces — so the chart + week outline share one derivation with install.
  const draft = useMemo<ImportedPlanDraft | null>(() => {
    if (!bundle) return null;
    // Re-derive dates by anchoring the relative export back at the plan's own
    // start Monday (falling back to today for pre-migration rows with no
    // start_date), then normalize as the importer does. The normalize/anchor
    // pair gates on a well-formed plan (numWeeks, ≥1 dated workout); an
    // ill-formed stored row renders as the empty state rather than crashing.
    try {
      const file = exportPlanToRelative(bundle.plan, bundle.weeks, bundle.workouts);
      const anchored = anchorPlan(
        normalizeRelativePlan(file),
        { kind: 'start', startDate: bundle.plan.start_date ?? todayIsoDate() },
        todayIsoDate(),
      );
      if (!anchored.ok) return null;
      return normalizePlanDraft(anchored.draft);
    } catch {
      return null;
    }
  }, [bundle]);

  const onExport = useCallback(async () => {
    if (!bundle) return;
    try {
      const file = exportPlanToRelative(bundle.plan, bundle.weeks, bundle.workouts);
      const name = planDueFilename(bundle.plan.race_name);
      const uri = `${FileSystem.cacheDirectory}${name}`;
      await FileSystem.writeAsStringAsync(uri, JSON.stringify(file, null, 2));
      await Share.share({ url: uri });
    } catch (err) {
      Alert.alert('Couldn’t export plan', err instanceof Error ? err.message : 'Try again.');
    }
  }, [bundle]);

  const identity = useMemo(() => bundle ? identityFromBundle(bundle) : null, [bundle]);

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        {/* The shared header. This was a local `navBar` with its own gutter
            (space.md — a THIRD value), a fontSize-16 centered title, and a
            hand-rolled 32x32 circle duplicating RoundIconButton. SheetHeader's
            `right` slot inserts the flex spacer, so the empty balancing view
            the old layout needed is gone with it. */}
        <SheetHeader
          navigation="back"
          navigationLabel="Back to plans"
          title="Plan"
          onClose={() => router.back()}
          right={bundle ? (
            <RoundIconButton
              icon="square.and.arrow.up"
              onPress={onExport}
              accessibilityLabel="Export plan as a .due file"
            />
          ) : undefined}
        />

        {q.error ? (
          <View style={styles.centered}>
            <ErrorState
              title="Couldn’t load this plan"
              message={q.error instanceof Error ? q.error.message : String(q.error)}
              onRetry={() => q.refetch()}
            />
          </View>
        ) : !ready || q.isLoading || isActivePlan ? (
          // `isActivePlan` holds the placeholder for the one frame between the
          // bundle resolving and the redirect above running, so the active
          // plan never paints a second dossier of itself.
          <View style={styles.centered}><ActivityIndicator color={C.mute} /></View>
        ) : !bundle ? (
          <View style={styles.centered}><Text style={styles.empty}>This plan couldn’t be found.</Text></View>
        ) : (
          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
            {identity ? (
              <PlanIdentityCard
                identity={identity}
                state={installedPlanState(bundle, identity.numWeeks)}
                style={styles.identityCard}
              />
            ) : null}
            {draft ? <PlanOutlineView draft={draft} showProfile={false} /> : null}
            <PoweredByStrava />
          </ScrollView>
        )}
      </SafeAreaView>
    </View>
  );
}

function identityFromBundle(bundle: ActivePlan) {
  const weekIndexById = new Map(bundle.weeks.map((week) => [week.id, week.week_index] as const));
  return derivePlanIdentity({
    name: bundle.plan.race_name ?? 'Training block',
    distanceKind: bundle.plan.distance_kind,
    numWeeks: bundle.plan.num_weeks,
    weeks: bundle.weeks.map((week) => ({
      weekIndex: week.week_index,
      phase: week.phase,
      targetMeters: week.target_meters,
      isRecovery: week.is_recovery,
    })),
    workouts: bundle.workouts.map((workout) => ({
      weekIndex: workout.week_id ? weekIndexById.get(workout.week_id) ?? null : null,
      type: workout.type,
      plannedDistanceMeters: workout.planned_distance_meters,
      isQuality: workout.is_quality,
      prescribedQualityMeters: workout.prescribed_quality_meters,
      structure: workout.structure,
    })),
  });
}

function installedPlanState(bundle: ActivePlan, numWeeks: number): PlanIdentityState | null {
  const currentWeekIndex = bundle.plan.status === 'active'
    ? planWeekAtDate(bundle.plan.start_date, todayIsoDate(), numWeeks)
    : null;
  const race = bundle.plan.race_date ? formatRaceDate(bundle.plan.race_date) : null;
  const parts = [currentWeekIndex != null ? `Week ${currentWeekIndex}` : null, race ? `Race ${race}` : null].filter(Boolean);
  if (parts.length === 0) return null;
  return { label: parts.join(' · '), currentWeekIndex };
}

function planWeekAtDate(startDate: string | null, isoDate: string, numWeeks: number): number | null {
  if (!startDate) return null;
  const start = Date.parse(`${startDate}T12:00:00Z`);
  const date = Date.parse(`${isoDate}T12:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(date)) return null;
  const week = Math.floor((date - start) / (7 * 86400 * 1000)) + 1;
  return week >= 1 && week <= numWeeks ? week : null;
}

function formatRaceDate(value: string): string {
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

const makeStyles = (C: Tokens) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: C.bg },
    safe: { flex: 1 },
    // Modal sheets sit below the status bar (top inset ≈ 0), so pad the bar
    // explicitly or the icons press against the sheet's top edge.
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
    empty: { fontSize: fontSizes.labelLg, fontWeight: '600', color: C.mute },
    scroll: { paddingHorizontal: space.lg, paddingTop: space.s, paddingBottom: space.xl * 2 },

    identityCard: { marginBottom: space.lg },
  });
