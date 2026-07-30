/**
 * ModalFooter — the shared bottom action rail for transactional modal screens.
 * It owns the hairline, horizontal rhythm, and home-indicator clearance; the
 * action itself remains an ActionButton so labels/loading/disabled state stay
 * local to the task.
 */
import { useContext } from 'react';
import { StyleSheet, View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import { useThemedStyles } from '@/theme/ThemeProvider';
import { space, type Tokens } from '@/theme/tokens';

export function ModalFooter({
  children,
  surface = 'bg',
  bottomInset,
  style,
  testID,
  pointerEvents,
  accessibilityElementsHidden,
  importantForAccessibility,
}: {
  children: React.ReactNode;
  surface?: 'bg' | 'panel' | 'card';
  /** Override for hosts that already resolve insets outside the modal tree. */
  bottomInset?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  pointerEvents?: ViewProps['pointerEvents'];
  accessibilityElementsHidden?: boolean;
  importantForAccessibility?: ViewProps['importantForAccessibility'];
}) {
  const styles = useThemedStyles(makeStyles);
  // The app always owns a SafeAreaProvider. The zero fallback keeps this
  // primitive composable in isolated component tests and previews too.
  const insets = useContext(SafeAreaInsetsContext);
  const inset = bottomInset ?? insets?.bottom ?? 0;
  return (
    <View
      testID={testID}
      pointerEvents={pointerEvents}
      accessibilityElementsHidden={accessibilityElementsHidden}
      importantForAccessibility={importantForAccessibility}
      style={[
        styles.base,
        surface === 'panel' ? styles.panel : surface === 'card' ? styles.card : styles.bg,
        { paddingBottom: Math.max(space.md, inset + space.sm) },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const makeStyles = (C: Tokens) => StyleSheet.create({
  base: {
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.line,
  },
  bg: { backgroundColor: C.bg },
  panel: { backgroundColor: C.panel },
  card: { backgroundColor: C.card },
});
