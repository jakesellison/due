/**
 * ActionButton — the app's primary action: a FLAT accent plate.
 *
 * WHAT CHANGED AND WHY. This was `LiftButton`: a solid fill with a 3px darker
 * bottom lip that read as raised, and a press that sank the face onto that lip
 * (the Duolingo tactile-button move). The lip is gone, for three reasons.
 *
 *   1. DESIGN.md already forbade it — "matte fill plus a hairline is enough; do
 *      not stack a strong border, tint, and shadow to manufacture hierarchy."
 *      In an app built from hairlines, neutral ink surfaces and rationed yellow,
 *      the lip was the ONLY decorative depth, and it was borrowed from a
 *      gamified genre this product is not. Every other shadow in the codebase is
 *      functional (a legend floating over a map, a segmented thumb).
 *   2. It gave the primary CTA its own private physics. Cards, rows, chips and
 *      GhostButton all shrink on the house `PressableScale` curve; the CTA alone
 *      sank on a spring, so the app's most important control was the one that
 *      felt unlike the rest of it.
 *   3. That spring ignored Reduce Motion. `PressableScale` honours it.
 *
 * WHAT CARRIES "PRESSABLE" INSTEAD is typographic, not physical. Every other
 * solid yellow in Due is a MEASUREMENT — a gauge arc, a contract bar, a
 * blueprint vessel, the tab pill — and not one of them carries words. A field of
 * accent with tracked-uppercase `accentInk` type on it (`actionLabel`) is a
 * control legend and can be read as nothing else. Scale settles the rest: a
 * commit button is 52pt tall, and no measurement in the app is.
 *
 * ANATOMY. One solid face: `radius.md`, `color` fill, `ActionButtonLabel` type,
 * a house-curve shrink and a light haptic on press. `style` lays out the OUTER
 * (margins, width, flex); `contentStyle` lays out the FACE (padding, row, gap,
 * height). Put the fill in `color`, never in `style`.
 *
 * Reserved for SOLID primary actions. The secondary counterpart is `GhostButton`
 * (fill + hairline); list rows and text buttons take neither.
 */
import { createContext, useContext } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type StyleProp,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import * as Haptics from 'expo-haptics';

import { PressableScale } from '@/components/PressableScale';
import { useTheme } from '@/theme/ThemeProvider';
import { actionLabel, radius as RADII, space } from '@/theme/tokens';

const ActionButtonStateContext = createContext({ unavailable: false });

export function ActionButton({
  color,
  disabledColor,
  onPress,
  children,
  style,
  contentStyle,
  radius = RADII.md,
  disabled = false,
  loading = false,
  loadingLabel = 'Working…',
  loadingAccessibilityLabel,
  variant = 'default',
  accessibilityLabel,
  accessibilityRole = 'button',
  hitSlop = 4,
}: {
  /** The solid fill. */
  color: string;
  /** Optional unavailable fill. Defaults to the theme's neutral slate. */
  disabledColor?: string;
  onPress?: (e: GestureResponderEvent) => void;
  children: React.ReactNode;
  /** OUTER positioning — margins, width, alignSelf. NOT the fill (use `color`). */
  style?: StyleProp<ViewStyle>;
  /** FACE layout — padding / flexDirection / gap / alignItems / height. */
  contentStyle?: StyleProp<ViewStyle>;
  radius?: number;
  disabled?: boolean;
  /** A non-interactive in-progress state with a visible label and VoiceOver busy state. */
  loading?: boolean;
  loadingLabel?: string;
  loadingAccessibilityLabel?: string;
  /** Standardizes full-width submit actions at 52pt. */
  variant?: 'default' | 'commit';
  accessibilityLabel?: string;
  accessibilityRole?: 'button' | 'link';
  hitSlop?: number;
}): React.JSX.Element {
  const C = useTheme();
  const disabledState = disabled || loading;
  // Unavailable actions go neutral. Loading actions keep their action colour so
  // progress stays recognizable as the thing you just asked for.
  const fill = disabled && !loading ? disabledColor ?? C.slate : color;

  return (
    <PressableScale
      onPress={onPress}
      disabled={disabledState}
      hitSlop={hitSlop}
      accessibilityRole={accessibilityRole}
      accessibilityState={{ disabled: disabledState, busy: loading }}
      accessibilityLabel={loading ? loadingAccessibilityLabel ?? loadingLabel : accessibilityLabel}
      onPressIn={() => {
        if (disabledState) return;
        // The light impact GhostButton also fires, on the same shrink — one
        // press feel for every control in the app.
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }}
      style={style}
    >
      <View
        style={[
          { borderRadius: radius, backgroundColor: fill },
          variant === 'commit' && styles.commitFace,
          contentStyle,
          loading && styles.loadingFace,
        ]}
      >
        <ActionButtonStateContext.Provider value={{ unavailable: disabled && !loading }}>
          {loading ? (
            <>
              <ActivityIndicator color={C.accentInk} />
              <ActionButtonLabel>{loadingLabel}</ActionButtonLabel>
            </>
          ) : children}
        </ActionButtonStateContext.Provider>
      </View>
    </PressableScale>
  );
}

/**
 * Canonical label treatment for solid primary actions — the action voice.
 *
 * Every call site used to hand-roll this `<Text>`, and they had drifted to five
 * different treatments (700/800/900 weight at 12/13/14/15pt). Extra `Text` props
 * (`numberOfLines`, `adjustsFontSizeToFit`) pass straight through, so a cramped
 * footer button can shrink-to-fit without leaving the voice.
 */
export function ActionButtonLabel({
  children,
  style,
  ...rest
}: TextProps & { children: React.ReactNode }): React.JSX.Element {
  const C = useTheme();
  const { unavailable } = useContext(ActionButtonStateContext);
  return (
    <Text {...rest} style={[styles.label, { color: unavailable ? C.mute : C.accentInk }, style]}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  commitFace: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.lg,
  },
  loadingFace: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  label: actionLabel,
});
