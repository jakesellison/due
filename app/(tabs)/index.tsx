import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useQueryClient } from '@tanstack/react-query';

import { useSession } from '@/app-lib/auth';
import {
  invalidatePlanActivityCaches,
  planHeaderInfo,
  useActivities,
  useWeeklyMileage,
  type DateRange,
} from '@/app-lib/queries';
import { useAdaptations } from '@/app-lib/adapt';
import { ensureSamplePlan } from '@/app-lib/seed';
import { useBackfillStatus } from '@/app-lib/backfillStatus';
import { useStravaStatus } from '@/app-lib/strava';
import { ErrorState } from '@/components/ErrorState';
import { SyncStatusRow } from '@/components/dash/SyncStatusRow';
import { ReconnectStravaRow } from '@/components/dash/ReconnectStravaRow';
import { TAB_BAR_INSET } from '@/components/GlassTabBar';
import { StickySections, type StickyBlock } from '@/components/StickySections';
import { CalendarTabs, type CalendarTabsHandle, type CalendarTabsState } from '@/components/dash/CalendarTabs';
import { BlockRail } from '@/components/dash/BlockRail';
import { ContractMetMoment } from '@/components/dash/ContractMetMoment';
import { useJustBanked } from '@/components/dash/useJustBanked';
import { WeekTabSkeleton } from '@/components/loading/TabSkeletons';
import { crossedMileageContract, preRunMeters } from '@/lib/kpi/justBanked';
import { eyebrowText } from '@/components/ui/Eyebrow';
import { useTheme, useThemedStyles } from '@/theme/ThemeProvider';
import { fontSizes, radius, space, type Tokens } from '@/theme/tokens';
import { addDays, adherenceSummary } from '@/lib';
import { PoweredByStrava } from '@/components/StravaAttribution';

/**
 * The Dash (home) in the dark+yellow system: a flat themed top bar (plan chip
 * with the days-out badge → Plan tab; avatar → the You hub); two KPI stat
 * tiles; the Today section; the week strip; live adaptations; and the block /
 * showing-up charts. Cards are the run-detail vocabulary (Card / Section),
 * numerals are heavy tabular system figures, accent is yellow. No narrated copy.
 */
export default function DashScreen() {
  const { userId, ready, error: sessionError, retry: retrySession } = useSession();
  const router = useRouter();
  const { calendarDate } = useLocalSearchParams<{ calendarDate?: string }>();
  const queryClient = useQueryClient();
  // Strava connection + the shared backfill status — drives both the compact
  // sync row (while a history import runs) and the no-plan empty state's
  // copy/CTA, so a fresh sign-up sees "connect/importing", not blank gauges.
  const { status: stravaStatus, loading: stravaLoading, refresh: refreshStravaStatus } = useStravaStatus(!!userId);
  // Dash is a persistent tab, so its status probe (mount-only) goes stale after
  // the runner reconnects Strava on the You screen — the "disconnected" row
  // would linger. Re-probe whenever Dash regains focus so the row clears as
  // soon as you return from reconnecting.
  useFocusEffect(
    useCallback(() => {
      if (userId) void refreshStravaStatus();
    }, [userId, refreshStravaStatus]),
  );
  const backfillStatus = useBackfillStatus();
  const seededFor = useRef<string | null>(null);
  const [seedError, setSeedError] = useState<Error | null>(null);
  const [seedDone, setSeedDone] = useState(false);
  // Bumped by the error screen's retry button to force the seed effect below to
  // re-run even when `userId` hasn't changed (its own deps guard is by userId).
  const [seedAttempt, setSeedAttempt] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  // Calendar section header state (lifted from CalendarTabs so the sticky period
  // control follows the browsed week and the inline month's actual expansion).
  const calRef = useRef<CalendarTabsHandle>(null);
  const [calState, setCalState] = useState<CalendarTabsState>({
    weekLabel: '',
    monthLabel: '',
    offToday: false,
    periodBankedMeters: 0,
    periodLabel: 'This week',
    calendarExpanded: false,
  });
  const handleCalState = useCallback((s: CalendarTabsState) => setCalState(s), []);
  const C = useTheme();
  const styles = useThemedStyles(makeStyles);

  // DEV SEED — ensure a sample plan once per user so the Dash has data.
  useEffect(() => {
    if (!userId) return;
    const attemptKey = `${userId}:${seedAttempt}`;
    if (seededFor.current === attemptKey) return;
    seededFor.current = attemptKey;
    let cancelled = false;
    (async () => {
      try {
        await ensureSamplePlan(userId);
      } catch (err) {
        if (!cancelled) setSeedError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        if (!cancelled) setSeedDone(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, seedAttempt]);

  const weekly = useWeeklyMileage(seedDone ? userId : null);
  const header = planHeaderInfo(weekly.plan, weekly.summary, weekly.today);

  // Race countdown for the calendar header's right slot. Bounded on purpose so
  // the label fits its FULL value range rather than today's: a plan can be a
  // year out, and once the race has passed there is nothing to count down to.
  const days = header.daysToRace;
  const raceCountdown =
    days == null || days < 0 ? null : days === 0 ? 'RACE DAY' : `RACE IN ${days}D`;
  const raceCountdownA11y =
    days == null || days < 0
      ? null
      : days === 0
        ? 'Race day'
        : `${days} ${days === 1 ? 'day' : 'days'} to race`;

  // "Just banked" celebration card — the newest run over a trailing window, so a
  // run that ingested while away still greets the runner on return. `useJustBanked`
  // shows it only while recent + unseen; the long-run accent needs the current
  // week's long target.
  const recentRange = useMemo<DateRange | null>(() => {
    if (!userId) return null;
    const pad = (n: number) => String(n).padStart(2, '0');
    const civil = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 10);
    return { from: civil(from), to: civil(to) };
  }, [userId]);
  const recentActs = useActivities(userId, recentRange);
  const longTargetMeters =
    (weekly.weekGoals ?? []).find((w) => w.isCurrent)?.long.targetMeters ?? 0;
  const justBanked = useJustBanked(userId, recentActs.data, longTargetMeters);

  // The adaptation engine's mileage deficit drives the contract projection and
  // behind detail. Applying edits still lives in the dedicated week planner.
  const adapt = useAdaptations(seedDone ? userId : null);
  const weekDeficitMeters = useMemo(
    () => Math.max(
      0,
      ...adapt.adaptations.map((a) => ('deficitMeters' in a ? a.deficitMeters : 0)),
    ),
    [adapt.adaptations],
  );
  // The mirror of the deficit: the week's remaining plan adds up to MORE than
  // the contract still needs, because earlier days ran long. Nothing is wrong —
  // so this never borrows the deficit's orange — but the plan and the contract
  // now disagree, and only the runner can decide which one moves.
  const weekSurplusMeters = Math.max(0, -adapt.weekGapMeters);
  const handleEditWeek = useCallback((weekNumber: number) => {
    if (weekNumber < 1) return;
    router.push({ pathname: '/planner/[id]', params: { id: String(weekNumber) } });
  }, [router]);
  const handleCalendarDateApplied = useCallback(() => {
    router.setParams({ calendarDate: undefined });
  }, [router]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await invalidatePlanActivityCaches(queryClient);
    } finally {
      setRefreshing(false);
    }
  }, [queryClient]);

  const bootError = sessionError ?? seedError ?? weekly.error;
  const booting = !ready || !seedDone || weekly.loading;

  // Retry covers every boot-error source: re-runs the session bootstrap, resets
  // the dev-seed effect (keyed on seedAttempt so it re-fires even though userId
  // is unchanged), and invalidates the plan/activities caches driving `weekly`.
  const onRetryBoot = useCallback(() => {
    setSeedError(null);
    setSeedDone(false);
    setSeedAttempt((n) => n + 1);
    retrySession();
    void invalidatePlanActivityCaches(queryClient);
  }, [queryClient, retrySession]);

  // Adherence — mileage is the weekly contract, so headline, streak, and dots
  // all use `WeekGoal.mileage.hit`. Quality and long-run results are counted
  // independently as supporting goals; neither can erase banked mileage.
  // Recomputed only when weekGoals changes, instead of on
  // every Dash re-render (a calendar week-swipe bumps `calState`, which
  // otherwise re-derives this — and rebuilds the whole calendar subtree — on
  // every interaction; audit-code Lane 6).
  const adherence = useMemo(() => adherenceSummary(weekly.weekGoals ?? []), [weekly.weekGoals]);

  // The single escalation: this run closed the week's mileage contract. Every
  // other banked run is covered by the inline arrival on the contract track.
  const currentWeekGoal = (weekly.weekGoals ?? []).find((w) => w.isCurrent) ?? null;
  const bankedActivityId = justBanked.banked?.activityId ?? null;
  const runMeters = justBanked.banked?.distanceMeters ?? 0;

  // FIX 2 (query race) — cross-reference the banked run's OWN date against the
  // same Monday..Sunday bounds `weekGoals` uses, independent of either
  // activities query's refetch timing. `weekly.weekGoals` and `justBanked`
  // (via `recentActs`, a DIFFERENT `useActivities` call/cache entry — see
  // `currentWeekActivityIds`'s doc comment) can disagree about this run
  // mid-refetch; the run's date does not depend on either query settling, so
  // it's a stable signal to build the rest of this on.
  // Null here (a banked row with no `local_date`) is not itself an error: it
  // just means this run can never be attributed to a week, so `runInCurrentWeek`
  // reads false and the mileage-contract MILESTONE silently can't fire for it —
  // but the run still gets ACKNOWLEDGED below (never "undecided" for a run that
  // was never going to land in a week), so it doesn't replay either.
  const bankedLocalDate = bankedActivityId
    ? recentActs.data?.find((a) => a.id === bankedActivityId)?.local_date ?? null
    : null;
  const currentWeekEnd = weekly.currentWeekStart ? addDays(weekly.currentWeekStart, 6) : '';
  const runInCurrentWeek =
    bankedLocalDate != null &&
    !!weekly.currentWeekStart &&
    bankedLocalDate >= weekly.currentWeekStart &&
    bankedLocalDate <= currentWeekEnd;

  // A run outside the current week's date bounds can never be the run that
  // closed THIS week's contract, however the (possibly stale) numbers happen
  // to read — without this guard a Sunday-evening run viewed the following
  // Monday could misattribute a milestone to a week it never belonged to.
  const contractJustMet =
    currentWeekGoal != null &&
    runInCurrentWeek &&
    crossedMileageContract(
      preRunMeters(currentWeekGoal.mileage.actualMeters, runMeters),
      currentWeekGoal.mileage.actualMeters,
      currentWeekGoal.mileage.targetMeters,
    );

  // The verdict for THIS run is UNDECIDED while it belongs to the current week
  // but `weekGoals`'s own activity set hasn't picked it up yet (the race
  // window). A run belonging to a DIFFERENT week is never undecided —
  // `weekGoals` will never include it, so `contractJustMet` above is already
  // final (false) for it, and there is nothing to wait for (constraint: must
  // not create a run that never gets acknowledged).
  //
  // `currentWeekGoal != null` gates this too — REGRESSION FIX: `weekGoals` has
  // no `isCurrent` entry whenever today's civil week isn't one of the plan's
  // weeks (plan finished, or installed to start next Monday). That's ordinary,
  // not an error state, but `currentWeekActivityIds` is derived from the same
  // "current plan week" concept and is permanently empty in it — with no
  // `currentWeekGoal` gate, `verdictUndecided` read true forever and the run
  // was NEVER acknowledged (Tier 1 replayed for the full 48h). A run can only
  // be "undecided" relative to a week that actually exists to decide it.
  const verdictUndecided =
    currentWeekGoal != null &&
    runInCurrentWeek && bankedActivityId != null && !weekly.currentWeekActivityIds.has(bankedActivityId);

  // The inline tier must not consume the acknowledgement while `verdictUndecided`
  // — otherwise a run that in fact closed the contract could get silently
  // acknowledged by the inline tier the instant before `weekGoals` catches up,
  // and `ContractMetMoment` would never get to render for it once the fresh
  // totals land (see Fix 2 in the review). This is intentionally NOT expressed
  // as "pass onArrivalSettled only when decided" (a fixed ~1.45s animation
  // timer could still elapse before a SLOW refetch resolves, permanently
  // burning the one-shot `onSettled` gate in `useArrivalMeters`). Instead the
  // visual-settle signal and the data-decided signal are tracked separately
  // below and joined by a plain effect, which is correct no matter how long
  // the refetch takes.
  const [arrivalSettled, setArrivalSettled] = useState(false);
  useEffect(() => {
    setArrivalSettled(false);
  }, [bankedActivityId]);
  const handleArrivalSettled = useCallback(() => setArrivalSettled(true), []);

  useEffect(() => {
    // `bankedActivityId == null` guards the commit where it just flipped to
    // null (e.g. right after this same effect's own previous acknowledge): the
    // sibling effect above queues `setArrivalSettled(false)` for THAT change,
    // but that reset isn't visible yet in this render — `arrivalSettled` is
    // still `true` here — so without this guard a changed `acknowledge`
    // identity (or any other dep) re-fires this effect for a run that no
    // longer exists, a redundant (harmless, but avoidable) AsyncStorage write.
    if (!arrivalSettled || contractJustMet || verdictUndecided || bankedActivityId == null) return;
    justBanked.acknowledge();
    // contractJustMet/verdictUndecided are plain booleans (not the objects
    // they're derived from) so this only re-runs on an actual decision change.
  }, [arrivalSettled, contractJustMet, verdictUndecided, bankedActivityId, justBanked.acknowledge]);

  if (bootError) {
    return (
      <Screen>
        <View style={styles.centered}>
          <ErrorState title="Couldn’t load your week" message={bootError.message} onRetry={onRetryBoot} />
        </View>
      </Screen>
    );
  }

  if (booting) {
    return (
      <Screen>
        <WeekTabSkeleton />
      </Screen>
    );
  }

  if (!weekly.plan || !weekly.summary) {
    // When no plan exists and Strava status is still loading, show loading state
    // to avoid flashing "Connect Strava" while the probe is in flight.
    if (stravaLoading) {
      return (
        <Screen>
          <WeekTabSkeleton />
        </Screen>
      );
    }

    // A first-run Dash with no plan reads as broken if it doesn't ALSO say
    // whether Strava is connected/importing (PM#1) — a fresh sign-up with
    // neither a plan nor a Strava connection saw only "paste a plan", no hint
    // that connecting Strava is the actual first step.
    const stravaConnected = stravaStatus?.connected ?? false;
    const importing = backfillStatus.kind === 'running' || backfillStatus.kind === 'rate_limited';
    const empty = !stravaConnected
      ? {
          title: 'Connect Strava to get started',
          body: 'Due builds your dash from your Strava history — connect to import your runs.',
          cta: 'Connect Strava',
          a11y: 'Connect Strava',
          onPress: () => router.push('/you'),
        }
      : importing
        ? {
            title: 'Importing your history',
            body:
              backfillStatus.kind === 'running'
                ? backfillStatus.label
                : 'Rate limited by Strava — resumes automatically.',
            cta: 'View progress',
            a11y: 'View sync progress',
            onPress: () => router.push('/you'),
          }
        : {
            title: 'No active plan yet',
            body: 'Paste a training plan to turn it into your active calendar.',
            cta: 'Import plan',
            a11y: 'Import plan',
            onPress: () => router.push('/plans'),
          };
    return (
      <Screen>
        <View style={styles.centered}>
          <Text style={styles.emptyTitle}>{empty.title}</Text>
          <Text style={styles.errorBody}>{empty.body}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={empty.a11y}
            onPress={empty.onPress}
            style={({ pressed }) => [styles.emptyBtn, pressed && styles.pressed]}
          >
            <Text style={styles.emptyBtnText}>{empty.cta}</Text>
          </Pressable>
        </View>
      </Screen>
    );
  }

  // Local context for the compact whole-block position rail.
  const planNumWeeks = header.numWeeks ?? weekly.plan?.num_weeks ?? 0;

  const blocks: StickyBlock[] = [];

  // Top bar REMOVED for the integrated-top prototype — plan chip / log-a-run /
  // profile will be re-slotted elsewhere. Left out so the integrated top can be
  // assessed without them.

  // Backfill/sync visibility (PM#1) — a compact row while a Strava history
  // import is running or halted on a rate limit; absent once idle/done so a
  // fully-synced account never carries a permanent row.
  if (backfillStatus.kind !== 'idle' && backfillStatus.kind !== 'done') {
    blocks.push({ kind: 'node', key: 'sync-status', node: <SyncStatusRow /> });
  }

  // Revoked Strava grant (deauthorized / dead refresh token): sync has stopped,
  // so say so at the top instead of letting the dash quietly go stale. Only a
  // resolved `connected: false` probe shows the row — loading/error never do.
  if (stravaStatus && !stravaStatus.connected && !stravaLoading) {
    blocks.push({ kind: 'node', key: 'strava-reconnect', node: <ReconnectStravaRow /> });
  }

  // Calendar unit — a dissolving section: its period label is the compact month
  // disclosure control, while the explicit Today action returns home. The pull
  // grip below the week rail remains the calendar's tactile expansion affordance.
  blocks.push({
    kind: 'section',
    key: 'calendar',
    label: calState.calendarExpanded
      ? calState.monthLabel || calState.weekLabel || 'Calendar'
      : calState.weekLabel ||
        `Week ${Math.max(1, weekly.currentWeekIndex)}/${weekly.plan?.num_weeks ?? 0}`,
    headerAction: {
      onPress: () => calRef.current?.openCalendar(),
      accessibilityLabel: calState.calendarExpanded
        ? 'Collapse month calendar'
        : 'Expand month calendar',
      expanded: calState.calendarExpanded,
    },
    // ONE conditional slot, two mutually exclusive orientations. Scrubbed off the
    // current week, the useful thing is the way back; sitting on it, the useful
    // thing is how long you have left. They never compete, so the slot always
    // holds the more relevant fact rather than a permanent fixture.
    //
    // The countdown pairs with the left label by design — "12/23" is already a
    // PLAN fact, so the row reads as plan orientation end to end. It is
    // deliberately eyebrow-weight, not a stat: the hero number on this screen is
    // the contract's, and a second bold numeral would compete with it.
    right: (
      <View style={styles.calRight}>
        {calState.offToday ? (
          <Pressable
            onPress={() => calRef.current?.scrollToToday()}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="Return to this week"
            style={({ pressed }) => [styles.todayPill, pressed && styles.pressed]}
          >
            <SymbolView name="arrow.uturn.backward" size={10} tintColor={C.ink} weight="bold" resizeMode="scaleAspectFit" />
            <Text style={styles.todayPillTxt} maxFontSizeMultiplier={1.25}>Today</Text>
          </Pressable>
        ) : raceCountdown ? (
          <Text
            style={styles.raceCountdown}
            numberOfLines={1}
            maxFontSizeMultiplier={1.25}
            accessibilityLabel={raceCountdownA11y ?? undefined}
          >
            {raceCountdown}
          </Text>
        ) : null}
      </View>
    ),
    bodyFlush: true,
    flush: true,
    body: (
      <CalendarTabs
        ref={calRef}
        onStateChange={handleCalState}
        initialWeekDays={weekly.weekDays}
        weekDaysFor={weekly.weekDaysFor}
        currentWeekStart={weekly.currentWeekStart}
        currentWeekNumber={Math.max(1, weekly.currentWeekIndex)}
        planWeeks={weekly.plan?.num_weeks ?? 0}
        easyBaseline={weekly.easyBaseline}
        weekGoals={weekly.weekGoals}
        weekDeficitMeters={weekDeficitMeters}
        weekSurplusMeters={weekSurplusMeters}
        focusDate={typeof calendarDate === 'string' ? calendarDate : undefined}
        onFocusDateHandled={handleCalendarDateApplied}
        onEditWeek={handleEditWeek}
        arrivalMeters={justBanked.banked?.distanceMeters ?? null}
        // This only reports that the visual tween has settled — it does NOT
        // decide who owns the acknowledgement. That decision (contractJustMet
        // / verdictUndecided, both computed above) is arbitrated by the
        // `arrivalSettled` effect, exactly once per run, so a query race
        // between `weekGoals` and `justBanked` can't burn the milestone (Fix 2).
        onArrivalSettled={handleArrivalSettled}
        dayPending={weekly.updating}
      />
    ),
  });

  // (The mileage contract + supporting Quality / Long run goals live FUSED into
  // the calendar card, above the grid, and scroll with the browsed week;
  // see WeekGauges in CalendarTabs.)

  // Block rail — one compact plan-position read. The current contract remains
  // on Week; the complete mileage profile and phase history live on Plan.
  if (planNumWeeks > 0 && adherence.statuses.length > 0) {
    const { settledN, hitN } = adherence;
    blocks.push({
      kind: 'node',
      key: 'block',
      node: (
        <BlockRail
          weeks={weekly.weekGoals}
          settledWeeks={settledN}
          hitWeeks={hitN}
          phaseLabel={header.phaseLabel}
          onOpenPlan={() => router.navigate('/(tabs)/plan')}
        />
      ),
    });
  }

  return (
    <Screen>
      <StickySections
        blocks={blocks}
        contentContainerStyle={{ paddingBottom: TAB_BAR_INSET }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.mute} />}
        footer={<PoweredByStrava />}
      />
      {contractJustMet && justBanked.banked && currentWeekGoal ? (
        <ContractMetMoment
          week={currentWeekGoal}
          run={{
            label: justBanked.banked.label,
            distanceMeters: justBanked.banked.distanceMeters,
            movingTimeS: justBanked.banked.movingTimeS,
          }}
          // `adherence.streak` counts back from the latest SETTLED week, so it
          // excludes the current one by construction — and the current one is
          // exactly the week this moment just closed. +1 makes it inclusive.
          streakWeeks={adherence.streak + 1}
          onView={() => {
            justBanked.acknowledge();
            router.push({ pathname: '/run/[id]', params: { id: justBanked.banked!.activityId } });
          }}
          onDismiss={justBanked.acknowledge}
        />
      ) : null}
    </Screen>
  );
}

/* ── Screen shell ──────────────────────────────────────────────────────── */

function Screen({ children }: { children: React.ReactNode }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        {children}
      </SafeAreaView>
    </View>
  );
}

const makeStyles = (C: Tokens) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: C.bg },
    safe: { flex: 1 },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
    pressed: { opacity: 0.6 },

    // Header — its gap to the first card must match the 26 between cards
    // (StickySections cardBody marginBottom), so the rhythm is even.
    // KPI tiles
    // Mileage-led week read: the one ring + runs count + a parallel quality bar.
    // The per-week goal-ring trend, fused under the current-week gauges.
    // Header legend mapping each goal to its ring colour.
    // Three-gauge row + the mileage breakout bar beneath it.
    // Section eyebrow right-hand text (Block + Showing-up sections)
    // "Return to today" jump control in the calendar header (shown when scrolled
    // off today's week). Neutral + a return arrow so it reads as an ACTION, not a
    // label saying the selected day is today (which the yellow text implied).
    calRight: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
    // Solid slate capsule — the canonical "jump to now" control. Its visible
    // face matches the 32 pt avatar; hitSlop preserves the 44 pt touch target.
    todayPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      backgroundColor: C.slate,
      borderRadius: radius.pill,
      height: 32,
      paddingHorizontal: space.m,
    },
    todayPillTxt: {
      ...eyebrowText(C, 'labelSm', C.ink),
    },
    // Matches the section label's register (same eyebrow tier, muted) so the row
    // reads as one caption with two ends, not a label plus a badge.
    raceCountdown: {
      ...eyebrowText(C, 'metadata', C.mute),
      flexShrink: 0,
    },

    // Boot / empty states
    emptyTitle: { fontSize: 20, fontWeight: '700', color: C.ink, marginBottom: space.sm },
    errorBody: { fontSize: fontSizes.body, color: C.mute, textAlign: 'center' },
    emptyBtn: {
      marginTop: space.lg,
      minHeight: 48,
      paddingHorizontal: space.xl,
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: C.yellow,
    },
    emptyBtnText: { fontSize: fontSizes.body, fontWeight: '800', color: C.accentInk },
  });
