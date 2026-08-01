import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { SymbolView } from 'expo-symbols';
import Animated, {
  Easing,
  FadeInUp,
  FadeOutUp,
  LinearTransition,
  ReduceMotion,
} from 'react-native-reanimated';

import { addDays, blueprintAllocationGaps, metersToUnits, type PlanBlueprintWeek } from '@/lib';
import { useAppPreferences, type DistancePreference } from '@/app-lib/preferences';
import { DueSectionHeading } from '@/components/brand';
import { rgba } from '@/components/charts/color';
import { PressableScale } from '@/components/PressableScale';
import { hairlineBottom, hairlineLeft, hairlineTop } from '@/components/ui/Divider';
import { Eyebrow } from '@/components/ui/Eyebrow';
import { statValueText } from '@/components/ui/Stat';
import { useTheme, useThemedStyles } from '@/theme/ThemeProvider';
import { data, dataRegular, display, fontSizes, radius, space, type Tokens } from '@/theme/tokens';

interface PhaseGroup {
  key: string;
  label: string;
  weeks: PlanBlueprintWeek[];
}

export function PlanLedger({
  weeks,
  selectedWeekIndex,
  onSelectWeek,
  onAdjustWeek,
  onOpenWeek,
  renderWeekDetails,
}: {
  weeks: PlanBlueprintWeek[];
  selectedWeekIndex: number;
  onSelectWeek: (weekIndex: number) => void;
  onAdjustWeek?: (weekIndex: number) => void;
  onOpenWeek?: (weekIndex: number) => void;
  /** Review-only readout that occupies the same drill altitude as View week. */
  renderWeekDetails?: (week: PlanBlueprintWeek) => ReactNode;
}) {
  const C = useTheme();
  const { preferences } = useAppPreferences();
  const units = preferences.distance;
  const styles = useThemedStyles(makeStyles);
  const { fontScale } = useWindowDimensions();
  const usesAccessibilityLayout = fontScale >= 1.6;
  const groups = useMemo(() => groupPhases(weeks), [weeks]);
  const selectedPosition = weeks.findIndex((week) => week.weekIndex === selectedWeekIndex);
  const selectedWeek = selectedPosition >= 0 ? weeks[selectedPosition] : null;
  const selectedGroup = groupContaining(groups, selectedWeekIndex);
  const peakMeters = Math.max(1, ...weeks.map((week) => week.targetMeters));
  const [expandedGroupKey, setExpandedGroupKey] = useState<string | null>(() => (
    selectedGroup?.key
    ?? groupContaining(groups, weeks.find((week) => week.isCurrent)?.weekIndex)?.key
    ?? groups[0]?.key
    ?? null
  ));

  useEffect(() => {
    const group = groupContaining(groups, selectedWeekIndex);
    if (group) setExpandedGroupKey(group.key);
  }, [groups, selectedWeekIndex]);

  return (
    <View style={styles.wrap}>
      <View style={styles.titleRow}>
        <DueSectionHeading
          title="Training blocks"
          meta={`${weeks.length} ${weeks.length === 1 ? 'week' : 'weeks'}`}
        />
      </View>

      <View testID="plan-ledger-surface" style={styles.phaseStack}>
        {groups.map((group, groupIndex) => {
          const expanded = group.key === expandedGroupKey;
          const summary = phaseSummary(group.weeks, units);
          const selectedInGroup = group.weeks.find((week) => week.weekIndex === selectedWeekIndex) ?? null;
          const selectedGroupPosition = selectedInGroup == null
            ? -1
            : group.weeks.findIndex((week) => week.weekIndex === selectedInGroup.weekIndex);
          const phasePosition = selectedGroupPosition < 0 ? null : selectedGroupPosition + 1;
          const openGroup = () => {
            setExpandedGroupKey(group.key);
            const next = group.weeks.find((week) => week.isCurrent) ?? group.weeks[0];
            if (next && next.weekIndex !== selectedWeekIndex) onSelectWeek(next.weekIndex);
          };
          const toggleGroup = () => {
            if (expanded) {
              setExpandedGroupKey(null);
              return;
            }
            openGroup();
          };
          return (
            <Animated.View
              key={group.key}
              testID={`plan-phase-group-${group.label.toLowerCase()}`}
              layout={GROUP_LAYOUT}
              style={[
                styles.group,
                expanded && styles.groupExpanded,
                groupIndex > 0 && styles.groupDivider,
              ]}
            >
              {expanded ? (
                <LinearGradient
                  pointerEvents="none"
                  testID={`plan-phase-gradient-${group.label.toLowerCase()}`}
                  colors={phaseGradient(group.label, C)}
                  locations={[0, 0.46, 1]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={StyleSheet.absoluteFill}
                />
              ) : null}
              <PressableScale
                testID={`phase-header-${group.label.toLowerCase()}`}
                accessibilityRole="button"
                accessibilityState={{ expanded }}
                accessibilityLabel={`${group.label} phase, ${summary.accessibility}`}
                accessibilityHint={expanded ? 'Collapses this training block' : 'Expands this training block and selects its first week'}
                onPress={toggleGroup}
              >
                <View style={[styles.groupHead, usesAccessibilityLayout && styles.groupHeadAccessible]}>
                  <View style={styles.phaseIdentity}>
                    <View style={styles.phaseCopy}>
                      <View style={styles.phaseTitleRow}>
                        <View
                          style={[
                            styles.phaseStatusDot,
                            summary.status === 'complete' && styles.phaseStatusComplete,
                            summary.status === 'current' && styles.phaseStatusCurrent,
                          ]}
                        />
                        <Text
                          testID={`phase-title-${group.label.toLowerCase()}`}
                          style={[styles.groupLabel, usesAccessibilityLayout && styles.groupLabelAccessible]}
                        >
                          {group.label}
                        </Text>
                        {phasePosition != null ? (
                          <Text style={[styles.phasePosition, usesAccessibilityLayout && styles.phasePositionAccessible]}>
                            {`Week ${phasePosition} of ${group.weeks.length}`}
                          </Text>
                        ) : null}
                      </View>
                      <Text style={[styles.groupMeta, usesAccessibilityLayout && styles.groupMetaAccessible]}>
                        {`${summary.statusLabel} · ${summary.range}`}
                      </Text>
                    </View>
                  </View>
                  <View style={[styles.groupSummary, usesAccessibilityLayout && styles.groupSummaryAccessible]}>
                    <Text style={[styles.groupLoad, usesAccessibilityLayout && styles.groupLoadAccessible]}>
                      {summary.load}
                    </Text>
                    <SymbolView
                      name={expanded ? 'chevron.up' : 'chevron.down'}
                      size={12}
                      tintColor={C.mute}
                      weight="semibold"
                      resizeMode="scaleAspectFit"
                    />
                  </View>
                </View>
              </PressableScale>

              {expanded && selectedInGroup ? (
                <Animated.View
                  testID={`plan-phase-body-${group.label.toLowerCase()}`}
                  entering={WEEKS_ENTER}
                  exiting={WEEKS_EXIT}
                  style={styles.expandedBody}
                >
                  <PhaseWeekStrip
                    weeks={group.weeks}
                    selectedWeekIndex={selectedWeekIndex}
                    previousDisabled={selectedGroupPosition <= 0}
                    nextDisabled={selectedGroupPosition < 0 || selectedGroupPosition >= group.weeks.length - 1}
                    onPrevious={() => {
                      const previous = group.weeks[selectedGroupPosition - 1];
                      if (previous) onSelectWeek(previous.weekIndex);
                    }}
                    onNext={() => {
                      const next = group.weeks[selectedGroupPosition + 1];
                      if (next) onSelectWeek(next.weekIndex);
                    }}
                    onSelectWeek={onSelectWeek}
                    accessibleLayout={usesAccessibilityLayout}
                  />
                  <WeekStrategy
                    week={selectedInGroup}
                    peakMeters={peakMeters}
                    onAdjust={!onAdjustWeek || selectedInGroup.state === 'past'
                      ? null
                      : () => onAdjustWeek(selectedInGroup.weekIndex)}
                    onOpen={onOpenWeek ? () => onOpenWeek(selectedInGroup.weekIndex) : null}
                    details={renderWeekDetails?.(selectedInGroup) ?? null}
                    accessibleLayout={usesAccessibilityLayout}
                    currentWeek={weeks.find((week) => week.isCurrent) ?? null}
                    onReturnCurrent={(weekIndex) => onSelectWeek(weekIndex)}
                  />
                </Animated.View>
              ) : null}
            </Animated.View>
          );
        })}
      </View>

      {selectedWeek == null ? (
        <Text style={styles.empty}>Select a week in the mileage profile to inspect its place in the plan.</Text>
      ) : null}
    </View>
  );
}

function PhaseWeekStrip({
  weeks,
  selectedWeekIndex,
  previousDisabled,
  nextDisabled,
  onPrevious,
  onNext,
  onSelectWeek,
  accessibleLayout,
}: {
  weeks: PlanBlueprintWeek[];
  selectedWeekIndex: number;
  previousDisabled: boolean;
  nextDisabled: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onSelectWeek: (weekIndex: number) => void;
  accessibleLayout: boolean;
}) {
  const C = useTheme();
  const { preferences } = useAppPreferences();
  const units = preferences.distance;
  const styles = useThemedStyles(makeStyles);
  const scrollRef = useRef<ScrollView | null>(null);
  const selectedPosition = Math.max(0, weeks.findIndex((week) => week.weekIndex === selectedWeekIndex));
  const committedPosition = useRef(selectedPosition);
  const [viewportWidth, setViewportWidth] = useState(WEEK_TILE_WIDTH * 3);
  const tileWidth = viewportWidth / VISIBLE_WEEK_TILES;
  const reelPadding = Math.max(0, (viewportWidth - tileWidth) / 2);

  const revealSelected = (animated: boolean) => {
    scrollRef.current?.scrollTo({
      x: selectedPosition * tileWidth,
      animated,
    });
  };

  const selectPosition = (position: number, haptic = true) => {
    const nextPosition = Math.max(0, Math.min(weeks.length - 1, position));
    const week = weeks[nextPosition];
    if (!week || nextPosition === committedPosition.current) return;
    committedPosition.current = nextPosition;
    onSelectWeek(week.weekIndex);
    if (haptic) void Haptics.selectionAsync().catch(() => undefined);
  };

  const settleAtOffset = (offset: number) => {
    selectPosition(Math.round(offset / tileWidth));
  };

  const selectAdjacent = (move: () => void) => {
    move();
    void Haptics.selectionAsync().catch(() => undefined);
  };

  useEffect(() => {
    committedPosition.current = selectedPosition;
    const reveal = () => revealSelected(true);
    if (typeof requestAnimationFrame !== 'function') {
      reveal();
      return;
    }
    const frame = requestAnimationFrame(reveal);
    return () => cancelAnimationFrame(frame);
  }, [selectedPosition, viewportWidth]);

  const selectedWeek = weeks[selectedPosition] ?? null;
  if (accessibleLayout && selectedWeek) {
    return (
      <View style={styles.weekSelectorAccessible}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous week"
          accessibilityState={{ disabled: previousDisabled }}
          disabled={previousDisabled}
          onPress={() => selectAdjacent(onPrevious)}
          style={({ pressed }) => [
            styles.weekArrow,
            previousDisabled && styles.weekArrowDisabled,
            pressed && styles.pressed,
          ]}
        >
          <SymbolView name="chevron.left" size={18} tintColor={C.ink} weight="semibold" resizeMode="scaleAspectFit" />
        </Pressable>
        <View
          style={styles.weekSelectorCopy}
          accessible
          accessibilityRole="text"
          accessibilityLabel={weekAccessibilityLabel(selectedWeek, units)}
        >
          <View style={styles.weekSelectorTitleRow}>
            <Text style={styles.weekSelectorTitle}>{formatWeekRange(selectedWeek.weekStart)}</Text>
            {selectedWeek.isCurrent ? <Eyebrow size="micro" color={C.yellowText}>CURRENT</Eyebrow> : null}
          </View>
          <Text style={styles.weekSelectorMeta}>
            {`Week ${selectedWeek.weekIndex} · ${formatMiles(metersToUnits(selectedWeek.targetMeters, units))} ${units}`}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next week"
          accessibilityState={{ disabled: nextDisabled }}
          disabled={nextDisabled}
          onPress={() => selectAdjacent(onNext)}
          style={({ pressed }) => [
            styles.weekArrow,
            nextDisabled && styles.weekArrowDisabled,
            pressed && styles.pressed,
          ]}
        >
          <SymbolView name="chevron.right" size={18} tintColor={C.ink} weight="semibold" resizeMode="scaleAspectFit" />
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.weekCarousel}>
      <View style={[styles.weekNav, accessibleLayout && styles.weekNavAccessible]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous week"
          accessibilityState={{ disabled: previousDisabled }}
          disabled={previousDisabled}
          onPress={() => selectAdjacent(onPrevious)}
          style={({ pressed }) => [
            styles.weekArrow,
            previousDisabled && styles.weekArrowDisabled,
            pressed && styles.pressed,
          ]}
        >
          <SymbolView name="chevron.left" size={13} tintColor={C.ink} weight="semibold" resizeMode="scaleAspectFit" />
        </Pressable>

        <View
          style={styles.weekViewport}
          onLayout={(event) => setViewportWidth(event.nativeEvent.layout.width)}
        >
          <ScrollView
            ref={scrollRef}
            testID="plan-week-reel"
            horizontal
            style={styles.weekScroller}
            contentContainerStyle={[styles.weekStrip, { paddingHorizontal: reelPadding }]}
            showsHorizontalScrollIndicator={false}
            snapToInterval={tileWidth}
            snapToAlignment="start"
            decelerationRate="fast"
            scrollEventThrottle={16}
            onScrollEndDrag={(event) => {
              const velocity = Math.abs(event.nativeEvent.velocity?.x ?? 0);
              if (velocity <= 0.05) settleAtOffset(event.nativeEvent.contentOffset.x);
            }}
            onMomentumScrollEnd={(event) => settleAtOffset(event.nativeEvent.contentOffset.x)}
            onContentSizeChange={() => revealSelected(false)}
          >
            {weeks.map((week, position) => {
              const selected = week.weekIndex === selectedWeekIndex;
              return (
                <PressableScale
                  key={week.weekId}
                  testID={`plan-week-${week.weekIndex}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={weekAccessibilityLabel(week, units)}
                  onPress={() => {
                    selectPosition(position);
                    scrollRef.current?.scrollTo({ x: position * tileWidth, animated: true });
                  }}
                  style={[
                    styles.weekTile,
                    { width: tileWidth },
                    !selected && styles.weekTileNeighbor,
                    accessibleLayout && styles.weekTileAccessible,
                  ]}
                >
                  <Text
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.78}
                    style={[styles.weekDate, selected && styles.weekDateSelected]}
                  >
                    {formatWeekRange(week.weekStart)}
                  </Text>
                  <Text
                    style={[
                      styles.weekMiles,
                      selected && styles.weekMilesSelected,
                    ]}
                  >
                    {`${formatMiles(metersToUnits(week.targetMeters, units))} ${units}`}
                  </Text>
                  <WeekHighlight week={week} />
                </PressableScale>
              );
            })}
          </ScrollView>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next week"
          accessibilityState={{ disabled: nextDisabled }}
          disabled={nextDisabled}
          onPress={() => selectAdjacent(onNext)}
          style={({ pressed }) => [
            styles.weekArrow,
            nextDisabled && styles.weekArrowDisabled,
            pressed && styles.pressed,
          ]}
        >
          <SymbolView name="chevron.right" size={13} tintColor={C.ink} weight="semibold" resizeMode="scaleAspectFit" />
        </Pressable>
      </View>

      <View
        testID="plan-week-page-indicator"
        style={styles.weekPageIndicator}
        accessible={false}
      >
        {weeks.map((week, position) => {
          const selected = position === selectedPosition;
          return (
            <View
              key={week.weekId}
              testID={`plan-week-page-${week.weekIndex}`}
              style={[
                styles.weekPageDot,
                week.isCurrent && styles.weekPageDotCurrent,
                selected && styles.weekPageDotSelected,
                selected && week.isCurrent && styles.weekPageDotSelectedCurrent,
              ]}
            />
          );
        })}
      </View>
    </View>
  );
}

function WeekHighlight({ week }: { week: PlanBlueprintWeek }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.weekHighlight}>
      {week.isRecovery ? (
        <Text testID={`plan-week-recovery-${week.weekIndex}`} style={styles.weekRecovery}>Recovery</Text>
      ) : null}
    </View>
  );
}

function WeekStrategy({
  week,
  peakMeters,
  onAdjust,
  onOpen,
  details,
  accessibleLayout,
  currentWeek,
  onReturnCurrent,
}: {
  week: PlanBlueprintWeek;
  peakMeters: number;
  onAdjust: (() => void) | null;
  onOpen: (() => void) | null;
  details: ReactNode;
  accessibleLayout: boolean;
  currentWeek: PlanBlueprintWeek | null;
  onReturnCurrent: (weekIndex: number) => void;
}) {
  const C = useTheme();
  const { preferences } = useAppPreferences();
  const units = preferences.distance;
  const unitWord = units === 'mi' ? 'miles' : 'kilometers';
  const styles = useThemedStyles(makeStyles);
  const targetDistance = formatMiles(metersToUnits(week.targetMeters, units));
  const qualityDistance = formatMiles(metersToUnits(week.qualityTargetMeters, units));
  const longDistance = formatMiles(metersToUnits(week.longTargetMeters, units));
  const status = weekStatus(week, peakMeters, units);

  return (
    <View style={styles.strategy}>
      {currentWeek && currentWeek.weekIndex !== week.weekIndex ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Return to current week, Week ${currentWeek.weekIndex}`}
          onPress={() => onReturnCurrent(currentWeek.weekIndex)}
          style={({ pressed }) => [
            styles.returnCurrent,
            accessibleLayout && styles.returnCurrentAccessible,
            pressed && styles.pressed,
          ]}
        >
          <View style={styles.returnCurrentIdentity}>
            <View style={styles.currentDotInline} />
            <Text style={styles.returnCurrentLabel}>{`Week ${currentWeek.weekIndex} is current`}</Text>
          </View>
          <Text style={styles.returnCurrentAction}>Return</Text>
        </Pressable>
      ) : null}
      <View
        accessible
        accessibilityRole="summary"
        accessibilityLabel={`Week ${week.weekIndex} strategy. ${targetDistance} ${unitWord} weekly contract, ${qualityDistance} quality ${unitWord}, ${longDistance} continuous long-run ${unitWord}. ${status.accessibility}`}
      >
        <View style={[styles.metrics, accessibleLayout && styles.metricsAccessible]}>
          <StrategyMetric value={targetDistance} unit={units} label="Weekly contract" primary accessibleLayout={accessibleLayout} />
          <StrategyMetric value={qualityDistance} unit={units} label="Quality" tone="quality" accessibleLayout={accessibleLayout} />
          <StrategyMetric value={longDistance} unit={units} label="Long run" tone="long" accessibleLayout={accessibleLayout} />
        </View>

        <View style={[styles.focusRow, accessibleLayout && styles.focusRowAccessible]}>
          <Text style={[styles.focusLabel, accessibleLayout && styles.focusLabelAccessible]}>{status.label}</Text>
          <Text
            style={[
              styles.focusText,
              status.needsAttention && styles.focusTextAttention,
              accessibleLayout && styles.focusTextAccessible,
            ]}
          >
            {status.text}
          </Text>
        </View>
      </View>

      {details}

      {onAdjust || onOpen ? (
      <View style={[styles.actionRow, accessibleLayout && styles.actionRowAccessible]}>
        {onAdjust ? (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Adjust week ${week.weekIndex}`}
              onPress={onAdjust}
              style={({ pressed }) => [styles.adjustWeek, accessibleLayout && styles.actionAccessible, pressed && styles.pressed]}
            >
              <SymbolView name="pencil" size={11} tintColor={C.ink} weight="semibold" resizeMode="scaleAspectFit" />
              <Text style={styles.adjustWeekText}>Adjust week</Text>
            </Pressable>
          </>
        ) : null}
        {onOpen ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`View Week ${week.weekIndex}`}
            onPress={onOpen}
            style={({ pressed }) => [styles.openWeek, accessibleLayout && styles.actionAccessible, pressed && styles.pressed]}
          >
            <Text style={styles.openWeekText}>View week</Text>
            <SymbolView name="chevron.right" size={12} tintColor={C.mute} weight="semibold" resizeMode="scaleAspectFit" />
          </Pressable>
        ) : null}
      </View>
      ) : null}
    </View>
  );
}

function StrategyMetric({
  value,
  unit,
  label,
  tone = 'neutral',
  primary = false,
  accessibleLayout,
}: {
  value: string;
  unit: string;
  label: string;
  tone?: 'neutral' | 'quality' | 'long';
  primary?: boolean;
  accessibleLayout: boolean;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.metric, accessibleLayout && styles.metricAccessible]}>
      <Text style={styles.metricQuantity}>
        <Text
          style={[
            styles.metricValue,
            tone === 'quality' && styles.metricValueQuality,
            tone === 'long' && styles.metricValueLong,
            accessibleLayout && styles.metricValueAccessible,
            primary && styles.metricValuePrimary,
          ]}
        >
          {value}
        </Text>
        <Text style={[styles.metricUnit, accessibleLayout && styles.metricUnitAccessible]}>{` ${unit}`}</Text>
      </Text>
      <Text style={[styles.metricLabel, accessibleLayout && styles.metricLabelAccessible]}>{label}</Text>
    </View>
  );
}

function phaseSummary(weeks: PlanBlueprintWeek[], units: DistancePreference): {
  range: string;
  load: string;
  accessibility: string;
  status: 'complete' | 'current' | 'upcoming';
  statusLabel: string;
} {
  const indexRange = groupRange(weeks);
  const dates = groupDateRange(weeks);
  const loads = weeks.map((week) => Math.round(metersToUnits(week.targetMeters, units)));
  const low = Math.min(...loads);
  const high = Math.max(...loads);
  const contractRange = low === high ? `${low} ${units}` : `${low}–${high} ${units}`;
  const recoveryCount = weeks.filter((week) => week.isRecovery).length;
  const status = weeks.some((week) => week.isCurrent)
    ? 'current'
    : weeks.every((week) => week.state === 'past')
      ? 'complete'
      : 'upcoming';
  const statusLabel = status === 'current'
    ? 'In progress'
    : status === 'complete'
      ? 'Complete'
      : 'Upcoming';
  return {
    range: dates,
    load: contractRange,
    status,
    statusLabel,
    accessibility: `${statusLabel}, ${indexRange}, ${dates}, contracts ${contractRange}, ${recoveryCount} ${recoveryCount === 1 ? 'recovery week' : 'recovery weeks'}`,
  };
}

function weekStatus(
  week: PlanBlueprintWeek,
  peakMeters: number,
  units: DistancePreference,
): {
  label: string;
  text: string;
  accessibility: string;
  needsAttention: boolean;
} {
  const gapThreshold = 0.05 * 1609.344;
  const phase = week.structuralPhase.toLowerCase();
  const highVolume = week.targetMeters >= peakMeters * 0.92;
  const role = week.isRecovery
    ? 'Recovery'
    : phase === 'peak' && highVolume
      ? 'Peak mileage'
      : phase === 'build' && highVolume
        ? 'High volume'
        : null;
  const overMeters = week.allocationDeltaMeters < -gapThreshold
    ? Math.abs(week.allocationDeltaMeters)
    : 0;
  const open = blueprintAllocationGaps(week);
  const unitWord = units === 'mi' ? 'miles' : 'kilometers';
  if (open.length > 0 && week.state !== 'past') {
    const detail = open
      .map((gap) => `${formatMiles(metersToUnits(gap.meters, units))} ${gap.label}`)
      .join(', ');
    const visible = open
      .map((gap) => `${formatMiles(metersToUnits(gap.meters, units))} ${gap.shortLabel}`)
      .join(' · ');
    const over = overMeters > 0 ? formatMiles(metersToUnits(overMeters, units)) : null;
    return {
      label: over ? 'Allocation' : role ? `${role} · ${unitWord} open` : `${unitWord[0]!.toUpperCase()}${unitWord.slice(1)} open`,
      text: over ? `${over} over · ${visible} open` : visible,
      accessibility: `${role ? `${role} week. ` : ''}${over ? `${over} ${unitWord} over the weekly contract. ` : ''}Allocation needs attention: ${detail} still open.`,
      needsAttention: true,
    };
  }

  if (overMeters > 0 && week.state !== 'past') {
    const over = formatMiles(metersToUnits(overMeters, units));
    return {
      label: 'Allocation',
      text: `${over} ${units} over contract`,
      accessibility: `Allocation is ${over} ${unitWord} over the weekly contract.`,
      needsAttention: true,
    };
  }

  const sessions = week.keySessions.length;
  const shape = `${week.runDays} ${week.runDays === 1 ? 'run day' : 'run days'} · ${sessions} ${sessions === 1 ? 'key session' : 'key sessions'}`;
  return {
    label: 'Week shape',
    text: shape,
    accessibility: `${role ? `${role} week, ` : ''}${week.runDays} ${week.runDays === 1 ? 'run day' : 'run days'}, ${sessions} ${sessions === 1 ? 'key session' : 'key sessions'}.`,
    needsAttention: false,
  };
}

function groupContaining(groups: PhaseGroup[], weekIndex: number | undefined): PhaseGroup | undefined {
  if (weekIndex == null) return undefined;
  return groups.find((group) => group.weeks.some((week) => week.weekIndex === weekIndex));
}

function groupRange(weeks: PlanBlueprintWeek[]): string {
  const first = weeks[0]!.weekIndex;
  const last = weeks[weeks.length - 1]!.weekIndex;
  return first === last ? `W${first}` : `W${first}–${last}`;
}

function groupDateRange(weeks: PlanBlueprintWeek[]): string {
  const start = dateParts(weeks[0]!.weekStart);
  const end = dateParts(addDays(weeks[weeks.length - 1]!.weekStart, 6));
  if (start.month === end.month) return `${start.month} ${start.day}–${end.day}`;
  return `${start.month} ${start.day}–${end.month} ${end.day}`;
}

function groupPhases(weeks: PlanBlueprintWeek[]): PhaseGroup[] {
  const groups: PhaseGroup[] = [];
  for (const week of weeks) {
    const label = `${week.structuralPhase.charAt(0).toUpperCase()}${week.structuralPhase.slice(1)}`;
    const previous = groups[groups.length - 1];
    if (previous?.label === label) previous.weeks.push(week);
    else groups.push({ key: `${week.weekIndex}-${label}`, label, weeks: [week] });
  }
  return groups;
}

function formatWeekRange(weekStart: string): string {
  const start = dateParts(weekStart);
  const end = dateParts(addDays(weekStart, 6));
  if (start.month === end.month) return `${start.month} ${start.day}–${end.day}`;
  return `${start.month} ${start.day}–${end.month} ${end.day}`;
}

function weekAccessibilityLabel(week: PlanBlueprintWeek, units: DistancePreference): string {
  const unitWord = units === 'mi' ? 'mile' : 'kilometer';
  return `Week ${week.weekIndex}, ${formatWeekRange(week.weekStart)}, ${formatMiles(metersToUnits(week.targetMeters, units))} ${unitWord} contract${week.isRecovery ? ', recovery week' : ''}${week.isCurrent ? ', current week' : ''}`;
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

/**
 * Block wash for Base/Build/Peak/Taper.
 *
 * This is a SANCTIONED use of the `plan*` art palette. tokens.ts reserves it for
 * plan identity and bars it from encoding "contract state or workout type" — a
 * training phase is neither: it is plan structure, on the plan's own surface,
 * and it deliberately shares the language of the generated covers. (The Dash
 * day panel's type wash was NOT sanctioned and was moved onto the semantic tone
 * colours; see `DayPanel.workoutGradient`.) The owner reviewed and kept this
 * gradient; don't "fix" it to semantic tokens.
 */
function phaseGradient(label: string, C: Tokens): readonly [string, string, string] {
  const normalized = label.toLowerCase();
  const [primary, secondary] = normalized === 'base'
    ? [C.planBlue, C.planViolet]
    : normalized === 'peak'
      ? [C.planViolet, C.planBlue]
      : normalized === 'taper'
        ? [C.planBlue, C.planWarm]
        : [C.planWarm, C.planViolet];
  return [
    rgba(primary, 0.18),
    rgba(secondary, 0.075),
    rgba(C.recess, 0),
  ];
}

const WEEK_TILE_WIDTH = 92;
const VISIBLE_WEEK_TILES = 3;
const GROUP_LAYOUT = LinearTransition
  .duration(200)
  .easing(Easing.out(Easing.cubic))
  .reduceMotion(ReduceMotion.System);
const WEEKS_ENTER = FadeInUp
  .duration(130)
  .easing(Easing.out(Easing.cubic))
  .reduceMotion(ReduceMotion.System);
const WEEKS_EXIT = FadeOutUp
  .duration(90)
  .easing(Easing.out(Easing.quad))
  .reduceMotion(ReduceMotion.System);

const makeStyles = (C: Tokens) =>
  StyleSheet.create({
    wrap: { paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.xl },
    titleRow: { marginBottom: space.md },
    phaseStack: {
      overflow: 'hidden',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: C.line,
      borderRadius: radius.md,
      backgroundColor: C.card,
    },
    group: {
      overflow: 'hidden',
      backgroundColor: 'transparent',
    },
    // A rounded ISLAND, not a squared band: the expanded block is the one
    // surface in the ledger that lifts off the stack (recess + gradient), and
    // sharp corners on it were the only unrounded edges in the app. `group`
    // already clips (overflow: hidden), so the gradient follows the curve.
    // …and INSET, not flush: a rounded island sitting edge-to-edge inside the
    // squared ledger reads as a corner collision. The margin lets it float in
    // the stack the way the Dash day panel de-dent does.
    groupExpanded: { backgroundColor: C.recess, borderRadius: radius.lg, marginHorizontal: space.s, marginVertical: space.s },
    groupDivider: hairlineTop(C),
    groupHead: {
      minHeight: 64,
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.md,
      paddingHorizontal: space.lg,
      paddingVertical: space.sm,
    },
    groupHeadAccessible: { minHeight: 0, flexDirection: 'column', alignItems: 'stretch' },
    phaseIdentity: { flex: 1, minWidth: 0 },
    phaseCopy: { flex: 1, minWidth: 0 },
    phaseTitleRow: { minWidth: 0, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm },
    phaseStatusDot: {
      width: 7,
      height: 7,
      borderRadius: radius.pill,
      backgroundColor: C.faint,
    },
    phaseStatusComplete: { backgroundColor: C.positiveText },
    phaseStatusCurrent: { backgroundColor: C.yellow },
    groupLabel: { color: C.ink, fontFamily: display, fontSize: fontSizes.sectionTitle, letterSpacing: -0.2 },
    groupLabelAccessible: { fontSize: fontSizes.sectionTitle },
    phasePosition: { ...statValueText(C, 'metadata', 'system'), color: C.mute, lineHeight: 16, fontWeight: '600' },
    phasePositionAccessible: { fontSize: fontSizes.metadata },
    groupMeta: { ...statValueText(C, 'metadata', 'system'), marginTop: space.xxs, color: C.mute, lineHeight: 16, fontWeight: '600' },
    groupMetaAccessible: { fontSize: fontSizes.metadata },
    groupSummary: { flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: space.m },
    groupSummaryAccessible: { alignSelf: 'stretch', justifyContent: 'space-between' },
    groupLoad: {
      ...statValueText(C, 'label'),
      minWidth: 76,
      lineHeight: 17,
      textAlign: 'right',
      textTransform: 'uppercase',
    },
    groupLoadAccessible: { minWidth: 0, fontSize: fontSizes.label },
    expandedBody: {
      ...hairlineTop(C),
      overflow: 'hidden',
      paddingBottom: space.sm,
      backgroundColor: 'transparent',
    },
    weekCarousel: { paddingBottom: space.xs },
    weekNav: { minHeight: 82, flexDirection: 'row', alignItems: 'center', paddingTop: space.s },
    weekNavAccessible: { alignItems: 'stretch' },
    weekSelectorAccessible: { minHeight: 72, flexDirection: 'row', alignItems: 'stretch', paddingVertical: space.sm },
    weekSelectorCopy: { flex: 1, minWidth: 0, justifyContent: 'center', paddingHorizontal: space.sm },
    weekSelectorTitleRow: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: space.sm },
    weekSelectorTitle: { ...statValueText(C, 'body', 'system'), lineHeight: 20, fontWeight: '700' },
    weekSelectorMeta: { ...statValueText(C, 'metadata', 'system'), marginTop: space.nudge, color: C.mute, fontWeight: '700' },
    weekArrow: { width: 44, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
    weekArrowDisabled: { opacity: 0.22 },
    weekViewport: {
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: 0,
      minWidth: 0,
      height: 76,
      position: 'relative',
      overflow: 'hidden',
    },
    weekScroller: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
    weekStrip: { alignItems: 'stretch' },
    weekTile: {
      minHeight: 68,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: space.s,
      paddingVertical: space.sm,
      borderRadius: radius.sm,
    },
    weekTileNeighbor: { opacity: 0.54 },
    weekTileAccessible: { minHeight: 72 },
    weekDate: { ...statValueText(C, 'metadata', 'system'), color: C.mute, lineHeight: 16, fontWeight: '600' },
    weekDateSelected: { color: C.ink, fontSize: fontSizes.label, lineHeight: 18, fontWeight: '700' },
    weekMiles: {
      ...statValueText(C, 'metadata', 'dataRegular'),
      marginTop: space.xs,
      color: C.mute,
      lineHeight: 16,
      textTransform: 'uppercase',
    },
    weekMilesSelected: { color: C.ink, fontFamily: data, fontSize: fontSizes.label, lineHeight: 17 },
    weekHighlight: { minHeight: 10, marginTop: space.s, alignItems: 'center', justifyContent: 'center' },
    weekRecovery: { color: C.mute, fontSize: fontSizes.metadata, lineHeight: 16, fontWeight: '600' },
    weekPageIndicator: {
      height: 16,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: space.s,
      marginTop: -space.sm,
    },
    weekPageDot: {
      width: 5,
      height: 5,
      borderRadius: radius.pill,
      backgroundColor: C.faint,
      opacity: 0.36,
    },
    weekPageDotCurrent: {
      backgroundColor: C.yellow,
      opacity: 0.78,
    },
    weekPageDotSelected: {
      width: 20,
      backgroundColor: C.ink,
      opacity: 0.92,
    },
    weekPageDotSelectedCurrent: {
      backgroundColor: C.yellow,
      opacity: 1,
    },
    strategy: {},
    returnCurrent: {
      ...hairlineBottom(C),
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: space.md,
      paddingHorizontal: space.lg,
    },
    returnCurrentAccessible: {
      minHeight: 0,
      alignItems: 'flex-start',
      paddingVertical: space.md,
    },
    returnCurrentIdentity: {
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
    },
    currentDotInline: {
      width: 6,
      height: 6,
      borderRadius: radius.pill,
      backgroundColor: C.yellow,
    },
    returnCurrentLabel: {
      flexShrink: 1,
      color: C.mute,
      fontSize: fontSizes.metadata,
      lineHeight: 16,
      fontWeight: '600',
    },
    returnCurrentAction: {
      color: C.yellowText,
      fontSize: fontSizes.metadata,
      lineHeight: 16,
      fontWeight: '700',
    },
    metrics: {
      minHeight: 78,
      flexDirection: 'row',
      alignItems: 'stretch',
      gap: space.lg,
      paddingHorizontal: space.lg,
      paddingTop: space.sm,
      paddingBottom: space.md,
    },
    metricsAccessible: { flexDirection: 'column', gap: space.md },
    metric: { flex: 1, minWidth: 0, justifyContent: 'center' },
    metricAccessible: { paddingHorizontal: 0 },
    metricQuantity: {
      minHeight: 29,
      color: C.ink,
      fontFamily: dataRegular,
      fontSize: fontSizes.numeralSm,
      lineHeight: 29,
      textTransform: 'uppercase',
      fontVariant: ['tabular-nums'],
    },
    metricValue: { color: C.ink, fontFamily: data, fontSize: fontSizes.numeralSm, lineHeight: 29, fontVariant: ['tabular-nums'] },
    metricValuePrimary: { fontSize: fontSizes.sheetTitle },
    metricValueQuality: { color: C.qualText },
    metricValueLong: { color: C.cyanText },
    metricValueAccessible: { fontSize: fontSizes.numeralSm },
    metricUnit: { color: C.mute, fontFamily: dataRegular, fontSize: fontSizes.metadata, lineHeight: 29 },
    metricUnitAccessible: { fontSize: fontSizes.metadata },
    metricLabel: { marginTop: space.xxs, color: C.mute, fontSize: fontSizes.metadata, lineHeight: 16, fontWeight: '600' },
    metricLabelAccessible: { fontSize: fontSizes.metadata },
    focusRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: space.sm,
      paddingHorizontal: space.lg,
      paddingBottom: space.md,
    },
    focusRowAccessible: { flexDirection: 'column', alignItems: 'flex-start' },
    focusLabel: { width: 84, color: C.mute, fontSize: fontSizes.metadata, lineHeight: 16, fontWeight: '600' },
    focusLabelAccessible: { width: 'auto' },
    focusText: { flex: 1, minWidth: 0, color: C.ink, fontSize: fontSizes.label, lineHeight: 18, fontWeight: '600' },
    // warningText, not yellow: yellow is the BANKED accent, and an attention
    // state wearing it read as a fourth competing colour in the panel. Orange
    // is the app's week-level judgment mark — which an allocation gap is.
    focusTextAttention: { color: C.warningText },
    focusTextAccessible: { fontSize: fontSizes.label, lineHeight: 18 },
    actionRow: {
      ...hairlineTop(C),
      minHeight: 50,
      flexDirection: 'row',
      alignItems: 'stretch',
      gap: space.sm,
    },
    actionRowAccessible: { minHeight: 0, flexDirection: 'column' },
    adjustWeek: { flex: 1, minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.s, paddingHorizontal: space.lg },
    adjustWeekText: { color: C.ink, fontSize: fontSizes.label, lineHeight: 18, fontWeight: '700' },
    // Centered label+chevron as one unit, ruled off from Adjust — the old
    // space-between pushed the chevron to the far edge, where it read as the
    // ROW's affordance and left it ambiguous which action it belonged to.
    openWeek: { ...hairlineLeft(C), flex: 1, minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs, paddingHorizontal: space.lg },
    openWeekText: { color: C.mute, fontSize: fontSizes.label, lineHeight: 18, fontWeight: '700' },
    actionAccessible: { minHeight: 0, paddingVertical: space.md },
    empty: { color: C.mute, fontSize: fontSizes.label, lineHeight: 18, fontWeight: '700' },
    pressed: { opacity: 0.58 },
  });
