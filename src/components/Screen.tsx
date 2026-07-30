import { type ReactNode } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useThemedStyles } from '@/theme/ThemeProvider';
import { display, fontSizes, space, typeRole, type Tokens } from '@/theme/tokens';

import { HeaderAvatar } from './HeaderAvatar';

/**
 * The shared top-level tab shell: the themed page background, a large-title
 * header row with an optional subtitle, and a header-right slot that defaults to
 * the persistent profile avatar. Plan and Trends render through this; Dash and
 * Routes keep their bespoke headers but add the same HeaderAvatar.
 */
export function Screen({
  title,
  subtitle,
  headerDivider = false,
  headerRight = <HeaderAvatar />,
  children,
}: {
  title: string;
  subtitle?: string;
  headerDivider?: boolean;
  headerRight?: ReactNode;
  children: ReactNode;
}) {
  const styles = useThemedStyles(makeStyles);
  const { fontScale } = useWindowDimensions();
  const usesAccessibilityLayout = fontScale >= 1.6;
  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={[styles.top, usesAccessibilityLayout && styles.topAccessible, headerDivider && styles.topDivider]}>
          <View style={styles.titleCol}>
            <Text
              style={[styles.h1, usesAccessibilityLayout && styles.h1Accessible]}
              maxFontSizeMultiplier={1.6}
            >
              {title}
            </Text>
            {subtitle ? (
              <Text
                style={styles.sub}
                numberOfLines={usesAccessibilityLayout ? undefined : 1}
                maxFontSizeMultiplier={1.6}
              >
                {subtitle}
              </Text>
            ) : null}
          </View>
          {headerRight}
        </View>
        {children}
      </SafeAreaView>
    </View>
  );
}

const makeStyles = (C: Tokens) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: C.bg },
    safe: { flex: 1 },
    top: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      // Canonical page gutter = 16 (space.lg); matches Card's own padding so
      // header and card content align edge-to-edge.
      paddingHorizontal: space.lg,
      paddingTop: space.sm,
      paddingBottom: space.sm,
    },
    topDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line },
    topAccessible: {
      minHeight: 72,
      alignItems: 'flex-start',
      paddingVertical: space.md,
    },
    titleCol: { flex: 1, minWidth: 0 },
    h1: { ...typeRole.pageTitle, color: C.ink },
    h1Accessible: { lineHeight: 56 },
    sub: { fontSize: fontSizes.metadata, fontWeight: '600', color: C.mute, marginTop: space.xxs },
  });
