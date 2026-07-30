/**
 * RoundIconButton — the circular icon button used in popup / sheet / hero
 * headers: a centered SF Symbol (self-centers via resizeMode, never a text
 * glyph) in a circle. `flat` = a C.card circle on the page bg; `overlay` = a
 * translucent-dark circle with a hairline border for a header floating over a
 * map/photo. Omit `onPress` for a static (non-interactive) badge.
 *
 * CloseButton is the semantic close-X wrapper around this.
 */
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { SymbolView } from 'expo-symbols';

import { useTheme, useThemedStyles } from '@/theme/ThemeProvider';
import { radius, type Tokens } from '@/theme/tokens';

export function RoundIconButton({
  icon,
  onPress,
  variant = 'flat',
  size = 15,
  disabled = false,
  accessibilityLabel,
  style,
}: {
  icon: string;
  onPress?: () => void;
  variant?: 'flat' | 'overlay';
  size?: number;
  disabled?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const C = useTheme();
  const styles = useThemedStyles(makeStyles);
  const overlay = variant === 'overlay';
  const circle = overlay ? styles.overlay : styles.flat;
  const glyph = (
    <SymbolView name={icon as never} size={size} tintColor={overlay ? '#FFFFFF' : C.ink} resizeMode="scaleAspectFit" />
  );
  if (!onPress) return <View style={[circle, style]}>{glyph}</View>;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      hitSlop={8}
      style={({ pressed }) => [circle, pressed && styles.pressed, disabled && styles.disabled, style]}
    >
      {glyph}
    </Pressable>
  );
}

const makeStyles = (C: Tokens) =>
  StyleSheet.create({
    // Both variants share ONE size (32) so a close button reads identically
    // whether it's on a page-bg sheet (flat) or floating over a map (overlay).
    flat: { width: 32, height: 32, borderRadius: radius.lg, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' },
    overlay: {
      width: 32,
      height: 32,
      borderRadius: radius.lg,
      backgroundColor: 'rgba(11,14,18,0.5)',
      borderColor: 'rgba(255,255,255,0.14)',
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pressed: { opacity: 0.55, transform: [{ scale: 0.94 }] },
    disabled: { opacity: 0.35 },
  });
