/**
 * DayPanel — the workout panel that sits below the CalendarTabs strip for the
 * selected day. Generalises the WorkoutRow in app/(tabs)/index.tsx to any
 * CalendarDay (not just today), using `day.primary` directly (tone is already
 * computed on the model — we do NOT re-run workoutTone here).
 *
 * Visual spec: docs/mockups/calendar-tab.html  .panel / .wrow / .eyebrow /
 *   .restday / .cta
 */

import React from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SymbolView } from 'expo-symbols';

import { useAppPreferences, type DistancePreference } from '@/app-lib/preferences';
import { rgba } from '@/components/charts/color';
import { Divider, hairlineTop } from '@/components/ui/Divider';
import { eyebrowText } from '@/components/ui/Eyebrow';
import { statValueText } from '@/components/ui/Stat';
import { useTheme, useThemedStyles } from '@/theme/ThemeProvider';
import { toneColorOr } from '@/theme/tone';
import { display, fontSizes, radius, space, usesAccessibilityTextLayout, type Tokens } from '@/theme/tokens';
import type { CalendarDay, WorkoutTone } from '@/lib';
import {
  dominantWorkLabel,
  estimateWorkoutDurationSec,
  formatDurationApprox,
  metersToUnits,
  prescribedQualityMeters,
  structureBarSegments,
  structureLines,
} from '@/lib';
import { ActualBar, PrescriptionBar } from '@/components/StructureBar';
import { ActionButton, ActionButtonLabel } from '@/components/ActionButton';
import { DueGlyphTile } from '@/components/brand';
import { WorkoutRow } from './WorkoutRow';

const SEMANTIC_TEXT_SCALE = 2;
const DAY_SUBSTITUTION_TOLERANCE_METERS = 161;

// ── Tone helpers ──────────────────────────────────────────────────────────────

const TONE_WORD: Record<WorkoutTone, string> = {
  easy: 'Easy',
  long: 'Long',
  quality: 'Quality',
  speed: 'Speed',
};

const TONE_ICON = {
  easy: 'figure.run',
  long: 'mountain.2.fill',
  quality: 'bolt.fill',
  speed: 'stopwatch.fill',
} as const satisfies Record<WorkoutTone, string>;

/**
 * The day panel's type wash, derived from the tone's OWN semantic colour.
 *
 * It used to blend a second stop out of the `plan*` art palette (planWarm /
 * planViolet), which tokens.ts reserves for generated plan covers — "they never
 * encode contract state or workout type" — and to map `speed` to `C.pink`,
 * the danger colour, where `tone.ts` maps quality and speed alike to violet.
 * So the wash both borrowed identity paint to say "type" and disagreed with the
 * canonical map about what speed looks like.
 *
 * One hue per tone now, fading out through its own lighter stop: the gradient
 * carries no meaning the tone colour does not already carry.
 */
function workoutGradient(tone: WorkoutTone, C: Tokens): readonly [string, string, string] {
  const hue = toneColorOr(C, tone, C.mute);
  return [
    rgba(hue, 0.16),
    rgba(hue, 0.075),
    rgba(C.card, 0),
  ];
}

const distance1 = (m: number, units: DistancePreference) => metersToUnits(m, units).toFixed(1);

// ── Logged-activity row helpers ───────────────────────────────────────────────

/**
 * Time-of-day bucket from an activity's start instant. Civil hour = UTC shifted
 * to the runner's local zone (EDT baseline, matching SessionView's `timeOfDay`
 * until `start_date_local` is plumbed app-wide). Deterministic (UTC-based), so
 * a double/triple reads "Morning / Afternoon / Evening / Night".
 */
function timeOfDayLabel(startDate: string | null): string {
  if (!startDate) return 'Run';
  const dt = new Date(startDate);
  if (Number.isNaN(dt.getTime())) return 'Run';
  const h = (dt.getUTCHours() - 4 + 24) % 24;
  if (h < 12) return 'Morning';
  if (h < 17) return 'Afternoon';
  if (h < 21) return 'Evening';
  return 'Night';
}

/**
 * Type hint for a logged activity. Matching classifications stay quiet; the
 * classifier speaks only when quality is genuinely new information for the
 * planned day. We cannot safely call an Easy recording a mismatch on a Quality
 * day because doubles often include a separate easy/recovery activity.
 */
function activityHint(qualityDetected: boolean | null, planExpectsQuality: boolean): string {
  if (qualityDetected === true) return planExpectsQuality ? 'Quality' : 'Quality detected';
  if (qualityDetected === false) return 'Easy';
  return 'Run';
}

/** sec/mi → "m:ss". */
function fmtPace(secPerMi: number, units: DistancePreference): string {
  const seconds = units === 'mi' ? secPerMi : secPerMi / 1.609344;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ── Day eyebrow label ─────────────────────────────────────────────────────────

const DOW_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DOW_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];


/** Full "Today, Wednesday June 24 — Title, X.X miles" for the container a11y label. */
function buildA11yLabel(day: CalendarDay, units: DistancePreference): string {
  const d = new Date(`${day.localDate}T12:00:00Z`);
  const dow = DOW_NAMES[day.dayIndex] ?? '';
  const mon = MONTH_FULL[d.getUTCMonth()] ?? '';
  const dt = d.getUTCDate();
  const prefix = day.isToday ? 'Today, ' : '';
  const dayStr = `${prefix}${dow} ${mon} ${dt}`;

  if (day.primary == null) {
    if (day.activities.length > 0) {
      const actualMeters = day.activities.reduce((sum, activity) => sum + activity.distanceMeters, 0);
      const unitWord = units === 'mi' ? 'miles' : 'kilometers';
      return `${dayStr} — ${day.activities.length} logged ${day.activities.length === 1 ? 'run' : 'runs'}, ${distance1(actualMeters, units)} ${unitWord}`;
    }
    return `${dayStr} — Rest day`;
  }

  const { title, plannedMeters } = day.primary;
  const unitWord = units === 'mi' ? 'miles' : 'kilometers';
  const distStr = plannedMeters != null ? `, ${distance1(plannedMeters, units)} ${unitWord}` : '';
  return `${dayStr} — ${title ?? 'Run'}${distStr}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

function DayPanelInner({
  day,
  accent,
  easyBaseline,
  historical = false,
  onOpenWorkout,
  onOpenActivity,
  onAdjustWeek,
}: {
  day: CalendarDay;
  /** The selected day's type colour, reserved for workout identity. */
  accent: string;
  easyBaseline: number;
  /** Settled weeks are archival: no allocation actions or live-week copy. */
  historical?: boolean;
  onOpenWorkout: (id: string) => void;
  /** Open a specific LOGGED activity's run detail (completed-day picker rows). */
  onOpenActivity: (activityId: string) => void;
  /** Opens the week planner with this day in context. */
  onAdjustWeek?: () => void;
}): React.JSX.Element {
  const C = useTheme();
  const { preferences } = useAppPreferences();
  const units = preferences.distance;
  const unitWord = units === 'mi' ? 'miles' : 'kilometers';
  const styles = useThemedStyles(makeStyles);
  const { fontScale } = useWindowDimensions();
  const accessibilityLayout = usesAccessibilityTextLayout(fontScale);

  const a11yLabel = buildA11yLabel(day, units);
  const renderActivities = (planExpectsQuality: boolean) => (
    <View style={styles.actList}>
      {day.activities.map((a, index) => {
        const timeLabel = timeOfDayLabel(a.startDate);
        const matchedWorkout = day.workouts.find((workout) => workout.matchedActivityIds?.includes(a.id));
        const expectsQuality = matchedWorkout
          ? matchedWorkout.isQuality || Boolean(matchedWorkout.hasEmbeddedQuality)
          : planExpectsQuality;
        const hint = activityHint(a.qualityDetected, expectsQuality);
        const shortfallMeters = matchedWorkout?.outcome === 'short'
          ? Math.max(0, (matchedWorkout.plannedMeters ?? 0) - matchedWorkout.actualMeters)
          : 0;
        const shortfallLabel = shortfallMeters > 0 ? `${distance1(shortfallMeters, units)} ${units} short` : null;
        const distStr = distance1(a.distanceMeters, units);
        return (
          <React.Fragment key={a.id}>
            {/* Inset to the row's own horizontal padding so the rule lines up
                with the ledger text rather than the card edge. */}
            {index > 0 ? <Divider inset={space.s} /> : null}
            <Pressable
              testID={`day-activity-row-${a.id}`}
              onPress={() => onOpenActivity(a.id)}
              accessibilityRole="link"
              accessibilityLabel={`Open ${timeLabel} run, ${distStr} ${unitWord}, ${hint}${shortfallLabel ? `, ${shortfallLabel}` : ''}`}
              style={({ pressed }) => [styles.actRow, pressed && styles.actRowPressed]}
            >
              <View style={[styles.actRowTop, accessibilityLayout && styles.actRowTopAccessible]}>
                <View style={styles.actMain}>
                  <Text style={styles.actTime} numberOfLines={accessibilityLayout ? undefined : 1} maxFontSizeMultiplier={SEMANTIC_TEXT_SCALE}>
                    {timeLabel}
                  </Text>
                  <Text
                    testID={`day-activity-hint-${a.id}`}
                    style={[
                      styles.actHint,
                      a.qualityDetected === true && styles.actHintQuality,
                      a.qualityDetected === false && styles.actHintEasy,
                    ]}
                    numberOfLines={accessibilityLayout ? undefined : 1}
                    maxFontSizeMultiplier={SEMANTIC_TEXT_SCALE}
                  >
                    {shortfallLabel ? (
                      <Text style={styles.actHintShort}>{shortfallLabel}</Text>
                    ) : (
                      <Text
                        style={[
                          a.qualityDetected === true && styles.actHintQuality,
                          a.qualityDetected === false && styles.actHintEasy,
                        ]}
                      >
                        {hint}
                      </Text>
                    )}
                  </Text>
                </View>
                <View style={[styles.actRight, accessibilityLayout && styles.actRightAccessible]}>
                  <Text style={styles.actMi} maxFontSizeMultiplier={SEMANTIC_TEXT_SCALE}>
                    {distStr}
                    <Text style={styles.actMiUnit} maxFontSizeMultiplier={SEMANTIC_TEXT_SCALE}> {units}</Text>
                  </Text>
                  <SymbolView name="chevron.right" size={12} tintColor={C.faint} resizeMode="scaleAspectFit" />
                </View>
              </View>
              {a.actualBar && a.actualBar.length > 0 ? (
                <View style={styles.actBarWrap}>
                  <ActualBar testID={`day-actual-rail-${a.id}`} segments={a.actualBar} height={7} />
                </View>
              ) : null}
            </Pressable>
          </React.Fragment>
        );
      })}
    </View>
  );

  // A scheduled rest day can still hold logged mileage. Keep the plan truth
  // ("Rest day plan") while rendering the actual recordings as the same flat,
  // openable ledger rows used on planned days.
  if (day.primary == null && day.activities.length > 0) {
    const actualMeters = day.activities.reduce((sum, activity) => sum + activity.distanceMeters, 0);
    return (
      <View
        role="group"
        accessibilityLabel={a11yLabel}
        testID="day-unplanned-card"
        style={styles.panel}
      >
        <View style={styles.outcome}>
          <View style={[styles.outcomeTop, accessibilityLayout && styles.outcomeTopAccessible]}>
            <DueGlyphTile name="easy" tone="easy" size={38} />
            <View style={styles.outcomeIdentity}>
              <Text style={styles.outcomeTitle} maxFontSizeMultiplier={SEMANTIC_TEXT_SCALE}>
                {day.activities.length === 1 ? 'Run' : `${day.activities.length} runs`}
              </Text>
              <Text style={styles.unplannedContext} maxFontSizeMultiplier={SEMANTIC_TEXT_SCALE}>
                Rest day plan
              </Text>
            </View>
            <View style={[styles.outcomeResult, accessibilityLayout && styles.outcomeResultAccessible]}>
              <Text style={styles.outcomeActual} maxFontSizeMultiplier={SEMANTIC_TEXT_SCALE}>
                {distance1(actualMeters, units)}
                <Text style={styles.outcomeActualUnit} maxFontSizeMultiplier={SEMANTIC_TEXT_SCALE}> {units}</Text>
              </Text>
              <Text style={styles.outcomeState} maxFontSizeMultiplier={SEMANTIC_TEXT_SCALE}>Banked</Text>
            </View>
          </View>
        </View>
        {renderActivities(false)}
      </View>
    );
  }

  // ── Rest day ────────────────────────────────────────────────────────────────
  if (day.primary == null) {
    return (
      <View
        role="group"
        accessible={true}
        accessibilityLabel={a11yLabel}
        testID="day-rest-card"
        style={[styles.panel, historical && styles.restPanelHistorical]}
      >
        <View
          testID="day-rest-hero"
          style={[styles.restHero, historical && styles.restHeroHistorical]}
        >
          <DueGlyphTile name="recovery" tone="neutral" size={38} />
          <View style={styles.restCopy}>
            <Text style={styles.restTxt} maxFontSizeMultiplier={SEMANTIC_TEXT_SCALE}>Rest day</Text>
            <Text style={styles.restMeta} maxFontSizeMultiplier={SEMANTIC_TEXT_SCALE}>Recovery</Text>
          </View>
        </View>
      </View>
    );
  }

  // ── Workout day ─────────────────────────────────────────────────────────────
  const { id, tone, title, isQuality, structure, plannedMeters, actualMeters, sealed, hasEmbeddedQuality } = day.primary;
  // The plan-vs-actual ledger shows once the day is OVER — a run banked ('done')
  // OR an elapsed scheduled day with no run ('missed', actual 0). Today/upcoming
  // keep the prescription-forward layout.
  const activityOrder = new Map(day.activities.map((activity, index) => [activity.id, index]));
  const runs = day.workouts
    .map((workout, sourceIndex) => ({
      workout,
      sourceIndex,
      actualIndex: Math.min(
        ...(workout.matchedActivityIds ?? [])
          .map((activityId) => activityOrder.get(activityId))
          .filter((index): index is number => index != null),
        Number.POSITIVE_INFINITY,
      ),
    }))
    .sort((a, b) => a.actualIndex - b.actualIndex || a.sourceIndex - b.sourceIndex)
    .map(({ workout }) => workout);
  const isMulti = runs.length >= 2;
  const allPlannedComplete = runs.length > 0 && runs.every((workout) => workout.completed);
  const allPlannedMet = runs.length > 0 && runs.every((workout) => workout.outcome === 'met');
  // `accent` (the prop) is the day's type colour — same value the tab outline uses
  // — so the panel's icon/type/dots match its frame. Speed folds into pink anyway.

  // A day can hold two runs (a double). It remains one day-unit, while the
  // per-workout matcher gives each leg its own actual distance and fill state.
  const dayPlanned = isMulti
    ? runs.reduce((s, w) => s + (w.plannedMeters ?? 0), 0)
    : (plannedMeters ?? 0);

  const bars = structureBarSegments(structure);
  const steps = structureLines(structure, units); // readable prescription (paces/reps)
  // An easy run is otherwise just a distance — give it the instruction that
  // matters: a target pace range from the runner's own easy baseline.
  const easyTarget =
    tone === 'easy' && steps.length < 2 && easyBaseline > 0
      ? `${fmtPace(easyBaseline - 10, units)}–${fmtPace(easyBaseline + 20, units)} /${units}  easy effort`
      : null;
  // A long/easy run can EMBED a quality block (an MP or tempo segment inside a
  // long run) without being a quality DAY. Surface it as "<Type> + Quality" so
  // the prescription reads honestly on the plan side — the same embedded-quality
  // signal weekDays uses for the split pip (prescribedQualityMeters > 0).
  const sub = isQuality ? dominantWorkLabel(structure) : null;
  const embeddedQuality = hasEmbeddedQuality
    ?? (!isQuality && tone === 'long' && prescribedQualityMeters(structure ?? []) > 0);
  const typeLabel = sub
    ? `${TONE_WORD[tone]}  ${sub}`
    : embeddedQuality
      ? `${TONE_WORD[tone]} + Quality`
      : TONE_WORD[tone];

  // Display values fold the single + multi cases.
  const titleText = isMulti
    ? runs.every((w) => w.tone === 'easy')
      ? 'Easy double'
      : runs.map((w) => TONE_WORD[w.tone]).join(' + ')
    : (title ?? 'Run');
  const typeLine = isMulti ? `${runs.map((w) => distance1(w.plannedMeters ?? 0, units)).join(' + ')} ${units}` : typeLabel;
  const distLabel = isMulti ? distance1(dayPlanned, units) : plannedMeters != null ? distance1(plannedMeters, units) : '—';
  const estLabel = formatDurationApprox(
    isMulti
      ? runs.reduce((s, w) => s + estimateWorkoutDurationSec(w.structure, w.plannedMeters ?? 0, easyBaseline), 0)
      : estimateWorkoutDurationSec(structure, plannedMeters ?? 0, easyBaseline),
  );
  const dayActual = day.activities.reduce((sum, a) => sum + a.distanceMeters, 0) || actualMeters;
  // One full-distance easy run may replace a prescribed easy double without
  // pretending that the activity happened twice. Quality/mixed prescriptions
  // still require per-leg evidence because their structure carries the point.
  const aggregateEasySubstitution =
    isMulti &&
    day.activities.length === 1 &&
    runs.every((workout) => workout.tone === 'easy') &&
    day.activities.every((activity) => activity.qualityDetected !== true) &&
    dayActual >= dayPlanned - DAY_SUBSTITUTION_TOLERANCE_METERS;
  const daySatisfied = allPlannedComplete || aggregateEasySubstitution;
  const over = daySatisfied || day.state === 'missed';
  const dayDelta = dayActual - dayPlanned;
  const dayDeltaDistance = metersToUnits(Math.abs(dayDelta), units);
  const allocationTolerance = Math.max(804.672, dayPlanned * 0.1);
  const onAllocation = daySatisfied && Math.abs(dayDelta) <= allocationTolerance;
  const dayDeltaLabel = onAllocation
    ? 'On allocation'
    : dayDelta > 0
      ? `${dayDeltaDistance.toFixed(1)} ${units} over allocation`
      : `${dayDeltaDistance.toFixed(1)} ${units} under allocation`;
  const plannedType = isMulti
    ? [...new Set(runs.map((w) => TONE_WORD[w.tone]))].join(' + ')
    : TONE_WORD[tone];
  const outcomePlanLabel = isMulti
    ? `${runs.map((workout) => distance1(workout.plannedMeters ?? 0, units)).join(' + ')} ${units} planned`
    : `${distance1(dayPlanned, units)} ${units} planned`;

  return (
    <View
      accessible={false}
      accessibilityLabel={a11yLabel}
      style={styles.panel}
      testID={over ? 'day-outcome-card' : 'day-workout-card'}
    >
      <LinearGradient
        pointerEvents="none"
        testID={`day-workout-gradient-${tone}`}
        colors={workoutGradient(tone, C)}
        locations={[0, 0.46, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {/* No date eyebrow — the selected calendar tab already names the day. */}
      {/* A closed day is a compact outcome here; the full plan-vs-actual ledger
          belongs in run/workout detail. This keeps week swipes geometrically
          stable and makes the surface an overview-plus-detail interface. */}
      {over ? (
        <View style={styles.outcome}>
          <View style={[styles.outcomeTop, accessibilityLayout && styles.outcomeTopAccessible]}>
            <DueGlyphTile
              testID="day-outcome-type-token"
              name={tone === 'long' ? 'long' : tone === 'easy' ? 'easy' : 'quality'}
              tone={tone === 'long' ? 'long' : tone === 'easy' ? 'easy' : 'quality'}
              overlay={embeddedQuality ? { name: 'quality', tone: 'quality' } : undefined}
              size={38}
            />
            <View style={styles.outcomeIdentity}>
              <Text style={styles.outcomeTitle} numberOfLines={accessibilityLayout ? undefined : 1} maxFontSizeMultiplier={SEMANTIC_TEXT_SCALE}>
                {titleText}
              </Text>
              <View style={[styles.outcomeMeta, accessibilityLayout && styles.outcomeMetaAccessible]}>
                {embeddedQuality ? (
                  <Text style={styles.outcomeType} numberOfLines={accessibilityLayout ? undefined : 1} maxFontSizeMultiplier={SEMANTIC_TEXT_SCALE}>
                    <Text style={{ color: C.cyanText }}>Long</Text>
                    <Text style={{ color: C.mute }}> + </Text>
                    <Text style={{ color: C.qualText }}>Quality</Text>
                  </Text>
                ) : (
                  <Text
                    style={[styles.outcomeType, { color: accent }]}
                    numberOfLines={accessibilityLayout ? undefined : 1}
                    maxFontSizeMultiplier={SEMANTIC_TEXT_SCALE}
                  >
                    {plannedType}
                  </Text>
                )}
                <Text
                  testID="day-outcome-plan-value"
                  style={styles.outcomePlan}
                  numberOfLines={accessibilityLayout ? undefined : 1}
                  maxFontSizeMultiplier={SEMANTIC_TEXT_SCALE}
                >
                  {outcomePlanLabel}
                </Text>
              </View>
            </View>
            <View style={[styles.outcomeResult, accessibilityLayout && styles.outcomeResultAccessible]}>
              <Text
                testID="day-outcome-actual-value"
                style={[styles.outcomeActual, !daySatisfied && styles.outcomeActualMissed]}
                maxFontSizeMultiplier={SEMANTIC_TEXT_SCALE}
              >
                {distance1(daySatisfied ? dayActual : 0, units)}
                <Text style={styles.outcomeActualUnit} maxFontSizeMultiplier={SEMANTIC_TEXT_SCALE}> {units}</Text>
              </Text>
              <Text
                style={[styles.outcomeState, !daySatisfied && styles.outcomeStateMissed]}
                numberOfLines={accessibilityLayout ? undefined : 1}
                maxFontSizeMultiplier={SEMANTIC_TEXT_SCALE}
              >
                {daySatisfied ? 'Banked' : 'Missed'}
              </Text>
            </View>
          </View>
          {/* Live-week contract variance belongs to the contract instrument
              above this card. Keep only workout-level outcomes here so the
              same shortfall is not narrated twice. Settled weeks still need
              the archival "not banked" fact because no live recovery state
              remains above them. */}
          {daySatisfied || historical ? (
            <>
              <Divider style={styles.outcomeRule} />
              <View style={[styles.outcomeDelta, accessibilityLayout && styles.outcomeDeltaAccessible]}>
                <View
                  testID="day-outcome-variance-mark"
                  style={[
                    styles.outcomeDeltaDot,
                    { backgroundColor: daySatisfied ? (onAllocation ? C.positiveText : C.faint) : C.warningText },
                  ]}
                />
                <Text
                  testID="day-outcome-variance"
                  style={[
                    styles.outcomeDeltaText,
                    daySatisfied && onAllocation && { color: C.positiveText },
                    !daySatisfied && { color: C.warningText },
                  ]}
                  maxFontSizeMultiplier={SEMANTIC_TEXT_SCALE}
                >
                  {daySatisfied ? dayDeltaLabel : `${distance1(dayPlanned, units)} ${units} not banked`}
                </Text>
              </View>
            </>
          ) : null}
        </View>
      ) : null}

      {!over ? (
        <>
      {/* The card itself is the affordance. The row remains the shared visual
          primitive, with one quiet disclosure instead of a second CTA. */}
      <WorkoutRow
        accent={accent}
        icon={TONE_ICON[tone]}
        glyphTone={tone === 'easy' ? 'easy' : tone === 'long' ? 'long' : 'quality'}
        glyphOverlay={embeddedQuality ? { name: 'quality', tone: 'quality' } : undefined}
        title={titleText}
        typeLine={embeddedQuality ? undefined : typeLine}
        typeLineNode={embeddedQuality ? (
          <Text style={styles.mixedType} numberOfLines={accessibilityLayout ? undefined : 1} maxFontSizeMultiplier={SEMANTIC_TEXT_SCALE}>
            <Text style={{ color: C.cyanText }}>Long</Text>
            <Text style={{ color: C.mute }}> + </Text>
            <Text style={{ color: C.qualText }}>Quality</Text>
          </Text>
        ) : undefined}
        distLabel={distLabel}
        distanceUnit={units}
        secondary={
          dayActual > 0
            ? { label: `${distance1(dayActual, units)} banked`, ran: true }
            : { label: estLabel, icon: 'clock' }
        }
        sealed={isMulti ? allPlannedMet && runs.every((workout) => workout.sealed) : sealed}
        onPress={!isMulti ? () => onOpenWorkout(id) : undefined}
        accessibilityLabel={!isMulti ? `Open ${titleText} details. ${a11yLabel}` : undefined}
        accessory={!isMulti ? (
          <View style={styles.disclosure}>
            <SymbolView name="chevron.right" size={13} tintColor={C.mute} resizeMode="scaleAspectFit" />
          </View>
        ) : undefined}
      />

      {/* Every open workout carries the same quiet prescription rail. It is a
          shape diagram, not a progress track; completed rows replace it with
          the solid parsed actual shape below. */}
      {isMulti ? (
        <View style={styles.doubleRail} testID="day-double-rail">
          {runs.map((w) => {
            const planned = Math.max(1, w.plannedMeters ?? 1);
            const progress = Math.min(1, w.actualMeters / planned);
            const fill = w.tone === 'quality'
              ? C.qualText
              : w.tone === 'long'
                ? C.cyanText
                : C.easyText;
            return (
              <View
                key={w.id}
                testID={`day-double-chunk-${w.id}`}
                style={[styles.doubleChunk, { flexGrow: planned }]}
              >
                <View
                  testID={`day-double-fill-${w.id}`}
                  style={[styles.doubleChunkFill, { backgroundColor: fill, width: `${progress * 100}%` }]}
                />
              </View>
            );
          })}
        </View>
      ) : (
        <View style={styles.woBarWrap}>
          <PrescriptionBar
            testID="day-prescription-rail"
            segments={bars.length > 0 ? bars : [{ kind: 'steady', meters: plannedMeters ?? 1 }]}
          />
        </View>
      )}

      {/* Easy-run target — the pace range that makes the card an instruction. */}
      {easyTarget ? (
        <View style={styles.targetRow}>
          <View style={[styles.stepDot, { backgroundColor: accent }]} />
          <Text style={styles.targetText} maxFontSizeMultiplier={SEMANTIC_TEXT_SCALE}>{easyTarget}</Text>
        </View>
      ) : null}

      {/* Prescription steps — the targets/paces, so a structured session is
          executable without tapping. Hidden for a plain single-segment run (the
          header already says the distance). */}
      {steps.length >= 2 ? (
        <View style={styles.steps}>
          {steps.slice(0, 3).map((s, i) => (
            <View key={i} style={[styles.stepRow, accessibilityLayout && styles.stepRowAccessible]}>
              <View style={[styles.stepDot, { backgroundColor: s.strong ? accent : C.faint }]} />
              <Text style={[styles.stepText, s.strong && styles.stepStrong]} numberOfLines={accessibilityLayout ? undefined : 1} maxFontSizeMultiplier={SEMANTIC_TEXT_SCALE}>
                {s.text}
              </Text>
            </View>
          ))}
          {steps.length > 3 ? (
            <Text style={styles.moreSteps} maxFontSizeMultiplier={SEMANTIC_TEXT_SCALE}>{`+${steps.length - 3} more steps in workout`}</Text>
          ) : null}
        </View>
      ) : null}
        </>
      ) : null}

      {/* Closed days are historical records, not primary actions. Keep each run
          openable, but use flat divided rows with a transient pressed wash. */}
      {day.activities.length >= 1 ? (
        renderActivities(isQuality || embeddedQuality)
      ) : null}

      {/* The run ledger is chronological: recorded activities are already
          sorted by their true start time; any plan legs without a recording
          follow them in authored plan order as the work still ahead. */}
      {isMulti && !daySatisfied && runs.some((workout) => !workout.completed) ? (
        <View style={styles.remainingList} testID="day-remaining-plan">
          {runs.filter((workout) => !workout.completed).map((workout, index) => {
            const missed = workout.outcome === 'missed';
            const stateLabel = missed ? 'Missed' : 'Still planned';
            return (
              <Pressable
                key={workout.id}
                testID={`day-remaining-workout-${workout.id}`}
                accessibilityRole="link"
                accessibilityLabel={`Open ${stateLabel.toLowerCase()} ${workout.title ?? TONE_WORD[workout.tone]}, ${distance1(workout.plannedMeters ?? 0, units)} ${unitWord}`}
                onPress={() => onOpenWorkout(workout.id)}
                style={({ pressed }) => [styles.remainingRow, index > 0 && styles.remainingDivider, pressed && styles.actRowPressed]}
              >
                <View style={styles.remainingCopy}>
                  <Text style={styles.remainingTitle} maxFontSizeMultiplier={SEMANTIC_TEXT_SCALE}>
                    {workout.title ?? `${TONE_WORD[workout.tone]} run`}
                  </Text>
                  <Text
                    testID={`day-remaining-state-${workout.id}`}
                    style={[styles.remainingMeta, missed && styles.remainingMetaMissed]}
                    maxFontSizeMultiplier={SEMANTIC_TEXT_SCALE}
                  >
                    {stateLabel}
                  </Text>
                </View>
                <View style={styles.remainingRight}>
                  <Text style={styles.remainingMiles} maxFontSizeMultiplier={SEMANTIC_TEXT_SCALE}>
                    {distance1(workout.plannedMeters ?? 0, units)}
                    <Text style={styles.remainingUnit} maxFontSizeMultiplier={SEMANTIC_TEXT_SCALE}> {units}</Text>
                  </Text>
                  <SymbolView name="chevron.right" size={12} tintColor={C.faint} resizeMode="scaleAspectFit" />
                </View>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {day.activities.length === 0 && !historical && day.state === 'missed' && onAdjustWeek ? (
        <ActionButton
          accessibilityLabel="Adjust this week"
          color={C.slate}
          onPress={onAdjustWeek}
          style={styles.woCtaOuter}
          contentStyle={styles.woCta}
        >
          <ActionButtonLabel style={styles.woCtaTxt} maxFontSizeMultiplier={SEMANTIC_TEXT_SCALE}>Adjust week</ActionButtonLabel>
          <SymbolView name="arrow.left.arrow.right" size={13} tintColor={C.ink} resizeMode="scaleAspectFit" />
        </ActionButton>
      ) : null}
    </View>
  );
}

// Memo'd: CalendarTabs re-renders on every browsed-week swipe, but the selected
// day (`days[selectedIndex]`) is a stable ref while only `viewWeek` changes —
// so this heavy panel skips the re-render entirely instead of rebuilding on
// each scroll. Re-renders only when the selected day / accent genuinely change.
export const DayPanel = React.memo(DayPanelInner);

// ── Styles ────────────────────────────────────────────────────────────────────

const makeStyles = (C: Tokens) =>
  StyleSheet.create({
    panel: {
      // Same matte card family as the weekly contract. Its height follows its
      // content, so a simple run never turns into a large empty tile.
      backgroundColor: C.card,
      overflow: 'hidden',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: C.line,
      borderRadius: radius.md,
      paddingTop: space.lg,
      paddingBottom: space.lg,
      marginBottom: space.l,
    },
    disclosure: { width: 18, alignSelf: 'center', alignItems: 'flex-end' },
    restHero: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.md,
      paddingHorizontal: space.lg,
    },
    // A settled rest day has no action beneath it. Remove the live card's CTA
    // allowance and give the single outcome row equal vertical breathing room.
    restPanelHistorical: { paddingTop: space.lg, paddingBottom: space.lg },
    restHeroHistorical: {},
    restCopy: { flex: 1, minWidth: 0 },
    restTxt: {
      color: C.ink,
      fontFamily: display,
      fontSize: fontSizes.sectionTitle,
      letterSpacing: -0.2,
    },
    restMeta: { ...eyebrowText(C, 'labelSm'), marginTop: space.nudge },
    outcome: { paddingHorizontal: space.lg },
    outcomeTop: { flexDirection: 'row', alignItems: 'center', gap: space.md },
    outcomeTopAccessible: { flexDirection: 'column', alignItems: 'stretch' },
    outcomeIdentity: { flex: 1, minWidth: 0, paddingRight: space.xs },
    outcomeTitle: { color: C.ink, fontFamily: display, fontSize: fontSizes.sectionTitle, letterSpacing: -0.2 },
    // Type and prescription answer different questions. Stacking them keeps a
    // mixed identity such as "Long + Quality" intact beside the result column.
    outcomeMeta: { alignItems: 'flex-start', gap: space.xxs, marginTop: space.nudge },
    outcomeMetaAccessible: { flexDirection: 'column', alignItems: 'flex-start' },
    // The colour is the day's own type accent (or the per-word tints of a mixed
    // "Long + Quality" identity), applied at the call site.
    outcomeType: eyebrowText(C, 'micro'),
    outcomePlan: { ...statValueText(C, 'labelSm', 'system'), color: C.mute, fontWeight: '700' },
    outcomeResult: { alignItems: 'flex-end', minWidth: 76 },
    outcomeResultAccessible: { alignItems: 'flex-start', minWidth: 0 },
    outcomeActual: {
      color: C.ink,
      fontFamily: display,
      fontSize: fontSizes.sheetTitle,
      letterSpacing: -0.4,
      fontVariant: ['tabular-nums'],
    },
    outcomeActualMissed: { color: C.mute },
    outcomeActualUnit: { color: C.mute, fontFamily: undefined, fontSize: fontSizes.metadata, fontWeight: '700' },
    outcomeState: { ...eyebrowText(C, 'micro'), marginTop: space.nudge },
    outcomeStateMissed: { color: C.warningText },
    unplannedContext: { ...eyebrowText(C, 'micro'), marginTop: space.nudge },
    outcomeRule: { marginTop: space.md },
    outcomeDelta: { flexDirection: 'row', alignItems: 'center', gap: space.s, paddingTop: space.sm },
    outcomeDeltaAccessible: { alignItems: 'flex-start' },
    outcomeDeltaDot: { width: 7, height: 7, borderRadius: 3.5 },
    outcomeDeltaText: { color: C.mute, fontSize: fontSizes.metadata, fontWeight: '800' },
    woBarWrap: {
      marginTop: space.l,
      marginHorizontal: space.lg,
    },
    doubleRail: {
      flexDirection: 'row',
      gap: space.s,
      marginTop: space.l,
      marginHorizontal: space.lg,
    },
    doubleChunk: {
      flexBasis: 0,
      minWidth: 12,
      height: 8,
      overflow: 'hidden',
      borderRadius: 3,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: C.line,
      backgroundColor: C.fill,
    },
    doubleChunkFill: {
      height: '100%',
      borderRadius: 2,
    },
    remainingList: {
      ...hairlineTop(C),
      marginHorizontal: space.lg,
      marginTop: space.md,
    },
    remainingRow: {
      minHeight: 54,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: space.s,
      paddingVertical: space.sm,
    },
    remainingDivider: hairlineTop(C),
    remainingCopy: { flex: 1, minWidth: 0, paddingRight: space.sm },
    remainingTitle: { color: C.ink, fontSize: fontSizes.labelLg, fontWeight: '700' },
    remainingMeta: { ...eyebrowText(C, 'micro'), marginTop: space.nudge },
    remainingMetaMissed: { color: C.warningText },
    remainingRight: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
    remainingMiles: { ...statValueText(C, 'labelLg', 'system'), fontWeight: '800' },
    remainingUnit: { color: C.mute, fontSize: fontSizes.labelSm, fontWeight: '700' },
    // Per-word tints ("Long" cyan / "Quality" violet) come from the call site.
    mixedType: eyebrowText(C, 'labelSm'),
    // Prescription step list (Runna-style, condensed): a dot + the target text.
    steps: { marginTop: space.md, marginHorizontal: space.lg, gap: space.sm },
    stepRow: { flexDirection: 'row', alignItems: 'center', gap: space.m },
    stepRowAccessible: { alignItems: 'flex-start' },
    stepDot: { width: 5, height: 5, borderRadius: 2.5 },
    stepText: { color: C.mute, fontSize: fontSizes.label, fontWeight: '600', flexShrink: 1 },
    stepStrong: { color: C.ink, fontWeight: '700' },
    moreSteps: { color: C.mute, fontSize: fontSizes.labelSm, fontWeight: '700', marginLeft: space.l },
    targetRow: { flexDirection: 'row', alignItems: 'center', gap: space.m, marginTop: space.md, marginHorizontal: space.lg },
    targetText: { ...statValueText(C, 'label', 'system'), fontWeight: '700' },
    // Logged activities sit on the card's own plane. Containment comes from the
    // outer outcome card; hairlines establish the repeated record structure.
    actList: {
      ...hairlineTop(C),
      marginHorizontal: space.lg,
      marginTop: space.md,
    },
    actRow: {
      minHeight: 54,
      paddingHorizontal: space.s,
      paddingVertical: space.sm,
    },
    actRowTop: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    actRowTopAccessible: { flexDirection: 'column', alignItems: 'stretch', gap: space.sm },
    actBarWrap: { marginTop: space.sm },
    actRowPressed: { backgroundColor: C.fill },
    actMain: {
      flex: 1,
      paddingRight: space.sm,
    },
    actTime: {
      color: C.ink,
      fontSize: fontSizes.body,
      fontWeight: '700',
      letterSpacing: -0.2,
    },
    actHint: { ...eyebrowText(C, 'labelSm'), marginTop: space.xxs },
    actHintQuality: { color: C.qualText },
    actHintEasy: { color: C.easyText },
    actHintShort: { color: C.warningText },
    actRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.s,
    },
    actRightAccessible: { alignSelf: 'flex-start' },
    actMi: {
      color: C.ink,
      fontSize: fontSizes.sectionTitle,
      fontFamily: display,
      letterSpacing: -0.3,
    },
    actMiUnit: {
      color: C.mute,
      opacity: 0.65,
      fontSize: fontSizes.labelSm,
      fontWeight: '700',
    },
    // Outer positioning (margins) vs face layout — split for the ActionButton.
    woCtaOuter: {
      marginHorizontal: space.lg,
      marginTop: space.l,
    },
    woCta: {
      minHeight: 44,
      paddingVertical: space.sm,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: space.s,
    },
    // A neutral-fill action, so the legend takes `ink` rather than the
    // accent's `accentInk`. Everything else is the standard action voice.
    woCtaTxt: { color: C.ink },
  });
