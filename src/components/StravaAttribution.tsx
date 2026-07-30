/**
 * StravaAttribution — the required Strava acknowledgement shown wherever a
 * Strava-sourced activity is presented in detail. Rendered as a quiet footer:
 *
 *  - The official "Powered by Strava" LOGO (unmodified brand asset; white on
 *    dark, black on light — never recoloured or stretched).
 *  - "View on Strava" — Strava's mandated link-back text, as a tasteful outlined
 *    pill in Strava orange #FC5200 (orange alone satisfies the legibility rule;
 *    no underline needed) that deep-links to the activity.
 *
 * Brand Guidelines: https://developers.strava.com/guidelines/
 */

import { Image, Linking, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { SymbolView } from 'expo-symbols';

import { useScheme, useTheme } from '@/theme/ThemeProvider';
import { fontSizes, radius, space } from '@/theme/tokens';

/** Strava's brand orange — mandated for the legible "View on Strava" link. */
const STRAVA_ORANGE = '#FC5200';

// Official "Powered by Strava" horizontal logo (365×37 → ~9.86:1). Static
// requires so Metro bundles both; we pick by theme at runtime.
const POWERED_WHITE = require('../../assets/brand/strava/api_logo_pwrdBy_strava_horiz_white.png');
const POWERED_ORANGE = require('../../assets/brand/strava/api_logo_pwrdBy_strava_horiz_orange.png');
const LOGO_HEIGHT = 15;

/** The activity URL on strava.com for a given Strava activity id. */
export function stravaActivityUrl(sourceId: string): string {
  return `https://www.strava.com/activities/${sourceId}`;
}

/**
 * The official "Powered by Strava" logo, alone — the required attribution for
 * ANY screen that DISPLAYS Strava data (Dash, Trends, Routes, Plan). The
 * unmodified brand asset (white on dark, brand-orange on light — never
 * recoloured or stretched; both are official Strava variants). Individual
 * activity views use the fuller {@link StravaAttribution}
 * (this logo + a "View on Strava" deep link). Brand Guidelines:
 * https://developers.strava.com/guidelines/
 */
export function PoweredByStrava({
  align = 'center',
  compact = false,
  style,
}: {
  align?: 'center' | 'left';
  compact?: boolean;
  style?: ViewStyle;
}): React.JSX.Element {
  const scheme = useScheme();
  const logoHeight = compact ? 12 : LOGO_HEIGHT;
  const logoWidth = Math.round(logoHeight * (365 / 37));
  return (
    <View
      style={[
        styles.powered,
        compact && styles.poweredCompact,
        { alignItems: align === 'center' ? 'center' : 'flex-start' },
        style,
      ]}
    >
      <Image
        source={scheme === 'dark' ? POWERED_WHITE : POWERED_ORANGE}
        style={{ width: logoWidth, height: logoHeight }}
        resizeMode="contain"
        accessibilityLabel="Powered by Strava"
      />
    </View>
  );
}

export function StravaAttribution({ sourceId }: { sourceId: string }): React.JSX.Element {
  const C = useTheme();
  const url = stravaActivityUrl(sourceId);
  return (
    <View style={[styles.footer, { borderTopColor: C.line }]}>
      <PoweredByStrava />
      <Pressable
        accessibilityRole="link"
        accessibilityLabel="View on Strava"
        hitSlop={8}
        onPress={() => {
          void Linking.openURL(url);
        }}
        style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
      >
        <Text style={styles.pillText}>View on Strava</Text>
        <SymbolView name="arrow.up.right" size={11} tintColor={STRAVA_ORANGE} weight="bold" resizeMode="scaleAspectFit" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  powered: {
    width: '100%',
    paddingVertical: space.lg,
  },
  poweredCompact: {
    paddingVertical: 0,
  },
  footer: {
    alignItems: 'center',
    gap: space.md,
    paddingTop: space.xl,
    paddingBottom: space.md,
    marginTop: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s,
    paddingHorizontal: space.l,
    height: 32,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: STRAVA_ORANGE,
  },
  pillText: {
    color: STRAVA_ORANGE,
    fontSize: fontSizes.label,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  pressed: { opacity: 0.55 },
});
