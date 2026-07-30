/**
 * `app/plans/starter/[id]` — the starter-plan preview + install screen.
 *
 * A bundled starter block (dateless `RelativePlan`) is anchored to the runner's
 * calendar (race date OR start date) and previewed as the real dated plan it
 * will become: the progression chart is the dominant instrument, a terse
 * Space-Mono stats row sits beneath it, and one yellow Install commit lands it.
 *
 * The screen owns only the `PlanAnchor`; every date edit re-runs `anchorPlan`
 * (pure) → `normalizePlanDraft`, so the preview is always exactly what install
 * would write. The `AnchorSheet` is screen-agnostic and reused by the install
 * reframe; this screen just holds it open/closed and feeds it the verdict.
 */
import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useQueryClient } from '@tanstack/react-query';

import { useSession } from '@/app-lib/auth';
import { useAppPreferences, type DistancePreference } from '@/app-lib/preferences';
import { installPlanDraft, useMyPlans } from '@/app-lib/queries';
import { derivePlanIdentity, normalizePlanDraft, planDistanceLabel, type ImportedPlanDraft } from '@/lib';
import {
  anchorPlan,
  nextMondayIso,
  todayIsoDate,
  type PlanAnchor,
} from '@/lib/plan/anchor';
import { starterById, STARTER_CATALOG, type StarterMeta } from '@/lib/plan/starter/catalog';
import { ActionButton, ActionButtonLabel } from '@/components/ActionButton';
import { ModalFooter } from '@/components/ModalFooter';
import { AnchorSheet, formatAnchorDate } from '@/components/plan/AnchorSheet';
import { PlanIdentityCard } from '@/components/plan/PlanIdentityCard';
import { PlanOutlineView } from '@/components/plan/PlanOutlineView';
import { SheetHeader } from '@/components/SheetHeader';
import { hairlineTop } from '@/components/ui/Divider';
import { Segmented } from '@/components/ui/Segmented';
import { statValueText } from '@/components/ui/Stat';
import { useTheme, useThemedStyles } from '@/theme/ThemeProvider';
import { data, fontSizes, radius, space, type Tokens } from '@/theme/tokens';

export default function StarterPreviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const initialMeta = starterById(id ?? '');
  const [selectedStarterId, setSelectedStarterId] = useState(() => initialMeta?.id ?? '');
  const meta = starterById(selectedStarterId) ?? initialMeta;
  if (!meta) return <UnknownStarter />;
  return (
    <StarterPreview
      meta={meta}
      onSelectTier={(nextId) => {
        setSelectedStarterId(nextId);
        router.setParams({ id: nextId });
      }}
    />
  );
}

function StarterPreview({ meta, onSelectTier }: { meta: StarterMeta; onSelectTier: (id: string) => void }) {
  const C = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const queryClient = useQueryClient();
  const { userId, ready } = useSession();
  const { preferences } = useAppPreferences();
  const units = preferences.distance;
  const unitWord = units === 'mi' ? 'miles' : 'kilometers';

  const myPlans = useMyPlans(ready ? userId : null);
  const activePlan = myPlans.data?.find((p) => p.status === 'active') ?? null;

  // "Today" is captured once so re-derivation is stable across renders.
  const [today] = useState(todayIsoDate);
  const plan = useMemo(() => meta.load(), [meta]);

  const [anchor, setAnchor] = useState<PlanAnchor>({ kind: 'start', startDate: nextMondayIso(today) });
  const [sheetOpen, setSheetOpen] = useState(false);
  const [installing, setInstalling] = useState(false);

  const result = useMemo(() => anchorPlan(plan, anchor, today), [plan, anchor, today]);
  const tooClose = result.ok ? null : result;

  // The installable draft — null when the anchor leaves too little room (race
  // mode too close / past). Install keys off this.
  const draft = useMemo(() => (result.ok ? normalizePlanDraft(result.draft) : null), [result]);

  // The PREVIEW draft: the anchored draft when valid, else a full-length start
  // anchor so the chart + stats stay populated even in the too-close state.
  const displayResult = useMemo(
    () => (result.ok ? result : anchorPlan(plan, { kind: 'start', startDate: nextMondayIso(today) }, today)),
    [result, plan, today],
  );
  const displayDraft = useMemo(
    () => (displayResult.ok ? normalizePlanDraft(displayResult.draft) : null),
    [displayResult],
  );

  const identity = useMemo(
    () => displayDraft ? identityFromDraft(displayDraft, `${planDistanceLabel(meta.distanceKind)} build`) : null,
    [displayDraft, meta.distanceKind],
  );

  const joinNotice =
    result.ok && result.joinAtWeek != null
      ? `Join at week ${result.joinAtWeek} of ${meta.numWeeks}`
      : null;

  // The anchor summary chip: what the plan is currently pinned to.
  const anchorSummary = useMemo(() => {
    if (anchor.kind === 'start') return `Starts ${formatAnchorDate(result.ok ? result.startDate : anchor.startDate)}`;
    const dateLabel = formatAnchorDate(anchor.raceDate);
    if (tooClose) return `Race ${dateLabel} · too close`;
    if (result.ok && result.joinAtWeek != null) return `Race ${dateLabel} · join at week ${result.joinAtWeek}`;
    return `Race ${dateLabel}`;
  }, [anchor, result, tooClose]);

  // One-number-one-screen: when the anchor is valid this line restated the
  // anchor chip and the blocks header ('Starts Mon Aug 3', '14 weeks') a
  // scroll above the button. It survives only when it says something the page
  // doesn't — why Install is disabled.
  const installSummary = result.ok ? null : 'Choose a valid date to install';

  // Same-distance tiers update this preview in place. The route parameter is
  // synchronized silently by the parent for deep-link fidelity, but the user
  // never leaves or remounts the setup surface.
  const siblings = useMemo(
    () => STARTER_CATALOG.filter((s) => s.distanceKind === meta.distanceKind),
    [meta.distanceKind],
  );

  const runInstall = useCallback(async () => {
    if (!draft) return;
    setInstalling(true);
    try {
      await installPlanDraft(draft, queryClient);
      router.replace('/(tabs)');
    } catch (err) {
      Alert.alert('Couldn’t install plan', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setInstalling(false);
    }
  }, [draft, queryClient, router]);

  const onInstall = useCallback(() => {
    if (!draft || installing) return;
    if (activePlan) {
      Alert.alert(
        `Install ${meta.name}`,
        'Your current plan will be archived — its history is kept.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Install', style: 'destructive', onPress: () => void runInstall() },
        ],
      );
      return;
    }
    void runInstall();
  }, [activePlan, draft, installing, meta.name, runInstall]);

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        {/* The shared header — see app/plans/[id].tsx for what this replaces. */}
        <SheetHeader
          navigation="back"
          navigationLabel="Back to plans"
          title="Starter plan"
          onClose={() => router.back()}
        />

        <ScrollView style={styles.scrollView} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {identity ? (
            <PlanIdentityCard
              identity={identity}
              artworkKind={meta.distanceKind === 'custom' ? null : meta.distanceKind}
              style={styles.identityCard}
            />
          ) : null}

          <Text style={styles.setupTitle}>Set up this plan</Text>
          <Text style={styles.setupIntro}>Choose the mileage you can comfortably sustain now, then place the block on your calendar.</Text>
          <View style={styles.setupPanel}>
            <View style={styles.volumeHead}>
              <Text style={styles.volumeLabel}>Training volume</Text>
              <Text accessibilityLiveRegion="polite" style={styles.volumeValue}>{tierDisplay(meta.tierMpw, units)} {units}/week</Text>
            </View>
            {/* Same-distance variants matched to recent sustainable volume.
                Selection is the app's ONE filled segmented control (Segmented),
                not a second underline grammar. */}
            {siblings.length > 1 ? (
              <Segmented
                style={styles.tierRow}
                accessibilityLabel="Training volume"
                mono
                value={meta.id}
                onChange={onSelectTier}
                options={siblings.map((s) => ({
                  value: s.id,
                  label: `${tierDisplay(s.tierMpw, units)} ${units}/week`,
                  accessibilityLabel: `${tierDisplay(s.tierMpw, units)} ${unitWord} per week`,
                }))}
              />
            ) : null}

            {/* Anchor summary → opens the sheet. */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Change anchor"
              onPress={() => setSheetOpen(true)}
              style={({ pressed }) => [styles.anchorRow, pressed && styles.pressed]}
            >
              <SymbolView name="calendar" size={15} tintColor={C.mute} resizeMode="scaleAspectFit" />
              <Text style={styles.anchorText} numberOfLines={1}>{anchorSummary}</Text>
              <SymbolView name="chevron.right" size={12} tintColor={C.faint} resizeMode="scaleAspectFit" />
            </Pressable>
          </View>

          {joinNotice ? <Text style={styles.joinNotice}>{joinNotice}</Text> : null}
          {tooClose ? (
            <View style={styles.tooClose}>
              <Text style={styles.tooCloseEyebrow}>TOO CLOSE</Text>
              <Text style={styles.tooCloseMeta}>
                {`${tooClose.weeksAvailable} available · ${tooClose.minWeeks} minimum`}
              </Text>
            </View>
          ) : null}

          {displayDraft ? <PlanOutlineView draft={displayDraft} showProfile={false} /> : null}

        </ScrollView>

        <ModalFooter style={styles.footer}>
          {installSummary ? <Text style={styles.footerSummary}>{installSummary}</Text> : null}
          <ActionButton
            accessibilityLabel="Install plan"
            loadingAccessibilityLabel="Installing plan"
            loadingLabel="Installing…"
            loading={installing}
            disabled={installing || !draft}
            disabledColor={C.slate}
            onPress={onInstall}
            color={C.yellow}
            variant="commit"
            style={styles.installBtn}
          >
            <ActionButtonLabel>Install plan</ActionButtonLabel>
          </ActionButton>
        </ModalFooter>
      </SafeAreaView>

      <AnchorSheet
        plan={plan}
        anchor={anchor}
        onChange={setAnchor}
        tooClose={tooClose}
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
      />
    </View>
  );
}

function tierDisplay(tierMpw: number, units: DistancePreference): number {
  return units === 'mi' ? tierMpw : Math.round(tierMpw * 1.609344);
}

function identityFromDraft(draft: ImportedPlanDraft, name: string) {
  return derivePlanIdentity({
    name,
    distanceKind: draft.plan.distanceKind,
    numWeeks: draft.plan.numWeeks,
    weeks: draft.weeks.map((week) => ({
      weekIndex: week.weekIndex,
      phase: week.phase,
      targetMeters: week.targetMeters,
      isRecovery: week.isRecovery,
    })),
    workouts: draft.workouts.map((workout) => ({
      weekIndex: workout.weekIndex,
      type: workout.type,
      plannedDistanceMeters: workout.plannedDistanceMeters,
      isQuality: workout.isQuality,
      structure: workout.structure,
    })),
  });
}

function UnknownStarter() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  return (
    <View style={styles.root}>
      <SafeAreaView style={[styles.safe, styles.empty]} edges={['top', 'bottom']}>
        <Text style={styles.emptyTitle}>Plan not found</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.back()} style={styles.emptyBtn}>
          <Text style={styles.emptyBtnText}>Go back</Text>
        </Pressable>
      </SafeAreaView>
    </View>
  );
}

const makeStyles = (C: Tokens) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: C.bg },
    safe: { flex: 1 },
    pressed: { opacity: 0.6 },

    scrollView: { flex: 1 },
    scroll: { paddingHorizontal: space.lg, paddingTop: space.s, paddingBottom: space.xl },
    identityCard: { marginBottom: space.xl },

    setupTitle: { color: C.ink, fontSize: fontSizes.sectionTitle, lineHeight: 23, fontWeight: '800', letterSpacing: -0.25 },
    setupIntro: { marginTop: space.xs, marginBottom: space.md, color: C.mute, fontSize: fontSizes.label, lineHeight: 18, fontWeight: '600' },
    setupPanel: {
      overflow: 'hidden',
      borderRadius: radius.md,
      backgroundColor: C.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: C.line,
      marginBottom: space.md,
    },
    volumeHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space.md, paddingHorizontal: space.lg, paddingTop: space.md },
    volumeLabel: { color: C.mute, fontSize: fontSizes.metadata, lineHeight: 16, fontWeight: '700' },
    volumeValue: { ...statValueText(C, 'sm'), lineHeight: 16 },

    // The volume tiers sit inside the setup panel's gutter; the control itself
    // (track fill, selected segment, hairline edge) belongs to <Segmented>.
    tierRow: { marginHorizontal: space.lg, marginTop: space.m, marginBottom: space.md },

    // Anchor summary chip.
    anchorRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.s,
      minHeight: 48,
      paddingHorizontal: space.lg,
      ...hairlineTop(C),
    },
    anchorText: { flex: 1, minWidth: 0, fontSize: fontSizes.labelLg, fontWeight: '700', color: C.ink, letterSpacing: -0.2 },

    // Join notice — one of the two sanctioned full sentences.
    joinNotice: { marginTop: space.md, fontSize: fontSizes.label, fontWeight: '600', color: C.mute, lineHeight: 19 },

    tooClose: {
      marginTop: space.md,
      paddingVertical: space.md,
      paddingHorizontal: space.lg,
      borderRadius: radius.md,
      backgroundColor: C.fill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: C.line,
    },
    tooCloseEyebrow: { fontSize: fontSizes.labelSm, fontWeight: '800', color: C.pink, letterSpacing: 0.6 },
    tooCloseMeta: { marginTop: space.xs, fontFamily: data, fontSize: fontSizes.label, color: C.ink },

    footer: { flexShrink: 0 },
    footerSummary: { marginBottom: space.sm, textAlign: 'center', color: C.mute, fontFamily: data, fontSize: fontSizes.micro, lineHeight: 14 },
    installBtn: { width: '100%' },

    // Empty state.
    empty: { alignItems: 'center', justifyContent: 'center', gap: space.lg },
    emptyTitle: { fontSize: fontSizes.sectionTitle, fontWeight: '800', color: C.ink },
    emptyBtn: { paddingHorizontal: space.lg, paddingVertical: space.md, borderRadius: radius.pill, backgroundColor: C.fill },
    emptyBtnText: { fontSize: fontSizes.labelLg, fontWeight: '800', color: C.ink },
  });
