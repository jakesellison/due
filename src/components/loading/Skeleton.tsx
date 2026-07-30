import { useEffect, useRef, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  View,
  type DimensionValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { useTheme, useThemedStyles } from '@/theme/ThemeProvider';
import { radius, type Tokens } from '@/theme/tokens';

/**
 * One low-cost pulse for a group of geometry-matched placeholders. The group
 * is one VoiceOver progress item; its decorative children stay silent.
 */
export function SkeletonGroup({
  accessibilityLabel,
  children,
  style,
  testID,
}: {
  accessibilityLabel: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const opacity = useRef(new Animated.Value(0.58)).current;

  useEffect(() => {
    let mounted = true;
    let pulse: Animated.CompositeAnimation | null = null;

    const setReducedMotion = (reduced: boolean) => {
      pulse?.stop();
      opacity.stopAnimation();
      opacity.setValue(reduced ? 0.82 : 0.58);
      if (reduced) return;
      pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(opacity, {
            toValue: 1,
            duration: 880,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(opacity, {
            toValue: 0.58,
            duration: 880,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
      );
      pulse.start();
    };

    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduced) => {
        if (mounted) setReducedMotion(reduced);
      })
      .catch(() => {
        if (mounted) setReducedMotion(false);
      });
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReducedMotion,
    );

    return () => {
      mounted = false;
      subscription.remove();
      pulse?.stop();
      opacity.stopAnimation();
    };
  }, [opacity]);

  return (
    <View
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="progressbar"
      accessibilityState={{ busy: true }}
      style={style}
      testID={testID}
    >
      <Animated.View style={{ opacity }}>{children}</Animated.View>
    </View>
  );
}

export function SkeletonBlock({
  height,
  width = '100%',
  style,
  testID,
}: {
  height: number;
  width?: DimensionValue;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View
      accessible={false}
      importantForAccessibility="no"
      style={[styles.block, { height, width }, style]}
      testID={testID}
    />
  );
}

const makeStyles = (C: Tokens) =>
  StyleSheet.create({
    block: {
      borderRadius: radius.sm,
      backgroundColor: C.slate,
    },
  });
