import { forwardRef } from 'react';
import {
  Pressable,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type View,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { motion } from '@/theme/tokens';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const EASE = Easing.bezier(...motion.easeOut);

type Props = Omit<PressableProps, 'style'> & {
  style?: StyleProp<ViewStyle>;
  /** Override the press scale (default motion.pressScale). */
  scaleTo?: number;
};

/**
 * A Pressable that scales down slightly on press for tactile feedback — Emil's
 * "buttons must feel responsive". Native-driven (runs off the JS thread),
 * interruptible, and a no-op under Reduce Motion. Use in place of an
 * opacity-dim `pressed` style for primary buttons and tappable cards/rows.
 */
export const PressableScale = forwardRef<View, Props>(function PressableScale(
  { style, scaleTo, onPressIn, onPressOut, ...rest },
  ref,
) {
  const scale = useSharedValue(1);
  const reduced = useReducedMotion();
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const target = scaleTo ?? motion.pressScale;

  return (
    <AnimatedPressable
      ref={ref}
      style={[style, animatedStyle]}
      onPressIn={(e: GestureResponderEvent) => {
        if (!reduced) scale.value = withTiming(target, { duration: motion.pressMs, easing: EASE });
        onPressIn?.(e);
      }}
      onPressOut={(e: GestureResponderEvent) => {
        if (!reduced) scale.value = withTiming(1, { duration: motion.releaseMs, easing: EASE });
        onPressOut?.(e);
      }}
      {...rest}
    />
  );
});
