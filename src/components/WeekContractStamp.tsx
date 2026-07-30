/**
 * The shared weekly-contract seal used wherever Due renders the permanent
 * plan record. The outer ring is mileage completion, the small violet/cyan
 * arcs are earned supporting contracts, and the corner x permanently records
 * a settled miss. A live week is the only yellow ring.
 */
import { useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  type StyleProp,
  View,
  type ViewStyle,
} from 'react-native';
import { SymbolView } from 'expo-symbols';
import Svg, { Circle } from 'react-native-svg';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { useAppPreferences, type DistancePreference } from '@/app-lib/preferences';
import { PressableScale } from '@/components/PressableScale';
import { metersToUnits, type WeekGoal } from '@/lib';
import { statValueText } from '@/components/ui/Stat';
import { useTheme, useThemedStyles } from '@/theme/ThemeProvider';
import { motion, radius, space, type Tokens } from '@/theme/tokens';

export const CONTRACT_STAMPS_PER_ROW = 6;

const STAMP_SIZE = 38;
const STAMP_CENTER = STAMP_SIZE / 2;
const MILEAGE_RADIUS = 17.25;
const MILEAGE_CIRCUMFERENCE = 2 * Math.PI * MILEAGE_RADIUS;
const SUPPORT_RADIUS = 13.25;
const SUPPORT_CIRCUMFERENCE = 2 * Math.PI * SUPPORT_RADIUS;
const SUPPORT_ARC = SUPPORT_CIRCUMFERENCE * (42 / 360);
const SELECT_EASE = Easing.bezier(...motion.easeOut);

type StampStatus = 'hit' | 'miss' | 'current' | 'future';

function stampStatus(week: WeekGoal): StampStatus {
  if (week.isFuture) return 'future';
  if (week.isCurrent) return 'current';
  return week.mileage.hit ? 'hit' : 'miss';
}

function contractDistance(week: WeekGoal, units: DistancePreference): string {
  const distance = Math.round(metersToUnits(week.mileage.targetMeters, units));
  return distance > 0 ? String(distance) : '—';
}

export function WeekContractStamp({
  week,
  testIDPrefix = 'contract-stamp',
  selected = false,
  onPress,
  slotStyle,
}: {
  week: WeekGoal;
  testIDPrefix?: string;
  selected?: boolean;
  onPress?: () => void;
  slotStyle?: StyleProp<ViewStyle>;
}) {
  const C = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { preferences } = useAppPreferences();
  const units = preferences.distance;
  const unitWord = units === 'mi' ? 'mile' : 'kilometer';
  const status = stampStatus(week);
  const qualityHit = !week.isFuture && week.quality.targetMeters > 0 && week.quality.hit;
  const longHit = !week.isFuture && week.long.targetMeters > 0 && week.long.hit;
  const actualFraction = Math.max(0, Math.min(1, week.mileage.fraction));
  // A just-opened current week still gets a tiny starting cap so it reads as
  // live, not future. The cap never suggests a completed ring.
  const visibleFraction = status === 'current' ? Math.max(0.025, actualFraction) : actualFraction;
  const progressColor = status === 'current' ? C.yellow : C.mute;
  const progressWidth = status === 'current' ? 2.5 : 1.8;
  const reducedMotion = useReducedMotion();
  const didMount = useRef(false);
  const selection = useSharedValue(selected ? 1 : 0);
  const settle = useSharedValue(0);
  const echo = useSharedValue(1);
  const selectionRingOpacity = status === 'current' ? 0.3 : 0.76;

  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      selection.value = selected ? 1 : 0;
      settle.value = 0;
      echo.value = 1;
      return;
    }

    if (reducedMotion) {
      selection.value = selected ? 1 : 0;
      settle.value = 0;
      echo.value = 1;
      return;
    }

    selection.value = withTiming(selected ? 1 : 0, {
      duration: selected ? 170 : 120,
      easing: SELECT_EASE,
    });

    if (selected) {
      // A single stamp-settle beat: arrive slightly proud, then return to the
      // persistent selected scale. The echo is deliberately one-shot so the
      // seal never reads as loading or demanding attention.
      settle.value = 0;
      settle.value = withTiming(1, { duration: 90, easing: SELECT_EASE }, (finished) => {
        if (finished) {
          settle.value = withTiming(0, { duration: 130, easing: SELECT_EASE });
        }
      });
      echo.value = 0;
      echo.value = withTiming(1, { duration: 220, easing: SELECT_EASE });
    } else {
      settle.value = 0;
      echo.value = 1;
    }
  }, [echo, reducedMotion, selected, selection, settle]);

  const sealMotionStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + selection.value * 0.04 + settle.value * 0.03 }],
  }));
  const selectionRingStyle = useAnimatedStyle(() => ({
    opacity: selection.value * selectionRingOpacity,
    transform: [{ scale: 0.94 + selection.value * 0.06 }],
  }));
  const selectionEchoStyle = useAnimatedStyle(() => ({
    opacity: (1 - echo.value) * 0.24,
    transform: [{ scale: 0.92 + echo.value * 0.36 }],
  }));

  const seal = (
    <View
      style={styles.sealFrame}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Animated.View
        pointerEvents="none"
        style={[styles.selectionEcho, { borderColor: C.ink }, selectionEchoStyle]}
      />
      <Animated.View
        pointerEvents="none"
        style={[styles.selectionRing, { borderColor: C.ink }, selectionRingStyle]}
      />
      <Animated.View style={sealMotionStyle}>
        <View
          testID={`${testIDPrefix}-${week.weekIndex}`}
          accessibilityValue={{ min: 0, max: 100, now: Math.round(actualFraction * 100) }}
          style={[styles.stamp, status === 'hit' && styles.stampHit]}
        >
          <Svg width={STAMP_SIZE} height={STAMP_SIZE} style={styles.stampSvg} pointerEvents="none">
            <Circle
              testID={`${testIDPrefix}-track-${week.weekIndex}`}
              cx={STAMP_CENTER}
              cy={STAMP_CENTER}
              r={MILEAGE_RADIUS}
              fill="none"
              stroke={status === 'future' ? C.line : C.faint}
              strokeWidth={1.2}
              opacity={status === 'future' ? 0.85 : 0.38}
            />
            {status !== 'future' && visibleFraction > 0 ? (
              <Circle
                testID={`${testIDPrefix}-progress-${week.weekIndex}`}
                cx={STAMP_CENTER}
                cy={STAMP_CENTER}
                r={MILEAGE_RADIUS}
                fill="none"
                stroke={progressColor}
                strokeWidth={progressWidth}
                strokeLinecap="round"
                strokeDasharray={`${MILEAGE_CIRCUMFERENCE * visibleFraction} ${MILEAGE_CIRCUMFERENCE}`}
                rotation={-90}
                origin={`${STAMP_CENTER}, ${STAMP_CENTER}`}
              />
            ) : null}
            {qualityHit ? (
              <Circle
                testID={`${testIDPrefix}-quality-${week.weekIndex}`}
                cx={STAMP_CENTER}
                cy={STAMP_CENTER}
                r={SUPPORT_RADIUS}
                fill="none"
                stroke={C.qual}
                strokeWidth={3}
                strokeLinecap="round"
                strokeDasharray={`${SUPPORT_ARC} ${SUPPORT_CIRCUMFERENCE}`}
                rotation={159}
                origin={`${STAMP_CENTER}, ${STAMP_CENTER}`}
              />
            ) : null}
            {longHit ? (
              <Circle
                testID={`${testIDPrefix}-long-${week.weekIndex}`}
                cx={STAMP_CENTER}
                cy={STAMP_CENTER}
                r={SUPPORT_RADIUS}
                fill="none"
                stroke={C.cyan}
                strokeWidth={3}
                strokeLinecap="round"
                strokeDasharray={`${SUPPORT_ARC} ${SUPPORT_CIRCUMFERENCE}`}
                rotation={-21}
                origin={`${STAMP_CENTER}, ${STAMP_CENTER}`}
              />
            ) : null}
          </Svg>

          <Text
            style={[
              styles.stampMileage,
              status === 'future' && styles.stampMileageFuture,
              status === 'future' && selected && styles.stampMileageSelected,
            ]}
            numberOfLines={1}
            maxFontSizeMultiplier={1}
          >
            {contractDistance(week, units)}
          </Text>

          {status === 'miss' ? (
            <View testID={`${testIDPrefix}-miss-${week.weekIndex}`} style={styles.missMark}>
              <SymbolView
                name="xmark"
                size={7.5}
                tintColor={C.mute}
                weight="black"
                resizeMode="scaleAspectFit"
              />
            </View>
          ) : null}
        </View>
      </Animated.View>
    </View>
  );

  if (onPress) {
    const supporting = [
      qualityHit ? 'Quality met' : null,
      longHit ? 'Long run met' : null,
    ].filter(Boolean).join(', ');
    const selectionLabel = status === 'future'
      ? `Select week ${week.weekIndex}. ${contractDistance(week, units)} ${unitWord} contract, planned.`
      : status === 'current'
        ? `Select week ${week.weekIndex}. ${contractDistance(week, units)} ${unitWord} contract, in progress.`
        : `Select week ${week.weekIndex} checkpoint. ${contractDistance(week, units)} ${unitWord} contract, mileage ${week.mileage.hit ? 'met' : 'missed'}${supporting ? `, ${supporting}` : ''}.`;
    return (
      <View style={[styles.stampSlot, slotStyle]}>
        <PressableScale
          accessibilityRole="button"
          accessibilityState={{ selected }}
          accessibilityLabel={selectionLabel}
          onPress={onPress}
          hitSlop={4}
          scaleTo={0.96}
          style={styles.selector}
        >
          {seal}
        </PressableScale>
      </View>
    );
  }

  return (
    <View style={[styles.stampSlot, slotStyle]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {seal}
    </View>
  );
}

export function WeekContractStampGrid({
  weeks,
  testIDPrefix = 'contract-stamp',
  recordTestID,
  columns = CONTRACT_STAMPS_PER_ROW,
  selectionMode = 'settled',
  selectedWeekIndex,
  onSelectWeek,
}: {
  weeks: WeekGoal[];
  testIDPrefix?: string;
  recordTestID?: string;
  columns?: number;
  selectionMode?: 'settled' | 'all';
  selectedWeekIndex?: number | null;
  onSelectWeek?: (weekIndex: number) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const orderedWeeks = [...weeks].sort((a, b) => a.weekIndex - b.weekIndex);
  const safeColumns = Math.max(1, Math.floor(columns));
  const slotStyle = { width: `${100 / safeColumns}%` as `${number}%` };
  const rows: WeekGoal[][] = [];
  for (let index = 0; index < orderedWeeks.length; index += safeColumns) {
    rows.push(orderedWeeks.slice(index, index + safeColumns));
  }

  return (
    <View style={styles.record} testID={recordTestID ?? `${testIDPrefix}-record`}>
      {rows.map((row, rowIndex) => (
        <View key={rowIndex} style={styles.stampRow} testID={`${testIDPrefix}-row-${rowIndex}`}>
          {row.map((week) => (
            <WeekContractStamp
              key={week.weekIndex}
              week={week}
              testIDPrefix={testIDPrefix}
              selected={week.weekIndex === selectedWeekIndex}
              slotStyle={slotStyle}
              onPress={onSelectWeek && (selectionMode === 'all' || (!week.isCurrent && !week.isFuture))
                ? () => onSelectWeek(week.weekIndex)
                : undefined}
            />
          ))}
          {Array.from({ length: safeColumns - row.length }, (_, index) => (
            <View key={`empty-${index}`} style={[styles.stampSlot, slotStyle]} />
          ))}
        </View>
      ))}
    </View>
  );
}

const makeStyles = (C: Tokens) =>
  StyleSheet.create({
    record: { gap: space.sm },
    stampRow: { flexDirection: 'row' },
    stampSlot: { width: '16.666666%', alignItems: 'center', justifyContent: 'center', minHeight: 40 },
    selector: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sealFrame: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'visible',
    },
    selectionRing: {
      position: 'absolute',
      width: 40,
      height: 40,
      borderRadius: 20,
      borderWidth: 1.5,
    },
    selectionEcho: {
      position: 'absolute',
      width: 42,
      height: 42,
      borderRadius: 21,
      borderWidth: 1.25,
    },
    stamp: {
      width: STAMP_SIZE,
      height: STAMP_SIZE,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'visible',
    },
    stampHit: { backgroundColor: C.fill },
    stampSvg: { position: 'absolute', inset: 0 },
    stampMileage: {
      ...statValueText(C, 'labelSm'),
      letterSpacing: -0.6,
    },
    stampMileageFuture: { color: C.faint },
    stampMileageSelected: { color: C.ink },
    missMark: {
      position: 'absolute',
      top: -2,
      right: -2,
      width: 12,
      height: 12,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: C.card,
    },
  });
