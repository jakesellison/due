import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useQueryClient } from '@tanstack/react-query';

import { useSession } from '@/app-lib/auth';
import { useAppPreferences, type DistancePreference } from '@/app-lib/preferences';
import { usePlanLibraryActions } from '@/app-lib/planLibraryActions';
import {
  usePlanIdentitySources,
  useMyPlans,
  useRecentWeeklyMiles,
  type MyPlan,
} from '@/app-lib/queries';
import { derivePlanIdentity, metersToUnits, todayIsoDate, type PlanIdentity, type RelativePlan } from '@/lib';
import { STARTER_CATALOG } from '@/lib/plan/starter/catalog';
import { suggestTier, type StarterTier } from '@/lib/plan/starter/suggestTier';
import { SheetHeader } from '@/components/SheetHeader';
import { PlanArtwork } from '@/components/plan/PlanArtwork';
import { hairlineBottom, hairlineTop } from '@/components/ui/Divider';
import { statValueText } from '@/components/ui/Stat';
import { useTheme, useThemedStyles } from '@/theme/ThemeProvider';
import { data, display, fontSizes, radius, space, usesAccessibilityTextLayout, type Tokens } from '@/theme/tokens';

/** Race distances in the shelf, in display voice. */
type StarterDistance = '5k' | '10k' | 'half' | 'marathon';

const DISTANCES: ReadonlyArray<{ kind: StarterDistance; label: string }> = [
  { kind: '5k', label: '5K' },
  { kind: '10k', label: '10K' },
  { kind: 'half', label: 'Half Marathon' },
  { kind: 'marathon', label: 'Marathon' },
];

/**
 * `/plans` — the single plan-entry surface. Three doors used to lead here (the
 * Plan tab's library toggle, the You "Plan" section, the empty-Dash CTA); they
 * now all open this one screen.
 *
 * State-adaptive: with an active plan it leads with one dominant current-plan
 * object; without one it leads with brief choice context. Starter-plan families
 * expose their real mileage shape and open at the tier matching recent volume;
 * detailed tier selection remains on the preview, where it has context.
 */
export default function PlansHome() {
  const { userId, ready } = useSession();
  const { preferences } = useAppPreferences();
  const units = preferences.distance;
  const router = useRouter();
  const queryClient = useQueryClient();
  const C = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { width: windowWidth } = useWindowDimensions();
  const storefrontCardWidth = Math.min(310, Math.max(272, windowWidth - space.lg * 2 - space.xl));

  const myPlans = useMyPlans(ready ? userId : null);
  const { weeklyMiles } = useRecentWeeklyMiles();
  const suggested = suggestTier(weeklyMiles);

  const plans = myPlans.data ?? [];
  const identitySources = usePlanIdentitySources(ready ? userId : null, plans.map((plan) => plan.id));
  const identities = useMemo<Record<string, PlanIdentity>>(() => {
    const out: Record<string, PlanIdentity> = {};
    for (const plan of plans) {
      const source = identitySources.data?.[plan.id];
      if (!source || source.weeks.length === 0) continue;
      out[plan.id] = derivePlanIdentity({
        name: plan.raceName,
        distanceKind: plan.distanceKind,
        numWeeks: plan.numWeeks,
        weeks: source.weeks,
        workouts: source.workouts,
      });
    }
    return out;
  }, [identitySources.data, plans]);
  const activePlan = plans.find((p) => p.status === 'active') ?? null;
  const activePlanId = activePlan?.id ?? null;
  const savedPlans = plans.filter((p) => p.id !== activePlanId);
  const preferredDistance = DISTANCES.some(({ kind }) => kind === activePlan?.distanceKind)
    ? (activePlan?.distanceKind as StarterDistance)
    : null;
  const storefrontDistances = useMemo(
    () => preferredDistance
      ? [...DISTANCES].sort((a, b) => Number(b.kind === preferredDistance) - Number(a.kind === preferredDistance))
      : DISTANCES,
    [preferredDistance],
  );
  const [refreshing, setRefreshing] = useState(false);
  const { switching, openPlanMenu } = usePlanLibraryActions(activePlanId, queryClient);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([myPlans.refetch(), identitySources.refetch()]);
    } finally {
      setRefreshing(false);
    }
  }, [identitySources, myPlans]);

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        {/* The shared header — the last screen still hand-rolling one. Its
            local navBar used a space.xl gutter (the app is on space.lg), a
            fontSize-18 system-face centered title where every other sheet
            title is display, and a 32x32 spacer that existed only to balance
            the centering. */}
        <SheetHeader variant="sheet" title="Plans" onClose={() => router.back()} />

        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.mute} />}
        >
          {activePlan ? (
            <CurrentPlanCard
              plan={activePlan}
              identity={identities[activePlan.id]}
              units={units}
              // The active plan's ONE window is the Plan tab. This modal sits
              // above the tabs, so leaving it is a dismissal, not a push —
              // `dismissTo` pops the Plans task and lands on `/plan` (the same
              // exit the importer uses after installing).
              onOpen={() => router.dismissTo('/plan')}
              onMenu={() => openPlanMenu(activePlan)}
            />
          ) : (
            <View style={styles.emptyLead}>
              <Text style={styles.emptyTitle}>Build toward race day</Text>
              <Text style={styles.emptyBody}>Choose a distance. Opening volume is set from the training you’ve already banked.</Text>
            </View>
          )}

          {savedPlans.length > 0 ? (
            <View style={styles.savedSection}>
              <View style={styles.savedHead}>
                <Text style={styles.heading}>Saved plans</Text>
                <Text style={styles.headingMeta}>{`${savedPlans.length} ${savedPlans.length === 1 ? 'PLAN' : 'PLANS'}`}</Text>
              </View>
              <SavedPlanLedger
                plans={savedPlans}
                busyId={switching}
                units={units}
                onOpenDetail={(plan) => router.push({ pathname: '/plans/[id]', params: { id: plan.id } })}
                onOpenMenu={openPlanMenu}
                identities={identities}
              />
            </View>
          ) : null}

          <View style={styles.section}>
            <View style={styles.headingRow}>
              <Text style={styles.heading}>Starter plans</Text>
              <Text style={styles.headingMeta}>
                {suggested ? `${tierDisplay(suggested, units)} ${units.toUpperCase()}/WK` : 'CHOOSE VOLUME'}
              </Text>
            </View>
            <Text style={styles.headingSub}>
              {suggested
                ? 'Opening volume is set from your recent training. You can change it before installing.'
                : 'Choose a race distance, then select the volume you can comfortably sustain.'}
            </Text>
            <ScrollView
              horizontal
              decelerationRate="fast"
              snapToInterval={storefrontCardWidth + space.md}
              showsHorizontalScrollIndicator={false}
              style={styles.storefrontBleed}
              contentContainerStyle={styles.storefrontShelf}
            >
              {storefrontDistances.map(({ kind, label }) => (
                <StarterStorefrontCard
                  key={kind}
                  kind={kind}
                  label={label}
                  suggested={suggested}
                  units={units}
                  width={storefrontCardWidth}
                  onPick={(id) => router.push(`/plans/starter/${id}`)}
                />
              ))}
            </ScrollView>
          </View>

          <View style={styles.byopSection}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Bring your own plan"
              onPress={() => router.push('/plans/install')}
              style={({ pressed }) => [styles.importCard, pressed && styles.pressed]}
            >
              <PlanArtwork kind="bring-your-own" aspectRatio={16 / 9} />
              <View style={styles.importCopyRow}>
                <View style={styles.importBody}>
                  <Text style={styles.importTitle}>Bring your own plan</Text>
                  <Text style={styles.importMeta}>Open a .due file, paste plan text, or convert a plan with AI.</Text>
                </View>
                <SymbolView name="chevron.right" size={12} tintColor={C.mute} resizeMode="scaleAspectFit" />
              </View>
            </Pressable>
          </View>

        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function CurrentPlanCard({ plan, identity, units, onOpen, onMenu }: { plan: MyPlan; identity?: PlanIdentity; units: DistancePreference; onOpen: () => void; onMenu: () => void }) {
  const C = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { fontScale } = useWindowDimensions();
  const accessible = usesAccessibilityTextLayout(fontScale);
  const state = identity ? activePlanState(plan, identity) : null;
  const total = identity ? formatPlanDistance(totalPlannedMeters(identity), units) : '—';
  const average = identity ? formatPlanDistance(identity.averageWeeklyMeters, units) : '—';
  const peak = identity ? formatPlanDistance(identity.peakWeeklyMeters, units) : '—';
  const distance = identity?.distanceLabel ?? (plan.distanceKind ? distanceLabel(plan.distanceKind) : 'Training');
  const raceDate = compactRaceDate(plan.raceDate);
  const raceCountdown = daysToRace(plan.raceDate);
  const context = [
    distance,
    raceDate,
    raceCountdown != null ? raceCountdown === 0 ? 'Race day' : `${raceCountdown} days to race` : null,
  ].filter(Boolean).join(' · ');

  return (
    <View style={styles.currentCard}>
      <View style={styles.currentHeader}>
        <View style={styles.currentLabelRow}>
          <View style={styles.currentDot} />
          <Text style={styles.currentLabel}>Current plan</Text>
        </View>
        {state?.detail ? (
          <Text testID="plan-current-week-marker" style={styles.currentDetail} numberOfLines={1}>
            {state.detail.toUpperCase()}
          </Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${plan.raceName} options`}
          hitSlop={8}
          onPress={onMenu}
          style={({ pressed }) => [styles.currentMenu, pressed && styles.pressed]}
        >
          <SymbolView name="ellipsis" size={17} tintColor={C.mute} weight="bold" resizeMode="scaleAspectFit" />
        </Pressable>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open current plan, ${plan.raceName}`}
        onPress={onOpen}
        style={({ pressed }) => pressed && styles.pressed}
      >
        <View style={styles.currentBody}>
          <Text style={styles.currentTitle} numberOfLines={accessible ? undefined : 2}>{plan.raceName}</Text>
          <Text style={styles.currentContext}>{context}</Text>
          <View style={[styles.currentMetrics, accessible && styles.currentMetricsAccessible]}>
            <View testID="plan-total-mileage" style={styles.currentTotal}>
              <Text style={styles.currentTotalValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>{total}</Text>
              <Text style={styles.currentTotalUnit}>{units.toUpperCase()} PLAN</Text>
            </View>
            <View style={[styles.currentStats, accessible && styles.currentStatsAccessible]}>
              <Text style={styles.currentStat}>{identity?.numWeeks ?? plan.numWeeks ?? '—'} WEEKS</Text>
              <Text style={styles.currentStat}>{average} AVG · {peak} PEAK</Text>
            </View>
          </View>
        </View>
        <View style={styles.currentOpenRow}>
          <Text style={styles.currentOpen}>Open plan</Text>
          <SymbolView name="chevron.right" size={12} tintColor={C.mute} resizeMode="scaleAspectFit" />
        </View>
      </Pressable>
    </View>
  );
}

function SavedPlanLedger({
  plans,
  identities,
  units,
  busyId,
  onOpenDetail,
  onOpenMenu,
}: {
  plans: MyPlan[];
  identities: Record<string, PlanIdentity>;
  units: DistancePreference;
  busyId: string | null;
  onOpenDetail: (plan: MyPlan) => void;
  onOpenMenu: (plan: MyPlan) => void;
}) {
  const C = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { fontScale } = useWindowDimensions();
  const accessible = usesAccessibilityTextLayout(fontScale);
  return (
    <View testID="saved-plan-ledger" style={styles.savedLedger}>
      {plans.map((plan) => {
        const identity = identities[plan.id];
        const total = identity ? formatPlanDistance(totalPlannedMeters(identity), units) : '—';
        return (
          <View key={plan.id} style={[styles.savedRow, accessible && styles.savedRowAccessible]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${plan.raceName}. View plan.`}
              onPress={() => onOpenDetail(plan)}
              style={({ pressed }) => [styles.savedMain, accessible && styles.savedMainAccessible, pressed && styles.pressed]}
            >
              <View style={styles.savedCopy}>
                <Text style={styles.savedTitle} numberOfLines={accessible ? undefined : 1}>{plan.raceName}</Text>
                <Text style={styles.savedMeta} numberOfLines={accessible ? undefined : 1}>
                  {[plan.distanceKind ? distanceLabel(plan.distanceKind) : 'Custom', plan.numWeeks ? `${plan.numWeeks} weeks` : null].filter(Boolean).join(' · ')}
                </Text>
              </View>
              <Text style={styles.savedMileage}>{total} {units.toUpperCase()}</Text>
            </Pressable>
            {busyId === plan.id ? (
              <ActivityIndicator color={C.mute} style={styles.savedMenu} />
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${plan.raceName} options`}
                hitSlop={10}
                onPress={() => onOpenMenu(plan)}
                style={({ pressed }) => [styles.savedMenu, pressed && styles.pressed]}
              >
                <SymbolView name="ellipsis" size={16} tintColor={C.mute} weight="bold" resizeMode="scaleAspectFit" />
              </Pressable>
            )}
          </View>
        );
      })}
    </View>
  );
}

function StarterStorefrontCard({ kind, label, suggested, units, width, onPick }: { kind: StarterDistance; label: string; suggested: StarterTier | null; units: DistancePreference; width: number; onPick: (id: string) => void }) {
  const C = useTheme();
  const styles = useThemedStyles(makeStyles);
  const tier = suggested ?? 45;
  const meta = STARTER_CATALOG.find((s) => s.id === `${kind}-${tier}`) ?? null;
  const identity = useMemo(() => meta ? identityFromRelative(meta.load()) : null, [meta]);
  // The cover is this tier's real mileage arc — the block's own shape, not a
  // decoration standing in for one.
  const arc = useMemo(() => identity?.weeks.map((week) => week.targetMeters), [identity]);
  if (!meta || !identity) return null;
  const average = Math.round(metersToUnits(identity.averageWeeklyMeters, units));
  const peak = Math.round(metersToUnits(identity.peakWeeklyMeters, units));
  const unitWord = units === 'mi' ? 'miles' : 'kilometers';
  const tierValue = tierDisplay(tier, units);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}, for runners near ${tierValue} ${unitWord} per week, ${identity.numWeeks} weeks, ${average} average ${unitWord} per week, ${peak} peak ${unitWord}`}
      onPress={() => onPick(`${kind}-${tier}`)}
      style={({ pressed }) => [styles.storefrontCard, { width }, pressed && styles.pressed]}
    >
      <PlanArtwork kind={kind} weeks={arc} aspectRatio={16 / 10} />
      <View style={styles.storefrontBody}>
        <View style={styles.storefrontCopy}>
          <Text style={styles.storefrontTitle}>{label}</Text>
          <Text style={styles.storefrontContext}>
            {identity.numWeeks} weeks · {tierValue} {units}/wk · {peak} {units} peak
          </Text>
        </View>
        <SymbolView name="chevron.right" size={12} tintColor={C.mute} resizeMode="scaleAspectFit" />
      </View>
    </Pressable>
  );
}

function tierDisplay(tierMpw: number, units: DistancePreference): number {
  return units === 'mi' ? tierMpw : Math.round(tierMpw * 1.609344);
}

function identityFromRelative(plan: RelativePlan): PlanIdentity {
  return derivePlanIdentity({
    name: plan.plan.name,
    distanceKind: plan.plan.distanceKind,
    numWeeks: plan.plan.numWeeks,
    weeks: plan.weeks.map((week) => ({
      weekIndex: week.week,
      phase: week.phase,
      targetMeters: week.targetMeters,
      isRecovery: week.isRecovery,
    })),
    workouts: plan.workouts.map((workout) => ({
      weekIndex: workout.week,
      type: workout.type,
      plannedDistanceMeters: workout.plannedDistanceMeters,
      isQuality: workout.type === 'quality',
      structure: workout.structure,
    })),
  });
}

function activePlanState(plan: MyPlan, identity: PlanIdentity) {
  const weekIndex = currentPlanWeek(plan.startDate, identity.numWeeks);
  const phase = weekIndex == null ? null : phaseAtWeek(identity, weekIndex);
  return {
    label: 'Current plan',
    detail: [phase, weekIndex != null ? `Week ${weekIndex} of ${identity.numWeeks}` : null].filter(Boolean).join(' · '),
    currentWeekIndex: weekIndex,
  };
}

function totalPlannedMeters(identity: PlanIdentity): number {
  return identity.weeks.reduce((sum, week) => sum + week.targetMeters, 0);
}

function formatPlanDistance(meters: number, units: DistancePreference): string {
  return Math.round(metersToUnits(meters, units)).toLocaleString('en-US');
}

function daysToRace(value?: string | null): number | null {
  if (!value) return null;
  const race = Date.parse(`${value}T12:00:00Z`);
  const today = Date.parse(`${todayIsoDate()}T12:00:00Z`);
  if (!Number.isFinite(race) || !Number.isFinite(today)) return null;
  const days = Math.ceil((race - today) / 86_400_000);
  return days >= 0 ? days : null;
}

function phaseAtWeek(identity: PlanIdentity, weekIndex: number): string | null {
  let cursor = 0;
  for (const phase of identity.phases) {
    cursor += phase.weeks;
    if (weekIndex <= cursor) return phase.label;
  }
  return null;
}

function currentPlanWeek(startDate: string | null | undefined, numWeeks: number): number | null {
  if (!startDate) return null;
  const start = Date.parse(`${startDate}T12:00:00Z`);
  const today = Date.parse(`${todayIsoDate()}T12:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(today)) return null;
  const week = Math.floor((today - start) / (7 * 86400 * 1000)) + 1;
  return week >= 1 && week <= numWeeks ? week : null;
}

function distanceLabel(kind: string): string {
  if (kind === 'marathon') return 'Marathon';
  if (kind === 'half') return 'Half';
  if (kind === '10k') return '10K';
  if (kind === '5k') return '5K';
  return 'Custom';
}

function compactRaceDate(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

const makeStyles = (C: Tokens) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: C.bg },
    safe: { flex: 1 },
    pressed: { opacity: 0.6 },
    // Modal sheets sit below the status bar (top inset ≈ 0), so pad the bar.
    scroll: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.xl * 2 },

    emptyLead: { paddingTop: space.lg },
    emptyTitle: { color: C.ink, fontFamily: display, fontSize: fontSizes.pageTitle, letterSpacing: -0.6 },
    emptyBody: { marginTop: space.sm, maxWidth: 310, color: C.mute, fontSize: fontSizes.labelLg, fontWeight: '600', lineHeight: 20 },

    currentCard: {
      position: 'relative',
      borderRadius: radius.md,
      backgroundColor: C.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: C.line,
      overflow: 'hidden',
      marginTop: space.sm,
    },
    currentHeader: {
      minHeight: 44,
      paddingLeft: space.lg,
      paddingRight: 52,
      ...hairlineBottom(C),
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: space.md,
    },
    currentLabelRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
    currentDot: { width: 7, height: 7, borderRadius: radius.pill, backgroundColor: C.yellow },
    currentLabel: { color: C.ink, fontFamily: display, fontSize: fontSizes.body, letterSpacing: -0.15 },
    currentDetail: { ...statValueText(C, 'micro'), flexShrink: 1, color: C.mute, lineHeight: 15, textAlign: 'right' },
    currentBody: { padding: space.lg },
    currentTitle: { color: C.ink, fontFamily: display, fontSize: fontSizes.sheetTitle, lineHeight: 30, letterSpacing: -0.45 },
    currentContext: { ...statValueText(C, 'labelSm', 'system'), marginTop: space.xs, color: C.mute, lineHeight: 16, fontWeight: '700' },
    currentMetrics: { marginTop: space.lg + 2, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: space.lg },
    currentMetricsAccessible: { flexDirection: 'column', alignItems: 'stretch' },
    currentTotal: { minWidth: 0, flexDirection: 'row', alignItems: 'baseline', gap: space.s },
    currentTotalValue: { flexShrink: 1, color: C.ink, fontFamily: display, fontSize: 46, lineHeight: 46, letterSpacing: -1.4, fontVariant: ['tabular-nums'] },
    currentTotalUnit: { color: C.mute, fontFamily: data, fontSize: fontSizes.metadata, letterSpacing: 0.6 },
    currentStats: { flexShrink: 0, alignItems: 'flex-end', paddingBottom: space.xs },
    currentStatsAccessible: { alignItems: 'flex-start', marginTop: space.md },
    currentStat: { ...statValueText(C, 'labelSm'), color: C.mute, lineHeight: 17 },
    currentOpenRow: { minHeight: 50, paddingHorizontal: space.lg, ...hairlineTop(C), flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    currentOpen: { color: C.ink, fontSize: fontSizes.label, fontWeight: '800' },
    currentMenu: { position: 'absolute', top: 0, right: space.s, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },

    section: { marginTop: space.xl + space.xs, marginBottom: 0 },
    heading: { color: C.ink, fontFamily: display, fontSize: fontSizes.body, letterSpacing: -0.15 },
    headingRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space.md },
    headingSub: { marginTop: space.s, marginBottom: space.md, color: C.mute, fontSize: fontSizes.metadata, fontWeight: '600', lineHeight: 16 },
    headingMeta: { ...statValueText(C, 'micro'), color: C.mute, lineHeight: 15 },
    storefrontBleed: { marginHorizontal: -space.lg },
    storefrontShelf: { paddingHorizontal: space.lg, paddingBottom: space.xs, gap: space.md },
    storefrontCard: {
      overflow: 'hidden',
      borderRadius: radius.md,
      backgroundColor: C.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: C.line,
    },
    storefrontBody: { minHeight: 64, paddingHorizontal: space.lg, paddingVertical: space.sm, flexDirection: 'row', alignItems: 'center', gap: space.md },
    storefrontCopy: { flex: 1, minWidth: 0 },
    storefrontTitle: { color: C.ink, fontFamily: display, fontSize: fontSizes.cardTitle, lineHeight: 25, letterSpacing: -0.3 },
    storefrontContext: { ...statValueText(C, 'metadata', 'system'), marginTop: space.xxs, color: C.mute, lineHeight: 16, fontWeight: '600' },

    importCard: {
      marginTop: space.md,
      overflow: 'hidden',
      backgroundColor: C.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: C.line,
      borderRadius: radius.md,
    },
    importCopyRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.sm },
    importBody: { flex: 1, minWidth: 0 },
    importTitle: { color: C.ink, fontFamily: display, fontSize: fontSizes.cardTitle, lineHeight: 25, letterSpacing: -0.35 },
    importMeta: { marginTop: space.xs, color: C.mute, fontSize: fontSizes.metadata, lineHeight: 16, fontWeight: '600' },
    byopSection: { marginTop: space.xl + space.xs },
    savedSection: { marginTop: space.xl + space.xs },
    savedHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space.md },
    savedLedger: { marginTop: space.sm, ...hairlineBottom(C) },
    savedRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', ...hairlineTop(C) },
    savedRowAccessible: { alignItems: 'stretch' },
    savedMain: { minHeight: 58, flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm },
    savedMainAccessible: { flexDirection: 'column', alignItems: 'flex-start', gap: space.s, paddingVertical: space.md },
    savedCopy: { flex: 1, minWidth: 0 },
    savedTitle: { color: C.ink, fontSize: fontSizes.labelLg, lineHeight: 19, fontWeight: '800', letterSpacing: -0.2 },
    savedMeta: { ...statValueText(C, 'labelSm', 'system'), marginTop: space.nudge, color: C.mute, lineHeight: 16, fontWeight: '700' },
    // The ledger's right-hand readout is the row's quiet key, not its subject, so
    // it keeps `C.mute` over the factory's `C.ink`.
    savedMileage: { ...statValueText(C, 'sm'), flexShrink: 0, color: C.mute, lineHeight: 17 },
    savedMenu: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  });
