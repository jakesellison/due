/**
 * Divider — the hairline rule, and the two style factories that are the real
 * migration target.
 *
 * An audit found 172 hand-written `StyleSheet.hairlineWidth` border
 * declarations. Almost none of them are a standalone element: they are a
 * `borderTopWidth` on a list row, a `borderBottomWidth` on a sticky header, a
 * hairline column between two gauge goals. Dropping a `<Divider />` element in
 * between those would change the layout (an extra flex child inside a `gap`
 * container adds a gap), so a component alone could never have collected them.
 *
 * Hence the shape this file takes — the same dual export `Card` uses, but with
 * the emphasis inverted. The FACTORIES are the primary API:
 *
 *     row:      { ...hairlineTop(C), paddingVertical: space.md },
 *     stickyBar:{ ...hairlineBottom(C), backgroundColor: C.bg },
 *
 * and `<Divider />` is for the minority of sites that genuinely want a rule as
 * an element (a separator between two blocks that own no border of their own).
 *
 * All four carry `C.line`. The one thing the 172 copies never disagreed about
 * was the width; they disagreed about the COLOUR — `C.line`, `C.slate`, and a
 * couple of `rgba()` literals — which is exactly the drift a token prevents.
 */
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';
import { space, type Tokens } from '@/theme/tokens';

/** A hairline rule ABOVE the container — the list-row separator idiom. */
export const hairlineTop = (C: Tokens) =>
  ({ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line }) as const;

/** A hairline rule BELOW the container — sticky headers, section footers. */
export const hairlineBottom = (C: Tokens) =>
  ({ borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line }) as const;

/** A hairline rule on the container's LEADING edge — the column-cell idiom
 *  (a stat cell ruled off from its left neighbour, where the rule belongs to
 *  the CELL and an element between cells would fight the row's `gap`). */
export const hairlineLeft = (C: Tokens) =>
  ({ borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: C.line }) as const;

/** Trailing-edge counterpart of `hairlineLeft`. */
export const hairlineRight = (C: Tokens) =>
  ({ borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: C.line }) as const;

export function Divider({
  inset = false,
  vertical = false,
  style,
  testID,
}: {
  /**
   * Pull the rule in from the edges. `true` uses `space.lg` — the app's gutter
   * (Screen, Card, SheetHeader), so an inset rule lines up with the content
   * beside it rather than picking its own indent. A number for the rare case
   * that must align with a leading icon column instead.
   */
  inset?: boolean | number;
  /**
   * A COLUMN rule rather than a row rule — the separator between two side-by-
   * side stats (WeekGauges' supporting goals). Same hairline, rotated; it is
   * still one decision, so it is still this component.
   */
  vertical?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const C = useTheme();
  const pad = inset === true ? space.lg : inset === false ? 0 : inset;
  return (
    <View
      testID={testID}
      // Decorative: a rule carries no information VoiceOver can use, and 172 of
      // them announcing themselves would bury the content between them.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        vertical
          ? { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', marginVertical: pad }
          : { height: StyleSheet.hairlineWidth, alignSelf: 'stretch', marginHorizontal: pad },
        { backgroundColor: C.line },
        // CONTRACT, relied on by call sites: `style` is applied LAST, so a
        // caller may override the colour (an accent-tinted phase rule) or the
        // stretch (a fixed-height rule in a centered row). Do not reorder.
        style,
      ]}
    />
  );
}
