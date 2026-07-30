/**
 * ListRow — the settings / library / hub row: an optional leading glyph, a
 * title, an optional sub-line, a right-hand value, and a chevron when the row
 * pushes somewhere.
 *
 * Surveyed before it was designed, because the wrong API here forces bespoke
 * rows to keep hand-rolling. The shape is drawn from what `app/(tabs)/you.tsx`
 * (`staticRow`, `planRow`, `accountRow`, `connectionRow`, `shoeLoadingRow` —
 * five row styles in ONE file), `SyncStatusRow`, `ReconnectStravaRow`, and the
 * plan-library rows already agree on:
 *
 *   flexDirection row · alignItems center · gap `space.md`
 *   paddingHorizontal `space.lg` (the app gutter)
 *   a `chevron.right` SF Symbol at `C.faint`, semibold
 *   `backgroundColor: C.fill` as the pressed tint (rows tint, they don't scale)
 *   a `StyleSheet.hairlineWidth` top border as the separator
 *
 * and what they DISAGREED about: minimum heights of 48 / 58 / 68 / 72, chevrons
 * at 9 / 10 / 11 / 12 / 13 / 14 / 15 / 18pt in five different tints.
 *
 * What it deliberately does NOT cover: `DayRow`, `WorkoutRow`, `ChangeRow`.
 * Those are instruments — a two-axis status/type strip, a prescription with a
 * structure bar — that happen to be row-SHAPED. Forcing them through a settings
 * row would produce a component with fifteen optional slots, which is how a
 * primitive stops being one.
 */
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import type { ReactNode } from 'react';
import { SymbolView, type SFSymbol } from 'expo-symbols';

import { hairlineTop } from '@/components/ui/Divider';
import { useTheme, useThemedStyles } from '@/theme/ThemeProvider';
import { fontSizes, radius, space, type Tokens } from '@/theme/tokens';

export function ListRow({
  title,
  sub,
  value,
  icon,
  leading,
  right,
  chevron,
  divided = false,
  compact = false,
  onPress,
  disabled = false,
  accessibilityLabel,
  style,
  testID,
}: {
  title: string;
  /** A second line under the title — status, count, last-used date. */
  sub?: string;
  /** The right-hand readout ("On", "Miles", "412 mi"). */
  value?: string;
  /** An SF Symbol, drawn in the standard 38pt `C.fill` tile. */
  icon?: SFSymbol;
  /** Replaces the icon tile entirely — an avatar, a shoe photo, a brand mark. */
  leading?: ReactNode;
  /** Replaces `value` — a Chip, a Switch, a skeleton. Sits before the chevron. */
  right?: ReactNode;
  /** Defaults to true when the row is pressable: a chevron promises a push. */
  chevron?: boolean;
  /**
   * Draw the separator ABOVE this row. Top rather than bottom so a list's last
   * row does not leave a rule hanging over the gap beneath it — the same choice
   * `you.tsx` made with `planRowFirst` turning it back off.
   */
  divided?: boolean;
  /** 44pt (the a11y floor) instead of 58 — for dense secondary lists. */
  compact?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const C = useTheme();
  const styles = useThemedStyles(makeStyles);
  const pressable = !!onPress && !disabled;
  const showChevron = chevron ?? pressable;

  const body = (
    <>
      {leading ?? (icon ? (
        <View style={styles.iconTile}>
          <SymbolView name={icon} size={18} tintColor={C.mute} weight="semibold" resizeMode="scaleAspectFit" />
        </View>
      ) : null)}
      <View style={styles.body}>
        <Text maxFontSizeMultiplier={2} style={styles.title} numberOfLines={2}>{title}</Text>
        {sub ? (
          <Text maxFontSizeMultiplier={2} style={styles.sub} numberOfLines={2}>{sub}</Text>
        ) : null}
      </View>
      {right ??
        (value ? (
          // `maxWidth` rather than a fixed width: a long value ("Fahrenheit")
          // may take most of the row, but never so much that the title clips.
          <Text maxFontSizeMultiplier={2} style={styles.value} numberOfLines={1}>{value}</Text>
        ) : null)}
      {showChevron ? (
        <SymbolView name="chevron.right" size={12} tintColor={C.faint} weight="semibold" resizeMode="scaleAspectFit" />
      ) : null}
    </>
  );

  const rowStyle: StyleProp<ViewStyle> = [
    styles.row,
    compact && styles.compact,
    divided && styles.divided,
    disabled && styles.disabledRow,
    style,
  ];

  if (!pressable) {
    return <View style={rowStyle} testID={testID}>{body}</View>;
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      // "Notifications, On" — the value is part of what the row says, and a
      // chevron is not worth announcing.
      accessibilityLabel={accessibilityLabel ?? [title, sub, value].filter(Boolean).join(', ')}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [rowStyle, pressed && styles.pressed]}
    >
      {body}
    </Pressable>
  );
}

const makeStyles = (C: Tokens) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.md,
      minHeight: 58,
      paddingHorizontal: space.lg,
      paddingVertical: space.sm,
    },
    compact: { minHeight: 44 },
    divided: hairlineTop(C),
    // Rows tint on press; only free-standing buttons and cards scale. A whole
    // list shrinking under a finger reads as the LIST moving, not the row.
    pressed: { backgroundColor: C.fill },
    disabledRow: { opacity: 0.5 },
    iconTile: {
      width: 38,
      height: 38,
      borderRadius: radius.sm,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: C.fill,
    },
    body: { flex: 1, minWidth: 0 },
    title: { fontSize: fontSizes.body, fontWeight: '700', color: C.ink },
    sub: { fontSize: fontSizes.metadata, color: C.mute, marginTop: space.xxs },
    value: { fontSize: fontSizes.metadata, fontWeight: '700', color: C.mute, textAlign: 'right', maxWidth: '52%' },
  });
