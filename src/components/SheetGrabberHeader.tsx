/**
 * Compact chrome for a resizable modal sheet: a centered grabber plus a
 * leading dismiss control in one consistent lane.
 *
 * The 32pt visible close circle is centered inside a 48pt placement slot. With
 * that slot beginning at the 16pt content margin, the visible circle starts
 * 24pt from the sheet edge while the interaction region remains at least 44pt.
 */
import { StyleSheet, View } from 'react-native';

import { CloseButton } from '@/components/CloseButton';
import { SHEET_CLOSE_TOP } from '@/components/SheetHeader';
import { useThemedStyles } from '@/theme/ThemeProvider';
import { radius, space, type Tokens } from '@/theme/tokens';

export function SheetGrabberHeader({
  onClose,
  accessibilityLabel = 'Close',
}: {
  onClose: () => void;
  accessibilityLabel?: string;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.header}>
      <View style={styles.closeSlot}>
        <CloseButton onPress={onClose} accessibilityLabel={accessibilityLabel} />
      </View>
      <View style={styles.grabber} />
    </View>
  );
}

const makeStyles = (C: Tokens) =>
  StyleSheet.create({
    header: {
      height: 48,
      alignItems: 'center',
      justifyContent: 'flex-start',
    },
    closeSlot: {
      position: 'absolute',
      left: space.lg,
      // The 32pt circle centres inside this 40pt slot, so the slot starts 4pt
      // above SHEET_CLOSE_TOP to land the visible circle exactly where
      // SheetHeader's sheet variant puts its own — one clearance, both
      // primitives. This was `top: space.xs` (an effective 8pt clearance
      // against SheetHeader's 16) and the mismatch was caught by eye.
      top: SHEET_CLOSE_TOP - space.xs,
      width: 48,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
    },
    grabber: {
      // The grabber pill hugs the top per native convention; the CLOSE is the
      // element that aligns across sheet primitives, not this.
      marginTop: space.sm,
      width: 36,
      height: 5,
      borderRadius: radius.pill,
      backgroundColor: C.fill,
    },
  });
