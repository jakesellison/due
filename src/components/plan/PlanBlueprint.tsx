import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';

import {
  adherenceSummary,
  addDays,
  metersToUnits,
  type PlanBlueprintWeek,
  type WeekGoal,
} from '@/lib';
import { useAppPreferences, type DistancePreference } from '@/app-lib/preferences';
import { DueSectionHeading } from '@/components/brand';
import { Divider, hairlineBottom, hairlineTop } from '@/components/ui/Divider';
import { statValueText } from '@/components/ui/Stat';
import { useTheme, useThemedStyles } from '@/theme/ThemeProvider';
import { data, display, fontSizes, radius, space, usesAccessibilityTextLayout, type Tokens } from '@/theme/tokens';

interface PhaseRun {
  key: string;
  label: string;
  count: number;
}

export interface PlanBlueprintProgress {
  /** Canonical per-week Mileage / Quality / Long Run ledger. */
  weekGoals: WeekGoal[];
}

interface PlanProgressSummary {
  bankedMeters: number;
  planMeters: number;
  contractsMet: number;
  contractsSettled: number;
  qualityMeters: number;
  qualityTargetMeters: number;
  longRunsMet: number;
  longRunsPlanned: number;
}

/**
 * Plan's dominant instrument. Planned weekly contracts form the vessel; running
 * fills elapsed vessels from the baseline. Quality and Long Run stay subordinate
 * as whole-plan totals, matching their role on Week.
 */
export function PlanBlueprint({
  weeks,
  selectedWeekIndex,
  onSelectWeek,
  progress,
}: {
  weeks: PlanBlueprintWeek[];
  selectedWeekIndex: number;
  onSelectWeek: (weekIndex: number) => void;
  progress?: PlanBlueprintProgress | null;
}) {
  const C = useTheme();
  const { preferences } = useAppPreferences();
  const units = preferences.distance;
  const unitWord = units === 'mi' ? 'miles' : 'kilometers';
  const styles = useThemedStyles(makeStyles);
  const { fontScale, width } = useWindowDimensions();
  const accessibleLayout = usesAccessibilityTextLayout(fontScale);
  const stackSupportingMetrics = accessibleLayout || fontScale > 1 || width < 375;
  const plotWidth = useRef(0);
  const [measuredPlotWidth, setMeasuredPlotWidth] = useState(0);
  const fallbackPosition = weeks.findIndex((week) => week.isCurrent);
  const resolvedSelectedPosition = weeks.findIndex((week) => week.weekIndex === selectedWeekIndex);
  const selectedPosition = resolvedSelectedPosition >= 0
    ? resolvedSelectedPosition
    : fallbackPosition >= 0
      ? fallbackPosition
      : 0;
  const [previewPosition, setPreviewPosition] = useState<number | null>(null);
  const displayedPosition = previewPosition ?? selectedPosition;
  const committedPosition = useRef(selectedPosition);
  const lastScrubPosition = useRef(displayedPosition);
  const scrubbing = useRef(false);
  const lastHapticAt = useRef(0);
  const selected = weeks[displayedPosition] ?? null;
  const currentPosition = weeks.findIndex((week) => week.isCurrent);
  const peakMeters = Math.max(1, ...weeks.map((week) => week.targetMeters));
  const peakDistance = Math.round(metersToUnits(peakMeters, units));
  const phases = useMemo(() => phaseRuns(weeks), [weeks]);
  const summary = useMemo(
    () => summarizeProgress(weeks, progress?.weekGoals ?? []),
    [progress?.weekGoals, weeks],
  );
  const hasProgress = progress?.weekGoals.some(
    (goal) => weeks.some((week) => goalMatchesWeek(goal, week)),
  ) ?? false;

  useEffect(() => {
    committedPosition.current = selectedPosition;
    if (scrubbing.current) return;
    lastScrubPosition.current = selectedPosition;
    setPreviewPosition(null);
  }, [selectedPosition]);

  const moveSelection = (direction: -1 | 1) => {
    const next = Math.max(0, Math.min(weeks.length - 1, selectedPosition + direction));
    const week = weeks[next];
    if (week) onSelectWeek(week.weekIndex);
  };

  const performScrubHaptic = useCallback(() => {
    const now = Date.now();
    if (now - lastHapticAt.current < SCRUB_HAPTIC_INTERVAL_MS) return;
    lastHapticAt.current = now;
    void Haptics.selectionAsync().catch(() => undefined);
  }, []);

  const beginScrub = useCallback(() => {
    scrubbing.current = true;
    lastScrubPosition.current = committedPosition.current;
  }, []);

  const previewAtX = useCallback((locationX: number) => {
    const index = blueprintIndexAtXWithHysteresis(
      locationX,
      plotWidth.current,
      weeks.length,
      lastScrubPosition.current,
    );
    if (index < 0 || index === lastScrubPosition.current) return;
    lastScrubPosition.current = index;
    setPreviewPosition(index);
    performScrubHaptic();
  }, [performScrubHaptic, weeks.length]);

  const finishScrub = useCallback(() => {
    scrubbing.current = false;
    const index = lastScrubPosition.current;
    const week = weeks[index];
    if (!week || index === committedPosition.current) {
      setPreviewPosition(null);
      return;
    }
    onSelectWeek(week.weekIndex);
  }, [onSelectWeek, weeks]);

  const cancelScrub = useCallback(() => {
    scrubbing.current = false;
    lastScrubPosition.current = committedPosition.current;
    setPreviewPosition(null);
  }, []);

  const commitAtX = useCallback((locationX: number) => {
    const index = blueprintIndexAtX(locationX, plotWidth.current, weeks.length);
    const week = weeks[index];
    if (!week) return;
    lastScrubPosition.current = index;
    if (index === committedPosition.current) {
      setPreviewPosition(null);
      return;
    }
    performScrubHaptic();
    onSelectWeek(week.weekIndex);
  }, [onSelectWeek, performScrubHaptic, weeks]);

  const scrubGesture = useMemo(() => {
    const pan = Gesture.Pan()
      .withTestId('plan-blueprint-pan')
      .runOnJS(true)
      .activeOffsetX([-8, 8])
      .failOffsetY([-14, 14])
      .onBegin(beginScrub)
      .onStart((event) => previewAtX(event.x))
      .onUpdate((event) => previewAtX(event.x))
      .onEnd(finishScrub)
      .onFinalize((_event, success) => {
        if (!success) cancelScrub();
      });
    const tap = Gesture.Tap()
      .withTestId('plan-blueprint-tap')
      .runOnJS(true)
      .maxDistance(12)
      .onEnd((event, success) => {
        if (success) commitAtX(event.x);
      });
    return Gesture.Race(pan, tap);
  }, [beginScrub, cancelScrub, commitAtX, finishScrub, previewAtX]);

  const selectedGoal = selected
    ? progress?.weekGoals.find((goal) => goalMatchesWeek(goal, selected))
    : undefined;
  const selectedActualMeters = selectedGoal?.mileage.actualMeters ?? selected?.actualMeters ?? 0;
  const selectedMeta = selected
    ? hasProgress && selected.state !== 'future'
      ? `Week ${selected.weekIndex} · ${formatPlanDistance(metersToUnits(selectedActualMeters, units))}/${formatPlanDistance(metersToUnits(selected.targetMeters, units))} ${units}`
      : hasProgress
        ? `Week ${selected.weekIndex} · ${formatPlanDistance(metersToUnits(selected.targetMeters, units))} ${units} plan`
        : `Week ${selected.weekIndex} · ${formatWeekRange(selected.weekStart)}`
    : `${peakDistance} ${units} peak`;

  return (
    <View
      testID="plan-blueprint"
      style={styles.wrap}
      accessible={false}
    >
      <DueSectionHeading
        title="Mileage profile"
        meta={selectedMeta}
      />

      <View
        testID="plan-blueprint-summary"
        style={[styles.headline, accessibleLayout && styles.headlineAccessible]}
        accessible
        accessibilityRole="summary"
        accessibilityLabel={progressAccessibilityLabel(summary, hasProgress, units)}
      >
        <View style={styles.headlinePrimary}>
          <Text style={styles.headlineLabel}>{hasProgress ? 'Banked in this plan' : 'Plan mileage'}</Text>
          <View style={styles.headlineValueRow}>
            <Text style={styles.headlineValue}>{formatPlanDistance(metersToUnits(hasProgress ? summary.bankedMeters : summary.planMeters, units))}</Text>
            <Text style={styles.headlineUnit}>{units.toUpperCase()}</Text>
          </View>
          {hasProgress ? (
            <View testID="plan-blueprint-actual-key" style={styles.planTotalRow}>
              <Text style={styles.planTotal}>{`of ${formatPlanDistance(metersToUnits(summary.planMeters, units))} plan ${units}`}</Text>
            </View>
          ) : (
            <Text style={styles.planTotal}>{`${weeks.length} weeks · ${peakDistance} ${units} peak`}</Text>
          )}
        </View>

        {hasProgress && accessibleLayout ? (
          <Text
            testID="plan-blueprint-contracts-accessible"
            maxFontSizeMultiplier={2}
            style={styles.contractResultCompact}
          >
            {summary.contractsSettled > 0
              ? `${summary.contractsMet}/${summary.contractsSettled} weeks met`
              : 'First contract in progress'}
          </Text>
        ) : hasProgress ? (
          <View style={[styles.contractResult, accessibleLayout && styles.contractResultAccessible]}>
            <Text style={styles.contractValue}>{`${summary.contractsMet}/${summary.contractsSettled}`}</Text>
            <Text style={styles.contractLabel}>CONTRACTS MET</Text>
            <View style={styles.profileKey}>
              <View style={styles.profileKeyItem}>
                <View style={styles.profileKeyOutline} />
                <Text style={styles.profileKeyText}>Plan</Text>
              </View>
              <View style={styles.profileKeyItem}>
                <View style={styles.profileKeyFill} />
                <Text style={styles.profileKeyText}>Banked</Text>
              </View>
            </View>
          </View>
        ) : null}
      </View>

      <GestureDetector gesture={scrubGesture}>
        <View
          testID="plan-blueprint-plot"
          style={styles.plot}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={selected ? blueprintLabel(selected, selectedActualMeters, hasProgress, units) : 'Mileage profile'}
          accessibilityHint="Swipe up or down with one finger to choose the previous or next week"
          accessibilityValue={selected
            ? { text: blueprintValue(selected, selectedActualMeters, hasProgress, weeks.length, units) }
            : undefined}
          accessibilityActions={[
            { name: 'decrement', label: 'Previous week' },
            { name: 'increment', label: 'Next week' },
          ]}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === 'decrement') moveSelection(-1);
            if (event.nativeEvent.actionName === 'increment') moveSelection(1);
          }}
          onLayout={(event) => {
            const width = event.nativeEvent.layout.width;
            plotWidth.current = width;
            setMeasuredPlotWidth(width);
          }}
        >
          <View style={[styles.vesselRow, { gap: vesselGap(weeks.length) }]}>
            {weeks.map((week, index) => {
              const goal = progress?.weekGoals.find((candidate) => goalMatchesWeek(candidate, week));
              const actualMeters = goal?.mileage.actualMeters ?? week.actualMeters;
              return (
                <MileageVessel
                  key={week.weekId}
                  week={week}
                  actualMeters={actualMeters}
                  peakMeters={peakMeters}
                  selected={index === displayedPosition}
                  showActual={hasProgress}
                />
              );
            })}
          </View>
          {currentPosition >= 0 && measuredPlotWidth > 0 ? (
            <View
              testID={`plan-blueprint-current-${weeks[currentPosition]!.weekIndex}`}
              pointerEvents="none"
              style={[
                styles.currentGuide,
                { left: pointX(currentPosition, measuredPlotWidth, weeks.length) - CURRENT_MARKER_SIZE / 2 },
              ]}
            >
              <View style={styles.currentDot} />
            </View>
          ) : null}
        </View>
      </GestureDetector>

      <View style={styles.phaseRow}>
        {phases.map((phase) => {
          const active = phase.label.toLowerCase() === selected?.structuralPhase;
          return (
            <View key={phase.key} style={[styles.phaseRun, { flex: phase.count }]}>
              <Divider style={[styles.phaseRule, active && styles.phaseRuleActive]} />
              {phase.count > 1 ? (
                <Text style={[styles.phaseLabel, active && styles.phaseLabelActive]} numberOfLines={1}>
                  {phase.label}
                </Text>
              ) : null}
            </View>
          );
        })}
      </View>

      <View
        testID="plan-blueprint-supporting"
        style={[styles.supporting, stackSupportingMetrics && styles.supportingAccessible]}
      >
        <SupportingProgress
          testID="plan-blueprint-quality-trace"
          label="Quality"
          accessibilityLabel={`Quality ${unitWord}`}
          actual={summary.qualityMeters}
          target={summary.qualityTargetMeters}
          color={C.qual}
          textColor={C.qualText}
          showProgress={hasProgress}
          compact={accessibleLayout}
          units={units}
        />
        {/* A column rule between the two supporting goals — it turns into a row
            rule once they stack. */}
        <Divider vertical={!stackSupportingMetrics} />
        <SupportingCount
          testID="plan-blueprint-long-trace"
          label="Long runs"
          actual={summary.longRunsMet}
          target={summary.longRunsPlanned}
          color={C.cyan}
          textColor={C.cyanText}
          showProgress={hasProgress}
          compact={accessibleLayout}
        />
      </View>
    </View>
  );
}

function MileageVessel({
  week,
  actualMeters,
  peakMeters,
  selected,
  showActual,
}: {
  week: PlanBlueprintWeek;
  actualMeters: number;
  peakMeters: number;
  selected: boolean;
  showActual: boolean;
}) {
  const styles = useThemedStyles(makeStyles);
  const targetHeight = week.targetMeters <= 0
    ? EMPTY_VESSEL_HEIGHT
    : Math.max(MIN_VESSEL_HEIGHT, Math.round((week.targetMeters / peakMeters) * VESSEL_HEIGHT));
  const creditedActual = showActual && !week.isFuture ? Math.max(0, actualMeters) : 0;
  const bankedHeight = week.targetMeters > 0
    ? Math.min(
      targetHeight + MAX_OVER_HEIGHT,
      Math.max(creditedActual > 0 ? 2 : 0, (creditedActual / week.targetMeters) * targetHeight),
    )
    : 0;

  return (
    <View
      testID={`plan-blueprint-vessel-${week.weekIndex}`}
      style={styles.vesselSlot}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View
        testID={`plan-blueprint-track-${week.weekIndex}`}
        style={[
          styles.vesselTrack,
          { height: targetHeight },
          week.isFuture && styles.vesselTrackFuture,
          selected && styles.vesselTrackSelected,
        ]}
      />
      {bankedHeight > 0 ? (
        <View
          testID={`plan-blueprint-actual-${week.weekIndex}`}
          style={[
            styles.vesselFill,
            { height: bankedHeight },
            week.isCurrent && styles.vesselFillCurrent,
          ]}
        />
      ) : null}
      <View
        testID={`plan-blueprint-vessel-shape-${week.weekIndex}`}
        pointerEvents="none"
        style={[
          styles.vesselOutline,
          { height: targetHeight },
          week.isFuture && styles.vesselOutlineFuture,
          selected && styles.vesselOutlineSelected,
        ]}
      />
    </View>
  );
}

function SupportingProgress({
  testID,
  label,
  accessibilityLabel,
  actual,
  target,
  color,
  textColor,
  showProgress,
  compact,
  units,
}: {
  testID: string;
  label: string;
  accessibilityLabel: string;
  actual: number;
  target: number;
  color: string;
  textColor: string;
  showProgress: boolean;
  compact: boolean;
  units: DistancePreference;
}) {
  const styles = useThemedStyles(makeStyles);
  const credited = Math.min(actual, target);
  const fraction = target > 0 ? credited / target : 0;
  const left = Math.max(0, target - credited);
  const displayActual = planDistanceValue(metersToUnits(credited, units));
  const displayTarget = planDistanceValue(metersToUnits(target, units));
  const displayLeft = Math.max(0, displayTarget - displayActual);
  const unitWord = units === 'mi' ? 'miles' : 'kilometers';
  return (
    <View
      testID={testID}
      style={[styles.supportMetric, compact && styles.supportMetricCompact]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={showProgress
        ? `${accessibilityLabel}, ${formatMiles(metersToUnits(credited, units))} of ${formatMiles(metersToUnits(target, units))} ${unitWord}, ${formatMiles(metersToUnits(left, units))} ${unitWord} left`
        : `${accessibilityLabel}, ${formatMiles(metersToUnits(target, units))} ${unitWord} planned`}
    >
      <View
        testID={`${testID}-head`}
        style={[styles.supportHead, compact && styles.supportHeadCompact]}
      >
        <Text style={styles.supportLabel} numberOfLines={1}>{label}</Text>
        <Text style={[styles.supportValue, { color: textColor }]} numberOfLines={1}>
          {showProgress
            ? `${formatPlanDistance(displayActual)}/${formatPlanDistance(displayTarget)}`
            : `${formatPlanDistance(displayTarget)} ${units}`}
        </Text>
      </View>
      {!compact ? (
        <>
          <View style={styles.supportTrack}>
            <View style={[styles.supportFill, { width: `${fraction * 100}%`, backgroundColor: color }]} />
          </View>
          <Text style={styles.supportLeft}>{showProgress ? `${formatPlanDistance(displayLeft)} ${units} left` : 'planned'}</Text>
        </>
      ) : null}
    </View>
  );
}

function SupportingCount({
  testID,
  label,
  actual,
  target,
  color,
  textColor,
  showProgress,
  compact,
}: {
  testID: string;
  label: string;
  actual: number;
  target: number;
  color: string;
  textColor: string;
  showProgress: boolean;
  compact: boolean;
}) {
  const styles = useThemedStyles(makeStyles);
  const fraction = target > 0 ? Math.min(1, actual / target) : 0;
  const left = Math.max(0, target - actual);
  return (
    <View
      testID={testID}
      style={[styles.supportMetric, compact && styles.supportMetricCompact]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={showProgress
        ? `${label}, ${actual} of ${target}, ${left} left`
        : `${label}, ${target} planned`}
    >
      <View
        testID={`${testID}-head`}
        style={[styles.supportHead, compact && styles.supportHeadCompact]}
      >
        <Text style={styles.supportLabel} numberOfLines={1}>{label}</Text>
        <Text style={[styles.supportValue, { color: textColor }]} numberOfLines={1}>
          {showProgress ? `${actual}/${target}` : `${target}`}
        </Text>
      </View>
      {!compact ? (
        <>
          <View style={styles.supportTrack}>
            <View style={[styles.supportFill, { width: `${fraction * 100}%`, backgroundColor: color }]} />
          </View>
          <Text style={styles.supportLeft}>{showProgress ? `${left} left` : 'planned'}</Text>
        </>
      ) : null}
    </View>
  );
}

function summarizeProgress(weeks: PlanBlueprintWeek[], weekGoals: WeekGoal[]): PlanProgressSummary {
  const goals = new Map(weekGoals.map((goal) => [goalKey(goal), goal]));
  const relevantGoals = weekGoals.filter(
    (goal) => weeks.some((week) => goalMatchesWeek(goal, week)),
  );
  const adherence = adherenceSummary(relevantGoals);
  return {
    bankedMeters: relevantGoals.reduce(
      (sum, goal) => sum + (goal.isFuture ? 0 : goal.mileage.actualMeters),
      0,
    ),
    planMeters: weeks.reduce((sum, week) => sum + week.targetMeters, 0),
    contractsMet: adherence.hitN,
    contractsSettled: adherence.settledN,
    qualityMeters: weeks.reduce((sum, week) => {
      const goal = goals.get(weekKey(week));
      if (!goal || goal.isFuture) return sum;
      return sum + Math.min(goal.quality.actualMeters, goal.quality.targetMeters);
    }, 0),
    qualityTargetMeters: weeks.reduce((sum, week) => {
      const goal = goals.get(weekKey(week));
      return sum + (goal?.quality.targetMeters ?? week.qualityTargetMeters);
    }, 0),
    longRunsMet: relevantGoals.filter(
      (goal) => !goal.isFuture && goal.long.targetMeters > 0 && goal.long.hit,
    ).length,
    longRunsPlanned: weeks.filter((week) => {
      const goal = goals.get(weekKey(week));
      return (goal?.long.targetMeters ?? week.longTargetMeters) > 0;
    }).length,
  };
}

function progressAccessibilityLabel(
  summary: PlanProgressSummary,
  hasProgress: boolean,
  units: DistancePreference,
): string {
  const unitWord = units === 'mi' ? 'miles' : 'kilometers';
  if (!hasProgress) {
    return `${formatMiles(metersToUnits(summary.planMeters, units))} plan ${unitWord}`;
  }
  return `${formatMiles(metersToUnits(summary.bankedMeters, units))} of ${formatMiles(metersToUnits(summary.planMeters, units))} plan ${unitWord} banked. ${summary.contractsMet} of ${summary.contractsSettled} completed weekly contracts met.`;
}

const VESSEL_HEIGHT = 96;
const MIN_VESSEL_HEIGHT = 20;
const EMPTY_VESSEL_HEIGHT = 2;
const MAX_OVER_HEIGHT = 10;
const CURRENT_MARKER_SIZE = 6;
const SCRUB_HYSTERESIS_RATIO = 0.18;
const SCRUB_HAPTIC_INTERVAL_MS = 70;

function pointX(index: number, width: number, count: number): number {
  if (count <= 0) return 0;
  return ((index + 0.5) / count) * width;
}

function vesselGap(weekCount: number): number {
  if (weekCount > 36) return 1;
  if (weekCount > 24) return 2;
  return 3;
}

function goalKey(goal: WeekGoal): string {
  return `${goal.weekIndex}|${goal.weekStart}`;
}

function weekKey(week: PlanBlueprintWeek): string {
  return `${week.weekIndex}|${week.weekStart}`;
}

function goalMatchesWeek(goal: WeekGoal, week: PlanBlueprintWeek): boolean {
  return goal.weekIndex === week.weekIndex && goal.weekStart === week.weekStart;
}

/** Map a touch in the full-width scrub surface to its nearest week slot. */
export function blueprintIndexAtX(locationX: number, width: number, weekCount: number): number {
  if (!Number.isFinite(locationX) || width <= 0 || weekCount <= 0) return -1;
  const slotWidth = width / weekCount;
  return Math.max(0, Math.min(weekCount - 1, Math.floor(locationX / slotWidth)));
}

/**
 * Keep a scrub selection stable near week boundaries. A new adjacent week has
 * to clear a small dead band; fast drags can still skip to the week under the
 * finger.
 */
export function blueprintIndexAtXWithHysteresis(
  locationX: number,
  width: number,
  weekCount: number,
  currentIndex: number,
): number {
  const rawIndex = blueprintIndexAtX(locationX, width, weekCount);
  if (rawIndex < 0 || currentIndex < 0 || currentIndex >= weekCount || rawIndex === currentIndex) {
    return rawIndex;
  }
  const slotWidth = width / weekCount;
  if (rawIndex > currentIndex) {
    const forwardThreshold = (currentIndex + 1 + SCRUB_HYSTERESIS_RATIO) * slotWidth;
    return locationX >= forwardThreshold ? rawIndex : currentIndex;
  }
  const backwardThreshold = (currentIndex - SCRUB_HYSTERESIS_RATIO) * slotWidth;
  return locationX <= backwardThreshold ? rawIndex : currentIndex;
}

function phaseRuns(weeks: PlanBlueprintWeek[]): PhaseRun[] {
  const runs: PhaseRun[] = [];
  for (const week of weeks) {
    const label = week.structuralPhase.charAt(0).toUpperCase() + week.structuralPhase.slice(1);
    const previous = runs[runs.length - 1];
    if (previous?.label === label) previous.count += 1;
    else runs.push({ key: `${week.weekIndex}-${label}`, label, count: 1 });
  }
  return runs;
}

function phaseLabel(week: PlanBlueprintWeek): string {
  if (week.isRecovery) return 'Recovery';
  return week.phase.charAt(0).toUpperCase() + week.phase.slice(1);
}

function blueprintLabel(
  week: PlanBlueprintWeek,
  actualMeters: number,
  showActual: boolean,
  units: DistancePreference,
): string {
  const unitWord = units === 'mi' ? 'miles' : 'kilometers';
  const actual = showActual && week.state !== 'future'
    ? ` ${formatMiles(metersToUnits(actualMeters, units))} ${unitWord} banked.`
    : '';
  return `Week ${week.weekIndex}, ${phaseLabel(week)}. ${formatMiles(metersToUnits(week.targetMeters, units))} ${unitWord} contract.${actual}${week.isCurrent ? ' Current week.' : ''}`;
}

function blueprintValue(
  week: PlanBlueprintWeek,
  actualMeters: number,
  showActual: boolean,
  weekCount: number,
  units: DistancePreference,
): string {
  const unitWord = units === 'mi' ? 'miles' : 'kilometers';
  const progress = showActual && week.state !== 'future'
    ? `${formatMiles(metersToUnits(actualMeters, units))} of ${formatMiles(metersToUnits(week.targetMeters, units))} ${unitWord} banked`
    : `${formatMiles(metersToUnits(week.targetMeters, units))} ${unitWord} contract`;
  return `Week ${week.weekIndex} of ${weekCount}, ${phaseLabel(week)}, ${progress}`;
}

function formatWeekRange(weekStart: string): string {
  const start = dateParts(weekStart);
  const end = dateParts(addDays(weekStart, 6));
  if (start.month === end.month) return `${start.month} ${start.day}–${end.day}`;
  return `${start.month} ${start.day}–${end.month} ${end.day}`;
}

function dateParts(date: string): { month: string; day: number } {
  const parsed = new Date(`${date}T12:00:00Z`);
  return {
    month: parsed.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }),
    day: parsed.getUTCDate(),
  };
}

function formatMiles(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(1);
}

/** Plan-altitude distances should read like scale, not false precision. */
function formatPlanDistance(value: number): string {
  return formatMiles(planDistanceValue(value));
}

function planDistanceValue(value: number): number {
  if (Math.abs(value) >= 10) return Math.round(value);
  return Math.round(value * 10) / 10;
}

const makeStyles = (C: Tokens) =>
  StyleSheet.create({
    wrap: {
      marginHorizontal: space.lg,
      paddingTop: space.md,
      paddingHorizontal: space.lg,
      paddingBottom: space.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: C.line,
      borderRadius: radius.md,
      backgroundColor: C.card,
    },
    headline: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      gap: space.lg,
      marginTop: space.md,
    },
    headlineAccessible: { flexDirection: 'column', alignItems: 'stretch' },
    headlinePrimary: { flex: 1, minWidth: 0 },
    headlineLabel: {
      color: C.mute,
      fontSize: fontSizes.metadata,
      lineHeight: 16,
      fontWeight: '800',
    },
    headlineValueRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: space.sm,
      marginTop: space.xs,
    },
    headlineValue: {
      color: C.ink,
      fontFamily: display,
      fontSize: 38,
      lineHeight: 42,
      letterSpacing: -0.8,
      fontVariant: ['tabular-nums'],
    },
    headlineUnit: {
      color: C.mute,
      fontFamily: data,
      fontSize: fontSizes.labelSm,
      letterSpacing: 0.8,
    },
    planTotalRow: { marginTop: space.xxs },
    planTotal: {
      ...statValueText(C, 'labelSm', 'dataRegular'),
      color: C.mute,
      lineHeight: 16,
    },
    contractResult: {
      flexShrink: 0,
      alignItems: 'flex-end',
      paddingBottom: space.xxs,
    },
    contractResultAccessible: { alignItems: 'flex-start' },
    contractResultCompact: {
      ...statValueText(C, 'labelLg'),
      alignSelf: 'flex-start',
      color: C.positiveText,
      lineHeight: 34,
    },
    contractValue: {
      color: C.positiveText,
      fontFamily: data,
      fontSize: fontSizes.numeralSm,
      lineHeight: 24,
      fontVariant: ['tabular-nums'],
    },
    contractLabel: {
      marginTop: space.xs,
      color: C.mute,
      fontFamily: data,
      fontSize: fontSizes.labelSm,
      lineHeight: 14,
      letterSpacing: 0.5,
    },
    plot: {
      ...hairlineBottom(C),
      position: 'relative',
      height: VESSEL_HEIGHT + 22,
      marginTop: space.md,
      paddingTop: space.md,
    },
    profileKey: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.md,
      marginTop: space.sm,
    },
    profileKeyItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.s,
    },
    profileKeyOutline: {
      width: 8,
      height: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: C.mute,
      borderRadius: radius.xs,
      backgroundColor: C.fill,
    },
    profileKeyFill: {
      width: 8,
      height: 12,
      borderRadius: radius.xs,
      backgroundColor: C.mute,
    },
    profileKeyText: {
      color: C.mute,
      fontSize: fontSizes.labelSm,
      lineHeight: 14,
      fontWeight: '700',
    },
    vesselRow: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'flex-end',
      paddingBottom: 1,
    },
    vesselSlot: {
      position: 'relative',
      flex: 1,
      minWidth: 1,
      height: VESSEL_HEIGHT,
      alignItems: 'stretch',
      justifyContent: 'flex-end',
    },
    vesselTrack: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      width: '100%',
      minWidth: 1,
      borderRadius: radius.xs,
      backgroundColor: C.fill,
    },
    vesselTrackSelected: { backgroundColor: C.panel },
    vesselTrackFuture: { backgroundColor: C.fill },
    vesselFill: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 1,
      borderTopLeftRadius: radius.xs,
      borderTopRightRadius: radius.xs,
      // Settled weeks bank NEUTRAL; yellow belongs to the live week alone —
      // the calendar strip's grammar (today = yellow, everything else grey).
      // Two owner rounds got here: alpha-dimmed yellow composites to olive
      // mud over the dark card (hue shift, not weight), and full-strength
      // yellow across a dozen settled weeks drowns the one that matters.
      backgroundColor: C.mute,
    },
    vesselFillCurrent: { backgroundColor: C.yellow },
    vesselOutline: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 2,
      width: '100%',
      minWidth: 1,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: C.faint,
      borderRadius: radius.xs,
    },
    vesselOutlineSelected: { borderColor: C.ink },
    vesselOutlineFuture: { borderColor: C.line },
    currentGuide: {
      position: 'absolute',
      zIndex: 2,
      top: 1,
      bottom: 0,
      width: CURRENT_MARKER_SIZE,
      alignItems: 'center',
    },
    currentDot: {
      width: CURRENT_MARKER_SIZE,
      height: CURRENT_MARKER_SIZE,
      borderRadius: radius.pill,
      backgroundColor: C.yellow,
    },
    phaseRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: space.xxs,
      marginTop: space.md,
    },
    phaseRun: { minWidth: 0 },
    phaseRule: { marginBottom: space.xs },
    // The run under the selected phase brightens; every other rule keeps the
    // Divider's own C.line.
    phaseRuleActive: { backgroundColor: C.mute },
    phaseLabel: {
      color: C.mute,
      fontSize: fontSizes.labelSm,
      lineHeight: 14,
      fontWeight: '700',
      textAlign: 'center',
    },
    phaseLabelActive: { color: C.ink, fontWeight: '800' },
    supporting: {
      ...hairlineTop(C),
      flexDirection: 'row',
      gap: space.lg,
      marginTop: space.md,
      paddingTop: space.md,
    },
    supportingAccessible: { flexDirection: 'column' },
    supportMetric: { flex: 1, minWidth: 0 },
    supportMetricCompact: {
      minHeight: 44,
      flex: 0,
      justifyContent: 'center',
    },
    supportHead: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      gap: space.sm,
    },
    supportHeadCompact: { minHeight: 44 },
    supportLabel: {
      flexShrink: 1,
      color: C.ink,
      fontSize: fontSizes.metadata,
      lineHeight: 16,
      fontWeight: '800',
    },
    // Both call sites tint this to the goal's own state colour, so the factory's
    // C.ink is only the fallback.
    supportValue: {
      ...statValueText(C, 'labelSm'),
      flexShrink: 0,
      lineHeight: 16,
    },
    supportTrack: {
      overflow: 'hidden',
      height: 5,
      marginTop: space.sm,
      borderRadius: radius.xs,
      backgroundColor: C.fill,
    },
    supportFill: { height: '100%', borderRadius: radius.xs },
    supportLeft: {
      ...statValueText(C, 'labelSm', 'dataRegular'),
      marginTop: space.xs,
      color: C.mute,
      lineHeight: 14,
    },
  });
