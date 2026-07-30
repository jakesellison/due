/**
 * SessionView — the run-readout (run detail). A WHOOP-style run detail wired to
 * a REAL activity (deep-link duerunning://run/<id>), themed by the app's
 * ThemeProvider (light/dark). Charts plot real stream data via @/lib
 * (paceSeries / hrSeries / mileSplits); the route is the real polyline. The two
 * orthogonal axes — intrinsic session-type detection and the relational
 * plan-match verdict — compose in the headline chips and drill body.
 *
 * Extracted from app/run/[id].tsx so a second route can render the same tree.
 * Takes activityId (the resolved path); workoutId is accepted for a later task
 * and is currently unused.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, ActivityIndicator, Alert, Animated, Image, LayoutAnimation, Modal, PanResponder, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Svg, { Path, Line as SvgLine, Circle, Defs, LinearGradient, RadialGradient, Stop, Rect, Text as SvgText } from 'react-native-svg';
import { useQueryClient } from '@tanstack/react-query';

import { useSession } from '@/app-lib/auth';
import { useAppPreferences, type DistancePreference, type TemperaturePreference } from '@/app-lib/preferences';
import { detachRouteFromWorkout, useWorkoutRoute, type SavedRoute } from '@/app-lib/routes';
import { closeScreen } from '@/app-lib/nav';
import { OverlayNav } from '@/components/OverlayNav';
import { RoundIconButton } from '@/components/RoundIconButton';
import { cardSurface } from '@/components/Card';
import { Divider, hairlineBottom, hairlineTop } from '@/components/ui/Divider';
import { eyebrowText } from '@/components/ui/Eyebrow';
import { Stat, statValueText } from '@/components/ui/Stat';
import { SheetHeader } from '@/components/SheetHeader';
import { PrescriptionBar } from '@/components/StructureBar';
import { WorkoutEditorModal } from '@/components/planner/WorkoutEditorModal';
import type { BuiltWorkout } from '@/components/planner/WorkoutBuilder';
import { useActivities, useActivity, useActivePlan, useRacePrediction, useWeeklyMileage, useWorkoutDetail, useSetQualityOverride as useSetColumnOverride, type ActivityRow, type WorkoutDetail, type WorkoutRow } from '@/app-lib/queries';
import { deletePlannedWorkout, saveWeekEdits } from '@/app-lib/weekEdit';
import { useActivityQualityDetect, useSetQualityOverride } from '@/app-lib/qualityCredit';
import type { Reading } from '@/lib/kpi/interpretWorkout';
import type { QualityOverride } from '@/lib/kpi/resolveQuality';
import { buildDrillVerdict, type DrillVerdict, type DrillSet, type RepRow } from '@/lib/kpi/drillVerdict';
import { assignMatches } from '@/lib/match/assign';
import { runnerRacePaces } from '@/lib/kpi/targetPace';
import { prescribedSets } from '@/lib/kpi/prescribedSets';
import {
  averagePace,
  deriveQualityFloor,
  dominantWorkLabel,
  estimateQualityFloor,
  estimateWorkoutDurationSec,
  FALLBACK_EASY_BASELINE_SEC_PER_MI,
  formatDistance,
  formatDuration,
  formatDurationApprox,
  formatPace,
  formatRepDist,
  formatTemperature,
  hrSeries,
  METERS_PER_MILE,
  metersToUnits,
  metersToMiles,
  mileSplits,
  paceCurve,
  paceDurationCurveFromPrecomputed,
  mapboxStaticUrl,
  mapboxBasemapUrl,
  fitMapView,
  mercatorProjector,
  paceGridlines,
  paceSeries,
  prescribedQualityMeters,
  routeDistanceFit,
  routePlanningBlock,
  structureBarSegments,
  structureLines,
  workoutIntensityLabel,
  workoutTone,
  DEFAULT_TITLES,
  type CurveActivity,
  type QualityDetect,
  type RunStream,
  type RunStreams,
  type StravaLap,
  type WorkoutTone,
  type WorkoutType,
} from '@/lib';
import { snapIntervals, type SnappedRep } from '@/lib/kpi/intervalSnap';
import { interpretWorkout, type QualityFloorRefs } from '@/lib/kpi/interpretWorkout';
import { buildGap } from '@/lib/kpi/gap';
import { resolveQuality } from '@/lib/kpi/resolveQuality';
import { readingToDetect } from '@/lib/kpi/readingToDetect';
import { planQualityFromWorkout } from '@/lib/kpi/planQuality';
import { STREAM_SUMMARY_VERSION } from '@/lib/kpi/ingestVerdict';
import { decimateMean } from '@/lib/run/decimate';
import {
  fullDomain,
  isZoomed,
  minZoomSpanMi,
  panDomainBy,
  pinchZoomDomain,
  resetDomain,
  type Domain,
} from '@/lib/run/zoomDomain';
import { hasUsableStreams } from '@/components/run/streams';
import { ErrorState } from '@/components/ErrorState';
import { ActionButton, ActionButtonLabel } from '@/components/ActionButton';
import { StravaAttribution } from '@/components/StravaAttribution';
import { RouteMapView } from '@/components/run/RouteMapView';
import { appleMaps, appleMapsAvailable, mapboxToken, MAPBOX_STYLE, MUTED_EMPHASIS } from '@/app-lib/maps';
import { rnMapbox, rnMapboxAvailable } from '@/app-lib/rnmapbox';
import { dataRegular, fontSizes, radius, space, THEMES, type Tokens } from '@/theme/tokens';
import { toneColorOr } from '@/theme/tone';
import { useScheme } from '@/theme/ThemeProvider';

// Theme: driven by the app ThemeProvider (system light/dark). `C`/`styles` are
// module bindings reassigned at the screen root each render, with a key={scheme}
// remount, so every read-only component picks up the active skin. (Pragmatic
// port of the prototype's pattern; a per-component useThemedStyles pass can
// follow without changing the look.)
let C: Tokens = THEMES.dark;
let DIST_UNITS: DistancePreference = 'mi';
let TEMP_UNITS: TemperaturePreference = 'fahrenheit';

// SessionView is a single mounted drill surface. Keep its prototype-era shared
// geometry bindings, but refresh them from useWindowDimensions on every root
// render so charts and maps survive rotation, resizing, and split view.
let SCREEN_W = 390;
let PANEL_W = SCREEN_W - space.lg * 2; // matches the 16px scroll inset
let CHART_W = PANEL_W - 32; // matches IW so charts align with legend/controls/panels
let IW = CHART_W;
const GAP = 16; // standard vertical rhythm between stacked blocks inside a section/sheet
const HR_MAX_EST = 188;

// A fixed, label-free Boston basemap crop: real cartographic texture without a
// fake route, a location claim, or an implicit recommendation.
const EXAMPLE_MAP_VIEW = { center: [-71.0835, 42.3630] as [number, number], zoom: 13.25 };

export function SessionView({ activityId, workoutId }: { activityId?: string; workoutId?: string }) {
  // activityId / workoutId are mutually exclusive entry points. A run deep-link
  // resolves an activity directly; a plan deep-link resolves a workout, then its
  // matched run (Completed-planned == the run readout) or — when nothing ran yet
  // — the prescribed/planned state.
  const id = activityId;
  const router = useRouter();
  const { width: viewportWidth } = useWindowDimensions();
  const { userId, ready } = useSession();
  const { preferences } = useAppPreferences();
  // HOOK-ORDER SAFETY: all three resolvers run unconditionally every render; the
  // ones not in play are fed a null id (their queries short-circuit to an idle
  // result), so React always sees the same hook sequence regardless of which path
  // renders.
  const detail = useActivity(ready ? userId : null, activityId ?? null);
  const wd = useWorkoutDetail(ready ? userId : null, workoutId ?? null);
  // When a workout deep-link matched a run, drive the full run readout with it.
  const matchedPrimary = workoutId != null ? primaryActivity(wd.matchedActivities, wd.primaryActivityId) : null;
  // Re-fetch the matched activity's DETAIL row (full-res streams/route/laps) so
  // Body doesn't render off the lean matched row from the list query. This call
  // must be unconditional — null id when not on the workoutId path or no match
  // yet — to keep hook order stable across renders.
  const matchedDetail = useActivity(ready ? userId : null, matchedPrimary?.id ?? null);
  // Active skin from the app ThemeProvider (OS scheme + user preference). Reassign
  // the module bindings here so the read-only component tree below them picks up
  // the live tokens; key={scheme} remounts on a theme change.
  const scheme = useScheme();
  DIST_UNITS = preferences.distance;
  TEMP_UNITS = preferences.temperature;
  C = THEMES[scheme];
  SCREEN_W = viewportWidth;
  PANEL_W = SCREEN_W - space.lg * 2;
  CHART_W = PANEL_W - 32;
  IW = CHART_W;
  styles = makeStyles(C);

  // The active resolver for the loading/error gate (the inert one is idle).
  const active = workoutId != null ? wd : detail;

  const content = (() => {
    if (!ready || active.loading) {
      return <View style={styles.centered}><ActivityIndicator color={C.yellow} /></View>;
    }
    if (active.error) {
      return (
        <View style={styles.centered}>
          <ErrorState title="Couldn’t load this run" message={active.error.message} onRetry={active.refetch} />
        </View>
      );
    }
    if (workoutId != null) {
      if (!wd.workout) {
        return <View style={styles.centered}><Text style={styles.err}>Workout not found</Text></View>;
      }
      // Completed-planned: a matched run → the same tree as run/[id].
      // Wait for the detail refetch before rendering Body so we never flash "Run
      // not found" while the full-res row is in flight.
      if (matchedPrimary) {
        if (matchedDetail.loading) {
          return <View style={styles.centered}><ActivityIndicator color={C.yellow} /></View>;
        }
        // Render with the detail row (full-res streams/route/laps). Fall back to
        // the lean matched row only if the detail fetch returned null (should not
        // happen in practice — same id — but prevents a blank screen).
        const activityForBody = matchedDetail.activity ?? matchedPrimary;
        return <Body activity={activityForBody} weekIndex={wd.weekIndex} userId={userId} knownWorkout={wd.workout} />;
      }
      // Upcoming / missed: no run yet → the planned readout.
      return <PlannedBody wd={wd} userId={userId} />;
    }
    if (!detail.activity) {
      return <View style={styles.centered}><Text style={styles.err}>Run not found</Text></View>;
    }
    return <Body activity={detail.activity} weekIndex={detail.weekIndex} userId={userId} />;
  })();

  return (
    <View style={styles.root} key={scheme}>
      {/* Status bar text rides over the map top — light over dark tiles, dark over light. */}
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      {/* No top edge: the hero map bleeds up through the notch; the hero pads its
          own nav buttons below the inset. */}
      {/* Read-only detail — dismissal is the hero's top-left X (+ swipe). No
          docked "Done": a dismiss-only bar duplicated the X and ate ~80pt of
          the sheet (dismissal standard: X closes, docked bar is commit-only). */}
      <SafeAreaView style={styles.safe} edges={[]}>
        {content}
      </SafeAreaView>
    </View>
  );
}

/**
 * Pick the activity that best represents a workout's run: prefer the one the
 * day-pairing attributed to this workout (`preferredId`), then any with usable
 * streams, breaking ties by greatest distance (the main run, not a tiny
 * cross-training blip on the same day). Moved here from app/workout/[id] when
 * that route collapsed into a SessionView wrapper.
 */
function primaryActivity(activities: ActivityRow[], preferredId: string | null): ActivityRow | null {
  if (preferredId) {
    const preferred = activities.find((a) => a.id === preferredId);
    if (preferred) return preferred;
  }
  const withData = activities.filter((a) => a.stream_summary != null || hasUsableStreams(a.streams));
  const pool = withData.length > 0 ? withData : activities;
  if (pool.length === 0) return null;
  return [...pool].sort((a, b) => (b.distance_meters ?? 0) - (a.distance_meters ?? 0))[0] ?? null;
}

/**
 * BANKED FORWARD — the one line that connects a day to the week it fed.
 *
 * The week is the contract; the runs are the allocation (PRODUCT.md). A day
 * screen that never names its week leaves the runner reading a day as if it
 * were the verdict, which is exactly the frame this product rejects. So every
 * run/workout detail carries the day's contribution and the week's resulting
 * position — labels + numbers, no narrated sentence (DESIGN.md's copy rule).
 *
 * The contribution is labelled `Banked`, not "this run": the hero already states
 * the run's distance, and repeating a fact is only allowed when the second
 * occurrence answers a different question. `Banked` is the canonical contract
 * term, so the pair reads as one ledger line (what this day put in, where the
 * week now stands) rather than the hero numeral said twice.
 *
 * `weekly.summary.weeks` already holds banked-vs-target for EVERY plan week, so
 * a run from six weeks ago shows ITS week's totals rather than today's. When
 * the week can't be resolved (no plan, unplanned activity, a week with no
 * contract) the line is omitted entirely — a wrong week is worse than none.
 */
function WeekBanked({ weekIndex, contributionMeters, userId }: {
  weekIndex: number | null;
  /** The day's own banked distance. Null on a day that banked nothing (planned/missed). */
  contributionMeters: number | null;
  userId: string | null;
}) {
  const weekly = useWeeklyMileage(userId);
  const bar = weekIndex != null
    ? weekly.summary?.weeks.find((week) => week.weekIndex === weekIndex) ?? null
    : null;
  if (!bar || bar.targetMeters <= 0) return null;
  const banked = metersToUnits(bar.actualMeters, DIST_UNITS);
  const target = metersToUnits(bar.targetMeters, DIST_UNITS);
  return (
    <View style={styles.weekLine}>
      {contributionMeters != null ? (
        <Stat
          testID="session-week-contribution"
          label="Banked"
          value={metersToUnits(contributionMeters, DIST_UNITS).toFixed(1)}
          unit={DIST_UNITS}
          size="labelLg"
          labelPlacement="above"
        />
      ) : null}
      <Stat
        testID="session-week-banked"
        label={`Week ${weekIndex}`}
        value={`${banked.toFixed(1)} / ${target.toFixed(1)}`}
        unit={DIST_UNITS}
        size="labelLg"
        labelPlacement="above"
      />
    </View>
  );
}


/**
 * The planned state — an upcoming or missed quality/easy day that hasn't been
 * run. Reuses the hero header and the Week card's prescription grammar: session
 * shape first, then concise structure rows and the resolved primary work pace.
 * A neutral Planned chip (Missed, once the date is past) stands in for
 * the run's verdict. No pace/HR/route/splits — there is no run to chart.
 */
function PlannedBody({ wd, userId }: { wd: WorkoutDetail; userId: string | null }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const w = wd.workout!;
  const type = w.type ?? 'easy';
  const prediction = useRacePrediction(userId);
  const weeklyMileage = useWeeklyMileage(userId);
  const easyBaseline = Number.isFinite(weeklyMileage.easyBaseline) && weeklyMileage.easyBaseline > 0
    ? weeklyMileage.easyBaseline
    : FALLBACK_EASY_BASELINE_SEC_PER_MI;
  const activePlan = useActivePlan(userId);
  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const paces = useMemo(
    () => runnerRacePaces(prediction?.prediction?.seconds ?? 0),
    [prediction?.prediction?.seconds],
  );
  const sets = useMemo(
    () => (w.is_quality ? prescribedSets(w.structure, paces) : []),
    [w.is_quality, w.structure, paces],
  );
  const plannedMeters =
    w.planned_distance_meters != null && w.planned_distance_meters > 0 ? w.planned_distance_meters : 0;
  const distance = plannedMeters > 0 ? metersToUnits(plannedMeters, DIST_UNITS) : 0;
  const date = longDate(w.date);
  const missed = w.date != null && wd.today > w.date;
  const routeBlocked = routePlanningBlock(
    { type: w.type, date: w.date, plannedDistanceMeters: w.planned_distance_meters },
    wd.today,
    wd.matchedActivities.length > 0,
  );
  const intensity = workoutIntensityLabel(w.structure);
  const prescription = structureLines(w.structure ?? [], DIST_UNITS);
  const prescriptionSegments = structureBarSegments(w.structure ?? []);
  const drillTone = workoutTone({ type: w.type, is_quality: w.is_quality, structure: w.structure ?? [] });
  const drillAccent = toneColorOr(C, drillTone);
  const drillType = [
    ({ easy: 'Easy', long: 'Long', quality: 'Quality', speed: 'Speed' } satisfies Record<WorkoutTone, string>)[drillTone],
    dominantWorkLabel(w.structure ?? []),
  ].filter(Boolean).join('  ');
  const drillIcon = drillTone === 'long'
    ? 'mountain.2.fill' as const
    : drillTone === 'easy'
      ? 'figure.run' as const
      : drillTone === 'speed'
        ? 'stopwatch.fill' as const
        : 'bolt.fill' as const;
  const estimatedDuration = w.planned_duration_s != null && w.planned_duration_s > 0
    ? w.planned_duration_s
    : estimateWorkoutDurationSec(w.structure ?? [], plannedMeters, easyBaseline, paces);
  const workTarget = sets[0]?.targetSecPerMi != null
    ? `${sets[0].zoneLabel ?? 'target'} ${fmtPace(paceSecPerUnitFromMi(sets[0].targetSecPerMi))}/${DIST_UNITS}`
    : null;
  const editorType: BuiltWorkout['type'] = w.is_quality
    ? 'quality'
    : type === 'long'
      ? 'long'
      : type === 'cross'
        ? 'cross'
        : 'easy';
  const initialWorkout = useMemo<BuiltWorkout>(() => ({
    type: editorType,
    title: w.title ?? '',
    distanceMeters: plannedMeters,
    durationSeconds: w.planned_duration_s,
    structure: w.structure ?? [],
  }), [editorType, plannedMeters, w.planned_duration_s, w.structure, w.title]);

  const saveWorkout = useCallback(async (workout: BuiltWorkout) => {
    const planId = activePlan.data?.plan?.id;
    if (!planId || !w.week_id || !w.date || saving) return;
    const editedType = workout.type as WorkoutType;
    const title = workout.title.trim() || DEFAULT_TITLES[editedType];
    const isQuality = editedType === 'quality';
    const qualityMeters = isQuality
      ? workout.structure.length
        ? prescribedQualityMeters(workout.structure, workout.distanceMeters, { paces })
        : workout.distanceMeters
      : null;
    const op = {
      kind: 'updateWorkout' as const,
      workoutId: w.id,
      type: editedType,
      title,
      plannedDistanceMeters: Math.round(workout.distanceMeters),
      plannedDurationSeconds: workout.durationSeconds,
      isQuality,
      prescribedQualityMeters: qualityMeters != null ? Math.round(qualityMeters) : null,
      structure: workout.structure,
    };
    setSaving(true);
    try {
      await saveWeekEdits({
        planId,
        weekId: w.week_id,
        finalDays: [{
          id: w.id,
          date: w.date,
          type: editedType,
          title,
          plannedDistanceMeters: workout.distanceMeters,
          plannedDurationSeconds: workout.durationSeconds,
          isQuality,
          prescribedQualityMeters: qualityMeters,
          structure: workout.structure,
        }],
        ops: [op],
        queryClient,
      });
      wd.refetch();
    } catch (error) {
      Alert.alert('Couldn’t save workout', error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      setSaving(false);
    }
  }, [activePlan.data?.plan?.id, paces, queryClient, saving, w.date, w.id, w.week_id, wd]);
  const confirmDeleteWorkout = useCallback(() => {
    const planId = activePlan.data?.plan?.id;
    if (!planId || !w.date || saving) return;
    Alert.alert(
      'Delete this run?',
      `${w.title ?? 'This run'} will be removed from the plan. This can’t be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete run',
          style: 'destructive',
          onPress: () => {
            setSaving(true);
            void deletePlannedWorkout({
              planId,
              workoutId: w.id,
              date: w.date!,
              title: w.title ?? 'Run',
              queryClient,
            })
              .then(() => {
                setEditOpen(false);
                closeScreen(router);
              })
              .catch((error) => {
                Alert.alert('Couldn’t delete run', error instanceof Error ? error.message : String(error));
              })
              .finally(() => setSaving(false));
          },
        },
      ],
    );
  }, [activePlan.data?.plan?.id, queryClient, router, saving, w.date, w.id, w.title]);
  // Split roles: the kicker carries the plan context (week + type + intensity),
  // the eyebrow is the quiet date line. Typography separates, not glyphs.
  const kicker = [wd.weekIndex != null ? `Wk ${wd.weekIndex}` : null, capWord(type), intensity ? intensity.toUpperCase() : null]
    .filter(Boolean)
    .join('  ');

  return (
    <>
    <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: Math.max(30, insets.bottom + 24) }]} showsVerticalScrollIndicator={false}>
      <HeroMap
        route={null}
        kicker={kicker}
        eyebrow={date}
        name={w.title ?? 'Run'}
        distance={distance > 0 ? distance.toFixed(1) : '—'}
        distanceMeters={plannedMeters}
        tempC={null}
        sessionType={null}
        planVerdict={null}
        topInset={insets.top}
        statusChip={{ label: missed ? 'Missed' : 'Planned' }}
        onEdit={() => setEditOpen(true)}
      />
      <WeekBanked weekIndex={wd.weekIndex} contributionMeters={null} userId={userId} />
      <View style={styles.plannedCard}>
        {/* One-number-one-screen: the identity row that opened this card
            (title / type / distance) restated the hero directly above it, so
            the card now starts at STRUCTURE — the content the hero cannot
            carry. The duration estimate is the row's one datum the hero
            lacks, so it alone survives. */}
        <View style={styles.plannedDurationRow}>
          <SymbolView name="clock" size={12} tintColor={C.faint} resizeMode="scaleAspectFit" />
          <Text style={styles.plannedDuration} maxFontSizeMultiplier={2}>{formatDurationApprox(estimatedDuration)}</Text>
        </View>
        {prescription.length > 0 ? (
          <>
            <View style={styles.prescriptionBarWrap}>
              <PrescriptionBar
                testID="workout-detail-prescription-rail"
                segments={prescriptionSegments.length > 0 ? prescriptionSegments : [{ kind: 'steady', meters: plannedMeters || 1 }]}
                height={9}
              />
            </View>
            <View style={styles.prescriptionRows}>
              {prescription.map((line, index) => {
                const target = line.strong && !prescription.slice(0, index).some((candidate) => candidate.strong)
                  ? workTarget
                  : null;
                return (
                  <View key={`${line.text}-${index}`} style={[styles.prescriptionRow, index > 0 && styles.prescriptionRowBorder]}>
                    <View style={[styles.prescriptionDot, { backgroundColor: line.strong ? C.qualText : C.faint }]} />
                    <Text style={[styles.prescriptionLine, line.strong && styles.prescriptionLineStrong]}>{line.text}</Text>
                    {target ? <Text style={styles.prescriptionTarget}>{target}</Text> : null}
                  </View>
                );
              })}
            </View>
          </>
        ) : (
          <View style={styles.pmSetHead}>
            <Text style={styles.pmSetTitle}>{distance > 0 ? `${distance.toFixed(1)} ${DIST_UNITS}` : '—'}</Text>
            <Text style={styles.pmSetTarget}>easy</Text>
          </View>
        )}
        {w.notes && prescription.length === 0 ? (
          <View style={styles.plannedNote}>
            <Text style={styles.pmNote}>{w.notes}</Text>
          </View>
        ) : null}
      </View>
      {routeBlocked === 'past' ? (
        <HistoricalWorkoutRoute workoutId={w.id} userId={userId} targetMeters={plannedMeters} />
      ) : !routeBlocked ? (
        <WorkoutRoutePlan workoutId={w.id} userId={userId} targetMeters={plannedMeters} />
      ) : null}
    </ScrollView>
    <WorkoutEditorModal
      visible={editOpen}
      onClose={() => setEditOpen(false)}
      onSubmit={saveWorkout}
      onDelete={confirmDeleteWorkout}
      easyBaseline={easyBaseline}
      racePaces={paces}
      initialWorkout={initialWorkout}
      submitLabel={saving ? 'Saving…' : 'Save workout'}
      editorKey={`detail-${w.id}`}
    />
    </>
  );
}

function HistoricalWorkoutRoute({ workoutId, userId, targetMeters }: { workoutId: string; userId: string | null; targetMeters: number }) {
  const selection = useWorkoutRoute(userId, workoutId);
  const route = selection.data?.route ?? null;
  if (!route) return null;
  return <ReadOnlyPlannedRoute route={route} targetMeters={targetMeters} />;
}

function ReadOnlyPlannedRoute({ route, targetMeters }: { route: SavedRoute; targetMeters: number }) {
  const fit = routeDistanceFit(route.distanceMeters, targetMeters);
  const fitLabel = fit.fit === 'on-target'
    ? 'on target'
    : `${formatDistance(Math.abs(fit.deltaMeters), DIST_UNITS)} ${fit.fit}`;
  return (
    <View style={styles.workoutRouteSection}>
      <View style={styles.attachedRoute}>
        <RouteCardHeader title="Planned route" />
        <RouteMapView
          path={route.drawPath}
          width={PANEL_W - space.lg * 2}
          height={168}
          lineColor={C.ink}
          cornerRadius={radius.sm}
        />
        <View style={styles.attachedRouteFooter}>
          <View style={styles.attachedRouteCopy}>
            <Text style={styles.attachedRouteName} numberOfLines={1}>{route.name}</Text>
            <Text style={[styles.attachedRouteMeta, fit.fit !== 'on-target' && styles.attachedRouteMetaOff]}>
              {formatDistance(route.distanceMeters, DIST_UNITS)} · {fitLabel}
            </Text>
          </View>
          <Text style={styles.readOnlyRouteLabel}>Read only</Text>
        </View>
      </View>
    </View>
  );
}

function WorkoutRoutePlan({ workoutId, userId, targetMeters }: { workoutId: string; userId: string | null; targetMeters: number }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const selection = useWorkoutRoute(userId, workoutId);
  const [detaching, setDetaching] = useState(false);
  const [exampleMapFailed, setExampleMapFailed] = useState(false);
  const route = selection.data?.route ?? null;
  const targetLabel = formatDistance(targetMeters, DIST_UNITS);
  const attachedFit = route ? routeDistanceFit(route.distanceMeters, targetMeters) : null;
  const attachedFitLabel = attachedFit
    ? attachedFit.fit === 'on-target'
      ? 'on target'
      : `${formatDistance(Math.abs(attachedFit.deltaMeters), DIST_UNITS)} ${attachedFit.fit}`
    : null;
  const exampleMapUrl = mapboxToken && !exampleMapFailed
    ? mapboxBasemapUrl({
        view: EXAMPLE_MAP_VIEW,
        style: C.bg === THEMES.light.bg ? MAPBOX_STYLE.light : MAPBOX_STYLE.dark,
        token: mapboxToken,
        width: PANEL_W - space.lg * 2,
        height: 144,
      })
    : null;
  const choose = () => router.push({ pathname: '/routes/select', params: { workoutId } });
  const remove = () => {
    if (!userId || detaching) return;
    Alert.alert('Remove planned route?', 'The route will stay in your saved routes.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove from workout',
        style: 'destructive',
        onPress: () => {
          setDetaching(true);
          detachRouteFromWorkout(userId, workoutId, queryClient)
            .catch((error) => Alert.alert('Couldn’t remove route', error instanceof Error ? error.message : String(error)))
            .finally(() => setDetaching(false));
        },
      },
    ]);
  };

  return (
    <View style={styles.workoutRouteSection}>
      {selection.isLoading ? (
        <View style={styles.workoutRouteCard}>
          <RouteCardHeader />
          <View style={styles.workoutRouteState} accessibilityLabel="Loading planned route">
            <ActivityIndicator color={C.mute} />
          </View>
        </View>
      ) : selection.error ? (
        <View style={styles.workoutRouteCard}>
          <RouteCardHeader />
          <View style={styles.workoutRouteState}>
            <Text style={styles.workoutRouteStateTitle}>Route unavailable</Text>
            <Pressable accessibilityRole="button" onPress={() => selection.refetch()} style={styles.routeRetry}>
              <Text style={styles.routeRetryText}>Try again</Text>
            </Pressable>
          </View>
        </View>
      ) : route ? (
        <View style={styles.attachedRoute}>
          <RouteCardHeader />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`View ${route.name}`}
            onPress={() => router.push({ pathname: '/routes/[id]', params: { id: route.id, workoutId } })}
            style={({ pressed }) => [pressed && styles.routePressed]}
          >
            <RouteMapView
              path={route.drawPath}
              width={PANEL_W - space.lg * 2}
              height={194}
              lineColor={C.yellow}
              cornerRadius={radius.sm}
            />
          </Pressable>
          <View style={styles.attachedRouteFooter}>
            <View style={styles.attachedRouteCopy}>
              <Text style={styles.attachedRouteName} numberOfLines={1}>{route.name}</Text>
              <Text style={[styles.attachedRouteMeta, attachedFit?.fit !== 'on-target' && styles.attachedRouteMetaOff]}>
                {formatDistance(route.distanceMeters, DIST_UNITS)} · {attachedFitLabel}
              </Text>
            </View>
            <View style={styles.attachedRouteActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Change planned route"
                onPress={choose}
                style={({ pressed }) => [styles.changeRoute, pressed && styles.routePressed]}
              >
                <Text style={styles.changeRouteText}>Change</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Remove planned route"
                accessibilityState={{ disabled: detaching }}
                disabled={detaching}
                onPress={remove}
                style={({ pressed }) => [styles.routeMore, pressed && styles.routePressed, detaching && styles.routeActionDisabled]}
              >
                {detaching ? (
                  <ActivityIndicator color={C.mute} />
                ) : (
                  <SymbolView name="ellipsis" size={17} tintColor={C.mute} weight="semibold" />
                )}
              </Pressable>
            </View>
          </View>
        </View>
      ) : (
        <View style={styles.emptyRoute}>
          <RouteCardHeader />
          <View style={styles.emptyRouteMap} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {exampleMapUrl ? (
              <Image
                source={{ uri: exampleMapUrl }}
                style={StyleSheet.absoluteFill}
                resizeMode="cover"
                onError={() => setExampleMapFailed(true)}
              />
            ) : (
              <SymbolView name="map" size={28} tintColor={C.faint} weight="regular" />
            )}
          </View>
          <View style={styles.emptyRouteCopy}>
            <Text style={styles.emptyRouteTitle}>Plan for {targetLabel}</Text>
            <Text style={styles.emptyRouteBody}>Build a route that fits this workout’s distance.</Text>
          </View>
          <ActionButton
            accessibilityLabel={`Plan route for ${targetLabel}`}
            onPress={choose}
            color={C.yellow}
            radius={radius.sm}
            contentStyle={styles.planRouteButton}
          >
            <ActionButtonLabel>Plan route</ActionButtonLabel>
          </ActionButton>
        </View>
      )}
    </View>
  );
}

function RouteCardHeader({ title = 'Route' }: { title?: string }) {
  return (
    <View style={styles.routeCardHeader}>
      <Text style={styles.workoutRouteTitle}>{title}</Text>
      <View style={styles.privateLabel}>
        <SymbolView name="lock.fill" size={10} tintColor={C.faint} weight="semibold" />
        <Text style={styles.privateText}>Private to you</Text>
      </View>
    </View>
  );
}

function Body({ activity, weekIndex, userId, knownWorkout = null }: { activity: ActivityRow; weekIndex: number | null; userId: string | null; knownWorkout?: WorkoutRow | null }) {
  const insets = useSafeAreaInsets();
  // Usable = real, length-aligned t/d/v — NOT just "the JSON object exists". A
  // treadmill/no-strap run can carry a streams object with no hr (or too few
  // samples); gating on this stops empty titled cards and zone crashes downstream.
  const s = hasUsableStreams(activity.streams) ? (activity.streams as RunStreams) : null;
  const hasHr = !!s?.hr?.some((h) => h != null);
  // Corpus of prior runs (≈120d back from this run) for the pace-curve baseline.
  const range = useMemo(() => {
    if (!activity.local_date) return null;
    return { from: addCivilDays(activity.local_date, -120), to: activity.local_date };
  }, [activity.local_date]);
  const corpus = useActivities(userId, range).data ?? [];
  // The pace curve's comparison baseline — its own selectable period (rolling
  // window or a custom span), loaded independently of the 120-day HR corpus.
  const [curvePeriod, setCurvePeriod] = useState<CurvePeriod>({ kind: 'rolling', days: 84, label: '12W' });
  const curveRange = useMemo(
    () => (activity.local_date ? curveWindow(curvePeriod, activity.local_date) : null),
    [curvePeriod, activity.local_date],
  );
  // `keepPrevious`: retuning the comparison period changes the query key, and
  // without it `data` drops to `undefined` for the length of the fetch — so the
  // baseline curve simply vanished from the chart until the rows landed (`All`
  // pages the whole history, so that was seconds, and read as a broken chart).
  // The previous window's curve now holds the line, and `curveStale` fades it so
  // it is never mistaken for the period actually selected.
  const curveQ = useActivities(userId, curveRange, { keepPrevious: true });
  const curveCorpus = curveQ.data ?? [];
  const curveStale = curveQ.isPlaceholderData;
  const distM = activity.distance_meters ?? 0;
  const miles = metersToMiles(distM);
  const distance = metersToUnits(distM, DIST_UNITS);
  const movingS = activity.moving_time_s;
  const elapsedS = activity.elapsed_time_s;
  const stoppedS = movingS != null && elapsedS != null ? Math.max(0, elapsedS - movingS) : null;
  const movingPace = movingS != null && distance > 0 ? movingS / distance : null;
  const name = activity.name?.trim() || 'Run';
  const date = longDate(activity.local_date);
  const tod = timeOfDay(activity.start_date);

  const splits = useMemo(() => buildSplits(activity), [activity]);
  // Estimated true HRmax = the athlete's observed peak across all their runs (a
  // good data-driven proxy), NOT this run's max. The real value belongs in the
  // profile; here we derive it and show it as the zones' stated basis.
  const estMaxHr = useMemo(() => {
    // Sanitize: ignore sensor glitches (a single 255-bpm ANT+ dropout would
    // otherwise rewrite every zone boundary). Cap at a physiological ceiling.
    const cand = [activity.max_hr ?? 0, ...corpus.map((a) => a.max_hr ?? 0)].filter((h) => h > 0 && h <= 220);
    return cand.length ? Math.max(...cand) : HR_MAX_EST;
  }, [activity, corpus]);
  const zones = useMemo(() => (s && hasHr ? computeZones(s, estMaxHr) : null), [s, hasHr, estMaxHr]);
  // The quality/interval floor — SAME source the server used at ingest, so run
  // detail and Dash can never disagree (audit: "Quality-detection floor drift").
  // Precomputed rows carry it in stream_summary.quality.floor; older rows that
  // predate that column fall back to the shared estimator with the population
  // baseline (matches the server's own fallback path).
  const qualityFloor = useMemo(() => {
    const stored = activity.stream_summary?.quality?.floor;
    if (!stored) return estimateQualityFloor({ easyBaselineSecPerMi: FALLBACK_EASY_BASELINE_SEC_PER_MI });
    // Older rows predate qualityFloorSecPerMi — derive it from the stored
    // paceFloor/easyBaseline rather than dropping the field.
    return {
      ...stored,
      qualityFloorSecPerMi: stored.qualityFloorSecPerMi
        ?? deriveQualityFloor(stored.easyBaselineSecPerMi),
    };
  }, [activity]);
  // The day's active-plan prescription, matched to THIS activity (a day can hold
  // an easy + long double, so pair by the canonical distance-greedy matcher, not
  // first-by-date). Feeds both the plan-matched interpreter reading below and the
  // drill verdict further down (shared, so the two never disagree on the match).
  const planQ = useActivePlan(userId);
  const plannedWorkout = useMemo(() => {
    const workouts = planQ.data?.workouts ?? [];
    const day = activity.local_date;
    if (!day) return null;
    const onDay = workouts.filter((w) => w.date === day);
    if (onDay.length <= 1) return onDay[0] ?? null;
    const acts = corpus.filter((a) => a.local_date === day && a.distance_meters != null);
    if (!acts.some((a) => a.id === activity.id) && activity.distance_meters != null) acts.push(activity);
    const res = assignMatches(
      onDay.map((w) => ({ workoutId: w.id, localDate: day, isQuality: w.is_quality, plannedMeters: w.planned_distance_meters ?? 0 })),
      acts.map((a) => ({ activityId: a.id, localDate: day, distanceMeters: a.distance_meters ?? 0 })),
    );
    const wid = res.matches.find((m) => m.activityId === activity.id)?.workoutId;
    return onDay.find((w) => w.id === wid) ?? onDay[0] ?? null;
  }, [planQ.data, activity, corpus]);
  // A /workout/[id] entry already resolved the exact workout, including the
  // correct half of a double. Prefer it for historical route lookup while the
  // established analysis matcher continues to drive workout interpretation.
  const plannedRouteWorkout = knownWorkout ?? plannedWorkout;
  const plannedRouteSelection = useWorkoutRoute(userId, plannedRouteWorkout?.id ?? null);
  const planQuality = useMemo(
    () =>
      plannedWorkout
        ? planQualityFromWorkout({
            id: plannedWorkout.id,
            structure: plannedWorkout.structure,
            plannedDistanceMeters: plannedWorkout.planned_distance_meters,
            prescribedQualityMeters: plannedWorkout.prescribed_quality_meters,
          })
        : null,
    [plannedWorkout],
  );

  // The plan-conditioned interpreter, run on THIS detail stream so the candidate
  // ladder + rendered blocks share one index space (the stored verdict is on the
  // ingest stream, which may differ). Same deterministic engine as ingest, so it
  // reproduces the stored reading; recomputing here just guarantees `s`-alignment.
  const refs = useMemo<QualityFloorRefs>(
    () => ({
      easyPaceSecPerMi:
        activity.stream_summary?.quality?.floor?.easyBaselineSecPerMi ?? FALLBACK_EASY_BASELINE_SEC_PER_MI,
      paceFloorSecPerMi: qualityFloor.paceFloorSecPerMi,
      hrFloor: qualityFloor.hrFloor ?? 999,
      qualityFloorSecPerMi: qualityFloor.qualityFloorSecPerMi,
    }),
    [activity.stream_summary, qualityFloor],
  );
  const interp = useMemo(() => {
    if (!s) return null;
    const st = toStream(s);
    const gap = st.altitude && st.altitude.length ? buildGap({ d: st.d, alt: st.altitude }) : null;
    return interpretWorkout(st, (activity.laps as StravaLap[] | null) ?? null, gap, refs, planQuality);
  }, [s, activity.laps, refs, planQuality]);

  // The runner's pinned interpretation (run-detail slider): a live LOCAL
  // selection for instant preview while scrubbing, persisted to quality_override
  // (debounced) so the credit reads re-resolve. `undefined` = untouched → fall
  // back to the stored column value. Resolves as override ?? matched ?? honest.
  const setColumnOverride = useSetColumnOverride(activity.id);
  const [selOverride, setSelOverride] = useState<QualityOverride | null | undefined>(undefined);
  const override = selOverride !== undefined ? selOverride : (activity.quality_override ?? null);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onOverride = useCallback(
    (o: QualityOverride | null) => {
      setSelOverride(o);
      if (persistTimer.current) clearTimeout(persistTimer.current);
      persistTimer.current = setTimeout(() => setColumnOverride.mutate(o), 350);
    },
    [setColumnOverride],
  );
  const qualityVerdict = useMemo(() => {
    if (!s || !interp) return null;
    const resolved = resolveQuality(
      { kind: 'none', summary: '', qualityDistanceMeters: 0, honest: interp.honest, matched: interp.matched, candidates: interp.candidates },
      override,
    );
    return readingToDetect(resolved, toStream(s));
  }, [s, interp, override]);
  // Quality decided up front: the section only mounts on a real quality effort
  // (no "no quality effort" denial card on easy runs), and its snapped label
  // feeds the hero verdict line.
  const quality = useMemo(() => {
    if (!s) return null;
    // Driven by the resolved interpreter verdict (override ?? matched ?? honest)
    // — which already carries the v9 gates (honest-quality floor, strides) and
    // the user's pinned interpretation, so the section, hero label, and credit
    // chip agree without a separate stored short-circuit.
    const st = toStream(s);
    const det = qualityVerdict;
    if (!det || !det.isQuality || det.blocks.length === 0) return null;
    // A sustained effort (tempo / progression) reads as one shape, not N reps —
    // mirror the sustained card's phrasing rather than snapIntervals' rep count.
    if (det.kind === 'progression') {
      return { label: 'Progression', type: 'progression' as const };
    }
    if (det.kind === 'tempo') {
      // Legacy fallback: a stream tempo whose mile splits step down still reads
      // as a progression even if the detector classified it tempo.
      if (progressionShape(mileSplits(s))) return { label: 'Progression', type: 'progression' as const };
      const b = det.blocks.reduce((a, x) => (x.durationS > a.durationS ? x : a), det.blocks[0]!);
      return { label: `${Math.round(b.durationS / 60)} min tempo`, type: 'tempo' as const };
    }
    return { label: snapIntervals(st, det.blocks, { unit: DIST_UNITS }).label, type: 'intervals' as const };
  }, [s, qualityVerdict, DIST_UNITS]);
  const elevGain = useMemo(() => (s ? elevGainFt(s) : null), [s]);
  const elev = useMemo(() => (s ? elevStats(s) : null), [s]);
  const displayedHr = useMemo(() => (s ? displayHeartRate(s) : null), [s]);
  const displayedAvgHr = activity.avg_hr ?? displayedHr?.avg ?? null;
  const displayedMaxHr = displayedHr?.max ?? activity.max_hr ?? null;
  const hrDriftV = useMemo(() => (s ? hrDrift(s) : null), [s]);
  const beatsMiV = useMemo(() => (s ? beatsPerMile(s) : null), [s]);
  const [sheet, setSheet] = useState<string | null>(null);
  const [selRep, setSelRep] = useState<RepRow | null>(null);

  const racePrediction = useRacePrediction(userId);
  const drill = useMemo<DrillVerdict | null>(() => {
    if (!activity) return null;
    // Pairs this activity to its plan workout via the shared `plannedWorkout`
    // matcher (distance-greedy, doubles-aware) so drill + the interpreter's
    // plan-match never disagree on which workout this run fulfils.
    const planned = plannedWorkout;
    const stream = s ? toStream(s) : null;
    return buildDrillVerdict({
      planned: planned
        ? {
            is_quality: planned.is_quality,
            structure: planned.structure,
            planned_distance_meters: planned.planned_distance_meters,
            prescribed_quality_meters: planned.prescribed_quality_meters,
          }
        : null,
      stream,
      detected: qualityVerdict,
      laps: (activity.laps as import('@/lib/run/analysis').StravaLap[] | null) ?? null,
      floor: qualityFloor,
      runMeters: distM,
      paces: runnerRacePaces(racePrediction?.prediction?.seconds ?? 0),
    });
  }, [activity, plannedWorkout, racePrediction, s, qualityFloor, qualityVerdict, distM]);

  // Intrinsic session readout (reps grouped by set). When a QUALITY plan matched
  // this run, use its sets (targets lit → Δ bars); otherwise the reps render bare
  // (pace · HR, no target) — a bonus/unplanned session is shown but not graded.
  const sessionView = useMemo<{ sets: DrillSet[] } | null>(() => {
    if (!s || !quality) return null;
    if (drill?.kind === 'quality' && drill.sets?.length && drill.reps?.length) return { sets: drill.sets };
    if (!qualityVerdict) return null;
    const st = toStream(s);
    const snap = snapIntervals(st, qualityVerdict.blocks, { unit: DIST_UNITS });
    if (!snap.reps.length) return null;
    const reps: RepRow[] = snap.reps.map((r, i) => ({
      index: i + 1, setIndex: 0, distanceMeters: r.targetDistMeters, paceSecPerMi: r.achievedPaceSecPerMi,
      deltaSec: null, avgHr: r.avgHr, startIdx: r.startIdx, endIdx: r.endIdx,
    }));
    return { sets: [{ plannedReps: reps.length, distPerRepMeters: reps[0]!.distanceMeters, targetSecPerMi: null, zoneLabel: null, reps }] };
  }, [s, quality, drill, qualityFloor, qualityVerdict, DIST_UNITS]);

  // Plan-match verdict for the headline chip (null when no plan attributed).
  const planVerdict = useMemo<{ state: string; label: string } | null>(() => {
    if (!drill) return null;
    const state = drill.kind === 'quality' ? drill.qualityState! : drill.distanceState!;
    if (drill.kind === 'quality') {
      const planned = (drill.sets ?? []).filter((set) => set.kind !== 'extra').reduce((sum, set) => sum + set.plannedReps, 0);
      const completed = (drill.sets ?? []).filter((set) => set.kind !== 'extra').reduce((sum, set) => sum + set.reps.length, 0);
      if (state === 'matched') return { state, label: 'Matched plan' };
      if (state === 'partial') return { state, label: planned > 0 ? `Partial · ${Math.min(completed, planned)} of ${planned}` : 'Partial plan' };
      return { state, label: 'Missed plan' };
    }
    return { state, label: state === 'met' ? 'Plan met' : 'Short of plan' };
  }, [drill]);

  // Precomputed quality credit + tap-to-undo. Reads the SAME server-written
  // verdict Dash reads (stream_summary.quality) — independent of the intrinsic
  // sessionType readout above, which drives the chart/rep breakdown. This chip
  // is specifically the CREDIT signal (with an override), violet per the app's
  // type-color language (quality = violet, yellow stays CTA-only).
  const activityQuality = useActivityQualityDetect(activity);
  const toggleQualityOverride = useSetQualityOverride(activity.id);
  const qualityChip = useMemo(() => {
    // A plan-aligned live reading fixes old stored summaries immediately on run
    // detail (before the v10 backfill reaches the row). Otherwise preserve the
    // durable stored-credit semantics used by Dash, including legacy rows whose
    // unversioned summary intentionally suppresses the quality credit chip.
    const useLive = !!qualityVerdict && (
      interp?.matched?.planAligned === true
      || activity.stream_summary?.quality?.v === STREAM_SUMMARY_VERSION
    );
    const detect = useLive ? qualityVerdict : activityQuality.detectResult;
    const credited = useLive
      ? !!detect?.isQuality && !activityQuality.overridden
      : activityQuality.qualityDetected;
    if (!credited || !detect) return null;
    const kind = detect.kind;
    const label = kind && kind !== 'none'
      ? `Quality · ${kind[0]!.toUpperCase()}${kind.slice(1)}`
      : 'Quality';
    // The precomputed verdict's summary (e.g. "6×221m @ 5:42", "26 min tempo @
    // 6:30", "18 min @ threshold") — the precise structure a runner expects to
    // read under the chip. Empty when the verdict carries no structured summary.
    const summary = detect.summary?.trim() || null;
    return { label, summary, onToggle: toggleQualityOverride };
  }, [
    activity.stream_summary?.quality?.v,
    activityQuality.detectResult,
    activityQuality.overridden,
    activityQuality.qualityDetected,
    interp?.matched?.planAligned,
    qualityVerdict,
    toggleQualityOverride,
  ]);

  const repMarkerFrac = useMemo<number | null>(() => {
    if (!selRep || !s) return null;
    const n = s.t.length;
    if (n < 2) return null;
    const mid = Math.round((selRep.startIdx + selRep.endIdx) / 2);
    return Math.max(0, Math.min(1, mid / (n - 1)));
  }, [selRep, s]);

  // Scroll-driven collapse: as a section's body scrolls up behind its pinned
  // title it FADES out, and once it's fully behind (just the title left) the
  // title rounds its bottom into a pill. Geometry (title y + body height) is
  // measured via onLayout; scrollY drives the body opacity natively.
  const scrollY = useRef(new Animated.Value(0)).current;
  const [geom, setGeom] = useState<Record<string, { top: number; bodyH: number }>>({});
  const geomRef = useRef(geom); geomRef.current = geom;
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const collapsedRef = useRef(collapsed); collapsedRef.current = collapsed;
  const onScroll = useMemo(() => Animated.event(
    [{ nativeEvent: { contentOffset: { y: scrollY } } }],
    {
      useNativeDriver: true,
      listener: (e: { nativeEvent: { contentOffset: { y: number } } }) => {
        const y = e.nativeEvent.contentOffset.y;
        const g = geomRef.current;
        const next = { ...collapsedRef.current };
        let changed = false;
        for (const k of Object.keys(g)) {
          const c = y >= g[k]!.top + g[k]!.bodyH - 10;
          if (!!next[k] !== c) { next[k] = c; changed = true; }
        }
        if (changed) setCollapsed(next);
      },
    },
  ), [scrollY]);
  const setTop = (key: string, top: number) =>
    setGeom((p) => (p[key]?.top === top ? p : { ...p, [key]: { top, bodyH: p[key]?.bodyH ?? 0 } }));
  const setBodyH = (key: string, bodyH: number) =>
    setGeom((p) => (p[key]?.bodyH === bodyH ? p : { ...p, [key]: { top: p[key]?.top ?? 0, bodyH } }));

  return (
    <>
    {(() => {
      // Each section = a sticky card-TOP (eyebrow, rounded top) + a card-BODY
      // (rounded bottom). The top freezes to the screen top while the body
      // scrolls up behind it (fading), then the title rounds its bottom into a
      // pill — Apple-Weather sticky/collapse behaviour, header inside the box.
      const kids: ReactNode[] = [
        <HeroMap
          key="hero"
          route={(activity.route as [number, number][] | null) ?? null}
          kicker={`Logged run${weekIndex != null ? `  Wk ${weekIndex}` : ''}`}
          eyebrow={`${date}${tod ? `  ${tod}` : ''}`}
          name={name}
          distance={distance.toFixed(1)}
          distanceMeters={distM}
          tempC={activity.avg_temp_c}
          sessionType={quality?.type ?? null}
          planVerdict={planVerdict}
          qualityChip={qualityChip}
          // The detected-structure summary renders as cells inside the SESSION
          // card (where the rep table lives); the hero only carries it when
          // that card can't mount (verdict present, streams missing).
          structure={sessionView ? null : qualityChip?.summary ?? null}
          topInset={insets.top}
          markerFrac={repMarkerFrac}
          onExpand={activity.route ? () => setSheet('map') : undefined}
        />,
        // The week this run fed, immediately under the day's own headline —
        // before any card, because it is the frame the cards are read in.
        <WeekBanked key="week-banked" weekIndex={weekIndex} contributionMeters={distM} userId={userId} />,
        <View key="hero-gap" style={{ height: 14 }} />,
      ];
      if (plannedRouteSelection.data?.route && (plannedRouteWorkout?.planned_distance_meters ?? 0) > 0) {
        kids.push(
          <ReadOnlyPlannedRoute
            key="planned-route"
            route={plannedRouteSelection.data.route}
            targetMeters={plannedRouteWorkout!.planned_distance_meters!}
          />,
        );
      }
      const sticky: number[] = [];
      const fulls: Record<string, { title: string; icon: string; content: ReactNode }> = {};
      // `badge` marks a CONDITIONAL section (one that only appears sometimes —
      // e.g. Quality, which exists only when a quality effort is detected). It
      // states a fact ("DETECTED"), NOT a target judgment like "met".
      const add = (key: string, icon: string, label: string, body: ReactNode, full: ReactNode, badge?: ReactNode) => {
        fulls[key] = { title: label, icon, content: full };
        const eyebrow = (
          <View style={styles.cardHeadRow}>
            <SymbolView name={icon as never} size={13} tintColor={C.mute} resizeMode="scaleAspectFit" />
            <Text style={styles.cardHeadLab}>{label}</Text>
            <View style={{ flex: 1 }} />
            {badge}
            <SymbolView name="chevron.right" size={11} tintColor={C.faint} resizeMode="scaleAspectFit" />
          </View>
        );
        sticky.push(kids.length);
        // Collapsed (body fully behind the title) → round the title's bottom into a pill.
        const topStyle = collapsed[key] ? [styles.cardTop, styles.cardTopPill] : styles.cardTop;
        // The whole title is tappable → expands the tile to a full-screen detail.
        const header = (
          <Pressable
            onPress={() => setSheet(key)}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={`Open ${label} details`}
            style={({ pressed }) => [topStyle, pressed && styles.pressDim]}
          >
            {eyebrow}
          </Pressable>
        );
        const g = geom[key];
        // Body stays INTACT (opacity 1) while it scrolls up behind the title, then
        // snaps to 0 EXACTLY at full collapse — invisibly, because it's already
        // hidden behind the opaque title — so nothing shows through when the title
        // then fades out over the inter-section gap (it disappears in place rather
        // than butting into the next header).
        const titleOpacity = g && g.bodyH > 24
          ? scrollY.interpolate({ inputRange: [g.top + g.bodyH + 5, g.top + g.bodyH + 24], outputRange: [1, 0], extrapolate: 'clamp' })
          : 1;
        const bodyOpacity = g && g.bodyH > 24
          ? scrollY.interpolate({ inputRange: [g.top + g.bodyH, g.top + g.bodyH + 4], outputRange: [1, 0], extrapolate: 'clamp' })
          : 1;
        kids.push(
          <Animated.View key={`${key}-t`} style={[styles.stickyMask, { opacity: titleOpacity }]} onLayout={(e) => setTop(key, e.nativeEvent.layout.y)}>{header}</Animated.View>,
        );
        kids.push(
          <Animated.View key={`${key}-b`} style={[styles.cardBody, { opacity: bodyOpacity }]} onLayout={(e) => setBodyH(key, e.nativeEvent.layout.height)}>{body}</Animated.View>,
        );
      };

      // The Analysis tile's at-a-glance scorecard (the run's headline numbers).
      const measures = () => (
        <>
          <View style={styles.sgRow}>
            <Metric label="Avg pace" value={movingPace != null ? formatDuration(movingPace) : '—'} unit={`/${DIST_UNITS}`} />
            <Metric label="Moving time" value={movingS != null ? formatDuration(movingS) : '—'} />
            {hasHr ? <Metric label="Avg HR" value={activity.avg_hr != null ? String(activity.avg_hr) : '—'} unit="bpm" /> : <Metric label="Distance" value={distance.toFixed(1)} unit={DIST_UNITS} />}
          </View>
          {elapsedS != null ? (
            <View style={[styles.sgRow, styles.sgRow2]}>
              <Metric sub label="Total time" value={formatDuration(elapsedS)} />
              <Metric sub label="Stopped" value={stoppedS != null ? formatDuration(stoppedS) : '0:00'} />
              {elevGain != null ? <Metric sub label="Elev gain" value={String(elevGain)} unit="ft" /> : <View style={styles.sgCell} />}
            </View>
          ) : null}
        </>
      );
      // Analysis's full-sheet breakdown carries ONLY what the tile scorecard and
      // the dedicated HR/Map sections don't already own: elapsed pace, total &
      // stopped time. (HR → Heart-rate section; elevation → Route/Map.)
      const breakdown = () => (
        <>
          <Panel icon="stopwatch.fill" label="Pace & time">
            <View style={styles.sgRow}>
              <Metric label="Avg elapsed" value={elapsedS != null && distance > 0 ? formatDuration(elapsedS / distance) : '—'} unit={`/${DIST_UNITS}`} />
              <Metric label="Total time" value={elapsedS != null ? formatDuration(elapsedS) : '—'} />
              <Metric label="Stopped" value={stoppedS != null ? formatDuration(stoppedS) : '0:00'} />
            </View>
          </Panel>
        </>
      );
      const paceCurveBody = (tall: boolean) => (
        <>
          <PaceCurve activity={activity} corpus={curveCorpus} period={curvePeriod} onPeriod={setCurvePeriod} tall={tall} stale={curveStale} />
          {activity.best_efforts && activity.best_efforts.length > 0 ? <BestEffortRows efforts={activity.best_efforts} /> : null}
        </>
      );
      // Full-screen pace curve: the tall scrub chart, a pace scorecard, then the
      // best-efforts list in its own Panel — same layered pattern as HR/Splits.
      const bePace = (n: string) => {
        const e = (activity.best_efforts ?? []).find((x) => x.name === n);
        return e && e.distance_m > 0 ? formatDuration(e.elapsed_s / metersToUnits(e.distance_m, DIST_UNITS)) : '—';
      };
      const shortEffortName = DIST_UNITS === 'mi' ? '1 mile' : '1K';
      const paceCurveFull = () => (
        <>
          <PaceCurve activity={activity} corpus={curveCorpus} period={curvePeriod} onPeriod={setCurvePeriod} tall stale={curveStale} />
          <View style={{ height: GAP }} />
          <Panel>
            <View style={styles.sgRow}>
              <Metric label="Avg pace" value={movingPace != null ? formatDuration(movingPace) : '—'} unit={`/${DIST_UNITS}`} />
              <Metric label={shortEffortName} value={bePace(shortEffortName)} unit={`/${DIST_UNITS}`} />
              <Metric label="5K pace" value={bePace('5K')} unit={`/${DIST_UNITS}`} />
            </View>
          </Panel>
          {activity.best_efforts && activity.best_efforts.length > 0 ? (
            <Panel icon="trophy.fill" label="Best efforts"><BestEffortRows efforts={activity.best_efforts} framed /></Panel>
          ) : null}
        </>
      );
      const hrFull = () => (
        <>
          {s ? <HrChart streams={s} avgHr={displayedAvgHr} tall /> : null}
          <View style={{ height: GAP }} />
          <Panel>
            <View style={styles.sgRow}>
              <Metric label="Avg" value={displayedAvgHr != null ? String(displayedAvgHr) : '—'} unit="bpm" />
              <Metric label="Max" value={displayedMaxHr != null ? String(displayedMaxHr) : '—'} unit="bpm" />
            </View>
            <View style={[styles.sgRow, styles.sgRow2]}>
              <Metric sub label="Aerobic drift" value={hrDriftV != null ? `${hrDriftV > 0 ? '+' : ''}${hrDriftV.toFixed(1)}` : '—'} unit="%" />
              <Metric sub label={`Beats / ${DIST_UNITS}`} value={beatsMiV != null ? Math.round(DIST_UNITS === 'mi' ? beatsMiV : beatsMiV / 1.609344).toLocaleString() : '—'} />
            </View>
          </Panel>
          {zones ? <ZonesPanel bars={zones.bars} rows={zones.rows} maxHr={estMaxHr} /> : null}
        </>
      );

      const note = activity.user_note?.trim();
      const addAnalysis = () => {
        if (!s) return;
        add('analysis', 'chart.line.uptrend.xyaxis', 'Analysis',
          <>{measures()}<Divider style={styles.tileDiv} /><StreamLanes streams={s} movingTimeS={movingS} distanceMeters={distM} /></>,
          <><StreamLanes streams={s} movingTimeS={movingS} distanceMeters={distM} tall /><View style={{ height: GAP }} />{breakdown()}</>,
        );
      };
      const addNote = () => {
        if (note) add('note', 'note.text', 'Note', <Text style={styles.noteText}>{note}</Text>, <Text style={styles.noteText}>{note}</Text>);
      };
      const addSession = () => {
        if (!s || !sessionView) return;
        const sv = sessionView;
        const sessionReps = sv.sets.flatMap((set) => set.reps);
        const sessionBody = (tall: boolean) => (
          <>
            <SessionOverview sets={sv.sets} planned={drill?.kind === 'quality'} />
            <Divider style={styles.tileDiv} />
            <IntervalAnalysis streams={s} det={qualityVerdict} hideReps full={tall}
              selectedIdx={selRep ? selRep.index - 1 : null}
              onSelectIdx={(i) => setSelRep(i == null ? null : sessionReps[i] ?? null)} />
            <QualityDrillBody sets={sv.sets} planned={drill?.kind === 'quality'} selectedRep={selRep?.index ?? null} onSelectRep={setSelRep} />
            {/* Correction affordance — one tap deeper, expanded sheet only. Scrub
                the interpreter's coarse→fine ladder or pin plan / not-a-workout. */}
            {tall && interp ? (
              <InterpretationControl interp={interp} override={override} onChange={onOverride} />
            ) : null}
          </>
        );
        add('session', 'bolt.fill', 'Session', sessionBody(false), sessionBody(true));
      };
      const addPlan = () => {
        // Plan gets its own surface only when Session cannot carry the answer:
        // distance progress, or a quality prescription whose work was not found.
        if (drill?.kind === 'distance') {
          add('plan', 'flag.checkered', 'Plan', <DistanceBody v={drill} />, <DistanceBody v={drill} />);
        } else if (drill?.kind === 'quality' && !sessionView) {
          add('plan', 'checklist', 'Plan', <MissedPlanBody sets={drill.sets ?? []} />, <MissedPlanBody sets={drill.sets ?? []} />);
        }
      };

      // Plan-aware meaning leads whenever Due has one. Easy/unplanned runs keep
      // Analysis first; a quality or prescribed run instead answers "did I do
      // the workout?" before presenting generic tracker metrics.
      const hasDueLead = !!sessionView || !!drill;
      addSession();
      addPlan();
      if (!hasDueLead) addAnalysis();
      addNote();
      if (hasDueLead) addAnalysis();

      // Historical context is more product-specific than raw ledgers, so it
      // precedes their compact page-level synopses. Full rows stay in sheets.
      if (s && miles >= 1) add('pacecurve', 'chart.xyaxis.line', 'Pace curve', paceCurveBody(false), paceCurveFull());
      if (splits.length > 0) add('splits', 'stopwatch', 'Splits', <SplitsOverview splits={splits} />, <SplitRows splits={splits} />);
      if (zones) add(
        'zones',
        'heart.fill',
        'Heart rate',
        <HeartRateOverview bars={zones.bars} rows={zones.rows} avgHr={displayedAvgHr} maxHr={displayedMaxHr} />,
        hrFull(),
      );
      // The hero map expands into its own sheet (registered directly, not via a
      // scrolling tile) — tapping the hero or its expand button opens it.
      if (activity.route) {
        fulls.map = { title: 'Route', icon: 'map.fill', content: <MapDetail route={activity.route as [number, number][]} streams={s} distanceMeters={distM} elev={elev} /> };
      }
      // Strava attribution — required wherever a Strava-sourced activity is shown.
      if (activity.source === 'strava' && activity.source_id) {
        kids.push(<StravaAttribution key="strava" sourceId={activity.source_id} />);
      }
      kids.push(<View key="tail" style={{ height: 24 }} />);
      const active = sheet ? fulls[sheet] : null;
      return (
        <>
          <Animated.ScrollView
            contentContainerStyle={[styles.scroll, { paddingBottom: Math.max(30, insets.bottom + 24) }]}
            stickyHeaderIndices={sticky}
            showsVerticalScrollIndicator={false}
            scrollEventThrottle={16}
            onScroll={onScroll}
          >
            {kids}
          </Animated.ScrollView>
          {active ? (
            <DetailSheet visible title={active.title} onClose={() => setSheet(null)}>{active.content}</DetailSheet>
          ) : null}
        </>
      );
    })()}
    </>
  );
}

// ── Pace + HR chart (react-native-svg, REAL data, scrub + axes) ──────────────
const CHART_H = 178;
const CHART_AX = 18; // x-axis (mile) label band
// ── Unified stacked stream lanes (pace · HR · elevation), scrub-aligned ───────
// TrainingPeaks-style: each stream is its own lane on a shared time axis; one
// cursor crosses every lane, so a single touch reads pace, HR and elevation at
// the same moment. Each lane header shows its avg, or the value under the cursor.
const LANE_H = 76, LANE_HEAD = 20, LANE_GAP = 16;
interface StreamLane {
  key: string; label: string; color: string; fill: boolean;
  segs: { px: number; py: number }[][];
  pts: { px: number; py: number; val: number }[];
  summary: string; fmt: (v: number) => string; range: string;
  /** Horizontal guide lines at nice round values (the lane's y scale). */
  ticks: { py: number; label: string }[];
}
/**
 * Pick 2–4 nice round tick values inside the domain. `steps` is ordered
 * fine→coarse; the first step that yields 2–4 ticks wins (coarsest as fallback
 * so a squat domain still gets at least one guide).
 */
function niceTicks(dom: [number, number], steps: number[]): number[] {
  let fallback: number[] = [];
  for (const s of steps) {
    const out: number[] = [];
    for (let v = Math.ceil(dom[0] / s) * s; v <= dom[1]; v += s) out.push(v);
    if (out.length >= 2 && out.length <= 4) return out;
    if (out.length > 0) fallback = out.slice(0, 4);
  }
  return fallback;
}
function buildLane(
  key: string, label: string, color: string, fill: boolean, invert: boolean,
  series: (number | null)[], xs: number[], lastT: number, laneH: number,
  fmtVal: (v: number) => string, unit: string, tickSteps: number[], summaryOverride?: string,
): StreamLane | null {
  const clean = series.filter((v): v is number => v != null);
  if (clean.length < 2) return null;
  const sorted = [...clean].sort((a, b) => a - b);
  const lo = percentile(sorted, 0.05), hi = percentile(sorted, 0.95);
  const pad = (hi - lo) * 0.16 || Math.max(1, Math.abs(hi) * 0.02);
  const dom: [number, number] = [lo - pad, hi + pad];
  const proj = project(series.map((y, i) => ({ x: xs[i]!, y })), [0, lastT], dom, CHART_W, laneH, invert);
  const pts = proj
    .map((p, i) => (p ? { px: p.px, py: p.py, val: series[i]! } : null))
    .filter((x): x is { px: number; py: number; val: number } => x != null);
  const avg = clean.reduce((s, v) => s + v, 0) / clean.length;
  const fmt = (v: number) => `${fmtVal(v)} ${unit}`;
  // Range = p05–p95 (the charted domain), so an outlier stop doesn't blow it up.
  const range = `${fmtVal(lo)}–${fmtVal(hi)} ${unit}`;
  // Y-scale guides at round values; keep labels clear of the lane edges where
  // they'd clip or collide with the line's own extremes.
  const ticks = niceTicks(dom, tickSteps)
    .map((v) => ({ py: yAt(v, dom, laneH, invert), label: fmtVal(v) }))
    .filter((t) => t.py > 8 && t.py < laneH - 2);
  return { key, label, color, fill, segs: segments(proj), pts, summary: summaryOverride ?? fmt(avg), fmt, range, ticks };
}

function Lane({ lane, sel, restX, laneH }: { lane: StreamLane; sel: { a: number; b: number } | null; restX: number | null; laneH: number }) {
  const isRange = sel != null && sel.b - sel.a >= 10;
  const lo = sel?.a ?? 0, hi = sel?.b ?? 0;
  let header = lane.summary;
  let dot: { px: number; py: number } | null = null;
  let avgY: number | null = null;
  let restingDot = false;
  if (sel && !isRange) {
    const d = nearestBy(lane.pts, sel.a);
    if (d) { header = lane.fmt(d.val); dot = d; }
  } else if (sel && isRange) {
    const inR = lane.pts.filter((p) => p.px >= lo && p.px <= hi);
    if (inR.length) {
      header = lane.fmt(inR.reduce((s, p) => s + p.val, 0) / inR.length);
      avgY = inR.reduce((s, p) => s + p.py, 0) / inR.length; // the average level, for a guide line
    }
  } else if (restX != null) {
    // At rest: a faint affordance dot so the lane reads as scrubbable; the header
    // stays the summary (an arbitrary midpoint value would be less useful).
    const d = nearestBy(lane.pts, restX);
    if (d) { dot = d; restingDot = true; }
  }
  return (
    <View style={{ height: LANE_HEAD + laneH, marginBottom: LANE_GAP }}>
      <View style={styles.laneHead}>
        <View style={styles.laneHeadL}>
          <Text style={styles.laneLab}>{lane.label}</Text>
          <Text style={styles.laneRange}>{lane.range}</Text>
        </View>
        <Text style={[styles.laneVal, { color: lane.color }]}>{header}{sel && isRange ? <Text style={styles.laneAvg}>  avg</Text> : ''}</Text>
      </View>
      <Svg width={CHART_W} height={laneH}>
        <Defs>
          <LinearGradient id={`ln${lane.key}`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={lane.color} stopOpacity="0.26" />
            <Stop offset="1" stopColor={lane.color} stopOpacity="0" />
          </LinearGradient>
        </Defs>
        {lane.ticks.map((t, i) => (
          <SvgLine key={`g${i}`} x1={0} y1={t.py} x2={CHART_W} y2={t.py} stroke={C.line} strokeWidth={StyleSheet.hairlineWidth} strokeDasharray="3 4" />
        ))}
        {/* Halo pass first (card-coloured stroke) so labels stay legible where the
            trace crosses them, then the ink pass. */}
        {lane.ticks.map((t, i) => (
          <SvgText key={`gh${i}`} x={CHART_W - 3} y={t.py - 3} fill="none" stroke={C.card} strokeWidth={2.5} fontSize={8.5} fontWeight="600" textAnchor="end">{t.label}</SvgText>
        ))}
        {lane.ticks.map((t, i) => (
          <SvgText key={`gt${i}`} x={CHART_W - 3} y={t.py - 3} fill={C.faint} fontSize={8.5} fontWeight="600" textAnchor="end">{t.label}</SvgText>
        ))}
        {lane.fill ? lane.segs.map((sg, i) => <Path key={`a${i}`} d={areaD(sg, laneH)} fill={`url(#ln${lane.key})`} />) : null}
        {lane.segs.map((sg, i) => <Path key={`l${i}`} d={lineD(sg)} stroke={lane.color} strokeWidth={1.8} fill="none" strokeLinejoin="round" strokeLinecap="round" />)}
        {avgY != null ? <SvgLine x1={Math.max(0, lo)} y1={avgY} x2={Math.min(CHART_W, hi)} y2={avgY} stroke={lane.color} strokeWidth={1.5} strokeDasharray="4 3" /> : null}
        {dot ? <Circle cx={dot.px} cy={dot.py} r={restingDot ? 3.5 : 4} fill={lane.color} fillOpacity={restingDot ? 0.5 : 1} /> : null}
      </Svg>
    </View>
  );
}

function StreamLanes({ streams, movingTimeS, distanceMeters, tall, highlight }: { streams: RunStreams; movingTimeS: number | null; distanceMeters: number; tall?: boolean; highlight?: { a: number; b: number } | null }) {
  const laneH = tall ? 104 : LANE_H;
  const [sel, setSel] = useState<{ a: number; b: number } | null>(null);
  const selRef = useRef<{ a: number; b: number } | null>(null);
  selRef.current = sel;
  // External rep-highlight overrides internal scrub sel when set.
  const effectiveSel = highlight ?? sel;
  const startRef = useRef(0);
  const dragRef = useRef(false);
  const model = useMemo(() => {
    const { d, t, v, hr, alt } = streams;
    const n = Math.min(d.length, t.length, v.length);
    if (n < 4) return null;
    const lastT = t[n - 1] ?? 1;
    const xs = Array.from({ length: n }, (_, i) => t[i] ?? 0);
    const FT = 3.28084;
    const metersPerUnit = DIST_UNITS === 'mi' ? METERS_PER_MILE : 1000;
    const paceRaw: (number | null)[] = [];
    for (let i = 0; i < n; i++) { const vi = v[i]!; paceRaw.push(vi > 0.4 ? metersPerUnit / vi : null); }
    // Walk/stop trim (render only): mask samples slower than 1.75× the run's
    // median moving pace (self-calibrating — ~15:00/mi cut for an 8:30 runner).
    // Brief walk breaks otherwise swing the lane full-height as downward spikes
    // and compress the actual running signal into a band; masked spans render as
    // honest line gaps instead.
    const paceSorted = paceRaw.filter((p): p is number => p != null).sort((a, b) => a - b);
    const paceCut = paceSorted.length ? paceSorted[Math.floor(paceSorted.length / 2)]! * 1.75 : Infinity;
    const paceMasked = paceRaw.map((p) => (p != null && p > paceCut ? null : p));
    const lanes: StreamLane[] = [];
    // Render decimation (chart view-model ONLY — analysis/splits/detection keep
    // full res): smooth full-res, then MEAN-bucket down to ~600 points/lane so
    // the SVG path isn't ~7,500 points. Mean per bucket reads clean (min-max
    // rendered a dense comb on long runs); at ≤32s buckets interval reps stay
    // clearly visible.
    // Smoothing window scales with duration (≈lastT/180, clamped 15–90s): a 2h40
    // long run gets ~55s smoothing so GPS pace jitter doesn't render as a dense
    // comb, while a 50-min interval workout stays ~15s so 200m reps keep their
    // sharp edges. Pace decimates to ~300 pts (≈1/px) — denser only re-draws
    // sub-pixel jitter the smoothing was meant to kill.
    const paceWin = Math.round(Math.min(90, Math.max(15, lastT / 180)));
    const paceDec = decimateMean(xs, smooth(paceMasked, paceWin), 300);
    const paceLane = buildLane('p', 'PACE', C.paceFast, true, false, paceDec.ys, paceDec.xs, lastT, laneH, (val) => formatDuration(val), `/${DIST_UNITS}`, [30, 60, 120, 300]);
    if (paceLane) lanes.push(paceLane);
    if (hr && hr.length >= n) {
      // HR red — the universal heart-rate colour. Distinct from the violet
      // quality accent and the neutral-blue pace lane.
      const hrDec = decimateMean(xs, smooth(hr.slice(0, n).map((x) => x ?? null), 19));
      const hrLane = buildLane('h', 'HEART RATE', C.red, false, true, hrDec.ys, hrDec.xs, lastT, laneH, (val) => String(Math.round(val)), 'bpm', [10, 20, 40]);
      if (hrLane) lanes.push(hrLane);
    }
    if (alt && alt.length >= n) {
      const gain = elevGainFt(streams);
      const altFt = alt.slice(0, n).map((a) => (a != null ? a * FT : null));
      const elevDec = decimateMean(xs, smooth(altFt, 21));
      const elevLane = buildLane('e', 'ELEVATION', C.elev, true, true, elevDec.ys, elevDec.xs, lastT, laneH, (val) => String(Math.round(val)), 'ft', [25, 50, 100, 250, 500], gain != null ? `+${gain} ft` : undefined);
      if (elevLane) lanes.push(elevLane);
    }
    if (!lanes.length) return null;
    const distPts = Array.from({ length: n }, (_, i) => ({ px: ((xs[i] ?? 0) / (lastT || 1)) * CHART_W, dMi: metersToUnits(d[i] ?? 0, DIST_UNITS) }));
    const totalDistance = metersToUnits(d[n - 1] ?? 0, DIST_UNITS);
    const step = DIST_UNITS === 'mi'
      ? totalDistance > 16 ? 5 : totalDistance > 8 ? 3 : 2
      : totalDistance > 25 ? 5 : totalDistance > 10 ? 2 : 1;
    const mileTicks: { x: number; label: string }[] = [];
    for (let unit = step; unit < totalDistance; unit += step) {
      let idx = d.findIndex((x) => x >= unit * metersPerUnit);
      if (idx < 0) idx = n - 1;
      mileTicks.push({ x: ((t[idx] ?? 0) / (lastT || 1)) * CHART_W, label: String(unit) });
    }
    const totalH = lanes.length * (LANE_HEAD + laneH + LANE_GAP) - LANE_GAP;
    return { lanes, distPts, mileTicks, totalH };
  }, [streams, movingTimeS, distanceMeters, laneH, DIST_UNITS]);

  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    // Once scrubbing, hold the gesture: refuse to hand it to the parent ScrollView
    // on a vertical drift, and block the native scroll from taking over.
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,
    onPanResponderGrant: (e) => {
      const x = clamp(e.nativeEvent.locationX, 0, CHART_W);
      const s = selRef.current;
      // Tapping an existing pinned POINT clears it (toggle off).
      if (s && s.b - s.a < 10 && Math.abs(x - s.a) < 16) { setSel(null); dragRef.current = false; return; }
      startRef.current = x; dragRef.current = true; setSel({ a: x, b: x });
    },
    onPanResponderMove: (e) => {
      if (!dragRef.current) return;
      const x = clamp(e.nativeEvent.locationX, 0, CHART_W);
      const a = startRef.current;
      setSel({ a: Math.min(a, x), b: Math.max(a, x) });
    },
    onPanResponderRelease: () => {
      dragRef.current = false;
      const s = selRef.current;
      if (s && s.b - s.a < 10) setSel({ a: s.a, b: s.a }); // a tap collapses to a pinned point
    },
    onPanResponderTerminate: () => { dragRef.current = false; },
  }), []);

  if (!model) return null;
  const isRange = effectiveSel != null && effectiveSel.b - effectiveSel.a >= 10;
  const lo = effectiveSel?.a ?? 0, hi = effectiveSel?.b ?? 0;
  const distAt = (x: number) => nearestBy(model.distPts, x)?.dMi ?? null;
  const dLo = effectiveSel ? distAt(lo) : null, dHi = effectiveSel ? distAt(hi) : null;
  const restX: number | null = null; // no resting cursor — detail shows only while scrubbing
  return (
    <View>
      <View style={styles.slTop}>
        <View style={styles.slReadout}>
          {!effectiveSel ? (
            <Text style={styles.slTopTxt}>Tap a point or drag a range to average</Text>
          ) : isRange ? (
            <View style={styles.slRange}>
              <Text style={styles.slTopTxt}>{dLo?.toFixed(2)}–{dHi?.toFixed(2)} {DIST_UNITS}</Text>
              <Text style={styles.slAvgTag}>AVG</Text>
              <Text style={styles.slSpan}>{dLo != null && dHi != null ? `${(dHi - dLo).toFixed(2)} ${DIST_UNITS}` : ''}</Text>
            </View>
          ) : (
            <Text style={styles.slTopTxt}>at {distAt(lo)?.toFixed(2)} {DIST_UNITS}</Text>
          )}
        </View>
        {sel ? (
          <Pressable onPress={() => setSel(null)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Clear chart selection" style={({ pressed }) => [styles.slClear, pressed && styles.pressBtn]}>
            <Text style={styles.slClearX}>×</Text>
          </Pressable>
        ) : null}
      </View>
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={`Run analysis. ${model.lanes.map((lane) => `${lane.label.toLowerCase()} ${lane.summary}`).join('. ')}.`}
        style={{ width: CHART_W, height: model.totalH, position: 'relative' }}
      >
        {model.lanes.map((l) => <Lane key={l.key} lane={l} sel={effectiveSel} restX={restX} laneH={laneH} />)}
        {effectiveSel && isRange ? (
          <>
            <View pointerEvents="none" style={{ position: 'absolute', left: lo, top: 0, width: hi - lo, height: model.totalH, backgroundColor: C.fill }} />
            <View pointerEvents="none" style={{ position: 'absolute', left: lo, top: 0, width: 1.5, height: model.totalH, backgroundColor: C.ink, opacity: 0.5 }} />
            <View pointerEvents="none" style={{ position: 'absolute', left: Math.max(0, hi - 1.5), top: 0, width: 1.5, height: model.totalH, backgroundColor: C.ink, opacity: 0.5 }} />
          </>
        ) : effectiveSel ? (
          <View pointerEvents="none" style={{ position: 'absolute', left: clamp(lo, 0, CHART_W), top: 0, width: 1, height: model.totalH, backgroundColor: C.ink, opacity: 0.45 }} />
        ) : restX != null ? (
          <View pointerEvents="none" style={{ position: 'absolute', left: restX, top: 0, width: 1, height: model.totalH, backgroundColor: C.ink, opacity: 0.14 }} />
        ) : null}
        <View style={{ position: 'absolute', left: 0, top: 0, width: CHART_W, height: model.totalH }} {...pan.panHandlers} />
      </View>
      <Svg width={CHART_W} height={16}>
        {model.mileTicks.map((t, i) => <SvgLine key={`mt${i}`} x1={t.x} y1={0} x2={t.x} y2={4} stroke={C.faint} strokeWidth={1} />)}
        {model.mileTicks.map((t, i) => <SvgText key={`ml${i}`} x={t.x} y={12} fill={C.faint} fontSize={9} textAnchor="middle">{t.label}</SvgText>)}
      </Svg>
    </View>
  );
}

function PaceHrChart({ streams, movingTimeS, distanceMeters }: { streams: RunStreams; movingTimeS: number | null; distanceMeters: number }) {
  const H = CHART_H;
  const [sel, setSel] = useState<{ a: number; b: number } | null>(null);
  const selRef = useRef(sel);
  selRef.current = sel;
  const dragRef = useRef<'a' | 'b' | null>(null);

  const model = useMemo(() => {
    const pace = paceSeries(streams);
    const hr = hrSeries(streams);
    const d = streams.d;
    const lastT = Math.max(pace[pace.length - 1]?.t ?? 1, hr[hr.length - 1]?.t ?? 1);
    const xDom: [number, number] = [0, lastT];

    const paceSm = smooth(pace.map((p) => p.paceSecPerKm), 27);
    const hrSm = smooth(hr.map((p) => p.hr), 19);
    const pv = paceSm.filter((p): p is number => p != null).sort((a, b) => a - b);
    const hv = hrSm.filter((p): p is number => p != null);
    const avg = averagePace(streams, { movingTimeS, distanceMeters });
    if (pv.length < 2) return null;
    const pLo = percentile(pv, 0.05), pHi = percentile(pv, 0.95);
    const pPad = (pHi - pLo) * 0.16 || 10;
    const pDom: [number, number] = [pLo - pPad, pHi + pPad];
    const hDom: [number, number] = hv.length ? [Math.min(...hv) - 6, Math.max(...hv) + 6] : [0, 1];

    // pace: faster (smaller s/km) reads UP → no invert; HR: higher reads UP → invert.
    const paceProj = project(pace.map((p, i) => ({ x: p.t, y: paceSm[i] ?? null })), xDom, pDom, CHART_W, H, false);
    const hrProj = project(hr.map((p, i) => ({ x: p.t, y: hrSm[i] ?? null })), xDom, hDom, CHART_W, H, true);

    // clean point lists (for scrub lookup), carrying distance
    const pacePts = pace.map((p, i) => {
      const y = paceSm[i];
      if (y == null) return null;
      return { px: (p.t / lastT) * CHART_W, py: yAt(y, pDom, H, false), dMi: (d[i] ?? 0) / METERS_PER_MILE, pace: y };
    }).filter((x): x is NonNullable<typeof x> => x != null);
    const hrPts = hr.map((p, i) => {
      const y = hrSm[i];
      if (y == null) return null;
      return { px: (p.t / lastT) * CHART_W, py: yAt(y, hDom, H, true), hr: Math.round(y) };
    }).filter((x): x is NonNullable<typeof x> => x != null);

    // pace gridlines (nice values) + mile ticks
    const gridlines = paceGridlines(pDom[0], pDom[1], true)
      .filter((v) => v > pDom[0] && v < pDom[1])
      .map((v) => ({ y: yAt(v, pDom, H, false), label: formatPace(v, 'mi').replace('/mi', '') }));
    const totalMi = (d[d.length - 1] ?? 0) / METERS_PER_MILE;
    const step = totalMi > 16 ? 5 : totalMi > 8 ? 3 : 2;
    const mileTicks: { x: number; label: string }[] = [];
    for (let mi = step; mi < totalMi; mi += step) {
      const target = mi * METERS_PER_MILE;
      let idx = d.findIndex((x) => x >= target);
      if (idx < 0) idx = d.length - 1;
      mileTicks.push({ x: ((streams.t[idx] ?? 0) / lastT) * CHART_W, label: String(mi) });
    }

    const avgY = avg != null ? yAt(avg, pDom, H, false) : null;
    return { paceSegs: segments(paceProj), hrSegs: segments(hrProj), avgY, gridlines, mileTicks, pacePts, hrPts };
  }, [streams, movingTimeS, distanceMeters]);

  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    // Once scrubbing, hold the gesture: refuse to hand it to the parent ScrollView
    // on a vertical drift, and block the native scroll from taking over.
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,
    onPanResponderGrant: (e) => {
      const x = clamp(e.nativeEvent.locationX, 0, CHART_W);
      const s = selRef.current;
      if (s) {
        const lo = Math.min(s.a, s.b), hi = Math.max(s.a, s.b);
        if (Math.abs(x - lo) < 26) { dragRef.current = 'a'; setSel({ a: x, b: hi }); return; }
        if (Math.abs(x - hi) < 26) { dragRef.current = 'b'; setSel({ a: lo, b: x }); return; }
      }
      dragRef.current = 'b';
      setSel({ a: x, b: x });
    },
    onPanResponderMove: (e) => {
      const x = clamp(e.nativeEvent.locationX, 0, CHART_W);
      const s = selRef.current;
      if (!s) return;
      if (dragRef.current === 'a') setSel({ a: x, b: s.b });
      else setSel({ a: s.a, b: x });
    },
    onPanResponderRelease: () => {
      dragRef.current = null;
      const s = selRef.current;
      if (s && Math.abs(s.a - s.b) < 8) setSel(null); // a tap clears
    },
    onPanResponderTerminate: () => { dragRef.current = null; },
  }), []);

  if (!model) return <View style={{ height: H + CHART_AX }} />;
  const lo = sel ? Math.min(sel.a, sel.b) : 0;
  const hi = sel ? Math.max(sel.a, sel.b) : 0;
  const range = sel && hi - lo >= 8;
  const summary = range ? rangeSummary(model, lo, hi) : null;

  return (
    <>
    <View style={{ width: CHART_W, height: H + CHART_AX, position: 'relative' }}>
      <Svg width={CHART_W} height={H + CHART_AX}>
        <Defs>
          <LinearGradient id="pf" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={C.paceFast} stopOpacity="0.42" />
            <Stop offset="1" stopColor={C.paceFast} stopOpacity="0" />
          </LinearGradient>
        </Defs>
        {/* pace gridlines + labels */}
        {model.gridlines.map((g, i) => (
          <SvgLine key={`g${i}`} x1={0} y1={g.y} x2={CHART_W} y2={g.y} stroke={C.line} strokeWidth={1} />
        ))}
        {model.gridlines.map((g, i) => (
          <SvgText key={`gl${i}`} x={2} y={g.y - 3} fill={C.faint} fontSize={9}>{g.label}</SvgText>
        ))}
        {/* mile ticks + labels */}
        {model.mileTicks.map((t, i) => (
          <SvgLine key={`m${i}`} x1={t.x} y1={H} x2={t.x} y2={H + 4} stroke={C.faint} strokeWidth={1} />
        ))}
        {model.mileTicks.map((t, i) => (
          <SvgText key={`ml${i}`} x={t.x} y={H + 14} fill={C.faint} fontSize={9} textAnchor="middle">{t.label}</SvgText>
        ))}
        {/* pace area + line, avg, hr */}
        {model.paceSegs.map((seg, i) => <Path key={`pa${i}`} d={areaD(seg, H)} fill="url(#pf)" />)}
        {model.paceSegs.map((seg, i) => <Path key={`pl${i}`} d={lineD(seg)} stroke={C.paceFast} strokeWidth={2} fill="none" />)}
        {model.avgY != null ? (
          <SvgLine x1={0} y1={model.avgY} x2={CHART_W} y2={model.avgY} stroke={C.paceFast} strokeOpacity={0.45} strokeWidth={1} strokeDasharray="4 4" />
        ) : null}
        {model.hrSegs.map((seg, i) => <Path key={`hr${i}`} d={lineD(seg)} stroke={C.red} strokeWidth={2} fill="none" strokeLinecap="round" />)}
        {/* range selection */}
        {range ? (
          <>
            <Rect x={lo} y={0} width={hi - lo} height={H} fill="#FFFFFF" fillOpacity={0.07} />
            <SvgLine x1={lo} y1={0} x2={lo} y2={H} stroke="#FFFFFF" strokeOpacity={0.65} strokeWidth={1.5} />
            <SvgLine x1={hi} y1={0} x2={hi} y2={H} stroke="#FFFFFF" strokeOpacity={0.65} strokeWidth={1.5} />
            <Circle cx={lo} cy={9} r={6} fill="#FFFFFF" /><Circle cx={lo} cy={H - 9} r={6} fill="#FFFFFF" />
            <Circle cx={hi} cy={9} r={6} fill="#FFFFFF" /><Circle cx={hi} cy={H - 9} r={6} fill="#FFFFFF" />
          </>
        ) : null}
      </Svg>
      {/* range summary */}
      {summary ? (
        <View style={[styles.rangeCallout, { left: clamp((lo + hi) / 2 - 80, 0, CHART_W - 160) }]} pointerEvents="none">
          <View style={styles.rcCell}><Text style={styles.rcVal}>{summary.distMi.toFixed(2)}</Text><Text style={styles.rcLab}>mi</Text></View>
          <View style={styles.rcDiv} />
          <View style={styles.rcCell}><Text style={[styles.rcVal, { color: C.paceFast }]}>{summary.paceLabel.replace('/mi', '')}</Text><Text style={styles.rcLab}>/mi</Text></View>
          <View style={styles.rcDiv} />
          <View style={styles.rcCell}><Text style={[styles.rcVal, { color: C.red }]}>{summary.avgHr ?? '—'}</Text><Text style={styles.rcLab}>bpm</Text></View>
        </View>
      ) : null}
      <View style={{ position: 'absolute', left: 0, top: 0, width: CHART_W, height: H }} {...pan.panHandlers} />
    </View>
    <View style={{ height: 18, justifyContent: 'center' }}>
      {!sel ? <Text style={styles.dragHint}>Drag to compare a segment</Text> : null}
    </View>
    </>
  );
}
function rangeSummary(model: { pacePts: { px: number; dMi: number; pace: number }[]; hrPts: { px: number; hr: number }[] }, lo: number, hi: number) {
  const inP = model.pacePts.filter((p) => p.px >= lo && p.px <= hi);
  const inH = model.hrPts.filter((p) => p.px >= lo && p.px <= hi);
  if (inP.length < 2) return null;
  const distMi = Math.abs(inP[inP.length - 1]!.dMi - inP[0]!.dMi);
  const avgKm = inP.reduce((s, p) => s + p.pace, 0) / inP.length;
  const avgHr = inH.length ? Math.round(inH.reduce((s, p) => s + p.hr, 0) / inH.length) : null;
  return { distMi, paceLabel: formatPace(avgKm, 'mi'), avgHr };
}
function sampleChart(model: { pacePts: { px: number; py: number; dMi: number; pace: number }[]; hrPts: { px: number; py: number; hr: number }[] }, x: number) {
  const p = nearestBy(model.pacePts, x);
  const h = nearestBy(model.hrPts, x);
  if (!p) return null;
  return { px: p.px, paceY: p.py, dMi: p.dMi, paceLabel: formatPace(p.pace, 'mi'), hrY: h?.py ?? null, hr: h?.hr ?? null };
}
function nearestBy<T extends { px: number }>(arr: T[], x: number): T | null {
  let best: T | null = null, bd = Infinity;
  for (const a of arr) { const dd = Math.abs(a.px - x); if (dd < bd) { bd = dd; best = a; } }
  return best;
}
function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

/** Civil date 'YYYY-MM-DD' shifted by n days (UTC-noon anchored). */
function addCivilDays(d: string, n: number): string {
  const dt = new Date(`${d}T12:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

// ── Pace curve: THIS run vs the recent-best envelope of prior runs (log-x) ────
// Reuses the shipped `paceCurve` lib (the same engine the Trends tab draws), so
// the comparison is the real pace-duration curve, not a per-run approximation.
// Strava best efforts ride the curve as labelled waypoints (the discrete distance
// PRs the continuous curve passes through). Touch-scrub reads this vs best.
const BEST_SHORT: Record<string, string> = {
  '1 mile': '1mi', '5K': '5K', '10K': '10K', '10 mile': '10mi', 'Half-Marathon': 'Half', '30K': '30K', 'Marathon': 'Mara',
};
/** Compact duration label for the scrub readout (5:57 · 20m · 1h26). */
function durShort(s: number): string {
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.floor(s / 60), ss = Math.round(s % 60);
  if (m < 60) return ss ? `${m}:${String(ss).padStart(2, '0')}` : `${m}m`;
  const h = Math.floor(m / 60), mm = m % 60;
  return mm ? `${h}h${mm}` : `${h}h`;
}

type CurveLabelAnchor = 'start' | 'middle' | 'end';

/**
 * Keep a milestone label out of the curve's ink. Flat sections retain the
 * centered label used by the other charts; steep sections move the label into
 * the open quadrant perpendicular to the local slope. Edge guards then keep
 * the text inside the plot.
 */
function curveMilestoneLabel(
  curve: { px: number; py: number }[],
  px: number,
  py: number,
  chartH: number,
  plotLeft: number,
  plotRight: number,
): { x: number; y: number; anchor: CurveLabelAnchor } {
  let idx = 0;
  let nearest = Infinity;
  for (let i = 0; i < curve.length; i++) {
    const distance = Math.abs(curve[i]!.px - px);
    if (distance < nearest) { nearest = distance; idx = i; }
  }
  const before = curve[Math.max(0, idx - 2)] ?? curve[idx];
  const after = curve[Math.min(curve.length - 1, idx + 2)] ?? curve[idx];
  const dx = (after?.px ?? px) - (before?.px ?? px);
  const slope = dx !== 0 ? ((after?.py ?? py) - (before?.py ?? py)) / dx : 0;
  const steep = Math.abs(slope) > 0.28;

  if (!steep) {
    const nearStart = px < plotLeft + 18;
    const nearEnd = px > plotRight - 18;
    return {
      x: nearStart ? plotLeft + 2 : nearEnd ? plotRight - 2 : px,
      y: clamp(py - 8, 10, chartH - 4),
      anchor: nearStart ? 'start' : nearEnd ? 'end' : 'middle',
    };
  }

  const placeBelow = py <= chartH - 18;
  // SVG y grows downward. On a descending visual tail (positive SVG slope),
  // below-left is open; when space runs out, use the opposite normal above.
  let side = slope > 0 ? -1 : 1;
  if (!placeBelow) side *= -1;
  if (px > plotRight - 24) side = -1;
  if (px < plotLeft + 24) side = 1;
  return {
    x: clamp(px + side * 6, plotLeft + 2, plotRight - 2),
    y: clamp(py + (placeBelow ? 13 : -10), 10, chartH - 4),
    anchor: side < 0 ? 'end' : 'start',
  };
}
// The pace-curve comparison baseline can be a rolling window or a custom span of
// the runner's history (e.g. "vs my 2025 runs"). The selected period drives BOTH
// which runs are loaded and which build the baseline curve.
type CurvePeriod = { kind: 'rolling'; days: number; label: string } | { kind: 'custom'; from: string; to: string };
const CURVE_PRESETS: { days: number; label: string }[] = [
  { days: 84, label: '12W' }, { days: 182, label: '26W' }, { days: 3650, label: 'All' },
];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The {from,to} corpus window the baseline curve is built from. */
function curveWindow(p: CurvePeriod, runDate: string): { from: string; to: string } {
  return p.kind === 'custom' ? { from: p.from, to: p.to } : { from: addCivilDays(runDate, -p.days), to: runDate };
}
/** First-of-month `delta` months from an ISO date (YYYY-MM-DD). */
function stepMonth(iso: string, delta: number): string {
  const [y, m] = iso.split('-').map(Number);
  const idx = y! * 12 + (m! - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}-01`;
}
/** Last day of the month containing `iso`. */
function endOfMonth(iso: string): string {
  return addCivilDays(stepMonth(`${iso.slice(0, 7)}-01`, 1), -1);
}
function monthLabel(iso: string): string {
  const [y, m] = iso.split('-').map(Number);
  return `${MONTHS[m! - 1]} ${y}`;
}

/** Ease the next layout change (row expand/collapse), unless reduce-motion is on. */
function animateExpand(rm: boolean) {
  if (!rm) LayoutAnimation.configureNext(LayoutAnimation.create(180, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity));
}
// Honor the OS "Reduce Motion" setting — animations that MOVE become instant.
function useReduceMotion(): boolean {
  const [rm, setRm] = useState(false);
  useEffect(() => {
    let on = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => { if (on) setRm(v); });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setRm);
    return () => { on = false; sub.remove(); };
  }, []);
  return rm;
}

// iOS UISegmentedControl clone: recessed full-width track, equal-width segments,
// a raised thumb that springs to the selection. (Apple Fitness D/W/M/Y, Oura.)
function Segmented({ options, value, onChange }: {
  options: readonly { label: string; value: number }[]; value: number; onChange: (v: number) => void;
}) {
  const [w, setW] = useState(0);
  const rm = useReduceMotion();
  const PAD = 2, INSET = 2;
  const seg = w > 0 ? (w - PAD * 2) / options.length : 0;
  const idx = Math.max(0, options.findIndex((o) => o.value === value));
  const tx = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (seg <= 0) return;
    const target = PAD + idx * seg + INSET;
    if (rm) { tx.setValue(target); return; } // reduce-motion: snap, don't spring
    // a touch of overshoot (ratio ≈ 0.65) for genuine iOS settle, not a linear slide
    Animated.spring(tx, { toValue: target, useNativeDriver: true, stiffness: 360, damping: 22, mass: 0.8 }).start();
  }, [idx, seg, tx, rm]);
  return (
    <View style={styles.segTrack} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {seg > 0 ? <Animated.View style={[styles.segThumb, { width: seg - INSET * 2, transform: [{ translateX: tx }] }]} /> : null}
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <View key={o.label} style={styles.segItem}>
            {i > 0 ? <View style={[styles.segDiv, (on || options[i - 1]!.value === value) ? { opacity: 0 } : null]} /> : null}
            <Pressable
              onPress={() => onChange(o.value)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={o.label}
              style={({ pressed }) => [styles.segHit, pressed && { opacity: 0.6 }]}
            >
              <Text style={[styles.segTxt, on ? styles.segTxtOn : null]}>{o.label}</Text>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}
// Comparison-period selector for the baseline curve: rolling presets + a Custom
// span you bracket with month steppers (e.g. "vs my 2025 runs"). No native date
// picker — month granularity is the right resolution for a training-period curve.
function PeriodControl({ period, onPeriod, runDate }: { period: CurvePeriod; onPeriod: (p: CurvePeriod) => void; runDate: string }) {
  const isCustom = period.kind === 'custom';
  const floor = stepMonth(runDate, -72); // ~6 years back
  const startCustom = () => onPeriod({ kind: 'custom', from: `${runDate.slice(0, 4)}-01-01`, to: endOfMonth(runDate) });
  const moveFrom = (delta: number) => {
    if (period.kind !== 'custom') return;
    const next = stepMonth(period.from, delta);
    if (next >= floor && next < period.to) onPeriod({ ...period, from: next });
  };
  const moveTo = (delta: number) => {
    if (period.kind !== 'custom') return;
    const firstOfNext = stepMonth(period.to, delta);
    if (firstOfNext > period.from && endOfMonth(firstOfNext) <= endOfMonth(runDate)) onPeriod({ ...period, to: endOfMonth(firstOfNext) });
  };
  return (
    <View>
      <View style={styles.pcChips}>
        {CURVE_PRESETS.map((r) => {
          const on = period.kind === 'rolling' && period.days === r.days;
          return (
            <Pressable
              key={r.label}
              onPress={() => onPeriod({ kind: 'rolling', days: r.days, label: r.label })}
              accessibilityRole="button"
              accessibilityLabel={`${r.label} comparison period`}
              accessibilityState={{ selected: on }}
              style={({ pressed }) => [styles.pcChip, on && styles.pcChipOn, pressed && styles.pressDim]}
            >
              <Text style={[styles.pcChipTxt, on && styles.pcChipTxtOn]}>{r.label}</Text>
            </Pressable>
          );
        })}
        <Pressable
          onPress={startCustom}
          accessibilityRole="button"
          accessibilityLabel="Custom comparison period"
          accessibilityState={{ selected: isCustom }}
          style={({ pressed }) => [styles.pcChip, isCustom && styles.pcChipOn, pressed && styles.pressDim]}
        >
          <Text style={[styles.pcChipTxt, isCustom && styles.pcChipTxtOn]} numberOfLines={1}>{period.kind === 'custom' ? `${MONTHS[Number(period.from.slice(5, 7)) - 1]}-${MONTHS[Number(period.to.slice(5, 7)) - 1]}` : 'Custom'}</Text>
        </Pressable>
      </View>
      {isCustom ? (
        <View style={styles.pcCustom}>
          <PeriodStepper label="From" value={monthLabel(period.from)} onLeft={() => moveFrom(-1)} onRight={() => moveFrom(1)} />
          <PeriodStepper label="To" value={monthLabel(period.to)} onLeft={() => moveTo(-1)} onRight={() => moveTo(1)} />
        </View>
      ) : null}
    </View>
  );
}

function PeriodStepper({ label, value, onLeft, onRight }: { label: string; value: string; onLeft: () => void; onRight: () => void }) {
  return (
    <View style={styles.stepRow}>
      <Text style={styles.stepLab}>{label}</Text>
      <View style={styles.stepCtrl}>
        <Pressable onPress={onLeft} accessibilityRole="button" accessibilityLabel={`Previous ${label.toLowerCase()} month`} style={({ pressed }) => [styles.stepBtn, pressed && styles.pressDim]}><SymbolView name="chevron.left" size={12} tintColor={C.mute} resizeMode="scaleAspectFit" /></Pressable>
        <Text style={styles.stepVal}>{value}</Text>
        <Pressable onPress={onRight} accessibilityRole="button" accessibilityLabel={`Next ${label.toLowerCase()} month`} style={({ pressed }) => [styles.stepBtn, pressed && styles.pressDim]}><SymbolView name="chevron.right" size={12} tintColor={C.mute} resizeMode="scaleAspectFit" /></Pressable>
      </View>
    </View>
  );
}

export function edgeAwareTickLabel(x: number, left: number, right: number, inset = 12): { x: number; anchor: 'start' | 'middle' | 'end' } {
  if (x < left + inset) return { x: left, anchor: 'start' };
  if (x > right - inset) return { x: right, anchor: 'end' };
  return { x, anchor: 'middle' };
}

function PaceCurve({ activity, corpus, period, onPeriod, tall, stale }: { activity: ActivityRow; corpus: ActivityRow[]; period: CurvePeriod; onPeriod: (p: CurvePeriod) => void; tall?: boolean; stale?: boolean }) {
  const H = tall ? 300 : 200, AX = 18;
  const PLOT_LEFT = 28, PLOT_RIGHT = CHART_W - 2, PLOT_W = PLOT_RIGHT - PLOT_LEFT;
  const [cursorX, setCursorX] = useState<number | null>(null);
  const [hasScrubbed, setHasScrubbed] = useState(false);
  const model = useMemo(() => {
    const toAct = (a: ActivityRow): CurveActivity => ({
      id: a.id, name: a.name ?? null, date: a.local_date ?? null,
      streams: hasUsableStreams(a.streams) ? (a.streams as RunStreams) : null,
    });
    const nowMs = activity.local_date ? new Date(`${activity.local_date}T12:00:00Z`).getTime() : Date.now();
    // Pace stays in sec/km here; the axis helpers (paceGridlines / formatPace 'mi')
    // do the mile conversion for the LABELS — converting earlier double-converts.
    const cur = paceCurve([toAct(activity)]).points.map((p) => ({ dur: p.durationS, pace: p.paceSecPerKm }));
    if (cur.length < 3) return null;
    const dMin = cur[0]!.dur, dMax = cur[cur.length - 1]!.dur;
    // "Previous" = best envelope of the runner's OTHER runs over the 12 weeks
    // before THIS run, clipped to the durations this run actually covered.
    // The corpus is already scoped to the selected period (rolling or custom), so
    // the whole thing builds the baseline — no sinceDays filter needed here.
    const prev = paceDurationCurveFromPrecomputed(
      corpus
        .filter((a) => a.id !== activity.id)
        .map((a) => ({ id: a.id, name: a.name ?? null, date: a.local_date ?? null, curve: a.stream_summary?.pace_duration_curve ?? null })),
      { nowMs },
    ).points
      .map((p) => ({ dur: p.durationS, pace: p.paceSecPerKm }))
      .filter((p) => p.dur >= dMin && p.dur <= dMax);

    const lnMin = Math.log(dMin), lnMax = Math.log(dMax);
    const xOf = (d: number) => PLOT_LEFT + ((Math.log(d) - lnMin) / (lnMax - lnMin || 1)) * PLOT_W;
    // Anchor the y-domain on THIS run's range (the focus); the recent-best line
    // clips into view. (The envelope's long-duration tail can be noisy-slow when
    // few prior runs are that long — it shouldn't stretch the whole axis.)
    const cv = cur.map((p) => p.pace);
    const lo = Math.min(...cv), hi = Math.max(...cv);
    const pad = (hi - lo) * 0.12 || 8;
    const pDom: [number, number] = [lo - pad * 1.8, hi + pad];
    const yOf = (p: number) => yAt(p, pDom, H, false);
    const curProj = cur.map((p) => ({ px: xOf(p.dur), py: yOf(p.pace), dur: p.dur, pace: p.pace }));
    const prevProj = prev.map((p) => ({ px: xOf(p.dur), py: yOf(p.pace), dur: p.dur, pace: p.pace }));
    const efforts = (activity.best_efforts ?? []) as { name: string; distance_m: number; elapsed_s: number }[];
    const bestPts = efforts
      .filter((e) => BEST_SHORT[e.name] && e.distance_m > 0 && e.elapsed_s >= dMin && e.elapsed_s <= dMax)
      .map((e) => {
        const px = xOf(e.elapsed_s);
        const py = yOf(e.elapsed_s / (e.distance_m / 1000));
        return { px, py, label: BEST_SHORT[e.name]!, labelPlacement: curveMilestoneLabel(curProj, px, py, H, PLOT_LEFT, PLOT_RIGHT) };
      });
    const ticks = [
      { s: 60, l: '1m' }, { s: 300, l: '5m' }, { s: 1200, l: '20m' }, { s: 3600, l: '1h' }, { s: 7200, l: '2h' },
    ].filter((t) => t.s >= dMin && t.s <= dMax).map((t) => ({ x: xOf(t.s), label: t.l }));
    const gridlines = paceGridlines(pDom[0], pDom[1], true)
      .filter((v) => v > pDom[0] && v < pDom[1])
      .map((v) => ({ y: yOf(v), label: formatPace(v, DIST_UNITS).replace(`/${DIST_UNITS}`, '') }));
    // Plain-language comparison vs the period best: mean pace gap over the overlap.
    let delta: { sec: number; sense: 'off' | 'under' | 'on' } | null = null;
    if (prevProj.length >= 2 && curProj.length >= 2) {
      let sum = 0, n = 0;
      for (const p of prevProj) { const c = nearestBy(curProj, p.px); if (c) { sum += c.pace - p.pace; n++; } }
      if (n > 0) { const m = sum / n; delta = { sec: Math.abs(Math.round(m)), sense: m > 3 ? 'off' : m < -3 ? 'under' : 'on' }; }
    }
    return { curProj, prevProj, bestPts, ticks, gridlines, hasPrev: prevProj.length >= 2, delta };
  }, [activity, corpus, H, PLOT_LEFT, PLOT_RIGHT, PLOT_W, DIST_UNITS]);

  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    // Once scrubbing, hold the gesture: refuse to hand it to the parent ScrollView
    // on a vertical drift, and block the native scroll from taking over.
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,
    onPanResponderGrant: (e) => setCursorX(clamp(e.nativeEvent.locationX, PLOT_LEFT, PLOT_RIGHT)),
    onPanResponderMove: (e) => setCursorX(clamp(e.nativeEvent.locationX, PLOT_LEFT, PLOT_RIGHT)),
    onPanResponderRelease: () => setCursorX(null),
    onPanResponderTerminate: () => setCursorX(null),
  }), [PLOT_LEFT, PLOT_RIGHT]);

  if (!model) return null;
  const curPt = cursorX != null ? nearestBy(model.curProj, cursorX) : null;
  const prevPt = cursorX != null && model.hasPrev ? nearestBy(model.prevProj, cursorX) : null;
  const curDistance = curPt ? metersToUnits((curPt.dur / curPt.pace) * 1000, DIST_UNITS) : null;
  const rangeLabel = period.kind === 'rolling' ? period.label : 'custom';
  // Cursor + callout appear ONLY while the user is actively scrubbing — no
  // resting/auto cursor.
  const resting = cursorX == null;
  const showPt = curPt;
  const showPrev = prevPt;
  const inspectorW = Math.min(220, CHART_W);

  return (
    <View>
      <View style={styles.pcLegend}>
        <View style={styles.pcKey}><View style={[styles.pcLine, { backgroundColor: C.paceFast }]} /><Text style={styles.pcKeyTxt}>This run</Text></View>
        {model.hasPrev ? (
          <View style={styles.pcKey}>
            <View style={styles.pcDots} accessibilityElementsHidden>
              <View style={[styles.pcDot, { backgroundColor: C.mute }]} />
              <View style={[styles.pcDot, { backgroundColor: C.mute }]} />
              <View style={[styles.pcDot, { backgroundColor: C.mute }]} />
            </View>
            <Text style={styles.pcKeyTxt}>Best</Text>
          </View>
        ) : null}
      </View>
      <PeriodControl period={period} onPeriod={onPeriod} runDate={activity.local_date ?? ''} />
      <View style={{ height: GAP }} />
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={`Pace curve for this run${model.hasPrev ? ` compared with the best ${rangeLabel}` : ''}${model.delta ? `. ${model.delta.sense === 'on' ? 'On the comparison curve' : `${model.delta.sec} seconds ${model.delta.sense === 'off' ? 'off' : 'ahead of'} the comparison curve`}` : ''}${curPt && curDistance != null ? `. Inspecting ${curDistance.toFixed(2)} ${DIST_UNITS === 'mi' ? 'miles' : 'kilometers'} over ${durShort(curPt.dur)}` : ''}.`}
        style={{ width: CHART_W, height: H + AX, position: 'relative' }}
      >
        <Svg width={CHART_W} height={H + AX}>
          <Defs>
            <LinearGradient id="pcf" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={C.paceFast} stopOpacity="0.16" />
              <Stop offset="1" stopColor={C.paceFast} stopOpacity="0" />
            </LinearGradient>
          </Defs>
          {model.gridlines.map((g, i) => <SvgLine key={`cg${i}`} x1={PLOT_LEFT} y1={g.y} x2={PLOT_RIGHT} y2={g.y} stroke={C.line} strokeWidth={1} />)}
          {model.gridlines.map((g, i) => <SvgText key={`cgl${i}`} x={2} y={g.y - 3} fill={C.faint} fontSize={9}>{g.label}</SvgText>)}
          {model.ticks.map((t, i) => <SvgLine key={`ct${i}`} x1={t.x} y1={H} x2={t.x} y2={H + 4} stroke={C.faint} strokeWidth={1} />)}
          {model.ticks.map((t, i) => {
            const label = edgeAwareTickLabel(t.x, PLOT_LEFT, PLOT_RIGHT);
            return (
              <SvgText
                key={`ctl${i}`}
                x={label.x}
                y={H + 13}
                fill={C.faint}
                fontSize={9}
                textAnchor={label.anchor}
              >
                {t.label}
              </SvgText>
            );
          })}
          {/* recent best — muted dashed baseline, drawn first (under). While a
              newly-picked period is still loading this is the PREVIOUS period's
              curve, held so the comparison doesn't blink out; it fades to signal
              that it isn't the selected window yet. */}
          {model.hasPrev ? <Path d={smoothLineD(model.prevProj)} stroke={C.mute} strokeOpacity={stale ? 0.22 : 0.66} strokeWidth={1.35} fill="none" strokeDasharray="1 5" strokeLinejoin="round" strokeLinecap="round" /> : null}
          {/* this run — filled + bright */}
          <Path d={smoothAreaD(model.curProj, H)} fill="url(#pcf)" />
          <Path d={smoothLineD(model.curProj)} stroke={C.paceFast} strokeWidth={2.4} fill="none" strokeLinejoin="round" strokeLinecap="round" />
          {/* best-effort waypoints (distance PRs the curve passes through) */}
          {model.bestPts.map((b, i) => <SvgText key={`bel${i}`} x={b.labelPlacement.x} y={b.labelPlacement.y} fill={C.mute} fontSize={8.5} fontWeight="700" textAnchor={b.labelPlacement.anchor}>{b.label}</SvgText>)}
          {model.bestPts.map((b, i) => <Circle key={`bed${i}`} cx={b.px} cy={b.py} r={3.2} fill={C.bg} stroke={C.paceFast} strokeWidth={1.6} />)}
          {/* scrub cursor — only while actively dragging */}
          {showPt ? (
            <>
              <SvgLine x1={showPt.px} y1={0} x2={showPt.px} y2={H} stroke={C.ink} strokeOpacity={0.5} strokeWidth={1} />
              {showPrev ? <Circle cx={showPrev.px} cy={showPrev.py} r={4} fill={C.mute} /> : null}
              <Circle cx={showPt.px} cy={showPt.py} r={4.5} fill={C.paceFast} />
            </>
          ) : null}
        </Svg>
        {showPt ? (
          <View style={[styles.rangeCallout, { width: inspectorW, left: clamp(showPt.px - inspectorW / 2, 0, CHART_W - inspectorW) }]} pointerEvents="none">
            <View style={styles.rcCell}><Text style={styles.rcVal}>{curDistance?.toFixed(2) ?? '—'}</Text><Text style={styles.rcLab}>{DIST_UNITS}</Text></View>
            <View style={styles.rcDiv} />
            <View style={styles.rcCell}><Text style={styles.rcVal}>{durShort(showPt.dur)}</Text><Text style={styles.rcLab}>dur</Text></View>
            <View style={styles.rcDiv} />
            <View style={styles.rcCell}><Text style={[styles.rcVal, { color: C.paceFast }]}>{formatPace(showPt.pace, DIST_UNITS).replace(`/${DIST_UNITS}`, '')}</Text><Text style={styles.rcLab}>this</Text></View>
            <View style={styles.rcDiv} />
            <View style={styles.rcCell}><Text style={[styles.rcVal, { color: C.mute }]}>{showPrev ? formatPace(showPrev.pace, DIST_UNITS).replace(`/${DIST_UNITS}`, '') : '—'}</Text><Text style={styles.rcLab}>best</Text></View>
          </View>
        ) : null}
        <View
          testID="pace-curve-scrubber"
          style={{ position: 'absolute', left: 0, top: 0, width: CHART_W, height: H }}
          onTouchStart={(e) => {
            setHasScrubbed(true);
            setCursorX(clamp(e.nativeEvent.locationX, PLOT_LEFT, PLOT_RIGHT));
          }}
          {...pan.panHandlers}
        />
      </View>
      <View style={{ height: 16, justifyContent: 'center' }}>
        {resting && !hasScrubbed ? <Text style={styles.dragHint}>Drag to inspect any duration</Text> : null}
      </View>
    </View>
  );
}

// ── Elevation profile (streams.alt over DISTANCE; scrub reports a 0–1 position) ─
function ElevationProfile({ streams, onScrub }: { streams: RunStreams; onScrub?: (frac: number | null) => void }) {
  const H = 118, AX = 18;
  const [cursorX, setCursorX] = useState<number | null>(null);
  const onScrubRef = useRef(onScrub); onScrubRef.current = onScrub;
  const model = useMemo(() => {
    const alt = streams.alt;
    const d = streams.d;
    if (!alt || alt.length < 2 || !d) return null;
    const n = Math.min(alt.length, d.length);
    const totalD = d[n - 1] || 1;
    // Smooth altitude before computing gain — raw GPS alt is noisy and massively
    // over-counts cumulative gain on flat terrain (Strava/Garmin smooth too).
    const raw: number[] = [];
    for (let i = 0; i < n; i++) raw.push(alt[i] ?? 0);
    const vals = smooth(raw, 21).map((v, i) => v ?? raw[i]!);
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const dom: [number, number] = [lo - 1, hi + 1 + (hi - lo) * 0.14]; // headroom for the max label
    // x is DISTANCE (not time) — the natural axis for an elevation profile.
    const proj = vals.map((a, i) => ({ px: ((d[i] ?? 0) / totalD) * CHART_W, py: yAt(a, dom, H, true) }));
    const pts = proj.map((p, i) => ({ px: p.px, py: p.py, ft: Math.round(vals[i]! * 3.28084), mi: metersToUnits(d[i] ?? 0, DIST_UNITS) }));
    let gain = 0;
    for (let i = 1; i < n; i++) { const dd = vals[i]! - vals[i - 1]!; if (dd > 0) gain += dd; }
    const totalMi = metersToUnits(totalD, DIST_UNITS);
    const metersPerUnit = DIST_UNITS === 'mi' ? METERS_PER_MILE : 1000;
    const step = DIST_UNITS === 'mi'
      ? totalMi > 16 ? 5 : totalMi > 8 ? 3 : 2
      : totalMi > 25 ? 5 : totalMi > 10 ? 2 : 1;
    const mileTicks: { x: number; label: string }[] = [];
    for (let mi = step; mi < totalMi; mi += step) mileTicks.push({ x: (mi * metersPerUnit / totalD) * CHART_W, label: String(mi) });
    return { area: areaD(proj, H), line: lineD(proj), gainFt: Math.round(gain * 3.28084), maxFt: Math.round(hi * 3.28084), gridY: yAt(hi, dom, H, true), mileTicks, pts };
  }, [streams, DIST_UNITS]);
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    // Once scrubbing, hold the gesture: refuse to hand it to the parent ScrollView
    // on a vertical drift, and block the native scroll from taking over.
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,
    onPanResponderGrant: (e) => { const x = clamp(e.nativeEvent.locationX, 0, CHART_W); setCursorX(x); onScrubRef.current?.(x / CHART_W); },
    onPanResponderMove: (e) => { const x = clamp(e.nativeEvent.locationX, 0, CHART_W); setCursorX(x); onScrubRef.current?.(x / CHART_W); },
    onPanResponderRelease: () => { setCursorX(null); onScrubRef.current?.(null); },
    onPanResponderTerminate: () => { setCursorX(null); onScrubRef.current?.(null); },
  }), []);
  if (!model) return null;
  const cur = cursorX != null ? nearestBy(model.pts, cursorX) : null;
  return (
    <View>
      <View style={styles.chHead}>
        <View><Text style={[styles.chLab, { color: C.elev }]}>Elev gain</Text><Text style={styles.chVal}>{model.gainFt}<Text style={styles.chUnit}> ft</Text></Text></View>
        <View style={{ alignItems: 'flex-end' }}><Text style={[styles.chLab, { color: C.elev }]}>Max</Text><Text style={styles.chVal}>{model.maxFt}<Text style={styles.chUnit}> ft</Text></Text></View>
      </View>
      <View style={{ width: CHART_W, height: H + AX, position: 'relative' }}>
        <Svg width={CHART_W} height={H + AX}>
          <Defs><LinearGradient id="ef" x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor={C.elev} stopOpacity="0.3" /><Stop offset="1" stopColor={C.elev} stopOpacity="0" /></LinearGradient></Defs>
          <SvgLine x1={0} y1={model.gridY} x2={CHART_W} y2={model.gridY} stroke={C.line} strokeWidth={1} />
          <SvgText x={2} y={model.gridY - 3} fill={C.faint} fontSize={9}>{model.maxFt} ft</SvgText>
          <Path d={model.area} fill="url(#ef)" />
          <Path d={model.line} stroke={C.elev} strokeWidth={2} fill="none" strokeLinejoin="round" />
          {model.mileTicks.map((t, i) => <SvgLine key={`em${i}`} x1={t.x} y1={H} x2={t.x} y2={H + 4} stroke={C.faint} strokeWidth={1} />)}
          {model.mileTicks.map((t, i) => <SvgText key={`eml${i}`} x={t.x} y={H + 14} fill={C.faint} fontSize={9} textAnchor="middle">{t.label}</SvgText>)}
          {cur ? <SvgLine x1={cur.px} y1={0} x2={cur.px} y2={H} stroke="#FFFFFF" strokeOpacity={0.5} strokeWidth={1} /> : null}
          {cur ? <Circle cx={cur.px} cy={cur.py} r={4.5} fill="#FFFFFF" stroke={C.paceFast} strokeWidth={2} /> : null}
        </Svg>
        {cur ? (
          <View style={[styles.elevCallout, { left: clamp(cur.px - 44, 0, CHART_W - 88) }]} pointerEvents="none">
            <Text style={styles.elevCalVal}>{cur.ft}<Text style={styles.elevCalU}> ft</Text></Text>
            <Text style={styles.elevCalSub}>{cur.mi.toFixed(2)} {DIST_UNITS}</Text>
          </View>
        ) : null}
        <View style={{ position: 'absolute', left: 0, top: 0, width: CHART_W, height: H }} {...pan.panHandlers} />
      </View>
    </View>
  );
}

// ── Best efforts: the run's fastest standard distances, as a long list beneath
// the curve (each PR is also a ○ waypoint on the curve above). ───────────────
const BE_LABEL: Record<string, string> = {
  '1 mile': '1 mile', '5K': '5K', '10K': '10K', '10 mile': '10 mile',
  '30K': '30K', 'Half-Marathon': 'Half marathon', 'Marathon': 'Marathon',
};
function BestEffortRows({ efforts, framed }: { efforts: { name: string; distance_m: number; elapsed_s: number }[]; framed?: boolean }) {
  const want = ['1 mile', '5K', '10K', '10 mile', '30K', 'Half-Marathon', 'Marathon'];
  const picked = want
    .map((n) => efforts.find((e) => e.name === n))
    .filter((e): e is { name: string; distance_m: number; elapsed_s: number } => !!e);
  if (!picked.length) return null;
  // The inline card supplies its own section heading; the full-sheet Panel does
  // not need a duplicate. Both surfaces retain explicit ledger columns so two
  // similar pace/time values never have to explain themselves by position alone.
  return (
    <View style={styles.beList}>
      {!framed ? <Text style={styles.beHead}>Best efforts</Text> : null}
      <View style={styles.beTableHead}>
        <Text style={[styles.tableHeadTxt, { flex: 1 }]}>DISTANCE</Text>
        <Text style={[styles.tableHeadTxt, { width: 78, textAlign: 'right' }]}>TIME</Text>
        <Text style={[styles.tableHeadTxt, { width: 84, textAlign: 'right' }]}>PACE</Text>
      </View>
      {picked.map((e) => (
        <View key={e.name} style={styles.beLRow}>
          <Text style={styles.beLName}>{BE_LABEL[e.name] ?? e.name}</Text>
          <Text style={styles.beLTime}>{formatDuration(e.elapsed_s)}</Text>
          <Text style={styles.beLPace}>{formatDuration(e.elapsed_s / metersToUnits(e.distance_m, DIST_UNITS))}<Text style={styles.beLUnit}> /{DIST_UNITS}</Text></Text>
        </View>
      ))}
    </View>
  );
}

/**
 * The map's own CARTOGRAPHIC ramp — deliberately not theme tokens.
 *
 * A named local palette so a colour audit reads these as an intentional
 * exception rather than drift. These are terrain, not app surface: a cool
 * blue-black base that reads as "map" beneath the trace, and a near-black
 * casing that separates the trace from it. They stay fixed in BOTH themes
 * because the map is always dark — a light-mode map would need a whole second
 * cartography, not a token swap.
 *
 * Everything on the map that IS app surface (the bottom scrim, mile-marker
 * fills, start/finish rings) uses real tokens; those had drifted onto the
 * retired Glass theme's `#0E0D17` and are now `C.bg`.
 */
const MAP_GLOW_INNER = '#182A36';
const MAP_GLOW_MID = '#0E141B';
const MAP_GLOW_OUTER = '#0A0D11';
const MAP_TRACE_CASING = '#05080B';

// ── Reusable dark route map (clean cartographic card; no fake streets) ───────
// A premium dark base + soft radial glow behind the trace + a casing-under-route
// for contrast. The trace can be pace-colored (heat ramp from stream pace) with
// numbered mile markers + start/end pins — the Strava/Nike/Fitbit dark genre.
function RouteMap({ route, streams, w, h, pad = 30, insetTop, insetBottom, paceColored, showMiles, distanceMeters, scrim, markerFrac, style }: {
  route: [number, number][]; streams?: RunStreams | null; w: number; h: number;
  pad?: number; insetTop?: number; insetBottom?: number; paceColored?: boolean; showMiles?: boolean; distanceMeters?: number;
  scrim?: boolean; markerFrac?: number | null; style?: object;
}) {
  const g = useMemo(() => routeGeom(route, w, h, pad, insetTop ?? pad, insetBottom ?? pad), [route, w, h, pad, insetTop, insetBottom]);
  const norms = useMemo(() => (paceColored && streams ? routePaceNorms(route, streams) : null), [route, streams, paceColored]);
  if (!g) return null;
  const pts = g.pts;
  const totalMi = distanceMeters ? metersToUnits(distanceMeters, DIST_UNITS) : 0;
  // Place mile markers by CUMULATIVE PATH LENGTH (the polyline is unevenly
  // sampled, so an index fraction would bunch markers where points are dense).
  let pathLen = 0; const cum = [0];
  for (let i = 1; i < pts.length; i++) { pathLen += Math.hypot(pts[i]!.px - pts[i - 1]!.px, pts[i]!.py - pts[i - 1]!.py); cum.push(pathLen); }
  const mileAt = (m: number) => {
    const target = (m / (totalMi || 1)) * pathLen;
    let i = 1; while (i < pts.length && cum[i]! < target) i++;
    return pts[Math.min(i, pts.length - 1)]!;
  };
  // "You are here" dot driven by a scrub elsewhere (the elevation chart): the
  // route point at this fraction of the cumulative path.
  const ptAtFrac = (frac: number) => {
    const target = clamp(frac, 0, 1) * pathLen;
    let i = 1; while (i < pts.length && cum[i]! < target) i++;
    return pts[Math.min(i, pts.length - 1)]!;
  };
  const marker = markerFrac != null && pts.length > 1 ? ptAtFrac(markerFrac) : null;
  const lastMile = Math.floor(totalMi - 0.15); // drop a marker that would sit on the finish pin
  // Keep markers from piling up where the route doubles back: drop any that land
  // within ~17px of an already-kept marker (or the start pin).
  const miles: { pt: { px: number; py: number }; label: number }[] = [];
  if (showMiles && totalMi >= 2) {
    const kept: { px: number; py: number }[] = [g.start];
    for (let m = 1; m <= lastMile; m++) {
      const pt = mileAt(m);
      if (kept.every((k) => Math.hypot(pt.px - k.px, pt.py - k.py) > 17)) { miles.push({ pt, label: m }); kept.push(pt); }
    }
  }
  return (
    <Svg width={w} height={h} style={style}>
      <Defs>
        <RadialGradient id="rmGlow" cx="50%" cy="46%" r="62%">
          <Stop offset="0" stopColor={MAP_GLOW_INNER} stopOpacity="1" />
          <Stop offset="0.7" stopColor={MAP_GLOW_MID} stopOpacity="1" />
          <Stop offset="1" stopColor={MAP_GLOW_OUTER} stopOpacity="1" />
        </RadialGradient>
        <LinearGradient id="hscrim" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0.12" stopColor={C.bg} stopOpacity="0" />
          <Stop offset="0.45" stopColor={C.bg} stopOpacity="0.6" />
          <Stop offset="1" stopColor={C.bg} stopOpacity="0.98" />
        </LinearGradient>
      </Defs>
      <Rect width={w} height={h} fill="url(#rmGlow)" />
      {/* casing: a dark, wide stroke under the trace lifts it off the base */}
      <Path d={lineD(pts)} stroke={MAP_TRACE_CASING} strokeOpacity={0.7} strokeWidth={paceColored ? 8.5 : 9} fill="none" strokeLinejoin="round" strokeLinecap="round" />
      {norms
        ? pts.slice(0, -1).map((p, i) => (
            <SvgLine key={`rs${i}`} x1={p.px} y1={p.py} x2={pts[i + 1]!.px} y2={pts[i + 1]!.py}
              stroke={paceHeat((norms[i]! + norms[i + 1]!) / 2)} strokeWidth={4.5} strokeLinecap="round" />
          ))
        : (
            <>
              {/* soft outer glow + bright core for the solid hero trace — ink, not
                  yellow (a GPS trace is information, not a call to action). */}
              <Path d={lineD(pts)} stroke={C.ink} strokeOpacity={0.22} strokeWidth={9} fill="none" strokeLinejoin="round" strokeLinecap="round" />
              <Path d={lineD(pts)} stroke={C.ink} strokeWidth={3.6} fill="none" strokeLinejoin="round" strokeLinecap="round" />
            </>
          )}
      {/* numbered mile markers */}
      {miles.map((m, i) => <Circle key={`mmc${i}`} cx={m.pt.px} cy={m.pt.py} r={9} fill={C.bg} stroke="#FFFFFF" strokeOpacity={0.85} strokeWidth={1.4} />)}
      {miles.map((m, i) => <SvgText key={`mmt${i}`} x={m.pt.px} y={m.pt.py + 3.6} fill="#FFFFFF" fontSize={10.5} fontWeight="700" textAnchor="middle">{m.label}</SvgText>)}
      {/* start + neutral finish, drawn last so they sit above mile markers */}
      <Circle cx={g.start.px} cy={g.start.py} r={6.5} fill={C.positiveText} stroke={C.bg} strokeWidth={2.2} />
      <Circle cx={g.end.px} cy={g.end.py} r={6.5} fill={C.ink} stroke={C.bg} strokeWidth={2.2} />
      {/* scrub "you are here" dot — on top of everything */}
      {marker ? <Circle cx={marker.px} cy={marker.py} r={9} fill="#FFFFFF" fillOpacity={0.22} /> : null}
      {marker ? <Circle cx={marker.px} cy={marker.py} r={5} fill="#FFFFFF" stroke={C.paceFast} strokeWidth={2.5} /> : null}
      {scrim ? <Rect width={w} height={h} fill="url(#hscrim)" /> : null}
    </Svg>
  );
}

// ── Real Apple Map (expo-maps / MapKit) — dark, pace-colored route ───────────
/** Camera centre + zoom that fits the route's padded bbox (expo-maps has no
 * fitToBounds, only centre+zoom; derive zoom from the larger span). */
function routeCamera(route: [number, number][]) {
  let minLa = Infinity, maxLa = -Infinity, minLn = Infinity, maxLn = -Infinity;
  for (const [la, ln] of route) { minLa = Math.min(minLa, la); maxLa = Math.max(maxLa, la); minLn = Math.min(minLn, ln); maxLn = Math.max(maxLn, ln); }
  const center = { latitude: (minLa + maxLa) / 2, longitude: (minLn + maxLn) / 2 };
  const cos = Math.cos((center.latitude * Math.PI) / 180) || 1;
  const span = Math.max((maxLa - minLa) * 1.3, (maxLn - minLn) * 1.3 * cos, 1e-4);
  return { coordinates: center, zoom: Math.max(2, Math.min(18, Math.log2(360 / span))) };
}
/** Lat/lng on the route at `frac` (0–1) of cumulative distance — drives the
 * scrub "you are here" marker, interpolated for smoothness. */
function routeCoordAtFrac(route: [number, number][], frac: number) {
  if (route.length < 2) return route[0] ? { latitude: route[0][0], longitude: route[0][1] } : null;
  const cos = Math.cos((route[0]![0] * Math.PI) / 180) || 1;
  let total = 0; const cum = [0];
  for (let i = 1; i < route.length; i++) { total += Math.hypot(route[i]![0] - route[i - 1]![0], (route[i]![1] - route[i - 1]![1]) * cos); cum.push(total); }
  const target = clamp(frac, 0, 1) * total;
  let i = 1; while (i < route.length && cum[i]! < target) i++;
  const a = route[i - 1]!, b = route[Math.min(i, route.length - 1)]!;
  const seg = (cum[i] ?? total) - cum[i - 1]! || 1;
  const t = clamp((target - cum[i - 1]!) / seg, 0, 1);
  return { latitude: a[0] + (b[0] - a[0]) * t, longitude: a[1] + (b[1] - a[1]) * t };
}
/** Clean a full-resolution GPS route for display: reject only EXTREME single-
 * point spikes — a point you'd massively "detour" through (path via it ≫ 2.5× the
 * direct line), i.e. a GPS dropout jump. No moving-average: on real per-second
 * data that just rounds a track's straights + turns into an egg. Keep the true
 * shape; the only thing we remove is the occasional teleport. */
function smoothRoute(route: [number, number][]): [number, number][] {
  if (route.length < 5) return route;
  const meanLat = route.reduce((s, p) => s + p[0], 0) / route.length;
  const cos = Math.cos((meanLat * Math.PI) / 180) || 1;
  const seg = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], (a[1] - b[1]) * cos);
  const fixed = route.map((p) => [p[0], p[1]] as [number, number]);
  for (let i = 1; i < fixed.length - 1; i++) {
    const dp = seg(fixed[i]!, fixed[i - 1]!), dn = seg(fixed[i]!, fixed[i + 1]!), ds = seg(fixed[i - 1]!, fixed[i + 1]!);
    if (dp + dn > 2.5 * Math.max(ds, 1e-9)) fixed[i] = [(fixed[i - 1]![0] + fixed[i + 1]![0]) / 2, (fixed[i - 1]![1] + fixed[i + 1]![1]) / 2];
  }
  return fixed;
}
function NativeRouteMap({ route, streams, markerFrac }: {
  route: [number, number][]; streams: RunStreams | null; markerFrac: number | null;
}) {
  const Maps = appleMaps!.AppleMaps;
  const sroute = useMemo(() => smoothRoute(route), [route]);
  const camera = useMemo(() => routeCamera(sroute), [sroute]);
  const coords = useMemo(() => sroute.map(([latitude, longitude]) => ({ latitude, longitude })), [sroute]);
  // Pace-colored route as ~44 short polyline overlays (MapKit has no gradient
  // stroke). Memoized so a scrub doesn't re-send the whole route to native —
  // only the markers update, which is what keeps the path from "getting lost".
  const polylines = useMemo(() => {
    const norms = streams ? routePaceNorms(sroute, streams) : null;
    if (!norms) return [{ id: 'route', coordinates: coords, color: C.ink, width: 3.4 }];
    const seg = Math.max(1, Math.floor(sroute.length / 44));
    const out: { id: string; coordinates: { latitude: number; longitude: number }[]; color: string; width: number }[] = [];
    for (let i = 0; i < sroute.length - 1; i += seg) {
      const j = Math.min(i + seg, sroute.length - 1);
      out.push({ id: `s${i}`, coordinates: coords.slice(i, j + 1), color: paceHeat((norms[i]! + norms[j]!) / 2), width: 3.4 });
    }
    return out;
  }, [sroute, streams, coords]);
  const scrub = markerFrac != null ? routeCoordAtFrac(sroute, markerFrac) : null;
  const markers = [
    { id: 'start', coordinates: coords[0]!, systemImage: 'circle.fill', tintColor: C.positiveText, title: 'Start' },
    { id: 'end', coordinates: coords[coords.length - 1]!, systemImage: 'flag.checkered', tintColor: C.ink, title: 'Finish' },
    ...(scrub ? [{ id: 'scrub', coordinates: scrub, systemImage: 'location.fill', tintColor: '#FFFFFF' }] : []),
  ];
  return (
    <Maps.View
      style={StyleSheet.absoluteFill}
      cameraPosition={camera}
      colorScheme={C.bg === THEMES.light.bg ? Maps.MapColorScheme.LIGHT : Maps.MapColorScheme.DARK}
      properties={{ mapType: Maps.MapType.STANDARD, emphasis: MUTED_EMPHASIS, isMyLocationEnabled: false, isTrafficEnabled: false, selectionEnabled: false, elevation: Maps.MapStyleElevation.FLAT, pointsOfInterest: { including: [] } }}
      uiSettings={{ togglePitchEnabled: false, compassEnabled: false, scaleBarEnabled: false, myLocationButtonEnabled: false }}
      polylines={polylines}
      markers={markers}
    />
  );
}

// ── Detail map on the custom Mapbox basemap ─────────────────────────────────
// Static (label-free, cool) basemap at a fixed center/zoom, with the pace-colored
// route, markers, and scrub dot drawn as an SVG overlay projected (Web Mercator)
// to match — so it stays interactive-feeling (scrub) without a native map module.
function MapboxRouteDetail({ route, streams, markerFrac, width, height }: {
  route: [number, number][]; streams: RunStreams | null; markerFrac: number | null; width: number; height: number;
}) {
  const isLight = C.bg === THEMES.light.bg;
  const sroute = useMemo(() => smoothRoute(route), [route]);
  const view = useMemo(() => fitMapView(sroute, width, height, 40), [sroute, width, height]);
  const project = useMemo(() => mercatorProjector(view, width, height), [view, width, height]);
  const url = mapboxToken ? mapboxBasemapUrl({ view, style: isLight ? MAPBOX_STYLE.light : MAPBOX_STYLE.dark, token: mapboxToken, width, height }) : null;
  const pts = useMemo(() => sroute.map(([lat, lng]) => project(lat, lng)), [sroute, project]);
  const norms = useMemo(() => (streams ? routePaceNorms(sroute, streams) : null), [sroute, streams]);
  const scrub = markerFrac != null ? routeCoordAtFrac(sroute, markerFrac) : null;
  const scrubPt = scrub ? project(scrub.latitude, scrub.longitude) : null;
  if (!url || pts.length < 2) return null;
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const start = pts[0]!, end = pts[pts.length - 1]!;
  return (
    <View style={{ width, height }}>
      <Image source={{ uri: url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Path d={d} stroke="#000000" strokeOpacity={isLight ? 0.16 : 0.5} strokeWidth={7.5} fill="none" strokeLinejoin="round" strokeLinecap="round" />
        {norms
          ? pts.slice(0, -1).map((p, i) => (
              <SvgLine key={`ms${i}`} x1={p[0]} y1={p[1]} x2={pts[i + 1]![0]} y2={pts[i + 1]![1]} stroke={paceHeat((norms[i]! + norms[i + 1]!) / 2)} strokeWidth={4.5} strokeLinecap="round" />
            ))
          : <Path d={d} stroke={C.ink} strokeWidth={4} fill="none" strokeLinejoin="round" strokeLinecap="round" />}
        <Circle cx={start[0]} cy={start[1]} r={6.5} fill={C.positiveText} stroke={C.bg} strokeWidth={2.2} />
        <Circle cx={end[0]} cy={end[1]} r={6.5} fill={C.ink} stroke={C.bg} strokeWidth={2.2} />
        {scrubPt ? <Circle cx={scrubPt[0]} cy={scrubPt[1]} r={9} fill="#FFFFFF" fillOpacity={0.22} /> : null}
        {scrubPt ? <Circle cx={scrubPt[0]} cy={scrubPt[1]} r={5} fill="#FFFFFF" stroke={C.paceFast} strokeWidth={2.5} /> : null}
      </Svg>
    </View>
  );
}

// ── Interactive detail map (@rnmapbox/maps GL) — pan / zoom on the custom style ──
function MapboxRouteDetailGL({ route, streams, markerFrac, width, height }: {
  route: [number, number][]; streams: RunStreams | null; markerFrac: number | null; width: number; height: number;
}) {
  const M = rnMapbox!;
  const isLight = C.bg === THEMES.light.bg;
  const sroute = useMemo(() => smoothRoute(route), [route]);
  const styleURL = `mapbox://styles/${isLight ? MAPBOX_STYLE.light : MAPBOX_STYLE.dark}`;
  const bounds = useMemo(() => {
    let minLa = 90, maxLa = -90, minLn = 180, maxLn = -180;
    for (const [la, ln] of sroute) { minLa = Math.min(minLa, la); maxLa = Math.max(maxLa, la); minLn = Math.min(minLn, ln); maxLn = Math.max(maxLn, ln); }
    return { ne: [maxLn, maxLa] as [number, number], sw: [minLn, minLa] as [number, number] };
  }, [sroute]);
  const norms = useMemo(() => (streams ? routePaceNorms(sroute, streams) : null), [sroute, streams]);
  // Pace-colored route as one FeatureCollection of 2-point segments (data-driven color).
  const routeFC = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: sroute.slice(0, -1).map((p, i) => ({
      type: 'Feature' as const,
      properties: { color: norms ? paceHeat((norms[i]! + norms[i + 1]!) / 2) : C.ink },
      geometry: { type: 'LineString' as const, coordinates: [[p[1], p[0]], [sroute[i + 1]![1], sroute[i + 1]![0]]] },
    })),
  }), [sroute, norms]);
  const markerFC = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: [
      { type: 'Feature' as const, properties: { color: C.positiveText }, geometry: { type: 'Point' as const, coordinates: [sroute[0]![1], sroute[0]![0]] } },
      { type: 'Feature' as const, properties: { color: C.ink }, geometry: { type: 'Point' as const, coordinates: [sroute[sroute.length - 1]![1], sroute[sroute.length - 1]![0]] } },
    ],
  }), [sroute]);
  const scrub = markerFrac != null ? routeCoordAtFrac(sroute, markerFrac) : null;
  const scrubFC = scrub ? { type: 'Feature' as const, properties: {}, geometry: { type: 'Point' as const, coordinates: [scrub.longitude, scrub.latitude] } } : null;
  return (
    <View style={{ width, height }}>
      <M.MapView style={StyleSheet.absoluteFill} styleURL={styleURL} scaleBarEnabled={false} compassEnabled={false} logoEnabled={false} attributionEnabled={false} pitchEnabled={false} rotateEnabled={false}>
        <M.Camera defaultSettings={{ bounds: { ...bounds, paddingLeft: 36, paddingRight: 36, paddingTop: 40, paddingBottom: 56 } }} animationMode="none" />
        <M.ShapeSource id="route" shape={routeFC}>
          <M.LineLayer id="routeCasing" style={{ lineColor: '#000000', lineOpacity: isLight ? 0.16 : 0.5, lineWidth: 8, lineJoin: 'round', lineCap: 'round' }} />
          <M.LineLayer id="routeLine" style={{ lineColor: ['get', 'color'], lineWidth: 4.5, lineJoin: 'round', lineCap: 'round' }} />
        </M.ShapeSource>
        <M.ShapeSource id="markers" shape={markerFC}>
          <M.CircleLayer id="markerDots" style={{ circleColor: ['get', 'color'], circleRadius: 6.5, circleStrokeColor: C.bg, circleStrokeWidth: 2.2 }} />
        </M.ShapeSource>
        {scrubFC ? (
          <M.ShapeSource id="scrub" shape={scrubFC}>
            <M.CircleLayer id="scrubHalo" style={{ circleColor: '#FFFFFF', circleOpacity: 0.22, circleRadius: 11 }} />
            <M.CircleLayer id="scrubDot" style={{ circleColor: '#FFFFFF', circleStrokeColor: C.paceFast, circleStrokeWidth: 2.5, circleRadius: 5 }} />
          </M.ShapeSource>
        ) : null}
      </M.MapView>
    </View>
  );
}

// ── Full-screen route detail (pace-colored map + legend + stats) ─────────────
function MapDetail({ route, streams, distanceMeters, elev }: {
  route: [number, number][]; streams: RunStreams | null; distanceMeters: number;
  elev: { gain: number; loss: number; longestMi: number; maxGrade: number; avgGrade: number } | null;
}) {
  // Anchor the legend with the actual end paces (the exact colors on the trace),
  // adidas-style — a legend that conveys scale, not just direction.
  const ext = streams ? paceExtents(streams) : null;
  // Scrub position (0–1 along the course) shared from the elevation chart to the
  // map's "you are here" dot.
  const [scrubFrac, setScrubFrac] = useState<number | null>(null);
  return (
    <>
      {/* Full-bleed map (Apple-Weather style) — breaks out of the sheet padding.
          Real Apple Map (MapKit) when available; the stylized SVG is the fallback. */}
      <View style={[styles.mapFull, { height: 320 }]}>
        {rnMapboxAvailable
          ? <MapboxRouteDetailGL route={route} streams={streams} markerFrac={scrubFrac} width={SCREEN_W} height={320} />
          : mapboxToken
            ? <MapboxRouteDetail route={route} streams={streams} markerFrac={scrubFrac} width={SCREEN_W} height={320} />
            : appleMapsAvailable
              ? <NativeRouteMap route={route} streams={streams} markerFrac={scrubFrac} />
              : <RouteMap route={route} streams={streams} w={SCREEN_W} h={320} pad={28} insetBottom={52} paceColored showMiles distanceMeters={distanceMeters} markerFrac={scrubFrac} />}
        <View style={styles.mapLegendFloat}>
          <Text style={styles.mapLegVal}>{ext ? formatDuration(paceSecPerUnitFromMi(ext.slow)) : ''}</Text>
          <Svg width={92} height={8}>
            <Defs><LinearGradient id="mapleg" x1="0" y1="0" x2="1" y2="0"><Stop offset="0" stopColor={paceHeat(0)} /><Stop offset="0.5" stopColor={paceHeat(0.5)} /><Stop offset="1" stopColor={paceHeat(1)} /></LinearGradient></Defs>
            <Rect width={92} height={8} rx={4} fill="url(#mapleg)" />
          </Svg>
          <Text style={styles.mapLegVal}>{ext ? formatDuration(paceSecPerUnitFromMi(ext.fast)) : ''}</Text>
          <Text style={styles.mapLegUnit}>/{DIST_UNITS}</Text>
        </View>
      </View>
      {streams?.alt ? (
        <>
          <Text style={styles.curveCap}>Elevation</Text>
          <ElevationProfile streams={streams} onScrub={setScrubFrac} />
          <View style={{ height: GAP }} />
        </>
      ) : <View style={{ height: GAP }} />}
      <Panel>
        <View style={styles.sgRow}>
          <Metric label="Distance" value={metersToUnits(distanceMeters, DIST_UNITS).toFixed(2)} unit={DIST_UNITS} />
          <Metric label="Elev gain" value={elev ? `+${elev.gain}` : '—'} unit="ft" />
          <Metric label="Max grade" value={elev ? elev.maxGrade.toFixed(1) : '—'} unit="%" />
        </View>
        {elev ? (
          <View style={[styles.sgRow, styles.sgRow2]}>
            <Metric sub label="Total down" value={`-${elev.loss}`} unit="ft" />
            <Metric sub label="Longest climb" value={`${(DIST_UNITS === 'mi' ? elev.longestMi : elev.longestMi * 1.609344).toFixed(2)} ${DIST_UNITS}`} />
            <Metric sub label="Avg grade" value={`${elev.avgGrade.toFixed(1)}%`} />
          </View>
        ) : null}
      </Panel>
    </>
  );
}

// ── Map-as-hero (route behind the headline) ─────────────────────────────────
// The custom map's canvas matches each theme's bg, so the hero dissolves into the
// page: the bottom fades to a fully-opaque `bg`, seamless into the content below.
// The identity then sits on that faded band in real theme ink.
//
// The ramp starts well ABOVE the text block (title/miles/chips/eyebrow — see
// `heroOverlay`) rather than just at the very bottom edge: a busier/greener
// map area behind the title itself used to have no scrim at all in either
// theme (UX#7). Blending toward the theme's OWN `bg` — not a fixed black —
// keeps this correct in both directions: dark theme's white hero text gets a
// near-black floor, light theme's dark hero text gets a near-white one.
function HeroBlend({ w, h, bg }: { w: number; h: number; bg: string }) {
  return (
    <Svg width={w} height={h} style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <LinearGradient id="heroBlend" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={bg} stopOpacity="0" />
          <Stop offset="0.32" stopColor={bg} stopOpacity="0.22" />
          <Stop offset="0.5" stopColor={bg} stopOpacity="0.55" />
          <Stop offset="0.68" stopColor={bg} stopOpacity="0.84" />
          <Stop offset="0.85" stopColor={bg} stopOpacity="0.97" />
          <Stop offset="1" stopColor={bg} stopOpacity="1" />
        </LinearGradient>
      </Defs>
      <Rect width={w} height={h} fill="url(#heroBlend)" />
    </Svg>
  );
}

function HeroMap({ route, kicker, eyebrow, name, distance, distanceMeters, tempC, sessionType, planVerdict, statusChip, qualityChip, structure, topInset = 0, markerFrac, onExpand, onEdit }: {
  route: [number, number][] | null;
  /** Record-type + plan-week context line ("LOGGED RUN  WK 1"), above the date. */
  kicker?: string | null;
  /** The quiet date/time line ("TUESDAY, MAY 12  6:20 AM"). */
  eyebrow: string; name: string; distance: string;
  distanceMeters: number; tempC: number | null;
  sessionType: 'intervals' | 'tempo' | 'progression' | null; planVerdict: { state: string; label: string } | null;
  /** A factual day state ('Missed', 'Planned') — always the neutral chip; see
   *  `verdictAccent` for why a day never wears the week's judgment colour. One
   *  casing in this slot: the hero's status chips are sentence case, alongside
   *  'Short of plan' / 'Partial · 4 of 5'. The eyebrow ABOVE them ('LOGGED RUN
   *  WK 1') is a different element and stays uppercase. */
  statusChip?: { label: string } | null;
  /** Precomputed quality-credit chip (violet, tap/long-press to undo a false positive). */
  qualityChip?: { label: string; summary?: string | null; onToggle: () => void } | null;
  /** Fallback slot for the detected-structure summary — only when no SESSION
   *  card mounts (the card owns the structure read whenever it exists). */
  structure?: string | null;
  topInset?: number; markerFrac?: number | null; onExpand?: () => void; onEdit?: () => void;
}) {
  const router = useRouter();
  const hasRoute = !!route && route.length >= 2;
  // The map bleeds up through the notch: its height absorbs the top inset so the
  // visible map below the notch stays ~326, and the nav buttons drop below it.
  // Routeless heroes (planned workouts, GPS-less runs) have no map to show —
  // collapse to just nav + identity block instead of a third of a screen of
  // dead background (beta-readiness audit U1).
  const W = SCREEN_W, H = (hasRoute ? 326 : 232) + topInset;
  const isLight = C.bg === THEMES.light.bg;
  // Preferred: a Mapbox static map — custom-styled (label-free, cool) and
  // theme-matched, so it dissolves into the page. Falls back to Apple Maps, then
  // the SVG route, until a Mapbox token is configured.
  // Ink, not yellow — the GPS trace is information, not a call to action.
  const mbUrl = mapboxToken && hasRoute
    ? mapboxStaticUrl({ route: route!, style: isLight ? MAPBOX_STYLE.light : MAPBOX_STYLE.dark, token: mapboxToken, width: W, height: H, strokeColor: C.ink.replace('#', '') })
    : null;

  // Nav (back + contextual actions) and the identity block (title / miles / chips /
  // context) are shared between two layouts: over a map (absolute, identity
  // bottom-anchored on the faded band) and — when there's no route — a compact
  // top-aligned header, so a GPS-less run / planned workout doesn't render a
  // dead gap between the close button and the title.
  const navButtons = (
    <>
      <RoundIconButton
        icon="chevron.left"
        variant="overlay"
        onPress={() => closeScreen(router)}
        accessibilityLabel="Back"
      />
      <View style={{ flexDirection: 'row', gap: space.m }}>
        {onExpand ? <RoundIconButton variant="overlay" icon="arrow.up.left.and.arrow.down.right" onPress={onExpand} accessibilityLabel="Expand" /> : null}
        {onEdit ? <RoundIconButton variant="overlay" icon="pencil" size={16} onPress={onEdit} accessibilityLabel="Edit workout" /> : null}
      </View>
    </>
  );
  const showQualityChip = planVerdict ? null : qualityChip;
  const showSessionType = qualityChip || planVerdict ? null : sessionType;
  const hasStatus = !!(showSessionType || planVerdict || statusChip || showQualityChip);
  const runMetadata = [
    tempC != null ? formatTemperature(tempC, TEMP_UNITS) : null,
  ].filter((value): value is string => value != null);
  const identityContent = (
    <>
      <Text style={styles.heroTitle}>{name}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: space.xxs }}>
        <Text style={styles.heroNum}>{distance}</Text><Text style={styles.heroUnit}>{DIST_UNITS.toUpperCase()}</Text>
      </View>
      {hasStatus ? (
        <View style={[styles.chips, styles.chipsWrap, { marginTop: space.m }]}>
          {showSessionType ? <View style={styles.chipG}><Text style={styles.chipTxt}>{TYPE_LABEL[showSessionType]}</Text></View> : null}
          {planVerdict ? (
            <View style={styles.chipG} accessibilityLabel={planVerdict.label}>
              <SymbolView name={VERDICT_ICON[planVerdict.state] as never} size={12} tintColor={verdictAccent(planVerdict.state)} resizeMode="scaleAspectFit" />
              <Text style={[styles.chipTxt, { color: verdictAccent(planVerdict.state) }]}>{planVerdict.label}</Text>
            </View>
          ) : null}
          {statusChip ? <View style={styles.chipG}><Text style={[styles.chipTxt, { color: C.mute }]}>{statusChip.label}</Text></View> : null}
          {showQualityChip ? (
            <Pressable
              onPress={showQualityChip.onToggle}
              onLongPress={showQualityChip.onToggle}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={`${showQualityChip.label}, tap to undo`}
              style={({ pressed }) => [styles.chipG, pressed && styles.pressDim]}
            >
              <SymbolView name="bolt.heart.fill" size={12} tintColor={C.qual} resizeMode="scaleAspectFit" />
              <Text style={[styles.chipTxt, { color: C.qualText }]}>{showQualityChip.label}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {runMetadata.length > 0 ? <Text style={styles.heroMeta}>{runMetadata.join('  ·  ')}</Text> : null}
      {structure ? <StructureCells summary={structure} style={{ marginTop: space.sm }} /> : null}
      {kicker ? <Text style={[styles.heroKick, { marginTop: space.md }]}>{kicker}</Text> : null}
      <Text style={[styles.heroEy, { marginTop: kicker ? 3 : space.md }]}>{eyebrow}</Text>
    </>
  );

  // Routeless: compact top-aligned header (nav, then identity directly below) —
  // no map box, no bottom-anchored overlay, so the close button and title sit
  // together near the top instead of straddling a tall empty hero.
  if (!hasRoute) {
    return (
      <View testID="session-hero-compact" style={styles.heroCompact}>
        {/* The inset belongs to OverlayNav, not to this wrapper. Applying it
            here AND letting OverlayNav add its own space.sm double-counted the
            offset — caught by the header-consistency suite. */}
        <OverlayNav topInset={topInset}>{navButtons}</OverlayNav>
        <View style={styles.heroIdentity}>{identityContent}</View>
      </View>
    );
  }

  return (
    <View style={[styles.heroMap, { height: H }]}>
      {hasRoute ? (
        <Pressable style={StyleSheet.absoluteFill} onPress={onExpand} accessibilityRole="button" accessibilityLabel="Expand route map">
          {/* A custom, theme-matched map (label-free, cool) that fades into the
              page bg. Identity sits on the faded band in theme ink — no scrim. */}
          {mbUrl
            ? <Image source={{ uri: mbUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
            : appleMapsAvailable
              ? <NativeRouteMap route={route!} streams={null} markerFrac={markerFrac ?? null} />
              : <RouteMap route={route!} w={W} h={H} pad={34} insetTop={64} insetBottom={96} distanceMeters={distanceMeters} scrim markerFrac={markerFrac ?? null} style={StyleSheet.absoluteFill} />}
          {mbUrl || appleMapsAvailable ? <HeroBlend w={W} h={H} bg={C.bg} /> : null}
        </Pressable>
      ) : (
        <Svg width={W} height={H} style={StyleSheet.absoluteFill}><Rect width={W} height={H} fill={C.bg} /></Svg>
      )}
      <OverlayNav floating topInset={topInset}>{navButtons}</OverlayNav>
      <View style={styles.heroOverlay} pointerEvents="box-none">{identityContent}</View>
    </View>
  );
}

/**
 * The detected-structure summary as a row of small cells — one per rep group
 * (e.g. [2×1mi @ 5:48] [1×589m @ 6:09]) so a long quality read wraps cell by
 * cell instead of cramming one line. Splits the stored summary on its " + "
 * group joiner (and the legacy " · " separator so pre-sweep rows read clean).
 */
function StructureCells({ summary, style }: { summary: string; style?: StyleProp<ViewStyle> }) {
  const parts = summary.split(/\s+(?:·|\+)\s+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  return (
    <View style={[styles.structRow, style]}>
      {parts.map((p, i) => (
        <View key={i} style={styles.structCell}>
          <Text style={styles.structTxt}>{p}</Text>
        </View>
      ))}
    </View>
  );
}

export type SplitRow = {
  label: string;
  paceSecPerKm: number;
  avgHr: number | null;
  distanceMeters: number;
  avgGradePct: number | null;
};

type SplitSummary = {
  avg: number;
  fast: number;
  slow: number;
  fastSplit: SplitRow;
  slowSplit: SplitRow;
};

export function summarizeSplits(splits: SplitRow[]): SplitSummary | null {
  if (splits.length === 0) return null;
  const fastSplit = splits.reduce((best, split) => (split.paceSecPerKm < best.paceSecPerKm ? split : best), splits[0]!);
  const slowSplit = splits.reduce((best, split) => (split.paceSecPerKm > best.paceSecPerKm ? split : best), splits[0]!);
  const totalDistance = splits.reduce((sum, split) => sum + split.distanceMeters, 0);
  const avg = totalDistance > 0
    ? splits.reduce((sum, split) => sum + split.paceSecPerKm * split.distanceMeters, 0) / totalDistance
    : 0;
  return { avg, fast: fastSplit.paceSecPerKm, slow: slowSplit.paceSecPerKm, fastSplit, slowSplit };
}

/** True only when a ledger can honestly use a MI ordinal instead of # + DIST. */
export function splitColumnMode(splits: SplitRow[]): 'mile' | 'distance' {
  if (splits.length === 0) return 'mile';
  const tolerance = METERS_PER_MILE * 0.12;
  return splits.every((split) => Math.abs(split.distanceMeters - METERS_PER_MILE) <= tolerance) ? 'mile' : 'distance';
}

/**
 * Render the backend `activities.laps` ledger without client-side invention or
 * suppression. Strava does not identify auto vs manual laps, so backend order,
 * distance, time, and row count are the only honest source of truth. When the
 * backend has no laps, the Splits surface stays absent instead of deriving a
 * second, potentially contradictory mile ledger from streams.
 */
export function buildSplits(activity: ActivityRow): SplitRow[] {
  const laps = (activity.laps as StravaLap[] | null) ?? null;
  if (!laps || laps.length === 0) return [];
  return laps.flatMap((lap, index) => {
    const distanceMeters = lap.distance ?? 0;
    const movingTimeS = lap.moving_time ?? 0;
    if (distanceMeters <= 0 || movingTimeS <= 0) return [];
    return [{
      label: String(index + 1),
      paceSecPerKm: (movingTimeS / distanceMeters) * 1000,
      avgHr: lap.average_heartrate != null ? Math.round(lap.average_heartrate) : null,
      distanceMeters,
      avgGradePct: lap.average_grade ?? null,
    }];
  });
}
/** A split's distance, mile or sub-mile aware ("1.00 mi" / "474 m"). */
function splitDistLabel(m: number): string {
  const threshold = DIST_UNITS === 'mi' ? 1500 : 1000;
  return m >= threshold ? `${metersToUnits(m, DIST_UNITS).toFixed(2)} ${DIST_UNITS}` : `${Math.round(m)} m`;
}

/** One compact, sequence-preserving read for the activity page. The full split
 * ledger remains in the tap-through sheet instead of occupying the page's
 * primary altitude. */
function SplitsOverview({ splits }: { splits: SplitRow[] }) {
  const paceFactor = DIST_UNITS === 'mi' ? 1.609344 : 1;
  const summary = summarizeSplits(splits);
  if (!summary) return null;
  const { avg, fast, slow } = summary;
  if (splits.length === 1) {
    const split = splits[0]!;
    const noun = 'lap';
    return (
      <View
        accessible
        accessibilityRole="summary"
        accessibilityLabel={`One ${noun}. ${splitDistLabel(split.distanceMeters)} at ${formatDuration(avg * paceFactor)} per ${DIST_UNITS === 'mi' ? 'mile' : 'kilometer'}${split.avgHr != null ? `. Average heart rate ${split.avgHr}` : ''}.`}
        style={styles.singleSplitOverview}
      >
        <View importantForAccessibility="no-hide-descendants">
          <Text style={styles.singleSplitLabel}>1 {noun}</Text>
          <Text style={styles.singleSplitDistance}>{splitDistLabel(split.distanceMeters)}</Text>
        </View>
        <Text style={styles.singleSplitPace}>{formatDuration(avg * paceFactor)} <Text style={styles.singleSplitUnit}>/{DIST_UNITS}</Text></Text>
      </View>
    );
  }
  const tickEvery = splits.length <= 8 ? 2 : splits.length <= 16 ? 4 : Math.ceil(splits.length / 4);
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${splits.length} splits. Average ${formatDuration(avg * paceFactor)} per ${DIST_UNITS === 'mi' ? 'mile' : 'kilometer'}. Fastest ${formatDuration(fast * paceFactor)}. Slowest ${formatDuration(slow * paceFactor)}.`}
    >
      <View style={styles.splitOverviewFrame} importantForAccessibility="no-hide-descendants">
        <View style={styles.splitOverviewGraph}>
          <View style={styles.splitOverviewBaseline} />
          {splits.map((split) => {
            const norm = slow > fast ? clamp((slow - split.paceSecPerKm) / (slow - fast), 0, 1) : 0.5;
            return (
              <View key={split.label} style={styles.splitOverviewSlot}>
                <View style={[styles.splitOverviewBar, { height: 22 + norm * 72, backgroundColor: paceHeat(norm) }]} />
              </View>
            );
          })}
        </View>
        <View style={styles.splitOverviewScale}>
          <View style={styles.splitOverviewScaleEnd}>
            <Text style={styles.splitOverviewScaleLabel}>FAST</Text>
            <Text style={styles.splitOverviewScaleValue}>{formatDuration(fast * paceFactor)}</Text>
          </View>
          <View style={styles.splitOverviewScaleEnd}>
            <Text style={styles.splitOverviewScaleLabel}>SLOW</Text>
            <Text style={styles.splitOverviewScaleValue}>{formatDuration(slow * paceFactor)}</Text>
          </View>
        </View>
      </View>
      <View style={styles.splitOverviewTicks} importantForAccessibility="no-hide-descendants">
        {splits.map((split, index) => {
          const show = index === 0 || index === splits.length - 1 || (index + 1) % tickEvery === 0;
          return <View key={split.label} style={styles.splitOverviewTickSlot}><Text style={styles.splitOverviewTick}>{show ? split.label : ''}</Text></View>;
        })}
      </View>
      <View style={styles.splitOverviewMeta} importantForAccessibility="no-hide-descendants">
        <Text style={styles.splitOverviewCount}>{splits.length} splits</Text>
        <Text style={styles.splitOverviewRange}>{formatDuration(avg * paceFactor)} avg <Text style={styles.splitOverviewUnit}>/{DIST_UNITS}</Text></Text>
      </View>
    </View>
  );
}

function SplitRows({ splits }: { splits: SplitRow[] }) {
  const paceFactor = DIST_UNITS === 'mi' ? 1.609344 : 1;
  // Every statistic is computed over the same backend lap rows shown below.
  const summary = summarizeSplits(splits);
  if (!summary) return null;
  const { avg, fast, slow, fastSplit, slowSplit } = summary;
  // A non-mile watch ledger always identifies rows as laps and carries DIST —
  // even when there is only one row. "MI 1" must never describe a 6-mile lap.
  const showDistance = splitColumnMode(splits) === 'distance';
  const hasGrade = splits.some((x) => x.avgGradePct != null);
  const hasElev = !showDistance && hasGrade; // per-row ELEV column (uniform mile splits only)
  if (splits.length === 1) {
    const split = splits[0]!;
    return (
      <Panel>
        <View style={styles.sgRow}>
          <Metric label="Pace" value={formatDuration(avg * paceFactor)} unit={`/${DIST_UNITS}`} />
          <Metric label="Distance" value={splitDistLabel(split.distanceMeters)} />
          <Metric label="Avg HR" value={split.avgHr != null ? String(split.avgHr) : '—'} unit={split.avgHr != null ? 'bpm' : undefined} />
        </View>
      </Panel>
    );
  }
  const rows = splits.map((sp) => {
    // norm 0 (slowest) … 1 (fastest), located on one honest shared rail.
    const norm = slow > fast ? clamp((slow - sp.paceSecPerKm) / (slow - fast), 0, 1) : 1;
    const color = paceHeat(norm);
    const paceSecPerUnit = sp.paceSecPerKm * paceFactor;
    const elevFt = sp.avgGradePct != null ? Math.round((sp.avgGradePct / 100) * sp.distanceMeters * 3.28084) : null;
    return (
      <View key={sp.label} style={styles.split}>
        <Text style={styles.splitMi}>{sp.label}</Text>
        <View style={styles.splitPaceRail}>
          <View style={styles.splitPaceRailLine} />
          <View style={styles.splitPaceRailMid} />
          <View
            testID="split-pace-tick"
            style={[
              styles.splitPaceTick,
              {
                left: `${clamp(norm, 0.025, 0.975) * 100}%` as `${number}%`,
                backgroundColor: color,
              },
            ]}
          />
        </View>
        <Text style={styles.splitPace}>{formatDuration(paceSecPerUnit)}</Text>
        {showDistance ? <Text style={styles.splitDist}>{splitDistLabel(sp.distanceMeters)}</Text> : hasElev ? <Text style={styles.splitElev}>{elevFt == null ? '—' : elevFt > 0 ? `+${elevFt}` : String(elevFt)}</Text> : null}
        <Text style={styles.splitHr}>{sp.avgHr ?? '—'}</Text>
      </View>
    );
  });
  // Full-screen: a summary scorecard + a grouped table (header + divided rows),
  // each in its own Panel, matching the other sections' full views.
  const netFt = splits.reduce((a, s) => a + (s.avgGradePct != null ? (s.avgGradePct / 100) * s.distanceMeters * 3.28084 : 0), 0);
  return (
    <>
      <Panel>
        <View style={styles.sgRow}>
          <Metric label="Avg pace" value={formatDuration(avg * paceFactor)} unit={`/${DIST_UNITS}`} />
          <Metric label="Fastest" value={formatDuration(fastSplit.paceSecPerKm * paceFactor)} unit={`/${DIST_UNITS}`} />
          <Metric label="Slowest" value={formatDuration(slowSplit.paceSecPerKm * paceFactor)} unit={`/${DIST_UNITS}`} />
        </View>
        <View style={[styles.sgRow, styles.sgRow2]}>
          <Metric sub label="Splits" value={String(splits.length)} />
          <Metric sub label="Range" value={slow > fast ? formatDuration((slow - fast) * paceFactor) : '—'} unit={`/${DIST_UNITS}`} />
          {hasGrade ? <Metric sub label="Net elev" value={`${netFt > 0 ? '+' : ''}${Math.round(netFt)}`} unit="ft" /> : null}
        </View>
      </Panel>
      <View style={{ height: GAP }} />
      <Panel>
        <View style={styles.tableHead}>
          <Text style={[styles.tableHeadTxt, { width: 22 }]}>{showDistance ? '#' : DIST_UNITS.toUpperCase()}</Text>
          <View style={styles.splitPaceHead}>
            <Text style={styles.splitPaceHeadTxt}>SLOW</Text>
            <Text style={styles.splitPaceHeadTxt}>FAST</Text>
          </View>
          <Text style={[styles.tableHeadTxt, { width: 52, textAlign: 'right' }]}>PACE</Text>
          {showDistance ? <Text style={[styles.tableHeadTxt, { width: 56, textAlign: 'right' }]}>DIST</Text> : hasElev ? <Text style={[styles.tableHeadTxt, { width: 44, textAlign: 'right' }]}>ELEV</Text> : null}
          <Text style={[styles.tableHeadTxt, { width: 36, textAlign: 'right' }]}>HR</Text>
        </View>
        {rows}
      </Panel>
    </>
  );
}
/** Shared single-hue pace ramp. It carries magnitude only, so it does not borrow
 * Due's semantic cyan (long run), yellow (current/action), or green (met). */
function paceHeat(frac: number): string {
  return lerpColor(C.paceSlow, C.paceFast, frac);
}
function lerpColor(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  const v = pa.map((p, i) => Math.round(p + (pb[i]! - p) * Math.max(0, Math.min(1, t))));
  return `rgb(${v[0]},${v[1]},${v[2]})`;
}
/** Hex → rgba at the given alpha (for subtle zone-color tints). */
function withAlpha(hex: string, a: number): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgba(${r},${g},${b},${a})`;
}

// ── Adaptive quality / interval analysis (detects reps from the REAL stream) ──
// Prototype of Spec 2's segmenter: smoothed pace, hard blocks ≤ the quality
// floor, gap-bridged + min-duration. Classifies one dominant block (sustained)
// vs. distributed blocks (intervals) and renders accordingly.
// The floor is the SAME `stream_summary.quality.floor` the server derived at
// ingest (Body's `qualityFloor`, threaded down as a prop) — never recomputed
// locally — so run detail and Dash can never disagree (audit: "Quality-
// detection floor drift").

/** Map the app stream shape to the lib's RunStream. Null HR → 0 (skipped by the
 * detector's HR guards). */
function toStream(s: RunStreams): RunStream {
  return { d: s.d, v: s.v, t: s.t, hr: (s.hr ?? []).map((h) => h ?? 0) };
}
/** Smoothed pace trace + mile axis for the interval chart. */
function paceTrace(stream: RunStream) {
  const n = Math.min(stream.d.length, stream.v.length);
  const pace: (number | null)[] = [];
  for (let i = 0; i < n; i++) { const vi = stream.v[i]!; pace.push(vi > 0.4 ? METERS_PER_MILE / vi : null); }
  return { pace: smooth(pace, 11), dMi: stream.d.map((x) => x / METERS_PER_MILE), totalMi: (stream.d[n - 1] ?? 0) / METERS_PER_MILE };
}
/** Average HR over an inclusive block index span. */
function blockHr(stream: RunStream, a: number, b: number): number | null {
  const hr = stream.hr; if (!hr) return null;
  let sum = 0, cnt = 0; for (let i = a; i <= b; i++) { const h = hr[i]; if (h != null && h > 0) { sum += h; cnt++; } }
  return cnt ? Math.round(sum / cnt) : null;
}
/** Rep tower (chart highlight) derived from a detected block + its snapped credit. */
interface Tower { startMi: number; endMi: number; paceSecMi: number; faded: boolean }

/** A "nice" mile gridline step that keeps ~4–6 verticals visible across `span`
 *  miles — the fixed 2/3/5mi steps read fine at full-domain but go blank once
 *  the window is pinched down to a handful of reps. */
function niceMileStep(span: number): number {
  const candidates = [0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 3, 5, 10, 20];
  for (const c of candidates) if (span / c <= 6) return c;
  return candidates[candidates.length - 1]!;
}

function IntervalChart({ trace, towers, avgPace, open, setOpen, tall }: { trace: ReturnType<typeof paceTrace>; towers: Tower[]; avgPace: number; open: number | null; setOpen: (n: number | null) => void; tall?: boolean }) {
  const H = tall ? 220 : 124, AX = 16, PR = 42; // PR = right gutter for pace labels
  const { pace, dMi, totalMi } = trace;
  const plotW = IW - PR;

  // ── Pinch-zoom X window (tracked request #120) ─────────────────────────────
  // Domain lives in the trace's own units (miles). Each zoom window re-slices
  // the full-resolution trace before render-only mean decimation. The interval
  // towers retain exact rep boundaries while bucket averaging removes GPS-scale
  // sawteeth from the overview; zooming still reveals the source at finer grain.
  const full = useMemo(() => fullDomain(totalMi), [totalMi]);
  const minSpanMi = useMemo(() => minZoomSpanMi(avgPace), [avgPace]);
  const [domain, setDomain] = useState<Domain>(full);
  const domainRef = useRef(domain);
  domainRef.current = domain;
  // A different run's chart (new totalMi) always opens at full domain.
  useEffect(() => { setDomain(full); domainRef.current = full; }, [full.lo, full.hi]);
  const gestureBase = useRef<Domain>(full);
  const towersRef = useRef(towers);
  towersRef.current = towers;
  const openRef = useRef(open);
  openRef.current = open;

  const gesture = useMemo(() => {
    const pinch = Gesture.Pinch()
      .runOnJS(true)
      .onStart(() => { gestureBase.current = domainRef.current; })
      .onUpdate((e) => {
        const base = gestureBase.current;
        const focalMi = base.lo + (e.focalX / (plotW || 1)) * (base.hi - base.lo);
        const next = pinchZoomDomain(base, focalMi, e.scale, full, minSpanMi);
        domainRef.current = next;
        setDomain(next);
      });
    const pan = Gesture.Pan()
      .runOnJS(true)
      .minPointers(1)
      .maxPointers(1)
      .activeOffsetX([-8, 8])
      .failOffsetY([-12, 12])
      .onStart(() => { gestureBase.current = domainRef.current; })
      .onUpdate((e) => {
        const base = gestureBase.current;
        // Only meaningful once zoomed — at full domain this is a no-op (clamped).
        const deltaMi = -(e.translationX / (plotW || 1)) * (base.hi - base.lo);
        const next = panDomainBy(base, deltaMi, full, minSpanMi);
        domainRef.current = next;
        setDomain(next);
      });
    const doubleTap = Gesture.Tap()
      .runOnJS(true)
      .numberOfTaps(2)
      .onEnd(() => {
        const next = resetDomain(full);
        domainRef.current = next;
        setDomain(next);
      });
    const singleTap = Gesture.Tap()
      .runOnJS(true)
      .numberOfTaps(1)
      .onEnd((e) => {
        const d = domainRef.current;
        const xOfHit = (mi: number) => ((mi - d.lo) / ((d.hi - d.lo) || 1)) * plotW;
        const list = towersRef.current;
        for (let i = 0; i < list.length; i++) {
          const t = list[i]!;
          const x1 = xOfHit(t.startMi), x2 = xOfHit(t.endMi);
          const w = Math.max(5, x2 - x1);
          if (e.x >= x1 - 4 && e.x <= x1 + w + 4) {
            setOpen(openRef.current === i ? null : i);
            return;
          }
        }
      });
    // Double-tap gets first refusal (single tap only fires once it fails);
    // pinch and pan are naturally disjoint by pointer count (2 vs 1) but Race
    // keeps whichever recognizes first from fighting the others, same pattern
    // as Reshape's Gesture.Race(pan, tap).
    return Gesture.Race(pinch, pan, Gesture.Exclusive(doubleTap, singleTap));
  }, [full, minSpanMi, plotW, setOpen]);

  const zoomed = isZoomed(domain, full);

  // Re-slice the FULL-res trace to the visible window (plus one point of
  // padding each side so the line doesn't visibly truncate at the edge).
  let i0 = 0; while (i0 < dMi.length && (dMi[i0] ?? 0) < domain.lo) i0++;
  if (i0 > 0) i0--;
  let i1 = dMi.length - 1; while (i1 > 0 && (dMi[i1] ?? 0) > domain.hi) i1--;
  if (i1 < dMi.length - 1) i1++;
  const visTowers = towers.filter((t) => t.endMi >= domain.lo && t.startMi <= domain.hi);

  const renderTrace = decimateMean(
    dMi.slice(i0, i1 + 1),
    pace.slice(i0, i1 + 1),
    tall ? 200 : 140,
  );
  const pv = renderTrace.ys.filter((p): p is number => p != null).sort((a, b) => a - b);
  // Clip extreme instantaneous GPS spikes (p04/p96) from the visible stream,
  // then anchor every visible rep tower so short work does not clip at the top.
  const plo = pv[Math.floor(pv.length * 0.04)] ?? 0, phi = pv[Math.floor(pv.length * 0.96)] ?? 1;
  const anchors = [plo, phi, ...visTowers.map((t) => t.paceSecMi).filter((p) => Number.isFinite(p))];
  const dLo = anchors.length ? Math.min(...anchors) : 0, dHi = anchors.length ? Math.max(...anchors) : 1;
  const padd = (dHi - dLo) * 0.12 || 10;
  const dom: [number, number] = [dLo - padd, dHi + padd];
  const xOf = (mi: number) => ((mi - domain.lo) / ((domain.hi - domain.lo) || 1)) * plotW;
  const yOf = (p: number) => { let nn = (p - dom[0]) / (dom[1] - dom[0] || 1); nn = Math.max(0, Math.min(1, nn)); return nn * H; }; // faster(small) -> top
  let line = ''; let started = false;
  for (let k = 0; k < renderTrace.ys.length; k++) { const p = renderTrace.ys[k]; if (p == null) { started = false; continue; } line += `${started ? 'L' : 'M'}${xOf(renderTrace.xs[k]!).toFixed(1)} ${yOf(p).toFixed(1)} `; started = true; }
  const step = niceMileStep(domain.hi - domain.lo);
  const ticks: number[] = []; for (let mi = Math.ceil(domain.lo / step) * step; mi < domain.hi; mi += step) { if (mi > domain.lo + 1e-6) ticks.push(mi); }
  const tickLabel = (mi: number) => (step >= 1 ? String(Math.round(mi)) : mi.toFixed(step >= 0.1 ? 1 : 2));
  // ~3 nice pace marks across the domain (wide on interval days → step to 2:00).
  const rawStep = (dom[1] - dom[0]) / 3;
  const pStep = rawStep > 90 ? 120 : rawStep > 45 ? 60 : 30;
  const yTicks: number[] = []; for (let p = Math.ceil(dom[0] / pStep) * pStep; p < dom[1]; p += pStep) yTicks.push(p);
  return (
    <View style={{ marginTop: space.s }}>
      <GestureDetector gesture={gesture}>
        <Svg width={IW} height={H + AX}>
          {/* horizontal gridlines + pace labels on the RIGHT edge */}
          {yTicks.map((p, i) => <SvgLine key={`g${i}`} x1={0} y1={yOf(p)} x2={plotW} y2={yOf(p)} stroke={C.line} strokeWidth={1} />)}
          {yTicks.map((p, i) => <SvgText key={`gl${i}`} x={plotW + 6} y={yOf(p) + 3} fill={C.faint} fontSize={9} textAnchor="start">{formatDuration(paceSecPerUnitFromMi(p))}</SvgText>)}
          {/* dotted vertical gridlines at the mile marks */}
          {ticks.map((mi, i) => <SvgLine key={`vg${i}`} x1={xOf(mi)} y1={0} x2={xOf(mi)} y2={H} stroke={C.line} strokeWidth={1} strokeDasharray="2 4" />)}
          <SvgLine x1={0} y1={H} x2={plotW} y2={H} stroke={C.line} strokeWidth={1} />
          {/* Work regions stay as faint vertical bands; the pace trace carries
              the ink, so this reads like Analysis rather than a filled bar UI. */}
          {visTowers.map((r) => {
            const i = towers.indexOf(r);
            const x1 = xOf(r.startMi), x2 = xOf(r.endMi); const w = Math.max(5, x2 - x1);
            const isOpen = open === i;
            return <Rect key={i} x={x1} y={0} width={w} height={H} rx={1} fill={C.paceFast} opacity={isOpen ? 0.1 : r.faded ? 0.02 : 0.035} />;
          })}
          {/* Actual pace stays thin; set-specific targets live beside each rep
              group where mixed 200/400/800m prescriptions remain honest. */}
          <Path d={line} fill="none" stroke={C.paceFast} strokeOpacity={0.82} strokeWidth={1.3} strokeLinejoin="round" strokeLinecap="round" />
          {ticks.map((mi, i) => (
            <SvgText key={`tl${i}`} x={xOf(mi)} y={H + 13} fill={C.faint} fontSize={9} textAnchor="middle">
              {DIST_UNITS === 'mi' ? tickLabel(mi) : (mi * 1.609344).toFixed(mi < 1 ? 1 : 0)}
            </SvgText>
          ))}
        </Svg>
      </GestureDetector>
      {zoomed ? <Text style={styles.zoomHint}>Double-tap to reset zoom</Text> : null}
    </View>
  );
}

function RepLedger({ reps, avgPace, uniform, open, setOpen, framed }: { reps: SnappedRep[]; avgPace: number; uniform: boolean; open: number | null; setOpen: (n: number | null) => void; framed?: boolean }) {
  const rm = useReduceMotion();
  // Full-screen: a labelled table where each rep carries an inline pace bar
  // (longer = faster) so the ledger and the IntervalChart towers tell the same
  // visual story. A faded (blown-up) rep is amber on the PACE only — one mark
  // per state, matching the compact ledger.
  if (framed) {
    const paces = reps.map((r) => r.achievedPaceSecPerMi);
    const fastR = Math.min(...paces), slowR = Math.max(...paces);
    return (
      <View>
        <View style={styles.ledHead}>
          <Text style={[styles.tableHeadTxt, { width: 20 }]}>#</Text>
          <View style={{ flex: 1 }} />
          <Text style={[styles.tableHeadTxt, { width: 56, textAlign: 'right' }]}>PACE</Text>
          <Text style={[styles.tableHeadTxt, { width: 56, textAlign: 'right' }]}>DIST</Text>
          <Text style={[styles.tableHeadTxt, { width: 34, textAlign: 'right' }]}>HR</Text>
        </View>
        {reps.map((r, i) => {
          const isOpen = open === i;
          const m = r.targetDistMeters;
          const distLabel = fmtRepDistUI(m);
          const norm = slowR > fastR ? clamp((slowR - r.achievedPaceSecPerMi) / (slowR - fastR), 0, 1) : 1;
          const w = Math.round((0.18 + 0.82 * norm) * 100);
          return (
            <Pressable key={i} onPress={() => { animateExpand(rm); setOpen(isOpen ? null : i); }} style={({ pressed }) => [styles.ledRow, isOpen ? { backgroundColor: C.fill } : null, pressed && styles.pressRow]}>
              <Text style={[styles.ledNum, { width: 20 }]}>{i + 1}</Text>
              {/* The bar stays on the neutral pace-heat ramp even for a faded
                  rep: a blow-up already reads as the slow end of the ramp, and
                  colouring the bar AND the numeral marked one state twice —
                  the compact ledger below marks only the numeral. */}
              <View style={styles.ledBar}><View style={{ height: '100%', borderRadius: radius.xs, width: `${w}%`, backgroundColor: paceHeat(norm) }} /></View>
              <Text style={[styles.ledPace, { width: 56, color: r.faded ? C.warningText : C.ink }]}>{formatDuration(paceSecPerUnitFromMi(r.achievedPaceSecPerMi))}</Text>
              <Text style={[styles.ledDist, { width: 56, flex: undefined, textAlign: 'right' }]} numberOfLines={1}>{distLabel}</Text>
              <Text style={[styles.ledHr, { width: 34 }]}>{r.avgHr != null ? `${r.avgHr}` : '—'}</Text>
            </Pressable>
          );
        })}
      </View>
    );
  }
  return (
    <View style={{ marginTop: space.md }}>
      {reps.map((r, i) => {
        const isOpen = open === i;
        const m = r.targetDistMeters;
        const repTime = r.achievedPaceSecPerMi * (m / METERS_PER_MILE); // elapsed time for the segment
        const distLabel = fmtRepDistUI(m);
        // Faded (blow-up) reps are amber on the pace — NOT a separate inline word,
        // which only some rows have and so knocks the columns out of alignment.
        return (
          <Pressable key={i} onPress={() => { animateExpand(rm); setOpen(isOpen ? null : i); }} style={({ pressed }) => [styles.ledRow, isOpen ? { backgroundColor: C.fill } : null, pressed && styles.pressRow]}>
            <Text style={styles.ledNum}>{i + 1}</Text>
            <Text style={styles.ledTime}>{formatDuration(repTime)}</Text>
            <Text style={styles.ledDist} numberOfLines={1}>{distLabel}</Text>
            <View style={{ flex: 1 }} />
            <Text style={[styles.ledPace, r.faded ? { color: C.warningText } : null]}>{formatDuration(paceSecPerUnitFromMi(r.achievedPaceSecPerMi))}<Text style={styles.ledUnit}> /{DIST_UNITS}</Text></Text>
            <Text style={styles.ledHr}>{r.avgHr != null ? `${r.avgHr}` : '—'}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ── Progression detection ───────────────────────────────────────────────────
// A progression run is one continuous effort whose pace steps DOWN over the run
// (negative split), not a set of reps. The dominant-block classifier sends it
// here as 'tempo'; this confirms the descending shape and drives the view.

type ProgSplit = ReturnType<typeof mileSplits>[number];
const SEC_KM_TO_MI = 1.609344; // sec/km → sec/mi

type ProgShape = { peakIdx: number; fastest: number; slowest: number };

/** Confirms a descending-pace shape from whole-mile splits: fastest mile in the
 *  back half, a meaningful drop into it, and a mostly-monotonic descent (a
 *  trailing cooldown is fine). Returned paces are seconds-per-mile. */
function progressionShape(splits: ProgSplit[]): ProgShape | null {
  const work = splits.filter((s) => !s.partial);
  if (work.length < 4) return null;
  const paces = work.map((s) => s.paceSecPerKm * SEC_KM_TO_MI);
  let peakIdx = 0;
  for (let i = 1; i < paces.length; i++) if (paces[i]! < paces[peakIdx]!) peakIdx = i;
  if (peakIdx < Math.ceil(paces.length * 0.4)) return null; // a fast start that fades isn't a progression
  const preMax = Math.max(...paces.slice(0, peakIdx + 1));
  if (preMax - paces[peakIdx]! < 40) return null; // needs a real drop (≥40 s/mi) into the peak
  let rises = 0;
  for (let i = 1; i <= peakIdx; i++) if (paces[i]! > paces[i - 1]! + 12) rises++;
  if (rises > Math.max(1, Math.floor(peakIdx * 0.25))) return null; // mostly monotonic down to the peak
  return { peakIdx, fastest: paces[peakIdx]!, slowest: Math.max(...paces) };
}

/**
 * Interpretation control — the run-detail correction affordance. Writes
 * `quality_override`; the credited default is `Auto`.
 *
 * WAS A SLIDER, and shouldn't have been. Three problems compounded:
 *
 *  1. `RangeSlider` is a two-thumb CONTINUOUS range filter (Airbnb price-range
 *     idiom: histogram, min/max readouts). Driving it in `single` mode over a
 *     2–4 step integer ladder asks a continuum control to express a short list
 *     of named alternatives.
 *  2. It rendered as a bare track. Single mode fills `low ± band`, and no
 *     `band` was passed, so the fill was always zero-width — an empty rail with
 *     a lone thumb, most often parked at position 0 of 1.
 *  3. It only responds to a drag on the 20pt thumb (`onPanResponderMove`; no
 *     tap-to-set), so choosing between two options meant dragging a handle
 *     across an unlabelled track whose ends read "coarse"/"fine" — interpreter
 *     jargon, not the runner's vocabulary.
 *
 * The underlying model is a single mutually-exclusive choice — match the plan,
 * take one of the detected readings, or say it wasn't a workout — so it is now
 * one single-select list where every option states what it would credit. The
 * options were previously split across three controls (slider + two toggle
 * chips) that could each look independently active.
 */
function InterpretationControl({
  interp,
  override,
  onChange,
}: {
  interp: { candidates: Reading[]; defaultIdx: number; matched: Reading | null };
  override: QualityOverride | null;
  onChange: (o: QualityOverride | null) => void;
}) {
  const cands = interp.candidates;
  const isNone = override?.choice === 'none';
  // The credited default (override null) is matched ?? honest, so when a plan
  // matched, "plan" IS the active default — reflect that in the slider position
  // (sit on the matched candidate) and the summary, so the control never
  // disagrees with the credited structure above it.
  const matchedIdx = interp.matched
    ? cands.findIndex(
        (c) =>
          c.kind === interp.matched!.kind &&
          c.blocks.length === interp.matched!.blocks.length &&
          Math.abs(c.qualityMi - interp.matched!.qualityMi) < 0.1,
      )
    : -1;
  const planActive = !isNone && !!interp.matched && (override == null || override.choice === 'plan');
  const naturalIdx = matchedIdx >= 0 ? matchedIdx : interp.defaultIdx;
  const selIdx =
    override?.choice === 'candidate'
      ? Math.min(Math.max(0, override.idx ?? naturalIdx), cands.length - 1)
      : planActive && matchedIdx >= 0
        ? matchedIdx
        : interp.defaultIdx;
  // One flat list of mutually-exclusive options, ONE ROW PER DISTINCT READING.
  //
  // The engine deliberately keeps structurally-identical readings when they
  // carry different provenance — the automatic evidence read and the
  // plan-aligned read can describe the same session while only the latter has
  // lap-derived metrics, and dropping either silently changes what the run
  // credits. That is correct for the engine and wrong for a chooser: it
  // surfaced as "5×2mi @ 6:00 / 5×2mi @ 6:00 / 5×2mi @ 6:01 / 5×2mi @ 6:01",
  // four spellings of one answer.
  //
  // So the LIST dedupes on what it renders. Two readings the runner reads as
  // the same sentence are the same choice, and the first one offered wins —
  // which is why the plan row is pushed first when a plan matched.
  const selectedSummary = isNone
    ? null
    : planActive && interp.matched
      ? interp.matched.summary
      : cands[selIdx]?.summary ?? null;

  type Opt = { key: string; label: string; note?: string; selected: boolean; onPress: () => void; muted?: boolean };
  const options: Opt[] = [];
  const offered = new Set<string>();
  if (interp.matched) {
    offered.add(interp.matched.summary);
    options.push({
      key: 'plan',
      label: interp.matched.summary,
      note: 'Matches plan',
      selected: planActive || interp.matched.summary === selectedSummary,
      onPress: () => onChange(null),
    });
  }
  cands.forEach((c, i) => {
    if (c.kind === 'none' || !c.summary || offered.has(c.summary)) return;
    offered.add(c.summary);
    options.push({
      key: `c${i}`,
      label: c.summary,
      note: i === naturalIdx && !interp.matched ? 'Detected' : undefined,
      selected: !isNone && !planActive && c.summary === selectedSummary,
      onPress: () => onChange(i === naturalIdx ? null : { choice: 'candidate', idx: i }),
    });
  });
  options.push({
    key: 'none',
    label: 'Not a workout',
    selected: isNone,
    muted: true,
    onPress: () => onChange(isNone ? null : { choice: 'none' }),
  });

  return (
    <View style={styles.interp}>
      <View style={styles.interpHead}>
        <Text style={styles.interpLabel}>INTERPRETATION</Text>
        {override ? (
          <Pressable onPress={() => onChange(null)} hitSlop={8} accessibilityLabel="Reset interpretation to automatic">
            <Text style={styles.interpAuto}>Auto</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.interpList} accessibilityRole="radiogroup">
        {options.map((o) => (
          <Pressable
            key={o.key}
            onPress={o.onPress}
            style={({ pressed }) => [styles.interpOpt, o.selected && styles.interpOptOn, pressed && styles.pressRow]}
            accessibilityRole="radio"
            accessibilityState={{ selected: o.selected }}
            accessibilityLabel={o.note ? `${o.label}, ${o.note}` : o.label}
          >
            {/* The selected mark is the only yellow here — reserved for the
                active choice, per the accent's contract-and-selection role. */}
            <View style={[styles.interpDot, o.selected && styles.interpDotOn]} />
            <Text
              style={[styles.interpOptTxt, o.muted && styles.interpOptTxtMuted, o.selected && styles.interpOptTxtOn]}
              numberOfLines={2}
            >
              {o.label}
            </Text>
            {o.note ? <Text style={styles.interpOptNote}>{o.note}</Text> : null}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function ProgressionView({ totalMi, totalSec, splits, shape, full }: { totalMi: number; totalSec: number; splits: ProgSplit[]; shape: ProgShape; full?: boolean }) {
  const bars = splits.filter((s) => !s.partial);
  const range = Math.max(shape.slowest - shape.fastest, 1);
  const avgPace = totalSec / (totalMi || 1);
  const displayDistance = DIST_UNITS === 'mi' ? totalMi : totalMi * 1.609344;
  const showHr = bars.some((s) => s.avgHr != null);
  return (
    <View>
      <View style={styles.qTop}>
        <View><Text style={styles.qTitle}>Progression</Text><Text style={styles.qSub}>Negative split</Text></View>
        <View style={{ flex: 1 }} />
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.iaAvg}>{formatDuration(paceSecPerUnitFromMi(shape.fastest))}<Text style={styles.iaAvgU}> /{DIST_UNITS} peak</Text></Text>
          <Text style={styles.iaSpread}>{formatDuration(paceSecPerUnitFromMi(shape.slowest))} → {formatDuration(paceSecPerUnitFromMi(shape.fastest))}</Text>
        </View>
      </View>
      {full ? (
        <View style={styles.qSummary}>
          <Panel>
            <View style={styles.sgRow}>
              <Metric label="Distance" value={displayDistance.toFixed(1)} unit={DIST_UNITS} />
              <Metric label="Peak split" value={formatDuration(paceSecPerUnitFromMi(shape.fastest))} unit={`/${DIST_UNITS}`} />
              <Metric label="Avg pace" value={formatDuration(paceSecPerUnitFromMi(avgPace))} unit={`/${DIST_UNITS}`} />
            </View>
          </Panel>
        </View>
      ) : null}
      <View style={styles.progHead}>
        <Text style={[styles.progMi, styles.progHeadCell]}>SPLIT</Text>
        <Text style={[styles.progPace, styles.progHeadCell]}>PACE</Text>
        <View style={{ flex: 1 }} />
        {showHr ? <Text style={[styles.progHr, styles.progHeadCell]}>HR</Text> : null}
      </View>
      <View style={styles.progRows}>
        {bars.map((s, i) => {
          const paceMi = s.paceSecPerKm * SEC_KM_TO_MI;
          const ti = (paceMi - shape.fastest) / range; // 0 = fastest, 1 = slowest
          const w = 24 + (1 - ti) * 76; // % — bar length ∝ speed; faster miles run longer, so the build is visible
          const tiAvg = Math.min(1, Math.max(0, (avgPace - shape.fastest) / range));
          const wAvg = 24 + (1 - tiAvg) * 76; // the dashed reference: bars past it ran faster than the run's average
          // Miles after the peak are the fade past the build — kept VISIBLE
          // (muted bar, not blacked out) with their HR intact. The build itself
          // is already legible from bar length + the pace column.
          const cool = i > shape.peakIdx;
          return (
            <View key={s.mile} style={styles.progRow}>
              <Text style={styles.progMi}>{s.mile}</Text>
              <Text style={styles.progPace}>{formatDuration(paceSecPerUnitFromMi(paceMi))}</Text>
              <View style={styles.progTrack}>
                <View style={[styles.progFill, { width: `${w}%`, backgroundColor: cool ? C.mute : C.yellow }]} />
                <View style={[styles.progAvg, { left: `${wAvg}%` }]} />
              </View>
              {showHr ? <Text style={styles.progHr}>{s.avgHr != null ? Math.round(s.avgHr) : ''}</Text> : null}
            </View>
          );
        })}
      </View>
      <View style={styles.progLegend}>
        <View style={styles.progLegendDash} />
        <Text style={styles.progLegendTxt}>avg {formatDuration(paceSecPerUnitFromMi(avgPace))}/{DIST_UNITS}  longer bar = faster split</Text>
      </View>
    </View>
  );
}

function IntervalAnalysis({ streams, det, full, hideReps, selectedIdx, onSelectIdx }: {
  streams: RunStreams; det: QualityDetect | null; full?: boolean; hideReps?: boolean;
  selectedIdx?: number | null; onSelectIdx?: (i: number | null) => void;
}) {
  const [openInternal, setOpenInternal] = useState<number | null>(null);
  // When the Session's rep table drives selection, the chart's highlighted tower
  // is controlled from outside; otherwise it owns its own open state.
  const controlled = onSelectIdx != null;
  const open = controlled ? (selectedIdx ?? null) : openInternal;
  const setOpen = controlled ? onSelectIdx : setOpenInternal;
  const stream = useMemo(() => toStream(streams), [streams]);
  // det is the lap+HR-aware verdict from the parent (computeIngestVerdict) — the
  // same one behind the chip — so lap-marked hill/altitude intervals show here.
  const snap = useMemo(() => (det ? snapIntervals(stream, det.blocks, { unit: 'mi' }) : null), [stream, det]);

  if (!det || !snap || !det.isQuality || det.blocks.length === 0) {
    return <View><Text style={styles.qCap}>No sustained quality effort detected in this run.</Text></View>;
  }

  const totalMi = (stream.d[stream.d.length - 1] ?? 0) / METERS_PER_MILE;
  const sustained = det.kind === 'tempo' || det.blocks.length < 2;

  if (sustained) {
    // A descending-pace shape is a progression — show the splits stepping down,
    // not a flat "sustained block".
    const splits = mileSplits(streams);
    const shape = progressionShape(splits);
    if (shape) return <ProgressionView totalMi={totalMi} totalSec={stream.t[stream.t.length - 1] ?? 0} splits={splits} shape={shape} full={full} />;

    const b = det.blocks.reduce((a, x) => (x.durationS > a.durationS ? x : a), det.blocks[0]!);
    const startMi = (stream.d[b.startIdx - 1] ?? 0) / METERS_PER_MILE;
    const endMi = (stream.d[b.endIdx] ?? 0) / METERS_PER_MILE;
    const avgHr = blockHr(stream, b.startIdx, b.endIdx);
    const warmFrac = Math.max(0.06, startMi / (totalMi || 1));
    const coolFrac = Math.max(0.06, (totalMi - endMi) / (totalMi || 1));
    const workFrac = Math.max(0.25, (endMi - startMi) / (totalMi || 1));
    return (
      <View>
        <View style={styles.qTop}>
          <View><Text style={styles.qTitle}>Sustained block</Text><Text style={styles.qSub}>Threshold effort</Text></View>
          <View style={{ flex: 1 }} />
          <Text style={styles.iaAvg}>{formatDuration(paceSecPerUnitFromMi(b.paceSecPerMi))}<Text style={styles.iaAvgU}> /{DIST_UNITS}</Text></Text>
        </View>
        <View style={styles.struct}>
          <View style={[styles.seg, { flex: warmFrac, backgroundColor: C.slate }]}><Text style={styles.segMute}>WARM</Text></View>
          <View style={[styles.seg, { flex: workFrac, backgroundColor: C.yellow }]}><Text style={styles.segDark}>{metersToUnits(b.distanceMeters, DIST_UNITS).toFixed(1)} {DIST_UNITS.toUpperCase()} @ {formatDuration(paceSecPerUnitFromMi(b.paceSecPerMi))}</Text></View>
          <View style={[styles.seg, { flex: coolFrac, backgroundColor: C.slate }]}><Text style={styles.segMute}>COOL</Text></View>
        </View>
        <View style={[styles.sgRow, { marginTop: space.md }]}>
          <Metric label="Duration" value={formatDuration(b.durationS)} />
          <Metric label="Distance" value={metersToUnits(b.distanceMeters, DIST_UNITS).toFixed(1)} unit={DIST_UNITS} />
          <Metric label="Avg HR" value={avgHr != null ? String(avgHr) : '—'} unit="bpm" />
        </View>
      </View>
    );
  }

  const reps = snap.reps;
  const avgPace = reps.reduce((a, r) => a + r.achievedPaceSecPerMi, 0) / reps.length;
  const spread = Math.round(Math.max(...reps.map((r) => r.achievedPaceSecPerMi)) - Math.min(...reps.map((r) => r.achievedPaceSecPerMi)));
  const trace = paceTrace(stream);
  const towers: Tower[] = det.blocks.map((b, i) => ({
    startMi: (stream.d[b.startIdx - 1] ?? 0) / METERS_PER_MILE,
    endMi: (stream.d[b.endIdx] ?? 0) / METERS_PER_MILE,
    paceSecMi: reps[i]?.achievedPaceSecPerMi ?? b.paceSecPerMi,
    faded: reps[i]?.faded ?? false,
  }));
  return (
    <View>
      {hideReps ? null : (
        <View style={styles.qTop}>
          <View><Text style={styles.qTitle}>{snap.label}</Text><Text style={styles.qSub}>Interval session</Text></View>
          <View style={{ flex: 1 }} />
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.iaAvg}>{formatDuration(paceSecPerUnitFromMi(avgPace))}<Text style={styles.iaAvgU}> /{DIST_UNITS} avg</Text></Text>
            {snap.uniform ? <Text style={styles.iaSpread}>{spread}s spread</Text> : null}
          </View>
        </View>
      )}
      <IntervalChart trace={trace} towers={towers} avgPace={avgPace} open={open} setOpen={setOpen} tall={full} />
      {hideReps ? null : full ? (
        <Panel><RepLedger reps={reps} avgPace={avgPace} uniform={snap.uniform} open={open} setOpen={setOpen} framed /></Panel>
      ) : (
        <RepLedger reps={reps} avgPace={avgPace} uniform={snap.uniform} open={open} setOpen={setOpen} />
      )}
    </View>
  );
}

// ── Plan-match drill: PlanMatchBand + RepTable ────────────────────────────────
const paceSecPerUnitFromMi = (secPerMi: number) =>
  DIST_UNITS === 'mi' ? secPerMi : secPerMi / 1.609344;
const paceSecPerUnitFromKm = (secPerKm: number) =>
  DIST_UNITS === 'mi' ? secPerKm * 1.609344 : secPerKm;
const fmtPace = (secPerUnit: number) => `${Math.floor(secPerUnit / 60)}:${String(Math.round(secPerUnit % 60)).padStart(2, '0')}`;
const fmtMi = (meters: number) => metersToUnits(meters, DIST_UNITS).toFixed(meters >= (DIST_UNITS === 'mi' ? METERS_PER_MILE : 1000) ? 1 : 2);
/** Rep distance for the UI: the canonical snap-to-nominal formatter (metres
 *  under a mile, miles above), shared with the detector so the set-header pill
 *  and the per-rep rows read the SAME distance. */
const fmtRepDistUI = (meters: number) => {
  if (DIST_UNITS === 'mi') return formatRepDist(meters);
  if (meters < 1500) return `${Math.round(meters)}m`;
  const km = metersToUnits(meters, 'km');
  return `${Number(km.toFixed(2))}km`;
};

/** Session's orientation layer, deliberately using the same two-tier scorecard
 * grammar as Analysis. Every value comes from the reconciled reps rendered in
 * the ledger below, so the card cannot describe one execution and list another. */
function SessionOverview({ sets, planned }: { sets: DrillSet[]; planned: boolean }) {
  const coreSets = sets.filter((set) => set.kind !== 'extra');
  const reps = coreSets.flatMap((set) => set.reps);
  const plannedReps = coreSets.reduce((sum, set) => sum + set.plannedReps, 0);
  const completedReps = reps.length;
  const distanceMi = reps.reduce((sum, rep) => sum + rep.distanceMeters / METERS_PER_MILE, 0);
  const repTimeSec = reps.reduce((sum, rep) => sum + rep.paceSecPerMi * (rep.distanceMeters / METERS_PER_MILE), 0);
  const avgPace = distanceMi > 0 ? repTimeSec / distanceMi : null;
  const paces = reps.map((rep) => rep.paceSecPerMi);
  const spread = paces.length > 1 ? Math.round(Math.max(...paces) - Math.min(...paces)) : 0;
  const hr = reps.map((rep) => rep.avgHr).filter((value): value is number => value != null);
  const avgHr = hr.length ? Math.round(hr.reduce((sum, value) => sum + value, 0) / hr.length) : null;
  const targets = [...new Set(coreSets.map((set) => set.targetSecPerMi).filter((value): value is number => value != null).map(Math.round))];
  const target = targets.length === 1 ? fmtPace(paceSecPerUnitFromMi(targets[0]!)) : targets.length > 1 ? 'Varied' : '—';

  // NO exception line. It used to close this card with an orange "1 rep short ·
  // +24s/mi off target", which is a pure restatement: COMPLETED already reads
  // "4 of 5", and AVG REP sits beside TARGET. Saying it a third time, in the
  // week's judgment colour, made one shortfall look like three (DESIGN.md:
  // "one state gets one mark", "say each fact once").
  return (
    <View>
      <View style={styles.sgRow}>
        <Metric label={planned ? 'Completed' : 'Reps'} value={planned ? `${Math.min(completedReps, plannedReps)} of ${plannedReps}` : String(completedReps)} />
        <Metric label="Avg rep" value={avgPace != null ? formatDuration(paceSecPerUnitFromMi(avgPace)) : '—'} unit={`/${DIST_UNITS}`} />
        <Metric label="Target" value={target} unit={targets.length === 1 ? `/${DIST_UNITS}` : undefined} />
      </View>
      <View style={[styles.sgRow, styles.sgRow2]}>
        <Metric sub label="Rep time" value={repTimeSec > 0 ? formatDuration(repTimeSec) : '—'} />
        <Metric sub label="Spread" value={formatDuration(paceSecPerUnitFromMi(spread))} />
        <Metric sub label="Avg HR" value={avgHr != null ? String(avgHr) : '—'} unit="bpm" />
      </View>
    </View>
  );
}

const TYPE_LABEL = { intervals: 'INTERVALS', tempo: 'TEMPO', progression: 'PROGRESSION' } as const;
// Verdict as a compact icon (the type chip + detail carry quality-vs-distance):
// success → seal, partial/short → half, missed → x.
const VERDICT_ICON: Record<string, string> = {
  matched: 'checkmark.seal.fill', met: 'checkmark.seal.fill',
  partial: 'circle.lefthalf.filled', short: 'circle.lefthalf.filled',
  missed: 'xmark.seal.fill',
};

/**
 * A day verdict is a FACT, not a grade.
 *
 * The week is the contract; the runs are the allocation (PRODUCT.md). Missing a
 * prescription on a Tuesday is a reshuffle, so a day may not wear the warning
 * colour that a WEEK wears when its contract is at risk — that colour now lives
 * only on week-level surfaces (the contract card, the week sheet). Shortfall
 * states therefore resolve to the neutral ink family and let the LABEL carry
 * the fact ('Missed', 'Partial · 4 of 5', 'Short of plan' all still render, in
 * full). A completed prescription keeps its positive mark: recognising work
 * that was done is not the thing that made these screens punitive.
 */
const verdictAccent = (state: string): string =>
  state === 'matched' || state === 'met' ? C.positiveText : C.mute;

/** Quality-day body: reps grouped by planned set, each rep diverging against
 *  its OWN set's target (so 4×800 @ 5K and 8×400 @ 3K are judged separately).
 *  Replaces the old flat PLANNED/RUN summary + single rep table. */
function QualityDrillBody({ sets, planned, onSelectRep, selectedRep }: {
  sets: DrillSet[]; planned: boolean; onSelectRep: (rep: RepRow | null) => void; selectedRep: number | null;
}) {
  const [w, setW] = useState(0);
  const allReps = sets.flatMap((s) => s.reps);
  if (!allReps.length) return null;
  const hasHr = allReps.some((r) => r.avgHr != null);
  // An UNPLANNED session (no target) has no Δ for any rep — drop the Δ column and
  // its diverging bar entirely and spread the columns, rather than leave a blank
  // Δ + empty gutter on every row.
  const hasDelta = allReps.some((r) => r.deltaSec != null);
  // GPS pace and lap placement do not support a moralized one-second boundary,
  // so a rep counts if it lands within 3% of its set's target (floor 10s).
  // Hoisted from the row loop because the deviation chart has to DRAW this band,
  // and the axis must be wide enough to contain it — otherwise a run whose reps
  // all sit inside tolerance would scale the band past the full track.
  const setTolerance = (s: DrillSet) => Math.max(10, Math.round((s.targetSecPerMi ?? 0) * 0.03));
  const maxAbs = Math.max(
    8,
    ...allReps.map((r) => Math.abs(r.deltaSec ?? 0)),
    ...sets.map(setTolerance),
  );
  const W_REP = 22, W_DIST = 50, W_PACE = 48, W_HR = hasHr ? 36 : 0, W_D = 44;
  const deltaW = Math.max(54, w - (W_REP + W_DIST + W_PACE + W_HR + W_D));

  /**
   * ONE column spec, consumed by both the header and every row.
   *
   * These used to be declared twice — inline on the header cells and again on
   * the row cells — and had already drifted: the HR header was left-aligned
   * over right-aligned values, and the row carried a dead
   * `hasDelta ? 'right' : 'right'` ternary from an edit that lost its other
   * branch. Deriving both from one list makes that class of drift impossible.
   *
   * Numerals are right-aligned so digits stack into a scannable column
   * (`fontVariant: tabular-nums` only equalises glyph width; alignment is what
   * actually forms the column). `#` is the one left-aligned cell — it is an
   * ordinal label, not a measurement.
   *
   * WIDTHS: with a Δ column the data cells stay fixed and the diverging bar
   * absorbs the remaining width. WITHOUT one there is no bar to absorb it, so
   * the cells share it via `flex` instead. Previously a single `flex: 1` spacer
   * sat between DIST and PACE, which shoved `# DIST` against the left margin and
   * `PACE HR` against the right with a void down the middle — the code comment
   * said "spread the columns" but a lone mid-row spacer splits them into two
   * clumps instead.
   */
  const cols: Array<{
    key: 'rep' | 'dist' | 'pace' | 'hr' | 'delta';
    label: string;
    width?: number;
    flex?: number;
    align: 'left' | 'right';
  }> = [
    { key: 'rep', label: '#', width: W_REP, align: 'left' },
    { key: 'dist', label: 'DIST', ...(hasDelta ? { width: W_DIST } : { flex: 1 }), align: 'right' },
    { key: 'pace', label: 'PACE', ...(hasDelta ? { width: W_PACE } : { flex: 1 }), align: 'right' },
    ...(hasHr
      ? [{ key: 'hr' as const, label: 'HR', ...(hasDelta ? { width: W_HR } : { flex: 1 }), align: 'right' as const }]
      : []),
    ...(hasDelta ? [{ key: 'delta' as const, label: 'Δ', width: W_D, align: 'right' as const }] : []),
  ];
  const cellStyle = (c: (typeof cols)[number]) => ({
    ...(c.width != null ? { width: c.width } : { flex: c.flex }),
    textAlign: c.align,
  });
  return (
    <View style={styles.pmTable} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {sets.map((set, si) => (
        <View key={si} style={si > 0 ? { marginTop: space.l } : undefined}>
          <View style={styles.pmSetHead}>
            <Text style={styles.pmSetTitle}>
              <Text style={styles.pmSetLabel}>{set.kind === 'extra' ? 'EXTRA  ' : planned ? 'PLAN  ' : 'ACTUAL  '}</Text>
              {set.kind === 'extra'
                ? `${set.reps.length}×${fmtRepDistUI(set.distPerRepMeters)}`
                : `${set.plannedReps}×${fmtRepDistUI(set.distPerRepMeters)}`}
            </Text>
            {set.targetSecPerMi != null ? (
              <Text style={styles.pmSetTarget}>{set.zoneLabel ?? 'target'} {fmtPace(paceSecPerUnitFromMi(set.targetSecPerMi))}<Text style={styles.pmUnit}>/{DIST_UNITS}</Text></Text>
            ) : null}
          </View>
          {si === 0 ? (
            <View style={styles.pmThead}>
              {cols.map((c) => (
                <Text key={c.key} style={[styles.pmTh, cellStyle(c)]}>{c.label}</Text>
              ))}
              {/* The deviation chart's axis header. Naming both directions once,
                  here, is what makes every bar below self-explanatory — without
                  it the geometry is only legible to someone who already knows
                  which side means what. Insets match the chart's own padding so
                  the words sit over the ends of the track they describe. */}
              {hasDelta ? (
                <View style={{ width: deltaW, flexDirection: 'row', justifyContent: 'space-between', paddingLeft: space.md, paddingRight: space.s }}>
                  <Text style={styles.pmAxis}>faster</Text>
                  <Text style={styles.pmAxis}>slower</Text>
                </View>
              ) : null}
            </View>
          ) : null}
          {set.reps.map((r, ri) => {
            const sel = selectedRep === r.index;
            // GPS pace and lap placement do not support a moralized one-second
            // boundary. A 3% (minimum 10s/mi) band stays neutral; only a clear
            // miss in either direction receives the single attention color.
            const tolerance = setTolerance(set);
            const outsideBand = r.deltaSec != null && Math.abs(r.deltaSec) > tolerance;
            const deltaLabel = r.deltaSec == null
              ? 'no pace target'
              : `${Math.abs(r.deltaSec)} seconds ${r.deltaSec < 0 ? 'faster' : r.deltaSec > 0 ? 'slower' : 'on target'}${outsideBand ? ', outside target band' : ', within target band'}`;
            return (
              <Pressable
                key={r.index}
                onPress={() => onSelectRep(sel ? null : r)}
                accessibilityRole="button"
                accessibilityState={{ selected: sel }}
                accessibilityLabel={`Rep ${r.index}, ${fmtRepDistUI(r.distanceMeters)}, ${fmtPace(paceSecPerUnitFromMi(r.paceSecPerMi))} per ${DIST_UNITS === 'mi' ? 'mile' : 'kilometer'}${r.avgHr != null ? `, ${r.avgHr} beats per minute` : ''}, ${deltaLabel}`}
                accessibilityHint="Selects this rep in the session chart and route"
                style={[styles.pmTrow, ri > 0 && styles.pmTrowRule, sel && styles.pmTrowSel]}
              >
                {cols.map((c) => {
                  const cell = cellStyle(c);
                  if (c.key === 'rep') return <Text key={c.key} style={[styles.pmTd, styles.pmRepNum, cell]}>{r.index}</Text>;
                  if (c.key === 'dist') return <Text key={c.key} style={[styles.pmTd, cell]}>{fmtRepDistUI(r.distanceMeters)}</Text>;
                  if (c.key === 'pace') return <Text key={c.key} style={[styles.pmTd, cell]}>{fmtPace(paceSecPerUnitFromMi(r.paceSecPerMi))}</Text>;
                  if (c.key === 'hr') return <Text key={c.key} style={[styles.pmTd, styles.pmHr, cell]}>{r.avgHr ?? '—'}</Text>;
                  return (
                    <Text key={c.key} style={[styles.pmDelta, cell]}>
                      {r.deltaSec == null ? '' : (r.deltaSec > 0 ? '+' : '−') + Math.round(Math.abs(paceSecPerUnitFromMi(r.deltaSec))) + 's'}
                    </Text>
                  );
                })}
                {hasDelta ? (w > 0 ? <DeltaTick delta={r.deltaSec} maxAbs={maxAbs} tolerance={tolerance} width={deltaW} /> : <View style={{ width: deltaW }} />) : null}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

/** Missed-quality body: the prescription you didn't complete — set headers, no
 *  reps (nothing was detected to fill them). */
function MissedPlanBody({ sets }: { sets: DrillSet[] }) {
  return (
    <View>
      {sets.map((set, si) => (
        <View key={si} style={[styles.pmSetHead, si > 0 ? { marginTop: space.m } : undefined]}>
          <Text style={styles.pmSetTitle}>{set.plannedReps}×{fmtRepDistUI(set.distPerRepMeters)}</Text>
          {set.targetSecPerMi != null ? (
            <Text style={styles.pmSetTarget}>{set.zoneLabel ?? 'target'} {fmtPace(paceSecPerUnitFromMi(set.targetSecPerMi))}<Text style={styles.pmUnit}>/{DIST_UNITS}</Text></Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

/** Distance-day body: run distance filling toward the planned target, with the
 *  remaining/over delta. Verdict (MET/SHORT) lives in the header badge. */
function DistanceBody({ v }: { v: DrillVerdict }) {
  const planned = v.plannedMeters ?? 0;
  const run = v.runMeters ?? 0;
  const frac = planned > 0 ? Math.min(1, run / planned) : run > 0 ? 1 : 0;
  const met = v.distanceState === 'met';
  const deltaMi = metersToUnits(Math.abs(planned - run), DIST_UNITS);
  // ONE MARK PER STATE. A run short of plan used to stamp the same shortfall
  // three times in the same colour — the hero chip, this fill, and the TO GO
  // figure — so a single easy day read as an emergency. The chip keeps the
  // state; the bar and the figure are measurements, so they take the neutral
  // ink family (see `verdictAccent`). The numbers themselves are untouched.
  const barColor = met ? C.positiveText : C.mute;
  const deltaColor = met ? C.positiveText : C.ink;
  return (
    <View>
      <View style={styles.pmDistHead}>
        <Text style={styles.pmDistRun}>{fmtMi(run)}<Text style={styles.pmDistUnit}> {DIST_UNITS}</Text></Text>
        <Text style={styles.pmDistPlan}>/ {fmtMi(planned)} {DIST_UNITS}</Text>
      </View>
      <View style={styles.pmProgTrack}>
        <View style={[styles.pmProgFill, { width: `${Math.max(3, frac * 100)}%`, backgroundColor: barColor }]} />
      </View>
      <View style={styles.pmDistFoot}>
        <Text style={styles.pmPlabel}>{met ? 'OVER' : 'TO GO'}</Text>
        <Text style={[styles.pmDistDelta, { color: deltaColor }]}>
          {met ? '+' : ''}{deltaMi.toFixed(1)}<Text style={styles.pmUnit}> {DIST_UNITS}</Text>
        </Text>
      </View>
    </View>
  );
}

/** Drawn, not filled: target is the center tick and the achieved delta is a
 * second hairline displaced along the baseline. Magnitude remains comparable
 * without introducing progress-bar/widget geometry into the ledger. */
/**
 * How far this rep landed from its pace target, as a signed bar growing out of
 * the target line — left of it is faster, right is slower.
 *
 * WAS THREE AMBIGUOUS MARKS: a full-width hairline with two near-identical
 * vertical ticks on it. Three things went wrong.
 *
 *  - The hairline used `C.line` at hairline weight — the SAME token and weight
 *    as `pmTrowRule`, this table's own row separator. So the axis read as table
 *    chrome (or as a strikethrough), not as a scale.
 *  - The two ticks differed only by 4pt of height and one step of grey, so
 *    nothing said which was the target and which was the rep.
 *  - Direction carried no weight: a rep 17s FASTER and one 17s SLOWER drew
 *    mirror-image marks that looked identical at a glance, leaving the `+17s`
 *    text to do all the work. A mark that only restates the number beside it
 *    has not earned its space.
 *
 * It also withheld the one judgement it was best placed to make. `outsideBand`
 * was already computed for the VoiceOver label — "outside target band" — but
 * nothing rendered it, so screen-reader users were told whether a rep counted
 * and sighted users were not. The band is now drawn, which closes that gap and
 * is what makes the geometry worth reading: position shows how far off, the
 * shaded zone shows whether that distance mattered.
 */
function DeltaTick({ delta, maxAbs, tolerance, width, height = 18 }: {
  delta: number | null; maxAbs: number; tolerance: number; width: number; height?: number;
}) {
  const cx = width / 2;
  const half = Math.max(1, cx - space.s);
  const scale = (v: number) => (maxAbs <= 0 ? 0 : clamp(v / maxAbs, -1, 1) * half);
  const bandHalf = Math.min(half, Math.abs(scale(tolerance)));
  const dx = delta == null ? 0 : scale(delta);
  const outside = delta != null && Math.abs(delta) > tolerance;
  const BAR = 6;
  return (
    <View style={{ width, height, justifyContent: 'center' }} importantForAccessibility="no-hide-descendants">
      {/* Tolerance band — the "this still counts" zone, centred on target. */}
      <View style={{
        position: 'absolute', left: cx - bandHalf, width: bandHalf * 2,
        top: (height - BAR - 5) / 2, height: BAR + 5,
        borderRadius: radius.xs, backgroundColor: C.fill,
      }} />
      {/* Target. Taller than the bar and full-height of the band so it reads as
          the anchor the bar grows from, not as another tick on a line. */}
      <View style={{
        position: 'absolute', left: cx - 0.5, top: (height - BAR - 9) / 2,
        width: 1, height: BAR + 9, backgroundColor: C.faint,
      }} />
      {/* The deviation itself. Anchored at target, so its side IS the sign and
          its length IS the magnitude — orange only once it leaves the band. */}
      {delta != null && Math.abs(dx) >= 1 ? (
        <View style={{
          position: 'absolute',
          left: dx < 0 ? cx + dx : cx,
          width: Math.abs(dx),
          top: (height - BAR) / 2, height: BAR,
          borderRadius: radius.xs,
          backgroundColor: outside ? C.warningText : C.mute,
        }} />
      ) : null}
    </View>
  );
}

type DisplayHeartRate = {
  values: (number | null)[];
  avg: number;
  min: number;
  max: number;
  maxIndex: number;
};

type CleanHeartRate = Omit<DisplayHeartRate, 'values'> & { values: (number | null)[] };

/** Raw-but-clean HR samples shared by the chart and zone ledger. */
function cleanHeartRate(streams: RunStreams): CleanHeartRate | null {
  const hr = streams.hr;
  if (!hr || hr.length < 2) return null;
  const raw = hr.map((value) => (value != null && value >= 30 && value <= 220 ? value : null));
  const present = raw.filter((value): value is number => value != null).sort((a, b) => a - b);
  if (present.length < 2) return null;

  // Relative to the run's median rather than a fixed athletic threshold, so an
  // easy runner and a threshold session receive the same acquisition cleanup.
  const median = percentile(present, 0.5);
  const acquisitionFloor = Math.max(45, Math.min(100, median * 0.55));
  const stableRun = 4;
  let stableStart = 0;
  for (let i = 0; i <= raw.length - stableRun; i++) {
    const window = raw.slice(i, i + stableRun);
    if (window.every((value) => value != null && value >= acquisitionFloor)) {
      stableStart = i;
      break;
    }
  }
  const values = raw.map((value, index) => (
    index < stableStart || value == null || value < acquisitionFloor ? null : value
  ));
  const kept = values.filter((value): value is number => value != null);
  if (kept.length < 2) return null;
  const max = Math.max(...kept);
  return {
    values,
    avg: Math.round(kept.reduce((sum, value) => sum + value, 0) / kept.length),
    min: Math.round(Math.min(...kept)),
    max: Math.round(max),
    maxIndex: values.findIndex((value) => value === max),
  };
}

/**
 * A display-only HR series. Wearables commonly record a few acquisition values
 * before their optical signal settles; those values stay in the source data but
 * do not become the run's visible minimum or stretch the chart domain. The raw
 * maximum is retained and annotated over the smoothed presentation trace.
 */
export function displayHeartRate(streams: RunStreams): DisplayHeartRate | null {
  const cleaned = cleanHeartRate(streams);
  if (!cleaned) return null;
  return {
    ...cleaned,
    values: smooth(cleaned.values, 17),
  };
}
/** Moving samples carrying each sample's dt (stopped/auto-pause gaps excluded). */
function movingSamples(streams: RunStreams): { v: number; hr: number; dt: number }[] {
  const { v, hr, t } = streams;
  const n = Math.min(v.length, hr.length, t.length);
  const out: { v: number; hr: number; dt: number }[] = [];
  for (let i = 1; i < n; i++) {
    const vi = v[i], h = hr[i], dt = (t[i] ?? 0) - (t[i - 1] ?? 0);
    if (vi != null && vi > 0.5 && h != null && h > 0 && dt > 0 && dt < 20) out.push({ v: vi, hr: h, dt });
  }
  return out;
}
/** Aerobic decoupling (cardiac drift), %: how far the speed:HR efficiency fell
 * from the first half to the second. Positive = HR drifted up relative to pace
 * (less durable / started too hard); ≈0 = aerobically steady. Pa:HR method over
 * moving samples, split at the moving-time midpoint. */
function hrDrift(streams: RunStreams): number | null {
  const samp = movingSamples(streams);
  if (samp.length < 20) return null;
  const totalT = samp.reduce((a, s) => a + s.dt, 0);
  let acc = 0, mid = 0;
  for (let i = 0; i < samp.length; i++) { acc += samp[i]!.dt; if (acc >= totalT / 2) { mid = i; break; } }
  const halfEF = (a: number, b: number): number | null => {
    let sv = 0, sh = 0, sw = 0;
    for (let i = a; i < b; i++) { sv += samp[i]!.v * samp[i]!.dt; sh += samp[i]!.hr * samp[i]!.dt; sw += samp[i]!.dt; }
    return sw > 0 && sh > 0 ? (sv / sw) / (sh / sw) : null;
  };
  const ef1 = halfEF(0, mid), ef2 = halfEF(mid, samp.length);
  if (ef1 == null || ef2 == null || ef1 === 0) return null;
  return ((ef1 - ef2) / ef1) * 100;
}
/** Cardiac efficiency: heartbeats spent per mile (lower = fitter) over moving
 * time. avg HR × moving minutes per mile, derived sample-by-sample. */
function beatsPerMile(streams: RunStreams): number | null {
  const samp = movingSamples(streams);
  if (samp.length < 5) return null;
  let beats = 0, dist = 0;
  for (const s of samp) { beats += (s.hr / 60) * s.dt; dist += s.v * s.dt; }
  const miles = dist / METERS_PER_MILE;
  return miles > 0.1 ? Math.round(beats / miles) : null;
}

// ── HR-over-distance chart (red trace, avg reference, peak callout, scrub) ──
function HrChart({ streams, avgHr, tall }: { streams: RunStreams; avgHr: number | null; tall?: boolean }) {
  const H = tall ? 190 : 128, AX = 16;
  const [cursorX, setCursorX] = useState<number | null>(null);
  const model = useMemo(() => {
    const d = streams.d;
    const display = displayHeartRate(streams);
    const n = Math.min(display?.values.length ?? 0, d?.length ?? 0);
    if (!display || !d || n < 4) return null;
    const sm = display.values.slice(0, n);
    const clean = sm.filter((v): v is number => v != null && v > 0);
    if (clean.length < 2) return null;
    // Reserve a real annotation band above the raw peak. The peak label never
    // has to fight the trace or the sheet edge for space.
    const lo = Math.min(...clean) - 5, hi = Math.max(display.max, ...clean) + 16;
    const totalDistance = metersToUnits(d[n - 1] ?? 0, DIST_UNITS);
    const xOf = (distance: number) => (distance / (totalDistance || 1)) * IW;
    const yOf = (v: number) => { let nn = (v - lo) / ((hi - lo) || 1); nn = Math.max(0, Math.min(1, nn)); return (1 - nn) * H; }; // higher HR → top
    // The inspector keeps full-resolution points, but the SVG path receives no
    // more detail than the screen can resolve. Mean-bucket decimation removes
    // the raw 7–10k-point comb without changing zone/session calculations.
    const renderXs = sm.map((_, i) => metersToUnits(d[i] ?? 0, DIST_UNITS));
    const render = decimateMean(renderXs, sm, Math.max(180, Math.round(IW * 1.25)));
    const proj = render.ys.map((v, i) => (v != null && v > 0 ? { px: xOf(render.xs[i] ?? 0), py: yOf(v) } : null));
    // Clean point list for scrub lookup — carries the HR value + distance.
    const pts: { px: number; py: number; hr: number; distance: number }[] = [];
    for (let i = 0; i < n; i++) {
      const v = sm[i];
      if (v != null && v > 0) {
        const distance = metersToUnits(d[i] ?? 0, DIST_UNITS);
        pts.push({ px: xOf(distance), py: yOf(v), hr: Math.round(v), distance });
      }
    }
    const avg = avgHr ?? display.avg;
    const maxI = clamp(display.maxIndex, 0, n - 1);
    const step = DIST_UNITS === 'mi'
      ? totalDistance > 16 ? 5 : totalDistance > 8 ? 3 : 2
      : totalDistance > 25 ? 5 : totalDistance > 10 ? 2 : 1;
    const ticks: { x: number; label: string }[] = [];
    for (let distance = step; distance < totalDistance; distance += step) ticks.push({ x: xOf(distance), label: String(distance) });
    return {
      segs: segments(proj),
      pts,
      avg: Math.round(avg),
      avgY: yOf(avg),
      maxV: display.max,
      maxPt: { px: xOf(metersToUnits(d[maxI] ?? 0, DIST_UNITS)), py: yOf(display.max) },
      ticks,
    };
  }, [streams, avgHr, tall, IW, DIST_UNITS]);

  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    // Once scrubbing, hold the gesture: refuse to hand it to the parent ScrollView
    // on a vertical drift, and block the native scroll from taking over.
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,
    onPanResponderGrant: (e) => setCursorX(clamp(e.nativeEvent.locationX, 0, IW)),
    onPanResponderMove: (e) => setCursorX(clamp(e.nativeEvent.locationX, 0, IW)),
    onPanResponderRelease: () => setCursorX(null),
    onPanResponderTerminate: () => setCursorX(null),
  }), []);

  if (!model) return null;
  const cur = cursorX != null ? nearestBy(model.pts, cursorX) : null;
  const peakLabelW = 52;
  const peakLabelX = clamp(model.maxPt.px, peakLabelW / 2, IW - peakLabelW / 2);
  const peakLabelY = Math.max(13, model.maxPt.py - 10);
  const avgLabelW = 55;
  return (
    <View>
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={`Heart rate over distance. Average ${model.avg} beats per minute. Maximum ${model.maxV}.`}
        style={{ width: IW, height: H + AX, position: 'relative' }}
      >
        <Svg width={IW} height={H + AX}>
          <SvgLine x1={0} y1={model.avgY} x2={IW} y2={model.avgY} stroke={C.red} strokeOpacity={0.4} strokeWidth={1} strokeDasharray="4 4" />
          {model.segs.map((s, i) => <Path key={`hl${i}`} d={lineD(s)} stroke={C.red} strokeWidth={2} fill="none" strokeLinejoin="round" />)}
          {/* Average and peak labels get matte masks; neither can be crossed by
              the red trace. The peak also has a reserved top-domain band. */}
          {cur == null ? <Rect x={IW - avgLabelW} y={model.avgY - 7} width={avgLabelW} height={14} fill={C.card} /> : null}
          {cur == null ? <SvgText x={IW - 3} y={model.avgY + 3} fill={C.red} fillOpacity={0.75} fontSize={8.5} fontWeight="700" textAnchor="end">{`AVG ${model.avg}`}</SvgText> : null}
          {cur == null ? <SvgLine x1={model.maxPt.px} y1={model.maxPt.py - 3} x2={peakLabelX} y2={peakLabelY + 2} stroke={C.red} strokeOpacity={0.5} strokeWidth={1} /> : null}
          {cur == null ? <Circle cx={model.maxPt.px} cy={model.maxPt.py} r={3.5} fill={C.red} /> : null}
          {cur == null ? <Rect x={peakLabelX - peakLabelW / 2} y={peakLabelY - 11} width={peakLabelW} height={15} rx={3} fill={C.card} /> : null}
          {cur == null ? <SvgText x={peakLabelX} y={peakLabelY} fill={C.red} fontSize={8.5} fontWeight="700" textAnchor="middle">{`MAX ${model.maxV}`}</SvgText> : null}
          {model.ticks.map((t, i) => <SvgLine key={`ht${i}`} x1={t.x} y1={H} x2={t.x} y2={H + 4} stroke={C.faint} strokeWidth={1} />)}
          {model.ticks.map((t, i) => {
            const label = edgeAwareTickLabel(t.x, 0, IW);
            return <SvgText key={`htl${i}`} x={label.x} y={H + 13} fill={C.faint} fontSize={9} textAnchor={label.anchor}>{t.label}</SvgText>;
          })}
          {cur ? (
            <>
              <SvgLine x1={cur.px} y1={0} x2={cur.px} y2={H} stroke="#FFFFFF" strokeOpacity={0.5} strokeWidth={1} />
              <Circle cx={cur.px} cy={cur.py} r={4.5} fill={C.red} />
            </>
          ) : null}
        </Svg>
        {cur ? (
          <View style={[styles.rangeCallout, { width: 132, left: clamp(cur.px - 66, 0, IW - 132) }]} pointerEvents="none">
            <View style={styles.rcCell}><Text style={[styles.rcVal, { color: C.red }]}>{cur.hr}</Text><Text style={styles.rcLab}>bpm</Text></View>
            <View style={styles.rcDiv} />
            <View style={styles.rcCell}><Text style={styles.rcVal}>{cur.distance.toFixed(2)}</Text><Text style={styles.rcLab}>{DIST_UNITS}</Text></View>
          </View>
        ) : null}
        <View style={{ position: 'absolute', left: 0, top: 0, width: IW, height: H }} {...pan.panHandlers} />
      </View>
    </View>
  );
}

// ── HR zones (tap a zone → avg pace · time · avg HR) ────────────────────────
type ZoneBars = { frac: number; color: string }[];
type ZoneRows = { name: string; color: string; sec: number; pct: number; range: string; avgHr: number | null; avgPace: number | null }[];

function HeartRateOverview({ bars, rows, avgHr, maxHr }: { bars: ZoneBars; rows: ZoneRows; avgHr: number | null; maxHr: number | null }) {
  const dominant = rows.reduce<ZoneRows[number] | null>((best, row) => (!best || row.sec > best.sec ? row : best), null);
  const spoken = [
    avgHr != null ? `Average ${avgHr} beats per minute` : null,
    maxHr != null ? `maximum ${maxHr}` : null,
    dominant ? `most time in ${dominant.name}, ${dominant.pct} percent` : null,
  ].filter((value): value is string => value != null).join('. ');
  return (
    <View accessible accessibilityRole="summary" accessibilityLabel={spoken}>
      <View style={styles.zBar} importantForAccessibility="no-hide-descendants">
        {bars.map((zone, index) => (zone.frac > 0 ? <View key={index} style={{ flex: zone.frac, backgroundColor: zone.color }} /> : null))}
      </View>
      <View style={styles.hrOverviewRow} importantForAccessibility="no-hide-descendants">
        <View>
          <Text style={styles.hrOverviewLabel}>Most time</Text>
          <Text style={styles.hrOverviewValue}>{dominant ? `${dominant.name} · ${dominant.pct}%` : '—'}</Text>
        </View>
        <Text style={styles.hrOverviewMeta}>{avgHr ?? '—'} avg  ·  {maxHr ?? '—'} max</Text>
      </View>
    </View>
  );
}

function ZonesCard({ bars, rows }: { bars: ZoneBars; rows: ZoneRows }) {
  const [open, setOpen] = useState<string | null>(null);
  const rm = useReduceMotion();
  return (
    <View>
      <View style={styles.zBar}>
        {bars.map((z, i) => (z.frac > 0 ? <View key={i} style={{ flex: z.frac, backgroundColor: z.color }} /> : null))}
      </View>
      <View style={styles.zHead}>
        <Text style={[styles.tableHeadTxt, { flex: 1 }]}>ZONE</Text>
        <Text style={[styles.tableHeadTxt, { width: 42, textAlign: 'right' }]}>%</Text>
        <Text style={[styles.tableHeadTxt, { width: 52, textAlign: 'right' }]}>TIME</Text>
        <Text style={[styles.tableHeadTxt, { width: 64, textAlign: 'right' }]}>RANGE</Text>
      </View>
      {rows.map((z) => {
        const isOpen = open === z.name;
        // Open zone = one tinted block (row + detail) in the zone's own colour,
        // so the detail reads as the zone unfolding — not a floating nested card.
        return (
          <View key={z.name} style={isOpen ? [styles.zOpenWrap, { backgroundColor: withAlpha(z.color, 0.1) }] : null}>
            <Pressable
              onPress={() => { animateExpand(rm); setOpen(isOpen ? null : z.name); }}
              accessibilityRole="button"
              accessibilityLabel={`${z.name}, ${z.pct} percent, ${formatDuration(z.sec)}, ${z.range} beats per minute`}
              accessibilityHint={isOpen ? 'Collapses zone details' : 'Shows average pace and heart rate for this zone'}
              accessibilityState={{ expanded: isOpen }}
              style={({ pressed }) => [styles.zRow, pressed && styles.pressRow]}
            >
              <View style={styles.zName}><View style={[styles.swatch, { backgroundColor: z.color }]} /><Text style={styles.zNameTxt}>{z.name}</Text></View>
              <Text style={styles.zPct}>{z.pct}%</Text>
              <Text style={styles.zDur}>{formatDuration(z.sec)}</Text>
              <Text style={styles.zRangeCol}>{z.range}</Text>
            </Pressable>
            {isOpen ? (
              <View style={[styles.zExpand, { borderTopColor: withAlpha(z.color, 0.22) }]}>
                <View style={styles.zeCell}><Text style={styles.zeLab}>Avg pace</Text><Text style={styles.zeVal}>{z.avgPace != null ? `${formatDuration(paceSecPerUnitFromMi(z.avgPace))} /${DIST_UNITS}` : '—'}</Text></View>
                <View style={styles.zeCell}><Text style={styles.zeLab}>Avg HR</Text><Text style={styles.zeVal}>{z.avgHr != null ? `${z.avgHr} bpm` : '—'}</Text></View>
                <View style={styles.zeCell}><Text style={styles.zeLab}>Range</Text><Text style={styles.zeVal}>{z.range} bpm</Text></View>
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

// Zone panel — boundaries are % of the estimated max HR (the athlete's observed
// peak). The basis is shown as a stated value, not a per-activity control; the
// real setting lives in the profile.
function ZonesPanel({ bars, rows, maxHr }: { bars: ZoneBars; rows: ZoneRows; maxHr: number }) {
  return (
    <Panel>
      <View style={styles.zMaxRow}>
        <Text style={styles.zMaxLab}>HR ZONES</Text>
        <Text style={styles.zMaxVal}>EST. MAX  {maxHr} <Text style={styles.zMaxUnit}>BPM</Text></Text>
      </View>
      <View style={{ height: 14 }} />
      <ZonesCard bars={bars} rows={rows} />
    </Panel>
  );
}

// ── small components ─────────────────────────────────────────────────────────
function StatRow({ label, value, unit, accent, first }: { label: string; value: string; unit?: string; accent?: boolean; first?: boolean }) {
  return (
    <View style={[styles.statRow, first ? { borderTopWidth: 0 } : null]}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, accent && { color: C.yellowText }]}>
        {value}{unit ? <Text style={styles.statUnit}> {unit}</Text> : null}
      </Text>
    </View>
  );
}
function SectionLabel({ children }: { children: ReactNode }) {
  return <Text style={styles.section}>{children}</Text>;
}

// In-card eyebrow header (Apple-Weather: SF Symbol + uppercase label at the top
// of the box, no chevron). Tappable variants open a detail sheet.
function CardHead({ icon, label, onPress }: { icon: string; label: string; onPress?: () => void }) {
  const inner = (
    <View style={styles.cardHeadRow}>
      <SymbolView name={icon as never} size={13} tintColor={C.mute} resizeMode="scaleAspectFit" />
      <Text style={styles.cardHeadLab}>{label}</Text>
    </View>
  );
  return onPress
    ? <Pressable onPress={onPress} hitSlop={6} style={styles.cardHeadWrap}>{inner}</Pressable>
    : <View style={styles.cardHeadWrap}>{inner}</View>;
}

// ── Apple-Weather-style detail sheet (tap a tile → slide-up grouped breakdown) ─
function DetailSheet({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: ReactNode }) {
  // Native iOS page sheet: insets from the top (dimmed parent + status bar show
  // above it) with rounded top corners — matching Apple Weather's detail modal.
  const rm = useReduceMotion();
  return (
    <Modal visible={visible} animationType={rm ? 'fade' : 'slide'} onRequestClose={onClose} presentationStyle="pageSheet">
      <View style={styles.fullWrap}>
        <SheetHeader onClose={onClose} title={title} style={styles.sessionSheetHeader} />
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.fullScroll}>
          <View style={{ width: IW }}>{children}</View>
        </ScrollView>
      </View>
    </Modal>
  );
}
/**
 * Panel — the one reusable container for full-screen detail content (Apple
 * Weather grouped-card pattern): a lifted, rounded surface, with an optional
 * eyebrow (SF Symbol + uppercase label) at the top.
 */
function Panel({ icon, label, children }: { icon?: string; label?: string; children: ReactNode }) {
  return (
    <View style={styles.panel}>
      {label ? (
        <View style={styles.panelHead}>
          {icon ? <SymbolView name={icon as never} size={12} tintColor={C.faint} resizeMode="scaleAspectFit" /> : null}
          <Text style={styles.panelLab}>{label}</Text>
        </View>
      ) : null}
      {children}
    </View>
  );
}
function Metric({ label, value, unit, sub }: { label: string; value: string; unit?: string; sub?: boolean }) {
  return (
    <View style={styles.sgCell}>
      <Text style={styles.sgLab}>{label}</Text>
      <Text style={sub ? styles.sgValSub : styles.sgVal}>
        {value}{unit ? <Text style={sub ? styles.sgUnitSub : styles.sgUnit}> {unit}</Text> : null}
      </Text>
    </View>
  );
}

// ── pure helpers ─────────────────────────────────────────────────────────────
type Pt = { px: number; py: number } | null;
function yAt(y: number, dom: [number, number], h: number, invert: boolean) {
  let n = (y - dom[0]) / (dom[1] - dom[0] || 1);
  n = Math.max(0, Math.min(1, n)); // clamp: capped outliers ride the edge
  if (invert) n = 1 - n;
  return n * h;
}
/** Moving-average smooth over a (number|null)[] series, preserving null gaps. */
function smooth(vals: (number | null)[], win: number): (number | null)[] {
  const half = Math.floor(win / 2);
  return vals.map((v, i) => {
    if (v == null) return null;
    let sum = 0, c = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(vals.length - 1, i + half); j++) {
      const w = vals[j];
      if (w != null) { sum += w; c++; }
    }
    return c ? sum / c : v;
  });
}
/** p in [0,1] over an ascending-sorted array. */
function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[idx]!;
}
/** Smoothed cumulative elevation gain in feet (null when no alt). */
function elevGainFt(streams: RunStreams): number | null {
  const alt = streams.alt;
  if (!alt || alt.length < 2) return null;
  const raw = alt.map((a) => a ?? 0);
  const vals = smooth(raw, 21).map((v, i) => v ?? raw[i]!);
  let gain = 0;
  for (let i = 1; i < vals.length; i++) { const dd = vals[i]! - vals[i - 1]!; if (dd > 0) gain += dd; }
  return Math.round(gain * 3.28084);
}

/** Richer elevation breakdown: total up/down (ft), longest continuous climb
 * (mi), max + avg climbing grade (%). Smoothed alt to tame GPS noise. */
function elevStats(streams: RunStreams): { gain: number; loss: number; longestMi: number; maxGrade: number; avgGrade: number } | null {
  const alt = streams.alt, d = streams.d;
  if (!alt || alt.length < 2 || !d) return null;
  const n = Math.min(alt.length, d.length);
  const raw = alt.slice(0, n).map((a) => a ?? 0);
  const vals = smooth(raw, 21).map((v, i) => v ?? raw[i]!);
  let gainM = 0, lossM = 0, maxGrade = 0, climbDist = 0, climbRise = 0;
  let climbStartD: number | null = null, longestM = 0;
  for (let i = 1; i < n; i++) {
    const dAlt = vals[i]! - vals[i - 1]!;
    const dDist = (d[i] ?? 0) - (d[i - 1] ?? 0);
    if (dAlt > 0) {
      gainM += dAlt;
      climbDist += dDist; climbRise += dAlt;
      if (climbStartD == null) climbStartD = d[i - 1] ?? 0;
      if (dDist > 1) { const g = (dAlt / dDist) * 100; if (g > maxGrade) maxGrade = g; }
    } else {
      lossM += -dAlt;
      if (climbStartD != null) { longestM = Math.max(longestM, (d[i - 1] ?? 0) - climbStartD); climbStartD = null; }
    }
  }
  if (climbStartD != null) longestM = Math.max(longestM, (d[n - 1] ?? 0) - climbStartD);
  return {
    gain: Math.round(gainM * 3.28084),
    loss: Math.round(lossM * 3.28084),
    longestMi: longestM / METERS_PER_MILE,
    maxGrade: Math.min(maxGrade, 40), // cap absurd single-sample GPS spikes
    avgGrade: climbDist > 0 ? (climbRise / climbDist) * 100 : 0,
  };
}
function project(points: { x: number; y: number | null }[], xDom: [number, number], yDom: [number, number], w: number, h: number, invert: boolean): Pt[] {
  return points.map((p) => {
    if (p.y == null) return null;
    const px = ((p.x - xDom[0]) / (xDom[1] - xDom[0] || 1)) * w;
    return { px, py: yAt(p.y, yDom, h, invert) };
  });
}
function segments(proj: Pt[]): { px: number; py: number }[][] {
  const segs: { px: number; py: number }[][] = [];
  let cur: { px: number; py: number }[] = [];
  for (const pt of proj) {
    if (pt) cur.push(pt);
    else { if (cur.length > 1) segs.push(cur); cur = []; }
  }
  if (cur.length > 1) segs.push(cur);
  return segs;
}
function lineD(seg: { px: number; py: number }[]) {
  return seg.map((p, i) => `${i ? 'L' : 'M'}${p.px.toFixed(1)} ${p.py.toFixed(1)}`).join(' ');
}
/** Smooth a derived envelope without smoothing raw workout samples. Quadratic
 * midpoints remove the angular "paint polyline" look while preserving every
 * pace-curve waypoint. */
function smoothLineD(seg: { px: number; py: number }[]) {
  if (seg.length < 3) return lineD(seg);
  let path = `M${seg[0]!.px.toFixed(1)} ${seg[0]!.py.toFixed(1)}`;
  for (let i = 1; i < seg.length - 1; i++) {
    const point = seg[i]!;
    const next = seg[i + 1]!;
    const midX = (point.px + next.px) / 2;
    const midY = (point.py + next.py) / 2;
    path += ` Q${point.px.toFixed(1)} ${point.py.toFixed(1)} ${midX.toFixed(1)} ${midY.toFixed(1)}`;
  }
  const last = seg[seg.length - 1]!;
  return `${path} L${last.px.toFixed(1)} ${last.py.toFixed(1)}`;
}
function areaD(seg: { px: number; py: number }[], h: number) {
  const f = seg[0]!, l = seg[seg.length - 1]!;
  return `${lineD(seg)} L${l.px.toFixed(1)} ${h} L${f.px.toFixed(1)} ${h} Z`;
}
function smoothAreaD(seg: { px: number; py: number }[], h: number) {
  if (seg.length === 0) return '';
  const first = seg[0]!, last = seg[seg.length - 1]!;
  return `${smoothLineD(seg)} L${last.px.toFixed(1)} ${h} L${first.px.toFixed(1)} ${h} Z`;
}
function routePath(route: [number, number][], w: number, h: number, pad: number) {
  if (!route || route.length < 2) return null;
  const meanLat = route.reduce((a, p) => a + p[0], 0) / route.length;
  const cos = Math.cos((meanLat * Math.PI) / 180) || 1;
  const pts = route.map(([la, ln]) => ({ x: ln * cos, y: la }));
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of pts) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
  const sx = maxX - minX || 1, sy = maxY - minY || 1;
  const sc = Math.min((w - 2 * pad) / sx, (h - 2 * pad) / sy);
  const dw = sx * sc, dh = sy * sc, ox = pad + (w - 2 * pad - dw) / 2, oy = pad + (h - 2 * pad - dh) / 2;
  const scr = pts.map((p) => ({ px: ox + (p.x - minX) * sc, py: oy + (maxY - p.y) * sc }));
  return { d: scr.map((p, i) => `${i ? 'L' : 'M'}${p.px.toFixed(1)} ${p.py.toFixed(1)}`).join(' '), end: scr[scr.length - 1]! };
}
/** Full projected route: every screen point + start/end (for pins, markers).
 * `insetTop` reserves extra space at the top (so a hero trace clears the nav). */
function routeGeom(route: [number, number][], w: number, h: number, pad: number, insetTop = pad, insetBottom = pad) {
  if (!route || route.length < 2) return null;
  const meanLat = route.reduce((a, p) => a + p[0], 0) / route.length;
  const cos = Math.cos((meanLat * Math.PI) / 180) || 1;
  const pts = route.map(([la, ln]) => ({ x: ln * cos, y: la }));
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of pts) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
  const sx = maxX - minX || 1, sy = maxY - minY || 1;
  const availH = h - insetTop - insetBottom;
  const sc = Math.min((w - 2 * pad) / sx, availH / sy);
  const dw = sx * sc, dh = sy * sc, ox = pad + (w - 2 * pad - dw) / 2, oy = insetTop + (availH - dh) / 2;
  const scr = pts.map((p) => ({ px: ox + (p.x - minX) * sc, py: oy + (maxY - p.y) * sc }));
  return { pts: scr, start: scr[0]!, end: scr[scr.length - 1]!, cx: ox + dw / 2, cy: oy + dh / 2 };
}
/** The 5th/95th-percentile smoothed pace (sec/mi) over the run — the fast/slow
 * anchors that drive the pace-heat ramp. Shared by the route coloring and the
 * map legend so the legend's end labels are the exact colors on the trace. */
function paceExtents(streams: RunStreams): { fast: number; slow: number; sm: (number | null)[]; clean: number[] } | null {
  const { v } = streams;
  const paceRaw = v.map((vi) => (vi != null && vi > 0.3 ? METERS_PER_MILE / vi : null));
  const sm = smooth(paceRaw, 15);
  const clean = sm.filter((x): x is number => x != null);
  if (clean.length < 2) return null;
  const sorted = [...clean].sort((a, b) => a - b);
  return { fast: percentile(sorted, 0.05), slow: percentile(sorted, 0.95), sm, clean };
}
/** Per-route-point pace norm (0 slow … 1 fast), approximating each point's
 * position by its even-distance fraction along the run, then sampling stream
 * pace there. Approximate (the polyline is downsampled) but visually faithful. */
function routePaceNorms(route: [number, number][], streams: RunStreams): number[] | null {
  const { d, v } = streams;
  const n = Math.min(d.length, v.length);
  if (n < 3 || route.length < 2) return null;
  const totalD = (d[n - 1] ?? 0) - (d[0] ?? 0);
  if (totalD <= 0) return null;
  const ext = paceExtents(streams);
  if (!ext) return null;
  const { fast, slow, sm, clean } = ext;
  const N = route.length;
  let j = 0;
  return route.map((_, i) => {
    const td = (d[0] ?? 0) + (i / (N - 1)) * totalD;
    while (j < n - 1 && (d[j] ?? 0) < td) j++;
    const p = sm[j] ?? clean[Math.floor(clean.length / 2)]!;
    return slow > fast ? clamp((slow - p) / (slow - fast), 0, 1) : 0.5;
  });
}
export function computeZones(streams: RunStreams, hrMax: number) {
  const cleaned = cleanHeartRate(streams);
  const hr = cleaned?.values ?? [], t = streams.t, n = Math.min(hr.length, t.length);
  const palette = [C.z1, C.z2, C.z3, C.z4, C.z5];
  // Keep physiology claims out of an estimated max-HR model. Personalized
  // labels can return once the runner owns explicit zone boundaries.
  const names = ['Z1', 'Z2', 'Z3', 'Z4', 'Z5'];
  const v = streams.v;
  const sec = [0, 0, 0, 0, 0];
  const hrSum = [0, 0, 0, 0, 0], hrWeight = [0, 0, 0, 0, 0];
  const paceSum = [0, 0, 0, 0, 0], paceWeight = [0, 0, 0, 0, 0];
  for (let i = 1; i < n; i++) {
    const h = hr[i];
    if (h == null) continue;
    const dt = (t[i] ?? 0) - (t[i - 1] ?? 0);
    const vi = v?.[i];
    // Zone time is MOVING time with a valid HR sample. Auto-pause gaps used to
    // be charged wholesale to the first zone after the gap (up to 14 minutes
    // on a long run). A missing velocity lane may fall back to the bounded dt,
    // but an explicit stopped sample never counts.
    if (dt <= 0 || dt >= 20 || (vi != null && vi <= 0.5)) continue;
    const pct = h / hrMax;
    const z = pct < 0.6 ? 0 : pct < 0.7 ? 1 : pct < 0.8 ? 2 : pct < 0.9 ? 3 : 4;
    sec[z]! += dt;
    hrSum[z]! += h * dt; hrWeight[z]! += dt;
    if (vi != null && vi > 0.5) { paceSum[z]! += (METERS_PER_MILE / vi) * dt; paceWeight[z]! += dt; }
  }
  const total = sec.reduce((a, b) => a + b, 0) || 1;
  const bars = sec.map((sv, i) => ({ frac: sv, color: palette[i]! }));
  // bpm boundaries at 0/60/70/80/90/100% of HRmax → per-zone ranges.
  const b = [0, 0.6, 0.7, 0.8, 0.9, 1].map((f) => Math.round(f * hrMax));
  const rangeFor = (i: number) => (i === 0 ? `<${b[1]}` : i === 4 ? `${b[4]}+` : `${b[i]}–${b[i + 1]}`);
  // All five zones, in Z1→Z5 order (the meaningful reading), zeros included.
  const rows = sec.map((sv, i) => ({
    name: names[i]!,
    color: palette[i]!,
    sec: sv,
    pct: Math.round((sv / total) * 100),
    range: rangeFor(i),
    avgHr: hrWeight[i]! > 0 ? Math.round(hrSum[i]! / hrWeight[i]!) : null,
    avgPace: paceWeight[i]! > 0 ? paceSum[i]! / paceWeight[i]! : null,
  }));
  return { bars, rows };
}
const WD = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function longDate(d: string | null) {
  if (!d) return '';
  const dt = new Date(`${d}T12:00:00Z`);
  return `${WD[dt.getUTCDay()]}, ${MO[dt.getUTCMonth()]} ${dt.getUTCDate()}`;
}
function capWord(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function timeOfDay(startISO: string | null): string | null {
  if (!startISO) return null;
  const dt = new Date(startISO);
  if (Number.isNaN(dt.getTime())) return null;
  const h24 = (dt.getUTCHours() - 4 + 24) % 24; // prototype: EDT; real build uses start_date_local
  const m = dt.getUTCMinutes();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`;
}

const makeStyles = (C: Tokens) => StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  safe: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  err: { color: C.mute, fontSize: fontSizes.body },
  scroll: { paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.xxl },
  heroNum: { color: C.ink, fontSize: 60, fontWeight: '800', letterSpacing: -1.6, fontVariant: ['tabular-nums'] },
  heroUnit: { color: C.mute, fontSize: fontSizes.label, fontWeight: '700', marginLeft: space.sm, letterSpacing: 0.5 },
  sgRow: { flexDirection: 'row' },
  sgRow2: { marginTop: space.l, paddingTop: space.l, ...hairlineTop(C) },
  sgCell: { flex: 1, alignItems: 'center' },
  sgLab: { ...eyebrowText(C, 'micro'), marginBottom: space.s, textAlign: 'center' },
  sgVal: { color: C.ink, fontSize: 23, fontWeight: '800', letterSpacing: -0.4, fontVariant: ['tabular-nums'] },
  sgValSub: { ...statValueText(C, 'sectionTitle', 'system'), color: C.mute, fontWeight: '700' },
  sgUnit: { ...eyebrowText(C, 'labelSm'), },
  sgUnitSub: { ...eyebrowText(C, 'micro'), color: C.faint, },
  // Canvas, not a card: the banked-forward line is connective context between
  // the hero and the cards below it, so it takes space on the page rather than
  // a third surface (DESIGN.md, container vocabulary).
  weekLine: { flexDirection: 'row', gap: space.xxl, marginTop: space.lg, paddingHorizontal: space.xxs },
  statRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: space.l, ...hairlineTop(C) },
  statLabel: { ...eyebrowText(C, 'labelSm'), },
  statValue: { color: C.ink, fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'] },
  statUnit: { ...eyebrowText(C, 'labelSm'), },
  section: { color: C.ink, fontSize: fontSizes.labelLg, fontWeight: '700', letterSpacing: -0.1, marginTop: 28, marginBottom: space.md, marginLeft: space.xxs },
  chHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: space.md },
  // Both call sites tint this to the elevation accent, so the factory's C.mute
  // is only the fallback.
  chLab: { ...eyebrowText(C, 'labelSm') },
  chVal: { color: C.ink, fontSize: fontSizes.sectionTitle, fontWeight: '800', marginTop: 3, fontVariant: ['tabular-nums'] },
  chUnit: { ...eyebrowText(C, 'labelSm'), },
  rangeCallout: { position: 'absolute', top: 2, width: 160, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.card, borderColor: C.line, borderWidth: 1, borderRadius: 10, paddingVertical: space.sm, paddingHorizontal: space.m },
  rcCell: { alignItems: 'center', flex: 1 },
  rcVal: { ...statValueText(C, 'labelLg', 'system'), fontWeight: '800' },
  rcLab: { color: C.faint, fontSize: fontSizes.micro, fontWeight: '600', marginTop: 1 },
  rcDiv: { width: StyleSheet.hairlineWidth, height: 22, backgroundColor: C.line },
  dragHint: { textAlign: 'center', color: C.faint, fontSize: fontSizes.labelSm, fontWeight: '500' },
  curveCap: { color: C.mute, fontSize: fontSizes.metadata, marginBottom: space.m },
  stickyMask: { backgroundColor: C.bg },
  // Sticky card-top (rounded top, all borders but bottom) + card-body (rounded
  // bottom, all borders but top). Together they read as one box whose top freezes.
  cardTop: { backgroundColor: C.card, borderColor: C.line, borderTopWidth: StyleSheet.hairlineWidth, borderLeftWidth: StyleSheet.hairlineWidth, borderRightWidth: StyleSheet.hairlineWidth, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, paddingHorizontal: space.lg, paddingTop: space.l, paddingBottom: space.md },
  cardBody: { backgroundColor: C.card, borderColor: C.line, borderLeftWidth: StyleSheet.hairlineWidth, borderRightWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomLeftRadius: radius.md, borderBottomRightRadius: radius.md, paddingHorizontal: space.lg, paddingBottom: space.lg, marginBottom: space.xl },
  cardTopPill: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomLeftRadius: radius.md, borderBottomRightRadius: radius.md },
  cardHeadWrap: { marginBottom: space.l },
  cardHeadRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  cardHeadLab: { ...eyebrowText(C, 'metadata') },
  plannedCard: { ...cardSurface(C), marginTop: space.xl, marginBottom: space.xl },
  plannedDurationRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginBottom: space.sm },
  plannedDuration: { ...statValueText(C, 'metadata', 'system'), color: C.faint, fontWeight: '600' },
  prescriptionBarWrap: { marginTop: space.lg, marginBottom: space.m },
  prescriptionRows: { marginTop: space.xs },
  prescriptionRow: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: space.s },
  prescriptionRowBorder: { ...hairlineTop(C) },
  prescriptionDot: { width: 5, height: 5, borderRadius: 3, flexShrink: 0 },
  prescriptionLine: { flex: 1, color: C.mute, fontSize: fontSizes.label, lineHeight: 18, fontWeight: '600' },
  prescriptionLineStrong: { color: C.ink, fontWeight: '700' },
  prescriptionTarget: { ...statValueText(C, 'labelSm', 'system'), color: C.mute, fontWeight: '600' },
  plannedNote: { marginTop: space.lg, paddingTop: space.lg, ...hairlineTop(C) },
  workoutRouteSection: { marginBottom: space.xl },
  workoutRouteCard: { ...cardSurface(C), overflow: 'hidden' },
  routeCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.md },
  workoutRouteTitle: { color: C.ink, fontSize: fontSizes.sectionTitle, fontWeight: '800', letterSpacing: -0.2 },
  privateLabel: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  privateText: { color: C.faint, fontSize: fontSizes.labelSm, fontWeight: '600' },
  workoutRouteState: { minHeight: 126, alignItems: 'center', justifyContent: 'center' },
  workoutRouteStateTitle: { color: C.ink, fontSize: fontSizes.labelLg, fontWeight: '700' },
  routeRetry: { minHeight: 44, justifyContent: 'center', paddingHorizontal: space.lg, marginTop: space.sm },
  routeRetryText: { color: C.mute, fontSize: fontSizes.label, fontWeight: '800' },
  attachedRoute: { ...cardSurface(C), overflow: 'hidden' },
  attachedRouteFooter: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingTop: space.md },
  attachedRouteCopy: { flex: 1, minWidth: 0 },
  attachedRouteName: { color: C.ink, fontSize: fontSizes.body, fontWeight: '800' },
  attachedRouteMeta: { color: C.mute, fontFamily: dataRegular, fontSize: fontSizes.micro, marginTop: space.xs },
  attachedRouteMetaOff: { color: C.warningText },
  attachedRouteActions: { flexDirection: 'row', alignItems: 'center' },
  changeRoute: { minHeight: 44, justifyContent: 'center', paddingHorizontal: space.md },
  changeRouteText: { color: C.ink, fontSize: fontSizes.label, fontWeight: '800' },
  routeMore: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  routeActionDisabled: { opacity: 0.45 },
  readOnlyRouteLabel: { ...eyebrowText(C, 'labelSm'), color: C.faint, },
  routePressed: { opacity: 0.68 },
  emptyRoute: { ...cardSurface(C), overflow: 'hidden' },
  emptyRouteMap: { height: 144, position: 'relative', alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, backgroundColor: C.recess, borderWidth: StyleSheet.hairlineWidth, borderColor: C.line, overflow: 'hidden' },
  emptyRouteCopy: { paddingTop: space.lg, paddingBottom: space.md },
  emptyRouteTitle: { color: C.ink, fontSize: fontSizes.body, fontWeight: '800' },
  emptyRouteBody: { color: C.mute, fontSize: fontSizes.label, lineHeight: 18, marginTop: space.xs },
  planRouteButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  // A section rule needs to sit BETWEEN two blocks, not clamped to the one
  // below it. This was 14 above / 4 below, so "Sustained block" crowded the
  // hairline while the metrics above it breathed — the asymmetry read as a
  // layout bug. Section headings want at least as much room above as below
  // them, so the rule is symmetric and both values are tokens (raw 14/4 also
  // broke the spacing-scale discipline in DESIGN.md). The rule itself is a
  // <Divider>; this carries only the spacing around it.
  tileDiv: { marginTop: space.l, marginBottom: space.l },
  fullWrap: { flex: 1, backgroundColor: C.card }, // lifted vs the page bg so the sheet reads as a separate surface
  sessionSheetHeader: { paddingTop: space.xl, paddingBottom: space.lg, ...hairlineBottom(C) },
  // Match the tile's effective inset (scroll 18 + card 16) so the fixed-width
  // charts fill the content and the grids align — otherwise they read left-offset.
  fullScroll: { alignItems: 'center', paddingBottom: 40 }, // content is a fixed IW-wide column, centered — matches the inline card width
  // Reusable Panel container (lifted vs the sheet surface).
  panel: { backgroundColor: C.panel, borderRadius: 14, padding: space.lg, marginBottom: space.m },
  panelHead: { flexDirection: 'row', alignItems: 'center', gap: space.s, marginBottom: space.md },
  panelLab: { ...eyebrowText(C, 'labelSm'), color: C.faint, },
  slTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 22, marginBottom: space.md }, // fixed height = the × button, so the row never grows when it appears
  slReadout: { flex: 1 },
  slClear: { width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
  slClearX: { color: C.mute, fontSize: fontSizes.body, lineHeight: 17, fontWeight: '600' },
  slTopTxt: { ...statValueText(C, 'metadata', 'system'), color: C.mute, fontWeight: '600' },
  laneHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', height: LANE_HEAD },
  laneHeadL: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  laneLab: { ...eyebrowText(C, 'micro'), color: C.faint, },
  laneRange: { ...statValueText(C, 'micro', 'system'), color: C.faint, fontWeight: '600' },
  // The lane's own colour is passed at the call site, so C.ink is only the fallback.
  laneVal: { ...statValueText(C, 'labelLg', 'system'), fontWeight: '700' },
  laneAvg: { color: C.faint, fontSize: fontSizes.micro, fontWeight: '700', letterSpacing: 0.3 },
  slRange: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  slAvgTag: { color: C.bg, backgroundColor: C.paceFast, fontSize: fontSizes.micro, fontWeight: '800', letterSpacing: 0.6, paddingHorizontal: space.s, paddingVertical: 1, borderRadius: radius.xs, overflow: 'hidden' },
  slSpan: { ...statValueText(C, 'labelSm', 'system'), color: C.faint, fontWeight: '600' },
  beList: { marginTop: space.md, ...hairlineTop(C), paddingTop: space.md },
  beHead: { ...eyebrowText(C, 'labelSm'), color: C.faint, },
  beTableHead: { flexDirection: 'row', alignItems: 'center', paddingTop: space.sm, paddingBottom: space.s, ...hairlineBottom(C) },
  beLRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.sm },
  beLName: { flex: 1, color: C.mute, fontSize: fontSizes.label, fontWeight: '600' },
  beLTime: { ...statValueText(C, 'labelLg', 'system'), width: 78, textAlign: 'right', fontWeight: '700' },
  beLPace: { ...statValueText(C, 'label', 'system'), width: 84, textAlign: 'right', color: C.mute, fontWeight: '600' },
  beLUnit: { color: C.faint, fontSize: fontSizes.micro, fontWeight: '600' },
  pcLegend: { flexDirection: 'row', gap: space.lg, marginBottom: space.sm },
  pcKey: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  pcLine: { width: 16, height: 2, borderRadius: 1 },
  pcDots: { width: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pcDot: { width: 2.5, height: 2.5, borderRadius: 1.25 },
  pcKeyTxt: { color: C.mute, fontSize: fontSizes.labelSm, fontWeight: '600' },
  segTrack: { flexDirection: 'row', height: 32, borderRadius: 9, backgroundColor: 'rgba(255,255,255,0.06)', padding: space.xxs, position: 'relative' },
  segThumb: { position: 'absolute', top: 2, bottom: 2, left: 0, borderRadius: 7, backgroundColor: C.slate, shadowColor: '#000', shadowOpacity: 0.34, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } },
  segItem: { flex: 1, position: 'relative', alignItems: 'center', justifyContent: 'center' },
  segHit: { flex: 1, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
  segDiv: { position: 'absolute', left: 0, top: '26%', height: '48%', width: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.14)' },
  segTxt: { ...statValueText(C, 'label', 'system'), color: C.mute, fontWeight: '600' },
  segTxtOn: { color: C.ink, fontWeight: '700' },
  noteText: { color: C.mute, fontSize: fontSizes.labelLg, lineHeight: 21 },
  chips: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  // Exceptional states can still wrap on narrow widths, but calm runs now keep
  // auxiliary facts in the metadata line rather than manufacturing more pills.
  chipsWrap: { flexWrap: 'wrap' },
  chipG: { flexDirection: 'row', alignItems: 'center', gap: space.xs, backgroundColor: C.panel, borderColor: C.line, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.pill, paddingVertical: space.s, paddingHorizontal: space.md },
  heroMap: { width: SCREEN_W, height: 326, marginHorizontal: -18, marginTop: -8, marginBottom: space.s },
  pressDim: { opacity: 0.62 }, // tile/header press feedback
  pressBtn: { opacity: 0.5, transform: [{ scale: 0.9 }] }, // round icon-button press
  pressRow: { backgroundColor: C.fill }, // list-row press tint
  mapFull: { width: SCREEN_W, marginHorizontal: -34, marginTop: -6, marginBottom: space.l, position: 'relative' },
  mapLegendFloat: { position: 'absolute', left: 16, bottom: 14, flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: C.card, borderColor: C.line, borderWidth: StyleSheet.hairlineWidth, borderRadius: 9, paddingVertical: space.s, paddingHorizontal: space.m, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  mapLegVal: { ...statValueText(C, 'metadata', 'system'), fontWeight: '700' },
  mapLegUnit: { color: C.mute, fontSize: fontSizes.micro, fontWeight: '600' },
  elevCallout: { position: 'absolute', top: 0, width: 88, alignItems: 'center', backgroundColor: C.card, borderColor: C.line, borderWidth: 1, borderRadius: 9, paddingVertical: space.s },
  elevCalVal: { ...statValueText(C, 'label', 'system'), fontWeight: '800' },
  elevCalU: { color: C.mute, fontSize: fontSizes.micro, fontWeight: '700' },
  elevCalSub: { ...statValueText(C, 'micro', 'system'), color: C.faint, fontWeight: '600' },
  heroOverlay: { position: 'absolute', left: 20, right: 20, bottom: 11 },
  // Routeless (map-less) hero: a compact top-aligned header that sits in the
  // page gutter (no full-bleed box), nav row then identity directly below.
  heroCompact: { paddingBottom: space.xs },
  heroIdentity: { marginTop: space.lg },
  heroEy: { ...eyebrowText(C, 'labelSm'), letterSpacing: 1 },
  // The hero's context line above the date — same microcaps voice, one step
  // quieter, so weight/colour (not glyphs) separate the two reads.
  heroKick: { ...eyebrowText(C, 'micro'), color: C.faint, letterSpacing: 1 },
  heroMeta: { ...statValueText(C, 'labelSm', 'system'), color: C.mute, fontWeight: '600', marginTop: space.sm },
  // Detected-structure cells (one per rep group) — chip grammar, squared corners
  // so they read as data cells, not actions; quality stays violet.
  structRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  structCell: { backgroundColor: C.panel, borderColor: C.line, borderWidth: 1, borderRadius: radius.sm, paddingVertical: space.xs + 1, paddingHorizontal: space.sm },
  structTxt: { ...statValueText(C, 'metadata', 'system'), color: C.qualText, fontWeight: '700', letterSpacing: 0.2 },
  heroTitle: { color: C.ink, fontSize: 21, fontWeight: '700', marginTop: 3, letterSpacing: -0.2 },
  chipTxt: { ...statValueText(C, 'metadata', 'system'), fontWeight: '700' },
  qTop: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.l },
  qTitle: { color: C.ink, fontSize: fontSizes.labelLg, fontWeight: '700' },
  qSub: { color: C.mute, fontSize: fontSizes.micro, fontWeight: '700', letterSpacing: 0.5, marginTop: 1 },
  struct: { flexDirection: 'row', height: 32, borderRadius: radius.sm, overflow: 'hidden', gap: space.xxs, marginBottom: space.md },
  seg: { alignItems: 'center', justifyContent: 'center' },
  segMute: { color: C.mute, fontSize: fontSizes.micro, fontWeight: '700' },
  segDark: { ...statValueText(C, 'micro', 'system'), color: C.accentInk, fontWeight: '800' },
  qCap: { color: C.mute, fontSize: fontSizes.metadata, lineHeight: 18 },
  iaAvg: { color: C.ink, fontSize: fontSizes.sectionTitle, fontWeight: '800', fontVariant: ['tabular-nums'] },
  iaAvgU: { ...eyebrowText(C, 'labelSm'), },
  iaSpread: { ...statValueText(C, 'labelSm', 'system'), color: C.mute, fontWeight: '600', marginTop: 3 },
  progHead: { flexDirection: 'row', alignItems: 'center', gap: space.m, marginBottom: space.sm },
  progHeadCell: { color: C.faint, fontSize: fontSizes.micro, fontWeight: '800', letterSpacing: 0.6 },
  progRows: { gap: space.s, marginBottom: space.md },
  progRow: { flexDirection: 'row', alignItems: 'center', gap: space.m },
  progMi: { ...statValueText(C, 'metadata', 'system'), color: C.faint, fontWeight: '700', width: 36 },
  progPace: { ...statValueText(C, 'metadata', 'system'), fontWeight: '700', width: 42 },
  progTrack: { flex: 1, height: 15, borderRadius: 5, backgroundColor: C.fill, overflow: 'hidden', justifyContent: 'center', position: 'relative' },
  progFill: { height: '100%', borderRadius: 5 },
  progAvg: { position: 'absolute', top: 0, bottom: 0, width: 1, borderLeftWidth: 1, borderColor: C.faint, borderStyle: 'dashed' }, // theme-aware: was hardcoded white-alpha (invisible on light)
  progHr: { ...statValueText(C, 'metadata', 'system'), color: C.mute, fontWeight: '700', width: 30, textAlign: 'right' },
  interp: { marginTop: space.md, paddingTop: space.md, ...hairlineTop(C) },
  interpHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  interpLabel: { ...eyebrowText(C, 'micro'), },
  interpAuto: { color: C.yellowText, fontSize: fontSizes.metadata, fontWeight: '800' },
  // Single-select list of interpretations. Rows are separated by proximity and
  // a selected fill rather than a box each — nested cards inside the session
  // card would add a third frame around one short list.
  interpList: { marginTop: space.sm, gap: space.xxs },
  interpOpt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 44, // touch target, independent of the row's visual height
    paddingVertical: space.s,
    paddingHorizontal: space.sm,
    borderRadius: radius.sm,
  },
  interpOptOn: { backgroundColor: C.fill },
  interpDot: {
    width: 10,
    height: 10,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: C.faint,
    backgroundColor: 'transparent',
  },
  interpDotOn: { borderColor: C.yellow, backgroundColor: C.yellow },
  // Quality violet carries the credited structure, matching the detected-cell
  // grammar above; tabular numerals so paces line up row to row.
  interpOptTxt: { ...statValueText(C, 'labelLg', 'system'), flex: 1, color: C.qualText, fontWeight: '700', letterSpacing: -0.1 },
  interpOptTxtOn: { fontWeight: '800' },
  // "Not a workout" credits nothing, so it does not wear the quality colour.
  interpOptTxtMuted: { color: C.mute, fontWeight: '700' },
  interpOptNote: { ...eyebrowText(C, 'micro'), color: C.faint, },
  progLegend: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.xs },
  progLegendDash: { width: 13, height: 1, borderTopWidth: 1, borderColor: C.faint, borderStyle: 'dashed' },
  progLegendTxt: { color: C.faint, fontSize: fontSizes.micro, fontWeight: '600' },
  pcChips: { flexDirection: 'row', minHeight: 44, ...hairlineBottom(C) },
  pcChip: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  pcChipOn: { borderBottomColor: C.yellow },
  pcChipTxt: { color: C.mute, fontSize: fontSizes.metadata, fontWeight: '700' },
  pcChipTxtOn: { color: C.ink },
  pcCustom: { marginTop: space.sm, gap: space.s },
  stepRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, paddingLeft: space.md, borderRadius: radius.sm, backgroundColor: C.fill },
  stepLab: { ...eyebrowText(C, 'labelSm'), color: C.faint, },
  stepCtrl: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  stepBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  stepVal: { ...statValueText(C, 'label', 'system'), fontWeight: '700', minWidth: 76, textAlign: 'center' },
  ledRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.m, paddingHorizontal: space.s, borderRadius: radius.sm, ...hairlineTop(C) },
  ledHead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.s, paddingBottom: space.sm },
  ledNum: { ...statValueText(C, 'label', 'system'), width: 22, color: C.mute, fontWeight: '700' },
  ledTime: { ...statValueText(C, 'label', 'system'), width: 54, color: C.mute, fontWeight: '600' },
  ledDist: { ...statValueText(C, 'label', 'system'), width: 64, color: C.mute, fontWeight: '600' },
  qSummary: { marginTop: space.l },
  ledBar: { flex: 1, height: 7, borderRadius: radius.xs, backgroundColor: 'rgba(255,255,255,0.07)', overflow: 'hidden', marginRight: space.m },
  ledPace: { ...statValueText(C, 'labelLg', 'system'), width: 78, textAlign: 'right', fontWeight: '700' },
  ledUnit: { color: C.mute, fontSize: fontSizes.micro, fontWeight: '700' },
  ledHr: { ...statValueText(C, 'metadata', 'system'), width: 44, textAlign: 'right', color: C.mute },
  zMaxRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  zMaxLab: { color: C.faint, fontSize: fontSizes.micro, fontWeight: '700', letterSpacing: 0.6 },
  zMaxVal: { ...statValueText(C, 'label', 'system'), color: C.mute, fontWeight: '800' },
  zMaxUnit: { color: C.faint, fontSize: fontSizes.micro, fontWeight: '700' },
  zBar: { flexDirection: 'row', height: 9, borderRadius: 5, overflow: 'hidden', marginBottom: space.sm },
  zHead: { flexDirection: 'row', alignItems: 'center', paddingBottom: space.s, ...hairlineBottom(C), marginBottom: space.xxs },
  zRow: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
  zName: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flex: 1 },
  zNameTxt: { color: C.mute, fontSize: fontSizes.metadata, fontWeight: '600' },
  zPct: { ...statValueText(C, 'label', 'system'), width: 42, textAlign: 'right', fontWeight: '700' },
  zRangeCol: { ...statValueText(C, 'labelSm', 'system'), width: 64, textAlign: 'right', color: C.faint, fontWeight: '600' },
  zOpenWrap: { borderRadius: radius.md, marginVertical: space.xxs, marginHorizontal: -11, paddingHorizontal: space.md },
  // The rule's WIDTH is the shared hairline decision; its COLOUR is the zone's
  // own tint, applied at the call site, so C.line here is only the fallback.
  zExpand: { flexDirection: 'row', paddingTop: space.md, paddingBottom: space.s, paddingLeft: space.lg, ...hairlineTop(C) },
  zeCell: { flex: 1 },
  zeLab: { ...eyebrowText(C, 'micro'), marginBottom: space.xs },
  zeVal: { ...statValueText(C, 'labelLg', 'system'), fontWeight: '700' },
  swatch: { width: 9, height: 9, borderRadius: 2 },
  zDur: { ...statValueText(C, 'metadata', 'system'), width: 52, textAlign: 'right', color: C.mute, fontWeight: '600' },
  hrOverviewRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: space.md },
  hrOverviewLabel: { ...eyebrowText(C, 'micro'), color: C.faint, },
  hrOverviewValue: { color: C.ink, fontSize: fontSizes.sectionTitle, fontWeight: '800', marginTop: space.xs, fontVariant: ['tabular-nums'] },
  hrOverviewMeta: { ...statValueText(C, 'metadata', 'system'), color: C.mute, fontWeight: '600' },
  splitOverviewFrame: { height: 102, flexDirection: 'row', alignItems: 'stretch', gap: space.sm, paddingTop: space.sm },
  splitOverviewGraph: { flex: 1, height: 94, flexDirection: 'row', alignItems: 'flex-end', gap: space.xxs, position: 'relative' },
  splitOverviewBaseline: { position: 'absolute', left: 0, right: 0, bottom: 0, height: StyleSheet.hairlineWidth, backgroundColor: C.line },
  splitOverviewSlot: { flex: 1, height: 94, justifyContent: 'flex-end' },
  splitOverviewBar: { width: '100%', minWidth: 2, borderTopLeftRadius: radius.xs, borderTopRightRadius: radius.xs },
  splitOverviewScale: { width: 42, justifyContent: 'space-between', alignItems: 'flex-end' },
  splitOverviewScaleEnd: { alignItems: 'flex-end' },
  splitOverviewScaleLabel: { color: C.faint, fontSize: fontSizes.micro, fontWeight: '700', letterSpacing: 0.4 },
  splitOverviewScaleValue: { ...statValueText(C, 'micro', 'system'), color: C.mute, fontWeight: '700', marginTop: 1 },
  splitOverviewTicks: { flexDirection: 'row', marginRight: 42 + space.sm, marginTop: space.xxs },
  splitOverviewTickSlot: { flex: 1, alignItems: 'center' },
  splitOverviewTick: { ...statValueText(C, 'micro', 'system'), color: C.faint, fontWeight: '600' },
  splitOverviewMeta: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: space.sm },
  splitOverviewCount: { color: C.mute, fontSize: fontSizes.metadata, fontWeight: '700' },
  splitOverviewRange: { ...statValueText(C, 'label', 'system'), fontWeight: '700' },
  splitOverviewUnit: { color: C.faint, fontSize: fontSizes.micro, fontWeight: '600' },
  singleSplitOverview: { minHeight: 92, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  singleSplitLabel: { ...eyebrowText(C, 'metadata'), },
  singleSplitDistance: { ...statValueText(C, 'metadata', 'system'), color: C.faint, fontWeight: '600', marginTop: space.xs },
  singleSplitPace: { color: C.ink, fontSize: 24, fontWeight: '800', letterSpacing: -0.35, fontVariant: ['tabular-nums'] },
  singleSplitUnit: { color: C.mute, fontSize: fontSizes.metadata, fontWeight: '700' },
  split: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm },
  splitMi: { ...statValueText(C, 'label', 'system'), width: 22, color: C.mute, fontWeight: '700' },
  splitPaceRail: { flex: 1, height: 18, position: 'relative', justifyContent: 'center' },
  splitPaceRailLine: { position: 'absolute', left: 0, right: 0, top: 9, height: StyleSheet.hairlineWidth, backgroundColor: C.line },
  splitPaceRailMid: { position: 'absolute', left: '50%', top: 6, width: StyleSheet.hairlineWidth, height: 7, backgroundColor: C.faint, opacity: 0.38 },
  splitPaceTick: { position: 'absolute', top: 2, width: 2, height: 14, marginLeft: -1, borderRadius: 1 },
  splitPaceHead: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  splitPaceHeadTxt: { color: C.faint, fontSize: fontSizes.micro, fontWeight: '700', letterSpacing: 0.35 },
  splitPace: { ...statValueText(C, 'label', 'system'), width: 52, textAlign: 'right', fontWeight: '700' },
  splitElev: { ...statValueText(C, 'metadata', 'system'), width: 44, textAlign: 'right', color: C.faint },
  splitDist: { ...statValueText(C, 'metadata', 'system'), width: 56, textAlign: 'right', color: C.mute, fontWeight: '600' },
  splitHr: { ...statValueText(C, 'metadata', 'system'), width: 36, textAlign: 'right', color: C.mute },
  tableHead: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingTop: space.sm, paddingBottom: space.s, ...hairlineBottom(C) },
  tableHeadTxt: { ...eyebrowText(C, 'micro'), color: C.faint, },
  // ── PlanMatchBand + RepTable ─────────────────────────────────────────────────
  pmUnit: { fontSize: fontSizes.labelSm, color: C.faint },
  pmPlabel: { width: 62, fontSize: fontSizes.micro, letterSpacing: 1, color: C.faint, fontWeight: '600' },
  pmTable: { marginTop: space.xs, paddingTop: space.xxs },
  pmThead: { flexDirection: 'row', alignItems: 'center', paddingTop: space.m, paddingBottom: space.s, ...hairlineBottom(C) },
  pmTh: { ...eyebrowText(C, 'micro'), color: C.faint, },
  // Axis ends for the deviation chart — one step quieter than a column header,
  // since they name a direction rather than title a column of values.
  pmAxis: { ...eyebrowText(C, 'micro'), color: C.faint, opacity: 0.75 },
  pmSetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: space.md, ...hairlineTop(C), ...hairlineBottom(C) },
  pmSetTitle: statValueText(C, 'metadata', 'dataRegular'),
  pmSetLabel: { color: C.faint },
  pmSetTarget: { ...statValueText(C, 'labelSm', 'dataRegular'), color: C.mute },
  pmNote: { fontSize: fontSizes.body, lineHeight: 21, fontWeight: '500', color: C.ink },
  pmHr: { color: C.mute },
  pmTrow: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
  pmTrowRule: { ...hairlineTop(C) },
  pmTrowSel: { backgroundColor: C.fill, borderRadius: radius.sm },
  pmTd: statValueText(C, 'label', 'dataRegular'),
  pmRepNum: { color: C.faint },
  pmDelta: { ...statValueText(C, 'metadata', 'dataRegular'), color: C.mute, textAlign: 'right' },
  pmDistHead: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  pmDistRun: { fontSize: 30, fontWeight: '800', color: C.ink, letterSpacing: -0.5, fontVariant: ['tabular-nums'] },
  pmDistUnit: { fontSize: fontSizes.labelLg, color: C.faint, fontWeight: '600' },
  pmDistPlan: { ...statValueText(C, 'labelLg', 'system'), color: C.faint },
  pmProgTrack: { height: 8, borderRadius: radius.xs, backgroundColor: C.fill, overflow: 'hidden', marginTop: space.md },
  pmProgFill: { height: 8, borderRadius: radius.xs },
  pmDistFoot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: space.m },
  // Tinted to the deviation accent at the call site; C.ink never renders here.
  pmDistDelta: { ...statValueText(C, 'labelLg', 'system'), fontWeight: '700' },
  zoomHint: { fontSize: fontSizes.micro, color: C.faint, fontWeight: '600', textAlign: 'right', marginTop: space.sm },
});
let styles = makeStyles(C);
