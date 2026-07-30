import { useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SymbolView } from 'expo-symbols';

import { eyebrowText } from '@/components/ui/Eyebrow';
import { useTheme, useThemedStyles } from '@/theme/ThemeProvider';
import { radius, space, usesAccessibilityTextLayout, type Tokens } from '@/theme/tokens';

/**
 * The app's sectioned-scroll vocabulary — the run-detail's Apple-Weather
 * sticky/collapse behaviour, extracted so every screen reads the same way.
 *
 * Each `section` block renders a sticky card-TOP (the eyebrow header, rounded
 * top) over a card-BODY (rounded bottom). As the body scrolls up behind its
 * pinned title it fades out; once fully behind, the title rounds its own bottom
 * into a pill. `node` blocks are plain content that scrolls normally (a hero, a
 * KPI row). Header label/padding/borders match the run-detail exactly.
 */
export type StickyBlock =
  | { kind: 'node'; key: string; node: ReactNode }
  | {
      kind: 'section';
      key: string;
      label: string;
      icon?: string;
      right?: ReactNode;
      body: ReactNode;
      /** Tappable header (e.g. expand to a detail sheet). Omitted → static title. */
      onPress?: () => void;
      /** Keep trailing header controls independent while making the title itself
       *  a compact disclosure control. */
      headerAction?: {
        onPress: () => void;
        accessibilityLabel: string;
        expanded?: boolean;
      };
      /** Drop the body's inner padding for full-bleed content (e.g. the calendar strip). */
      bodyFlush?: boolean;
      /** Drop the CARD chrome entirely (bg/border/radius) — the section renders
       *  edge-to-edge on the page as an integrated region, not a boxed card. */
      flush?: boolean;
    };

export function StickySections({
  blocks,
  contentContainerStyle,
  refreshControl,
  footer,
}: {
  blocks: StickyBlock[];
  contentContainerStyle?: StyleProp<ViewStyle>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  refreshControl?: React.ReactElement<any>;
  /** Rendered after all blocks, inside the scroll (e.g. a Powered-by-Strava footer). */
  footer?: React.ReactNode;
}) {
  const C = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { fontScale } = useWindowDimensions();
  const accessibilityLayout = usesAccessibilityTextLayout(fontScale);

  // Scroll-driven collapse: as a section's body scrolls up behind its pinned
  // title it FADES out, and once it's fully behind the title rounds into a pill.
  const scrollY = useRef(new Animated.Value(0)).current;
  const [geom, setGeom] = useState<Record<string, { top: number; bodyH: number }>>({});
  const geomRef = useRef(geom);
  geomRef.current = geom;
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const collapsedRef = useRef(collapsed);
  collapsedRef.current = collapsed;
  const onScroll = useMemo(
    () =>
      Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
        useNativeDriver: true,
        listener: (e: { nativeEvent: { contentOffset: { y: number } } }) => {
          const y = e.nativeEvent.contentOffset.y;
          const g = geomRef.current;
          const next = { ...collapsedRef.current };
          let changed = false;
          for (const k of Object.keys(g)) {
            const c = y >= g[k]!.top + g[k]!.bodyH - 10;
            if (!!next[k] !== c) {
              next[k] = c;
              changed = true;
            }
          }
          if (changed) setCollapsed(next);
        },
      }),
    [scrollY],
  );
  const setTop = (key: string, top: number) =>
    setGeom((p) => (p[key]?.top === top ? p : { ...p, [key]: { top, bodyH: p[key]?.bodyH ?? 0 } }));
  const setBodyH = (key: string, bodyH: number) =>
    setGeom((p) => (p[key]?.bodyH === bodyH ? p : { ...p, [key]: { top: p[key]?.top ?? 0, bodyH } }));

  const kids: ReactNode[] = [];
  const sticky: number[] = [];
  for (const b of blocks) {
    if (b.kind === 'node') {
      kids.push(<View key={b.key}>{b.node}</View>);
      continue;
    }
    const headerLabel = (
      <>
        {b.icon ? (
          <SymbolView name={b.icon as never} size={13} tintColor={C.mute} resizeMode="scaleAspectFit" />
        ) : null}
        <Text
          style={styles.cardHeadLab}
          numberOfLines={accessibilityLayout ? undefined : 1}
          adjustsFontSizeToFit={!accessibilityLayout}
          minimumFontScale={accessibilityLayout ? undefined : 0.72}
          maxFontSizeMultiplier={accessibilityLayout ? 2 : 1.25}
        >
          {b.label}
        </Text>
        {b.headerAction ? (
          <SymbolView
            name="chevron.down"
            size={11}
            tintColor={C.mute}
            weight="bold"
            resizeMode="scaleAspectFit"
            style={b.headerAction.expanded ? styles.cardHeadChevronExpanded : undefined}
          />
        ) : null}
      </>
    );
    const eyebrow = (
      <View style={[styles.cardHeadRow, accessibilityLayout && styles.cardHeadRowAccessible]}>
        {b.headerAction ? (
          <Pressable
            onPress={b.headerAction.onPress}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={b.headerAction.accessibilityLabel}
            accessibilityState={
              typeof b.headerAction.expanded === 'boolean'
                ? { expanded: b.headerAction.expanded }
                : undefined
            }
            style={({ pressed }) => [
              styles.cardHeadControl,
              accessibilityLayout && styles.cardHeadControlAccessible,
              pressed && styles.pressDim,
            ]}
          >
            {headerLabel}
          </Pressable>
        ) : (
          <View style={[styles.cardHeadLabelRow, accessibilityLayout && styles.cardHeadLabelRowAccessible]}>{headerLabel}</View>
        )}
        {b.right ? (
          <View style={[styles.cardHeadRight, accessibilityLayout && styles.cardHeadRightAccessible]}>
            {b.right}
          </View>
        ) : null}
      </View>
    );
    sticky.push(kids.length);
    const topStyle = [
      collapsed[b.key] ? [styles.cardTop, styles.cardTopPill] : styles.cardTop,
      b.flush && styles.cardTopFlush,
    ];
    const header = b.onPress ? (
      <Pressable
        onPress={b.onPress}
        hitSlop={6}
        style={({ pressed }) => [topStyle, pressed && styles.pressDim]}
      >
        {eyebrow}
      </Pressable>
    ) : (
      <View style={topStyle}>{eyebrow}</View>
    );
    const g = geom[b.key];
    const titleOpacity =
      g && g.bodyH > 24
        ? scrollY.interpolate({
            inputRange: [g.top + g.bodyH + 5, g.top + g.bodyH + 24],
            outputRange: [1, 0],
            extrapolate: 'clamp',
          })
        : 1;
    const bodyOpacity =
      g && g.bodyH > 24
        ? scrollY.interpolate({
            inputRange: [g.top + g.bodyH, g.top + g.bodyH + 4],
            outputRange: [1, 0],
            extrapolate: 'clamp',
          })
        : 1;
    kids.push(
      <Animated.View
        key={`${b.key}-t`}
        style={[styles.stickyMask, { opacity: titleOpacity }]}
        onLayout={(e) => setTop(b.key, e.nativeEvent.layout.y)}
      >
        {header}
      </Animated.View>,
    );
    kids.push(
      <Animated.View
        key={`${b.key}-b`}
        style={[styles.cardBody, b.bodyFlush && styles.cardBodyFlush, b.flush && styles.cardBodyBare, { opacity: bodyOpacity }]}
        onLayout={(e) => setBodyH(b.key, e.nativeEvent.layout.height)}
      >
        {b.body}
      </Animated.View>,
    );
  }

  return (
    <Animated.ScrollView
      contentContainerStyle={[styles.scroll, contentContainerStyle]}
      stickyHeaderIndices={sticky}
      showsVerticalScrollIndicator={false}
      scrollEventThrottle={16}
      onScroll={onScroll}
      refreshControl={refreshControl}
    >
      {kids}
      {footer}
    </Animated.ScrollView>
  );
}

const makeStyles = (C: Tokens) =>
  StyleSheet.create({
    scroll: { paddingHorizontal: space.lg, paddingTop: space.sm },
    stickyMask: { backgroundColor: C.bg },
    // One content surface for the whole Dash: C.panel, borderless — the tonal
    // step above the near-black page does the separating, no hairline outline (the
    // day-panel/realign treatment, now used everywhere).
    cardTop: {
      backgroundColor: C.panel,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      paddingHorizontal: space.lg,
      paddingTop: space.md,
      paddingBottom: space.m,
    },
    cardTopPill: { borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg },
    // Integrated (flush) region — no card chrome; header sits on the page bg,
    // aligned to the scroll gutter (its own side padding removed).
    // A flush header sits on the page background as a CAPTION over the content
    // below, not as a header bar. It therefore carries less vertical weight than
    // a card header: the card variant's padding made the row read as a bar with
    // a vacant right half, when the right slot is deliberately conditional (see
    // the Dash's Today/countdown slot).
    cardTopFlush: {
      paddingTop: space.sm,
      paddingBottom: space.s,
      backgroundColor: 'transparent',
      borderTopWidth: 0,
      borderLeftWidth: 0,
      borderRightWidth: 0,
      borderBottomWidth: 0,
      borderTopLeftRadius: 0,
      borderTopRightRadius: 0,
      borderBottomLeftRadius: 0,
      borderBottomRightRadius: 0,
      paddingHorizontal: 0,
    },
    cardBodyBare: {
      backgroundColor: 'transparent',
      borderLeftWidth: 0,
      borderRightWidth: 0,
      borderBottomWidth: 0,
      borderBottomLeftRadius: 0,
      borderBottomRightRadius: 0,
      marginBottom: 0,
    },
    // Full-bleed body (no side/bottom padding); a little top room so a tall
    // feature (e.g. the calendar tab) clears the header as it scrolls under.
    cardBodyFlush: { paddingHorizontal: 0, paddingBottom: 0, paddingTop: space.s },
    cardBody: {
      backgroundColor: C.panel,
      borderBottomLeftRadius: radius.lg,
      borderBottomRightRadius: radius.lg,
      paddingHorizontal: space.lg,
      paddingBottom: space.l,
      marginBottom: space.l,
    },
    cardHeadRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
    cardHeadRowAccessible: { flexDirection: 'column', alignItems: 'stretch', gap: space.sm },
    cardHeadLabelRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexShrink: 1 },
    cardHeadLabelRowAccessible: { width: '100%', flexShrink: 0, alignItems: 'flex-start' },
    cardHeadControl: {
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
      flexShrink: 1,
      paddingRight: space.xs,
    },
    cardHeadControlAccessible: { width: '100%', flexShrink: 0, alignItems: 'flex-start' },
    cardHeadRight: { marginLeft: 'auto' },
    cardHeadRightAccessible: { marginLeft: 0, alignSelf: 'flex-start' },
    cardHeadChevronExpanded: { transform: [{ rotate: '180deg' }] },
    cardHeadLab: {
      ...eyebrowText(C, 'metadata'),
      flexShrink: 1,
    },
    pressDim: { opacity: 0.7 },
  });
