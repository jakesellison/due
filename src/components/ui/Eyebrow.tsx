/**
 * Eyebrow — the uppercase kicker that labels a section, a stat, a table column,
 * or a panel ("THIS WEEK", "COMPLETED", "QUALITY", "MI/WK AVG").
 *
 * It exists because an audit found 70 hand-rolled copies of the same five
 * declarations across `app/` and `src/components/`, and they had already
 * drifted in every dimension that was left to the call site:
 *
 *   fontSize      micro (25×) · labelSm (19×) · metadata (6×) — plus 20 copies
 *                 that inherited whatever the surrounding style set
 *   fontWeight    '700' (39×) · '800' (12×) · '900' (5×)
 *   letterSpacing 0.3 · 0.4 · 0.45 · 0.5 · 0.55 · 0.6 · 0.65 · 0.7 · 0.8 · 1
 *
 * Ten letter-spacings is not a system; it is per-screen optical tuning that no
 * two screens agreed on. The canonical eyebrow is `C.mute` / `fontSizes.labelSm`
 * / weight 700 / letterSpacing 0.5 — the modal value of every axis above.
 *
 * SIZE is a real product decision (a dense table header IS smaller than a card
 * kicker), so it stays a prop, bounded to the three tiers the audit found.
 * WEIGHT and LETTER-SPACING are not, so they are gone: the eyebrow's job is to
 * recede, and 900/1.0 was one screen shouting louder than its neighbours.
 *
 * COLOUR stays open because accent eyebrows carry meaning — a violet quality
 * label, a warning-orange deficit key. Pass a TOKEN (`C.qualText`), never a hex.
 *
 * Also exported as `eyebrowText(C, size?)` for `StyleSheet.create` composition,
 * which is how most of this codebase builds styles:
 *
 *     tableHead: { ...eyebrowText(C, 'micro'), marginBottom: space.xs },
 */
import { StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native';
import type { ReactNode } from 'react';

import { useThemedStyles } from '@/theme/ThemeProvider';
import { fontSizes, type Tokens } from '@/theme/tokens';

/** The three tiers the audit found in production. `labelSm` is the default. */
export type EyebrowSize = 'micro' | 'labelSm' | 'metadata';

/**
 * The eyebrow treatment as a spreadable style.
 *
 * Deliberately carries NO margin: half the hand-rolled copies added a
 * `marginBottom` and half did not, and a primitive that reserves space below
 * itself fights every parent that already sets `gap` (the same lesson `Card`
 * records). Spacing belongs to the layout, not to the label.
 */
export const eyebrowText = (C: Tokens, size: EyebrowSize = 'labelSm', color?: string) => ({
    color: color ?? C.mute,
    fontSize: fontSizes[size],
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  }) as const;

export function Eyebrow({
  children,
  size = 'labelSm',
  color,
  numberOfLines,
  style,
  testID,
  accessibilityLabel,
}: {
  children: ReactNode;
  size?: EyebrowSize;
  /** A semantic TOKEN (`C.qualText`, `C.warningText`). Defaults to `C.mute`. */
  color?: string;
  numberOfLines?: number;
  style?: StyleProp<TextStyle>;
  testID?: string;
  accessibilityLabel?: string;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Text
      // An eyebrow is already the smallest type in the app; letting it scale
      // past 2× turns a one-word kicker into three wrapped lines inside a row
      // that was sized for one. Same ceiling SheetHeader uses.
      maxFontSizeMultiplier={2}
      numberOfLines={numberOfLines}
      testID={testID}
      accessibilityLabel={accessibilityLabel}
      style={[styles[size], color ? { color } : null, style]}
    >
      {children}
    </Text>
  );
}

const makeStyles = (C: Tokens) =>
  StyleSheet.create({
    micro: eyebrowText(C, 'micro'),
    labelSm: eyebrowText(C, 'labelSm'),
    metadata: eyebrowText(C, 'metadata'),
  });
