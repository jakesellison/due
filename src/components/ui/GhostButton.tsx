/**
 * GhostButton — the SECONDARY action, and the documented counterpart to
 * `ActionButton`.
 *
 * The house rule is already written down: primary = solid accent → ActionButton;
 * secondary = fill + border → Pressable. Only half of that rule had a component
 * behind it, so the secondary half was re-typed everywhere it appeared —
 * ContractMetMoment's `dismiss`, `app/planner/[id]`'s `btnG` — and they had
 * already drifted:
 *
 *   radius       radius.md · radius.sm · radius.pill
 *   border       StyleSheet.hairlineWidth · 1 · none at all
 *   min height   48 · 52 · whatever `paddingVertical: space.s` produced
 *   press        an opacity dim, or nothing
 *
 * The anatomy is fixed here: `C.fill` face, hairline `C.line` edge,
 * `radius.md`, a `C.mute` label — quiet by construction, so it can sit beside a
 * yellow ActionButton without competing.
 *
 * FEEL: identical to ActionButton's — a light haptic on press-in and a physical
 * shrink, both from `PressableScale`, the house press idiom. Ghost buttons,
 * primary actions, tappable cards and rows all decelerate on the same curve.
 * (ActionButton used to sink onto a raised lip instead; that lip is gone, so
 * "matches the primary, minus the lip" is now simply "matches the primary".)
 */
import { StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import * as Haptics from 'expo-haptics';

import { PressableScale } from '@/components/PressableScale';
import { useTheme, useThemedStyles } from '@/theme/ThemeProvider';
import { alpha, fontSizes, radius, space, type Tokens } from '@/theme/tokens';

export function GhostButton({
  label,
  onPress,
  icon,
  destructive = false,
  disabled = false,
  accessibilityLabel,
  style,
  testID,
}: {
  label: string;
  onPress?: () => void;
  /** An SF Symbol before the label, tinted to the label's own colour. */
  icon?: SFSymbol;
  /**
   * A destructive secondary action (Delete, Disconnect, Discard). Takes the
   * danger TOKEN plus an `alpha` wash of it — not a new red, and not the solid
   * fill a primary destructive button would get.
   */
  destructive?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  /** OUTER layout — width, flex, margins. The face is this component's. */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const C = useTheme();
  const styles = useThemedStyles(makeStyles);
  const ink = disabled ? C.faint : destructive ? C.dangerText : C.mute;

  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityLabel={accessibilityLabel ?? label}
      testID={testID}
      onPressIn={() => {
        if (disabled) return;
        // The same light impact ActionButton fires, synced to the same shrink —
        // a secondary action should feel answered, just not celebrated.
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }}
      style={[
        styles.face,
        destructive && styles.destructive,
        disabled && styles.disabled,
        style,
      ]}
    >
      {icon ? <SymbolView name={icon} size={14} tintColor={ink} weight="semibold" resizeMode="scaleAspectFit" /> : null}
      <Text maxFontSizeMultiplier={2} numberOfLines={1} style={[styles.label, { color: ink }]}>
        {label}
      </Text>
    </PressableScale>
  );
}

const makeStyles = (C: Tokens) =>
  StyleSheet.create({
    face: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: space.sm,
      // 48, not 44: it pairs with ActionButton, whose `commit` variant is 52 and
      // whose default face lands near this. 44 is the a11y floor, not a target.
      minHeight: 48,
      paddingHorizontal: space.lg,
      paddingVertical: space.s,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: C.line,
      backgroundColor: C.fill,
    },
    destructive: {
      backgroundColor: alpha(C.dangerText, 0.1),
      borderColor: alpha(C.dangerText, 0.28),
    },
    // Flat and recessive: an unavailable secondary action should read as absent,
    // not as a differently-coloured button.
    disabled: { backgroundColor: 'transparent', opacity: 0.6 },
    label: { fontSize: fontSizes.body, fontWeight: '800', flexShrink: 1 },
  });
