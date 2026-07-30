/**
 * SheetHeader — the shared header row for popup, sheet, and pushed detail
 * screens: a close or back action (top-left), a display title (+ optional
 * context line), an optional leading glyph, and an optional right-aligned slot.
 *
 * Keeps the header rhythm (padding, gap, title type) identical across week adjustment,
 * plan history, and other sheets so they can never drift. Pass
 * `style` to tweak the container (e.g. more top padding on a grabber sheet).
 */
import { type ReactNode } from 'react';
import { StyleSheet, Text, useWindowDimensions, View, type StyleProp, type ViewStyle } from 'react-native';

import { CloseButton } from '@/components/CloseButton';
import { RoundIconButton } from '@/components/RoundIconButton';
import { useThemedStyles } from '@/theme/ThemeProvider';
import { display, fontSizes, space, typeRole, usesAccessibilityTextLayout, type Tokens } from '@/theme/tokens';

/**
 * Clearance from a native sheet's top edge to the close control — ONE number,
 * shared by every primitive that owns a sheet top (SheetHeader's `sheet`
 * variant and SheetGrabberHeader). It exists because the two primitives used
 * to derive their own (16 vs an effective 8), and the drift was only caught by
 * eye, twice. headerConsistency pins that both derive from this constant.
 */
export const SHEET_CLOSE_TOP = space.lg;

export function SheetHeader({
  onClose,
  closeDisabled = false,
  navigation = 'close',
  navigationLabel,
  title,
  context,
  leading,
  right,
  topInset = 0,
  variant = 'page',
  style,
}: {
  onClose: () => void;
  closeDisabled?: boolean;
  navigation?: 'close' | 'back';
  navigationLabel?: string;
  title: string;
  /** Date, week, or phase context. Sentence case; never a decorative kicker. */
  context?: string;
  /** A glyph between the navigation action and the title (e.g. an adjustment wand). */
  leading?: ReactNode;
  /** Right-aligned slot (a tag or secondary action); a spacer is inserted before it. */
  right?: ReactNode;
  /**
   * Safe-area top inset, for screens whose own container does NOT already
   * clear the notch (a `SafeAreaView edges={[]}`, or a full-bleed root).
   *
   * This exists because the header did not own its vertical start, so every
   * screen invented one: a top-edge SafeAreaView here, `Math.max(42,
   * insets.top + 4)` there. The offsets drifted by 10-20pt across the app.
   * The rule is now single and additive — inset, then `space.sm` — and it is
   * the SAME `space.sm` OverlayNav uses, so page and immersive headers start
   * at the same distance below the safe area.
   */
  topInset?: number;
  /**
   * `sheet` for headers at the TOP OF A NATIVE MODAL (presentation: 'modal' /
   * pageSheet). A modal has no status bar above it, so the page rule of
   * `space.sm` below the safe area lands the close button 8pt from the sheet's
   * rounded edge — cramped enough that four screens were flagged by eye in one
   * review. Sheets breathe at `space.lg` instead; pages keep `space.sm`.
   */
  variant?: 'page' | 'sheet';
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useThemedStyles(makeStyles);
  const { fontScale } = useWindowDimensions();
  const accessibilityLayout = usesAccessibilityTextLayout(fontScale);
  return (
    <View
      style={[
        styles.header,
        accessibilityLayout && styles.headerAccessible,
        variant === 'sheet' && { paddingTop: SHEET_CLOSE_TOP },
        topInset > 0 && { paddingTop: topInset + space.sm },
        style,
      ]}
    >
      {navigation === 'back' ? (
        <RoundIconButton
          icon="chevron.left"
          onPress={onClose}
          disabled={closeDisabled}
          accessibilityLabel={navigationLabel ?? 'Back'}
        />
      ) : (
        <CloseButton
          onPress={onClose}
          disabled={closeDisabled}
          accessibilityLabel={navigationLabel ?? 'Close'}
        />
      )}
      {leading}
      <View style={styles.titleBlock}>
        {context ? <Text maxFontSizeMultiplier={2} style={styles.context}>{context}</Text> : null}
        <Text maxFontSizeMultiplier={2} style={styles.title}>{title}</Text>
      </View>
      {right ? (
        <>
          <View style={{ flex: 1 }} />
          {right}
        </>
      ) : null}
    </View>
  );
}

const makeStyles = (C: Tokens) =>
  StyleSheet.create({
    // `space.lg` (16) is the app's gutter: the tab shell (Screen.tsx) and Card
    // both use it, and it outnumbers `space.xl` 109 to 27 across production
    // styles. This header was the outlier at 24 — and disagreed with ITSELF,
    // since `headerAccessible` below already dropped to 16 at accessibility
    // text sizes. A sheet's header now aligns with the content beneath it
    // instead of sitting 8pt further in.
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.md,
      paddingHorizontal: space.lg,
      paddingTop: space.sm,
      paddingBottom: space.md,
    },
    // No longer needs to restate the gutter — only the cross-axis change.
    headerAccessible: { alignItems: 'flex-start' },
    titleBlock: { flexShrink: 1, minWidth: 0 },
    context: { color: C.mute, fontSize: fontSizes.labelSm, lineHeight: 16, fontWeight: '700', marginBottom: space.xxs },
    title: { ...typeRole.sheetTitle, color: C.ink },
  });
