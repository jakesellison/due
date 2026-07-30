import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import type { BottomTabBarProps } from 'expo-router/build/react-navigation/bottom-tabs';

import { useTheme, useThemedStyles } from '@/theme/ThemeProvider';
import { fontSizes, radius, space, type Tokens } from '@/theme/tokens';

/**
 * The themed tab bar — fused FLUSH to the bottom edge (full-width, no floating
 * capsule): a bar with a hairline top border that fills down into the home-
 * indicator safe area. Content scrolls UNDER it (screens add `TAB_BAR_INSET`
 * of padding).
 *
 * ACTIVE STATE — one RULE for all three tabs: the active glyph and label tint
 * yellow; inactive stays mute. The glyph uses `yellowText`, not `yellow`: the
 * two are the SAME colour in dark (#FFC93C), but the vivid fill primitive sits
 * at 1.65:1 on the light tab bar — an all-but-invisible selection mark — where
 * `yellowText` is 5.83:1. Dark mode is unchanged; light mode becomes legible. A unification pass briefly drew a solid yellow
 * pill behind the glyph instead, and the owner overruled it — the yellow-
 * filled ICONS were the app's look, and the silhouette differences between
 * glyphs (Week's gauge ring vs Plan's solid grid) are each icon's identity,
 * not drift. One rule, not one shape.
 */

const BAR_HEIGHT = 52;

/** Bottom content inset screens should reserve so content clears the bar
 *  (bar height + a typical home-indicator inset). */
export const TAB_BAR_INSET = BAR_HEIGHT + 30;

const ICONS: Record<string, SFSymbol> = {
  index: 'gauge.medium',
  plan: 'calendar',
  you: 'person.crop.circle',
};

export function GlassTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const usesIconOnlyLayout = fontScale >= 1.6;
  const C = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrap, { paddingBottom: Math.max(insets.bottom - 14, 10) }]}
    >
      <View style={styles.bar}>
          {state.routes.map((route) => {
            const { options } = descriptors[route.key]!;
            const label =
              typeof options.tabBarLabel === 'string'
                ? options.tabBarLabel
                : (options.title ?? route.name);
            const focused = state.routes[state.index]?.key === route.key;

            const onPress = () => {
              const event = navigation.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });
              if (!focused && !event.defaultPrevented) {
                navigation.navigate(route.name);
              }
            };

            return (
              <Pressable
                key={route.key}
                onPress={onPress}
                style={styles.tab}
                accessibilityRole="button"
                accessibilityLabel={label}
                accessibilityState={focused ? { selected: true } : {}}
              >
                <View style={styles.iconWrap}>
                  <SymbolView
                    name={ICONS[route.name] ?? 'circle'}
                    size={usesIconOnlyLayout ? 23 : 21}
                    tintColor={focused ? C.yellowText : C.mute}
                    weight={focused ? 'semibold' : 'regular'}
                    resizeMode="scaleAspectFit"
                  />
                </View>
                {!usesIconOnlyLayout ? (
                  <Text style={[styles.label, focused && styles.labelActive]} maxFontSizeMultiplier={1.35}>{label}</Text>
                ) : null}
              </Pressable>
            );
          })}
      </View>
    </View>
  );
}

const makeStyles = (C: Tokens) =>
  StyleSheet.create({
    // Fused flush to the bottom edge: full-width bar, hairline top border, card
    // fill that extends through the home-indicator inset (paddingBottom inline).
    wrap: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: C.card,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: C.line,
    },
    bar: {
      height: BAR_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-around',
      paddingHorizontal: space.sm,
    },
    tab: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 3,
      paddingVertical: space.xs,
    },
    iconWrap: {
      height: 28,
      alignItems: 'center',
      justifyContent: 'center',
    },
    label: {
      fontSize: fontSizes.micro,
      fontWeight: '700',
      color: C.mute,
    },
    labelActive: {
      color: C.ink,
    },
  });
