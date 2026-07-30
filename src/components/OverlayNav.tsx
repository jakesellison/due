/**
 * OverlayNav — the navigation row for surfaces whose content runs edge to edge
 * beneath it: a run's route map, a photo hero, the route builder's live map.
 *
 * Due has two header families and this is the second one. `SheetHeader` is the
 * page/sheet header: a solid row that OWNS its vertical space, with a title
 * beside the action. This is the immersive header: circular `variant="overlay"`
 * controls floating ON the content, with no title in the row — the title
 * belongs to the content below (a run's identity block) or to a separate pill
 * (the route builder's).
 *
 * It exists because that row was hand-rolled at three call sites which had
 * already drifted apart: the run hero sat at `topInset + 12` (a bare literal)
 * while the route builder sat at `topInset + space.sm`. Four points apart, for
 * no reason either could state.
 *
 * The offset is now `space.sm` everywhere, which is also `SheetHeader`'s
 * `paddingTop` — so an overlay header and a page header start at the same
 * distance below the safe area, and the two families line up with each other
 * instead of merely being internally consistent.
 *
 * Chevron-vs-X is NOT this component's business and is deliberately left to the
 * caller: it follows the presentation, exactly as it does for SheetHeader. A
 * pushed card gets `chevron.left` (run detail), a modal gets a close X (route
 * builder). Same rule, both families.
 */
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { type ReactNode } from 'react';

import { space } from '@/theme/tokens';

/** Distance below the safe-area inset — shared with SheetHeader's paddingTop. */
export const OVERLAY_NAV_TOP = space.sm;

export function OverlayNav({
  topInset = 0,
  floating = false,
  children,
  style,
}: {
  /** Safe-area top inset; the row sits `OVERLAY_NAV_TOP` below it. */
  topInset?: number;
  /**
   * True when the row must be absolutely positioned OVER full-bleed content
   * (a map that starts at the screen edge). False when it is the first thing
   * in an ordinary column and can simply pad itself down.
   */
  floating?: boolean;
  /** Usually two nodes — leading action, trailing action(s) — spread apart. */
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.row,
        floating
          ? [styles.floating, { top: topInset + OVERLAY_NAV_TOP }]
          : { paddingTop: topInset + OVERLAY_NAV_TOP },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: space.lg,
  },
  floating: { position: 'absolute', left: 0, right: 0 },
});
