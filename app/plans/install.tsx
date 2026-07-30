import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  LayoutAnimation,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';

import { useQueryClient } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Clipboard from 'expo-clipboard';

import { useSession } from '@/app-lib/auth';
import { closeScreen } from '@/app-lib/nav';
import { useAppPreferences } from '@/app-lib/preferences';
import { installPlanDraft, useMyPlans } from '@/app-lib/queries';
import { takePendingPlanText } from '@/lib/plan/pendingShare';
import {
  anchorPlan,
  buildPlanBlueprint,
  formatDuration,
  MAX_PLAN_TEXT_BYTES,
  MAX_PLAN_TEXT_LABEL,
  metersToUnits,
  nextMondayIso,
  normalizePlanDraft,
  parsePlanImport,
  planDistanceLabel,
  PlanImportError,
  PLAN_DESIGN_PROMPT,
  PLAN_IMPORT_PROMPT,
  todayIsoDate,
  workoutIntensityLabel,
  type AnchorTooClose,
  type ImportedPlanDraft,
  type PlanAnchor,
  type PlanBlueprintWeek,
  type RelativePlan,
} from '@/lib';
import { SheetHeader } from '@/components/SheetHeader';
import { AnchorSheet, formatAnchorDate } from '@/components/plan/AnchorSheet';
import { PlanArtwork } from '@/components/plan/PlanArtwork';
import { PlanBlueprint } from '@/components/plan/PlanBlueprint';
import { PlanLedger } from '@/components/plan/PlanLedger';
import { PlanOverviewContext } from '@/components/plan/PlanOverviewContext';
import { ActionButton, ActionButtonLabel } from '@/components/ActionButton';
import { ModalFooter } from '@/components/ModalFooter';
import { Chip } from '@/components/ui/Chip';
import { hairlineBottom, hairlineTop } from '@/components/ui/Divider';
import { statValueText } from '@/components/ui/Stat';

type ReviewWorkout = ImportedPlanDraft['workouts'][number];

import { useTheme, useThemedStyles } from '@/theme/ThemeProvider';
import { display, fontSizes, radius, space, typeRole, type Tokens } from '@/theme/tokens';

type Phase = 'import' | 'review';

/**
 * Read a `.due` file, refusing anything too large to be a training plan BEFORE
 * loading it into memory.
 *
 * The source is outside our control — a document picked from Files, or shared in
 * from another app — and `readAsStringAsync` materializes the whole thing, so an
 * unbounded read is a crash waiting to happen. `parsePlanImport` enforces the
 * same ceiling on the resulting text (and so also covers paste and share-in,
 * where no size is known up front); checking `getInfoAsync` first means an
 * oversized file is never read at all.
 */
async function readPlanFile(uri: string): Promise<string> {
  const info = await FileSystem.getInfoAsync(uri);
  const size = info.exists ? (info as { size?: number }).size : undefined;
  if (typeof size === 'number' && size > MAX_PLAN_TEXT_BYTES) {
    throw new Error(
      `That file is too large to be a training plan (limit ${MAX_PLAN_TEXT_LABEL}).`,
    );
  }
  return FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.UTF8 });
}

/**
 * Import a training plan — bring-your-own-AI, zero backend. The user copies Due's
 * prompt into their own AI (which converts any plan into Due's format), then
 * brings the result back as a `.due` file (the main path) or pastes it. We
 * validate (`parsePlanImport`) → review → `installPlanDraft`. No server.
 */
export default function InstallPlanScreen() {
  const styles = useThemedStyles(makeStyles);
  const C = useTheme();
  const router = useRouter();
  // When launched by opening / sharing a .due file (via +native-intent), `src` is
  // the file URI to read and import on mount.
  const { src } = useLocalSearchParams<{ src?: string }>();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { userId, ready } = useSession();
  const myPlans = useMyPlans(ready ? userId : null);
  const activePlan = myPlans.data?.find((p) => p.status === 'active') ?? null;

  const [phase, setPhase] = useState<Phase>('import');
  // The imported plan is dateless (a v3 `RelativePlan`); calendar dates enter only
  // via the `anchor` the runner picks at install time. `draft` (the dated,
  // normalized shape the review UI + install RPC consume) is derived, never stored.
  const [relative, setRelative] = useState<RelativePlan | null>(null);
  const [anchor, setAnchor] = useState<PlanAnchor>(() => ({ kind: 'start', startDate: nextMondayIso(todayIsoDate()) }));
  const [anchorOpen, setAnchorOpen] = useState(false);
  const [pasted, setPasted] = useState('');
  const [pasteOpen, setPasteOpen] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [copied, setCopied] = useState(false);
  // Which entry path: bring an existing plan, or have the AI design one.
  const [mode, setMode] = useState<'have' | 'need'>('have');
  const [aiGuideOpen, setAiGuideOpen] = useState(false);
  const copyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (copyResetRef.current) clearTimeout(copyResetRef.current); }, []);
  const [selectedReviewWeek, setSelectedReviewWeek] = useState<number | null>(null);

  // Anchor the dateless plan onto the calendar. `anchored` may refuse (race too
  // close / in the past) — then `draft` is null and the review shows the notice.
  const anchored = useMemo(() => (relative ? anchorPlan(relative, anchor, todayIsoDate()) : null), [relative, anchor]);
  const draft = useMemo<ImportedPlanDraft | null>(
    () => (anchored?.ok ? normalizePlanDraft(anchored.draft) : null),
    [anchored],
  );
  const tooClose: AnchorTooClose | null = anchored && !anchored.ok ? anchored : null;
  // The PREVIEW derivation (mirrors the starter preview's `displayDraft`): the
  // anchored draft when valid, else a full-length start anchor so the chart +
  // summary stay populated even when the race anchor is too close. Install keys
  // off `draft` (hard-disabled in the fallback); everything visual keys off this.
  const displayAnchored = useMemo(
    () =>
      anchored?.ok
        ? anchored
        : relative
          ? anchorPlan(relative, { kind: 'start', startDate: nextMondayIso(todayIsoDate()) }, todayIsoDate())
          : null,
    [anchored, relative],
  );
  const displayDraft = useMemo<ImportedPlanDraft | null>(
    () => (displayAnchored?.ok ? normalizePlanDraft(displayAnchored.draft) : null),
    [displayAnchored],
  );

  // The anchor summary row — "Starts Mon Jul 27" (start) or "Race Sat Oct 11 ·
  // join at week 4" (race, when the runner joins a trimmed block). Reflects the
  // raw anchor when the derivation refused, so the row still opens the sheet.
  const anchorSummary = useMemo(() => {
    if (anchored?.ok) {
      if (anchor.kind === 'race' && anchored.raceDate) {
        const join = anchored.joinAtWeek ? ` · join at week ${anchored.joinAtWeek}` : '';
        return `Race ${formatAnchorDate(anchored.raceDate)}${join}`;
      }
      return `Starts ${formatAnchorDate(anchored.startDate)}`;
    }
    return anchor.kind === 'race'
      ? `Race ${formatAnchorDate(anchor.raceDate)}`
      : `Starts ${formatAnchorDate(anchor.startDate)}`;
  }, [anchored, anchor]);

  const reviewBlueprint = useMemo(
    () => displayDraft ? blueprintFromDraft(displayDraft) : [],
    [displayDraft],
  );
  const reviewWorkouts = useMemo(() => {
    const grouped = new Map<number, ReviewWorkout[]>();
    for (const workout of displayDraft?.workouts ?? []) {
      if (workout.type === 'rest') continue;
      const rows = grouped.get(workout.weekIndex) ?? [];
      rows.push(workout);
      grouped.set(workout.weekIndex, rows);
    }
    return grouped;
  }, [displayDraft]);
  // The AI's assumptions (questions[]) + anchoring warnings (e.g. a tail workout
  // dropped on the race snap) + normalizer warnings, shown under "Heads up".
  const reviewNotes = useMemo(
    () =>
      displayDraft
        ? [
            ...(displayAnchored?.ok ? displayAnchored.warnings : []),
            ...displayDraft.questions,
            ...displayDraft.warnings,
          ]
        : [],
    [displayDraft, displayAnchored],
  );


  // ── Ingest (file open, paste, or shared-in .due) ─────────────────────────────
  const ingest = useCallback((text: string) => {
    try {
      const next = parsePlanImport(text); // dateless RelativePlan (v3)
      setRelative(next);
      setAnchor({ kind: 'start', startDate: nextMondayIso(todayIsoDate()) }); // fresh default
      setSelectedReviewWeek(null);
      setPasted('');
      setPhase('review');
    } catch (err) {
      Alert.alert(
        'Couldn’t import plan',
        err instanceof PlanImportError ? err.message : 'That file didn’t look like a Due plan. Try again.',
      );
    }
  }, []);

  useEffect(() => {
    if (phase !== 'review' || reviewBlueprint.length === 0) return;
    setSelectedReviewWeek((current) => (
      current != null && reviewBlueprint.some((week) => week.weekIndex === current)
        ? current
        : reviewBlueprint[0]!.weekIndex
    ));
  }, [phase, reviewBlueprint]);

  // Opened/shared a .due file → read it and jump to review (once per src).
  const ingestedSrc = useRef<string | null>(null);
  useEffect(() => {
    if (!src || ingestedSrc.current === src) return;
    ingestedSrc.current = src;
    (async () => {
      try {
        ingest(await readPlanFile(src));
      } catch (err) {
        Alert.alert('Couldn’t open the file', err instanceof Error ? err.message : 'Try opening it again.');
      }
    })();
  }, [src, ingest]);

  // Shared-in plan TEXT (from ShareIntentGate) — handed off in-memory, consumed once.
  useEffect(() => {
    const text = takePendingPlanText();
    if (text) ingest(text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onCopyPrompt = useCallback(async () => {
    try {
      await Clipboard.setStringAsync(mode === 'have' ? PLAN_IMPORT_PROMPT : PLAN_DESIGN_PROMPT);
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setCopied(true);
      if (copyResetRef.current) clearTimeout(copyResetRef.current);
      copyResetRef.current = setTimeout(() => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setCopied(false);
      }, 1800);
    } catch {
      Alert.alert('Couldn’t copy prompt', 'Please try again.');
    }
  }, [mode]);

  const onPickFile = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
        // Steer the picker at plan-shaped documents. Advisory only — the browser
        // sheet still lets a determined user choose anything — so `readPlanFile`
        // remains the actual guard.
        type: ['application/json', 'text/plain', 'public.json', 'public.plain-text'],
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset) return;
      ingest(await readPlanFile(asset.uri));
    } catch (err) {
      Alert.alert('Couldn’t read file', err instanceof Error ? err.message : 'Please choose another file.');
    }
  }, [ingest]);

  // ── Install (reused) ─────────────────────────────────────────────────────────
  const runInstall = useCallback(async () => {
    if (!draft) return;
    setInstalling(true);
    try {
      await installPlanDraft(draft, queryClient);
      router.dismissTo('/plan');
    } catch (err) {
      Alert.alert('Couldn’t install plan', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setInstalling(false);
    }
  }, [queryClient, draft, router]);

  const onInstall = useCallback(() => {
    if (!draft || installing) return;
    if (activePlan) {
      Alert.alert(
        `Install ${draft.plan.raceName}`,
        'Your current plan will be archived — its history is kept.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Install', style: 'destructive', onPress: () => void runInstall() },
        ],
      );
      return;
    }
    void runInstall();
  }, [activePlan, draft, installing, runInstall]);

  const guide =
    mode === 'have'
      ? {
          title: 'Convert a plan',
          intro: 'Turn a spreadsheet, PDF, screenshot, or written schedule into a Due plan.',
          s1Title: 'Copy the conversion prompt',
          s1Body: 'It tells any AI exactly how to structure the result.',
          s2Title: 'Add your current plan',
          s2Body: 'Paste the prompt into your AI, attach the plan, and save the resulting .due file.',
        }
      : {
          title: 'Create a plan',
          intro: 'Use any AI to design a new training block in Due’s portable format.',
          s1Title: 'Copy the design prompt',
          s1Body: 'It includes Due’s plan format and the questions your AI should ask.',
          s2Title: 'Design the block',
          s2Body: 'Paste the prompt into your AI, answer its questions, and save the resulting .due file.',
        };

  const topTitle = phase === 'review' ? 'Review plan' : aiGuideOpen ? guide.title : 'Import a plan';
  const leaveCurrentView = () => {
    if (phase === 'review') setPhase('import');
    else if (aiGuideOpen) setAiGuideOpen(false);
    else closeScreen(router);
  };

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={[]}>
        <SheetHeader
          navigation="back"
          navigationLabel={phase === 'review' ? 'Back to import' : aiGuideOpen ? 'Back to plan sources' : 'Back'}
          title={topTitle}
          onClose={leaveCurrentView}
          topInset={insets.top}
        />

        {phase === 'import' ? aiGuideOpen ? (
          <ScrollView contentContainerStyle={[styles.scroll, styles.scrollImport]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Text style={styles.aiGuideIntro}>{guide.intro}</Text>
            <Step n={1} title={guide.s1Title} body={guide.s1Body}>
              <ActionButton accessibilityLabel="Copy the import prompt" onPress={onCopyPrompt} color={C.yellow} variant="commit" style={styles.copyAction}>
                <View style={styles.openFileContent}>
                  <SymbolView name={copied ? 'checkmark' : 'doc.on.doc'} size={16} tintColor={C.accentInk} weight="bold" resizeMode="scaleAspectFit" />
                  <ActionButtonLabel>{copied ? 'Copied' : 'Copy prompt'}</ActionButtonLabel>
                </View>
              </ActionButton>
            </Step>
            <Step n={2} title={guide.s2Title} body={guide.s2Body} />
            <Step n={3} title="Return to Due" body="Open the .due file here, or paste its text below." last>
              <Pressable accessibilityRole="button" accessibilityLabel="Open the plan file" onPress={onPickFile} style={({ pressed }) => [styles.ctaBtn, styles.returnAction, pressed && styles.pressed]}>
                <SymbolView name="folder" size={16} tintColor={C.ink} weight="bold" resizeMode="scaleAspectFit" />
                <Text style={styles.ctaBtnText}>Open .due file</Text>
              </Pressable>
              <PastePlanControl
                open={pasteOpen}
                value={pasted}
                onToggle={() => setPasteOpen((open) => !open)}
                onChange={setPasted}
                onUse={() => ingest(pasted)}
              />
            </Step>
          </ScrollView>
        ) : (
          <ScrollView contentContainerStyle={[styles.scroll, styles.scrollImport]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <PlanArtwork kind="bring-your-own" aspectRatio={2.2} radiusMode="card" style={styles.importHero} />
            <Text style={styles.importTitle}>Bring your plan into Due</Text>
            <Text style={styles.sectionIntro}>Open a portable Due plan, paste one, or convert an existing schedule.</Text>
            <ActionButton accessibilityLabel="Open the plan file" onPress={onPickFile} color={C.yellow} variant="commit" style={styles.openFileBtn}>
              <View style={styles.openFileContent}>
                <SymbolView name="folder" size={16} tintColor={C.accentInk} weight="bold" resizeMode="scaleAspectFit" />
                <ActionButtonLabel>Open .due file</ActionButtonLabel>
              </View>
            </ActionButton>
            <PastePlanControl
              open={pasteOpen}
              value={pasted}
              onToggle={() => setPasteOpen((open) => !open)}
              onChange={setPasted}
              onUse={() => ingest(pasted)}
            />

            <Text style={styles.aiSectionTitle}>Create with AI</Text>
            <Text style={styles.sectionIntro}>Due supplies the exact prompt. Use it with any AI you prefer.</Text>
            <View style={styles.sourceList}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Convert an existing plan"
                onPress={() => { setMode('have'); setAiGuideOpen(true); }}
                style={({ pressed }) => [styles.sourceRow, pressed && styles.pressed]}
              >
                <SymbolView name="doc.text" size={18} tintColor={C.mute} resizeMode="scaleAspectFit" />
                <View style={styles.sourceCopy}>
                  <Text style={styles.sourceTitle}>Convert an existing plan</Text>
                  <Text style={styles.sourceMeta}>PDF, spreadsheet, screenshot, or text</Text>
                </View>
                <SymbolView name="chevron.right" size={12} tintColor={C.faint} resizeMode="scaleAspectFit" />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Create a new plan"
                onPress={() => { setMode('need'); setAiGuideOpen(true); }}
                style={({ pressed }) => [styles.sourceRow, styles.sourceRowLast, pressed && styles.pressed]}
              >
                <SymbolView name="sparkles" size={18} tintColor={C.mute} resizeMode="scaleAspectFit" />
                <View style={styles.sourceCopy}>
                  <Text style={styles.sourceTitle}>Create a new plan</Text>
                  <Text style={styles.sourceMeta}>Build a block from your goals and training</Text>
                </View>
                <SymbolView name="chevron.right" size={12} tintColor={C.faint} resizeMode="scaleAspectFit" />
              </Pressable>
            </View>
          </ScrollView>
        ) : relative ? (
          <ScrollView
            contentContainerStyle={[styles.reviewScroll, { paddingBottom: Math.max(152, insets.bottom + 136) }]}
            showsVerticalScrollIndicator={false}
          >
            {displayDraft && reviewBlueprint.length > 0 ? (
              <>
                <PlanOverviewContext
                  name={displayDraft.plan.raceName}
                  goalTime={displayDraft.plan.goalTimeSeconds ? `Goal ${formatDuration(displayDraft.plan.goalTimeSeconds)}` : null}
                  primaryFacts={`${planDistanceLabel(displayDraft.plan.distanceKind)} · ${displayDraft.plan.numWeeks} weeks`}
                  secondaryFacts={anchorSummary}
                  onSecondaryPress={() => setAnchorOpen(true)}
                  secondaryAccessibilityLabel="Change anchor"
                />
                {tooClose ? (
                  <View style={[styles.card, styles.panel]}>
                    <Text style={styles.noticeEyebrow}>{tooClose.reason === 'race-past' ? 'RACE PAST' : 'TOO CLOSE'}</Text>
                    <View style={styles.noticeStats}>
                      <View style={styles.noticeStat}>
                        <Text style={styles.noticeStatVal}>{tooClose.weeksAvailable}</Text>
                        <Text style={styles.noticeStatLab}>AVAILABLE</Text>
                      </View>
                      <View style={styles.noticeStat}>
                        <Text style={styles.noticeStatVal}>{tooClose.minWeeks}</Text>
                        <Text style={styles.noticeStatLab}>MINIMUM</Text>
                      </View>
                    </View>
                  </View>
                ) : null}

                {reviewNotes.length > 0 ? (
                  <View style={[styles.card, styles.panel]}>
                    <Text style={styles.panelTitle}>Heads up</Text>
                    {reviewNotes.slice(0, 5).map((line) => (
                      <Text key={line} style={styles.note}>• {line}</Text>
                    ))}
                    {reviewNotes.length > 5 ? <Text style={styles.moreText}>+ {reviewNotes.length - 5} more</Text> : null}
                  </View>
                ) : null}

                <PlanBlueprint
                  weeks={reviewBlueprint}
                  selectedWeekIndex={selectedReviewWeek ?? reviewBlueprint[0]!.weekIndex}
                  onSelectWeek={setSelectedReviewWeek}
                />
                <PlanLedger
                  weeks={reviewBlueprint}
                  selectedWeekIndex={selectedReviewWeek ?? reviewBlueprint[0]!.weekIndex}
                  onSelectWeek={setSelectedReviewWeek}
                  renderWeekDetails={(week) => (
                    <ReviewWeekSchedule workouts={reviewWorkouts.get(week.weekIndex) ?? []} />
                  )}
                />
              </>
            ) : null}
          </ScrollView>
        ) : null}

        {phase === 'review' && relative ? (
          <AnchorSheet
            plan={relative}
            anchor={anchor}
            onChange={setAnchor}
            tooClose={tooClose}
            visible={anchorOpen}
            onClose={() => setAnchorOpen(false)}
          />
        ) : null}

        {phase === 'review' ? (
          <ModalFooter style={styles.footer} bottomInset={insets.bottom}>
            <ActionButton
              accessibilityLabel="Install plan"
              loadingAccessibilityLabel="Installing plan"
              loadingLabel="Installing…"
              loading={installing}
              disabled={installing || !draft}
              onPress={onInstall}
              color={C.yellow}
              variant="commit"
              style={styles.primaryBtn}
            >
              <ActionButtonLabel>Install plan</ActionButtonLabel>
            </ActionButton>
          </ModalFooter>
        ) : null}
      </SafeAreaView>
    </View>
  );
}

function PastePlanControl({
  open,
  value,
  onToggle,
  onChange,
  onUse,
}: {
  open: boolean;
  value: string;
  onToggle: () => void;
  onChange: (value: string) => void;
  onUse: () => void;
}) {
  const C = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={open ? 'Hide paste plan text' : 'Show paste plan text'}
        accessibilityState={{ expanded: open }}
        onPress={onToggle}
        style={({ pressed }) => [styles.pasteToggle, pressed && styles.pressed]}
      >
        <Text style={styles.pasteToggleText}>Paste plan text</Text>
        <SymbolView name={open ? 'chevron.up' : 'chevron.down'} size={12} tintColor={C.mute} resizeMode="scaleAspectFit" />
      </Pressable>
      {open ? (
        <View style={styles.pasteBody}>
          <TextInput
            accessibilityLabel="Paste plan text"
            style={styles.pasteInput}
            value={value}
            onChangeText={onChange}
            placeholder="Paste .due text"
            placeholderTextColor={C.faint}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Use pasted text"
            disabled={!value.trim()}
            onPress={onUse}
            style={({ pressed }) => [styles.ctaBtn, styles.useCta, !value.trim() && styles.ctaDisabled, pressed && styles.pressed]}
          >
            <Text style={styles.ctaBtnText}>Use pasted text</Text>
          </Pressable>
        </View>
      ) : null}
    </>
  );
}

/** One compact step in the real import sequence. */
function Step({ n, title, body, last, children }: { n: number; title: string; body?: string; last?: boolean; children?: React.ReactNode }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.step}>
      <Text style={styles.stepNum}>{n}</Text>
      <View style={[styles.stepBody, last && styles.stepBodyLast]}>
        <Text style={styles.stepTitle}>{title}</Text>
        {body ? <Text style={styles.stepText}>{body}</Text> : null}
        {children}
      </View>
    </View>
  );
}

function ReviewWeekSchedule({ workouts }: { workouts: ReviewWorkout[] }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.reviewWeekSchedule}>
      <Text style={styles.scheduleTitle}>Planned runs</Text>
      {workouts.length > 0 ? workouts.map((workout, index) => (
        <ReviewWorkoutRow key={`${workout.date}-${workout.title}-${index}`} workout={workout} />
      )) : <Text style={styles.scheduleEmpty}>No runs scheduled.</Text>}
    </View>
  );
}

/** The pre-install equivalent of the Plan tab's View week drill. */
function ReviewWorkoutRow({ workout }: { workout: ReviewWorkout }) {
  const C = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { preferences } = useAppPreferences();
  const units = preferences.distance;
  const isQuality = workout.isQuality || workout.type === 'race';
  const dotColor = workout.type === 'long' || workout.type === 'race'
    ? C.cyan
    : isQuality
      ? C.qual
      : C.mute;
  const intensity = workoutIntensityLabel(workout.structure);
  const showIntensity = intensity != null && !workout.title.toLowerCase().includes(intensity.toLowerCase());
  const distance =
    workout.plannedDistanceMeters && workout.plannedDistanceMeters > 0
      ? metersToUnits(workout.plannedDistanceMeters, units).toFixed(1)
      : null;
  return (
    <View style={styles.dayRow}>
      <Text style={styles.dayDate} numberOfLines={1}>{shortDay(workout.date)}</Text>
      <View style={[styles.dayDot, { backgroundColor: dotColor }]} />
      <Text style={[styles.dayTitle, isQuality && styles.dayTitleQ]} numberOfLines={1}>{workout.title}</Text>
      {showIntensity ? <Chip label={intensity} style={styles.intensityChip} /> : null}
      {distance != null ? (
        <View style={styles.dayRight}>
          <Text style={styles.dayDist} numberOfLines={1}>{distance}</Text>
          <Text style={styles.dayMicro}>{units.toUpperCase()}</Text>
        </View>
      ) : null}
    </View>
  );
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Mon 15" from a 'YYYY-MM-DD' date — matches <DayRow/>'s date column. */
function shortDay(date: string): string {
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
  return `${WEEKDAYS[dow]} ${Number(date.slice(8, 10))}`;
}

function blueprintFromDraft(draft: ImportedPlanDraft): PlanBlueprintWeek[] {
  const workoutsByWeek = new Map<number, ImportedPlanDraft['workouts']>();
  for (const workout of draft.workouts) {
    const rows = workoutsByWeek.get(workout.weekIndex) ?? [];
    rows.push(workout);
    workoutsByWeek.set(workout.weekIndex, rows);
  }
  return buildPlanBlueprint(draft.weeks.map((week) => ({
    weekId: `review-week-${week.weekIndex}`,
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
      id: `review-${week.weekIndex}-${index}`,
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

const makeStyles = (C: Tokens) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: C.bg },
    safe: { flex: 1 },
    card: { backgroundColor: C.card, borderColor: C.line, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md },
    // Structurally SheetHeader's grammar: back action, `space.md` gap, then a
    // shrinkable left-aligned title. It was `space-between` with a centered
    // title balanced against an empty spacer opposite the back button — a
    // layout that only worked because the back button was 70pt of text.
    scroll: { paddingHorizontal: space.lg, paddingTop: space.md },
    scrollImport: { paddingTop: space.xl, paddingBottom: space.xxl },
    reviewScroll: { paddingTop: space.md },
    importHero: { marginBottom: space.lg },

    // The real import sequence earns numbering; quiet ledger numerals keep it
    // from reading like an onboarding illustration.
    step: { flexDirection: 'row', gap: space.md },
    stepNum: { ...statValueText(C, 'label', 'system'), width: 24, paddingTop: space.s, fontWeight: '800', color: C.faint },
    stepBody: { flex: 1, paddingBottom: space.xl },
    stepBodyLast: { paddingBottom: 0 },
    stepTitle: { fontSize: fontSizes.sectionTitle, fontWeight: '800', color: C.ink, letterSpacing: -0.2, marginTop: space.s },
    stepText: { marginTop: space.xs, fontSize: fontSizes.label, lineHeight: 19, fontWeight: '600', color: C.mute },

    // Shared quiet action; the open-file action above is the primary commit.
    ctaBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: space.s,
      minHeight: 52,
      borderRadius: radius.md,
      backgroundColor: C.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: C.line,
    },
    ctaBtnText: { fontSize: fontSizes.body, fontWeight: '800', color: C.ink },
    ctaDisabled: { opacity: 0.4 },
    useCta: { marginTop: space.md },
    importTitle: { color: C.ink, fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
    sectionIntro: { marginTop: space.xs, maxWidth: 340, color: C.mute, fontSize: fontSizes.label, lineHeight: 18, fontWeight: '600' },
    openFileBtn: { marginTop: space.lg },
    openFileContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.s },
    aiGuideIntro: { maxWidth: 340, marginBottom: space.lg, color: C.mute, fontSize: fontSizes.labelLg, lineHeight: 20, fontWeight: '600' },
    copyAction: { width: '100%', marginTop: space.md },
    returnAction: { marginTop: space.md },
    aiSectionTitle: { marginTop: space.xxl, color: C.ink, fontSize: fontSizes.sectionTitle, lineHeight: 23, fontWeight: '800', letterSpacing: -0.25 },
    sourceList: { overflow: 'hidden', marginTop: space.md, borderRadius: radius.md, backgroundColor: C.card, borderWidth: StyleSheet.hairlineWidth, borderColor: C.line },
    sourceRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, ...hairlineBottom(C) },
    sourceRowLast: { borderBottomWidth: 0 },
    sourceCopy: { flex: 1, minWidth: 0 },
    sourceTitle: { color: C.ink, fontSize: fontSizes.labelLg, lineHeight: 19, fontWeight: '800' },
    sourceMeta: { marginTop: space.xxs, color: C.mute, fontSize: fontSizes.labelSm, lineHeight: 16, fontWeight: '600' },
    pasteToggle: { minHeight: 52, marginTop: space.md, paddingHorizontal: space.sm, ...hairlineBottom(C), flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    pasteToggleText: { color: C.ink, fontSize: fontSizes.label, fontWeight: '700' },
    pasteBody: { paddingBottom: space.md },
    pasteInput: {
      marginTop: space.lg,
      minHeight: 72,
      borderRadius: radius.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: C.line,
      backgroundColor: C.fill,
      paddingHorizontal: space.md,
      paddingTop: space.m,
      paddingBottom: space.m,
      fontSize: fontSizes.label,
      color: C.ink,
      textAlignVertical: 'top',
    },

    // Too-close / race-past inline notice (label register — eyebrow + stats).
    noticeEyebrow: { fontSize: fontSizes.labelSm, fontWeight: '800', color: C.pink, letterSpacing: 0.6 },
    noticeStats: { flexDirection: 'row', gap: space.xl, marginTop: space.m },
    noticeStat: { alignItems: 'flex-start' },
    noticeStatVal: { fontSize: 22, fontWeight: '800', color: C.ink, fontVariant: ['tabular-nums'] },
    noticeStatLab: { marginTop: space.xxs, fontSize: fontSizes.micro, fontWeight: '800', color: C.mute, letterSpacing: 0.5 },

    // Review.
    panel: { marginHorizontal: space.lg, padding: space.lg, marginBottom: space.l },
    panelTitle: { fontSize: fontSizes.sectionTitle, fontWeight: '800', color: C.ink, letterSpacing: -0.2, marginBottom: space.s },
    note: { marginTop: space.sm, fontSize: fontSizes.label, lineHeight: 19, fontWeight: '600', color: C.mute },
    moreText: { paddingTop: space.m, fontSize: fontSizes.metadata, fontWeight: '700', color: C.mute },
    reviewWeekSchedule: {
      paddingHorizontal: space.lg,
      paddingBottom: space.md,
      ...hairlineTop(C),
    },
    scheduleTitle: { paddingVertical: space.md, color: C.mute, fontSize: fontSizes.labelSm, fontWeight: '800' },
    scheduleEmpty: { paddingBottom: space.md, color: C.mute, fontSize: fontSizes.metadata, fontWeight: '600' },
    dayRow: {
      height: 48,
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.m,
      ...hairlineTop(C),
    },
    dayDate: { ...statValueText(C, 'labelSm', 'system'), width: 52, fontWeight: '600', color: C.mute },
    dayDot: { width: 7, height: 7, borderRadius: 3.5 },
    dayTitle: { flex: 1, minWidth: 0, fontSize: fontSizes.labelLg, fontWeight: '500', color: C.ink, letterSpacing: -0.2 },
    dayTitleQ: { fontWeight: '700' },
    // `flexShrink: 0` keeps the Chip's own shrink off: in this row the flexible
    // title is what gives way under a long workout name, never the intensity tag.
    intensityChip: { marginLeft: space.s, flexShrink: 0 },
    dayRight: { alignItems: 'flex-end' },
    dayDist: { ...statValueText(C, 'body', 'system'), fontWeight: '700' },
    dayMicro: { fontSize: fontSizes.micro, fontWeight: '700', color: C.faint, letterSpacing: 0.4, marginTop: 1 },

    footer: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      flexDirection: 'row',
      gap: space.md,
    },
    primaryBtn: { width: '100%' },
    pressed: { opacity: 0.72 },
  });
