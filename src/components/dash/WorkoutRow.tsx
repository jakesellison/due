/**
 * WorkoutRow — the canonical "a workout as a row" presentation, shared so a
 * workout reads the SAME wherever it appears: a tinted type token, the title +
 * optional prescription line, and the distance with an est-time / "ran" secondary. The
 * Dash's DayPanel renders it bare (top of the day panel, bar drawn below); the
 * week planner renders it as a `card` with a drag grip accessory. Extracted
 * from DayPanel so the two can never drift (same move as CalendarCell).
 */
import type { ReactNode } from 'react';
import { StyleSheet, Text, useWindowDimensions, View, type StyleProp, type ViewStyle } from 'react-native';
import { SymbolView } from 'expo-symbols';

import { DueGlyphTile, type DueGlyphName, type DueGlyphTone } from '@/components/brand';
import { PressableScale } from '@/components/PressableScale';
import { eyebrowText } from '@/components/ui/Eyebrow';
import { statValueText } from '@/components/ui/Stat';
import { useThemedStyles } from '@/theme/ThemeProvider';
import { display, fontSizes, radius, space, usesAccessibilityTextLayout, type Tokens } from '@/theme/tokens';

const SEMANTIC_TEXT_SCALE = 2;
const DISPLAY_TEXT_SCALE = 1.6;

type SFName = React.ComponentProps<typeof SymbolView>['name'];

/** hex → rgba at alpha a (soft type-token bg). */
function tint(hex: string, a: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export interface WorkoutRowProps {
  /** The workout's type colour (drives token + type-line). */
  accent: string;
  icon: SFName;
  /** Overrides the icon-derived tile tone; useful for the Easy steel-blue identity. */
  glyphTone?: DueGlyphTone;
  /** Small secondary identity mark, e.g. Quality embedded in a Long Run. */
  glyphOverlay?: { name: DueGlyphName; tone: DueGlyphTone };
  title: string;
  typeLine?: string;
  /** Rich type line for mixed identities such as Long + Quality. */
  typeLineNode?: ReactNode;
  /** Small muted caption under the type line (e.g. "Missed · Tue"). */
  note?: string;
  distLabel: string | number;
  distanceUnit?: 'mi' | 'km';
  /** Small line under the distance — est time (with a clock) or "N ran". */
  secondary?: { label: string; icon?: SFName; ran?: boolean };
  sealed?: boolean;
  /** Wrap in a card (planner list) vs bare row (Dash panel top). */
  card?: boolean;
  /** Right-most element (e.g. a drag grip). */
  accessory?: ReactNode;
  /** Container override (e.g. the planner's orange candidate treatment). */
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  accessibilityLabel?: string;
  testID?: string;
}

export function WorkoutRow({
  accent,
  icon,
  glyphTone,
  glyphOverlay,
  title,
  typeLine,
  typeLineNode,
  note,
  distLabel,
  distanceUnit = 'mi',
  secondary,
  sealed,
  card,
  accessory,
  style,
  onPress,
  accessibilityLabel,
  testID,
}: WorkoutRowProps) {
  const styles = useThemedStyles(makeStyles);
  const { fontScale } = useWindowDimensions();
  const usesAccessibilityLayout = usesAccessibilityTextLayout(fontScale);
  const dueGlyph = dueGlyphFor(icon);
  // The accessory (e.g. a drag grip) sits OUTSIDE the PressableScale so it never
  // triggers the row's onPress — tapping the grip drags, it doesn't open detail.
  return (
    <View style={[styles.row, usesAccessibilityLayout && styles.rowAccessible, card ? styles.card : styles.bare, style]}>
      <PressableScale
        onPress={onPress}
        accessibilityRole={onPress ? 'link' : undefined}
        accessibilityLabel={accessibilityLabel}
        testID={testID}
        style={[styles.tap, usesAccessibilityLayout && styles.tapAccessible]}
      >
        {dueGlyph ? (
          <DueGlyphTile
            name={dueGlyph.name}
            tone={glyphTone ?? dueGlyph.tone}
            overlay={glyphOverlay}
            size={38}
            style={styles.dueTile}
          />
        ) : (
          <View style={[styles.tok, { backgroundColor: tint(accent, 0.14) }]}>
            <SymbolView name={icon} size={19} tintColor={accent} resizeMode="scaleAspectFit" />
          </View>
        )}

        <View style={[styles.main, usesAccessibilityLayout && styles.mainAccessible]}>
          <View style={[styles.titleRow, usesAccessibilityLayout && styles.titleRowAccessible]}>
            <Text style={styles.title} numberOfLines={usesAccessibilityLayout ? undefined : 1} maxFontSizeMultiplier={SEMANTIC_TEXT_SCALE}>
              {title}
            </Text>
            {sealed ? <SymbolView name="checkmark.seal.fill" size={15} tintColor={styles.seal.color} resizeMode="scaleAspectFit" /> : null}
          </View>
          {typeLineNode || typeLine || note ? <View style={[styles.typeRow, usesAccessibilityLayout && styles.typeRowAccessible]}>
            {typeLineNode ?? (typeLine ? <Text style={[styles.type, { color: accent }]} numberOfLines={usesAccessibilityLayout ? undefined : 1} maxFontSizeMultiplier={SEMANTIC_TEXT_SCALE}>
              {typeLine}
            </Text> : null)}
            {note ? (
              <View style={styles.noteChip}>
                <Text style={styles.noteChipTxt} numberOfLines={usesAccessibilityLayout ? undefined : 1} maxFontSizeMultiplier={SEMANTIC_TEXT_SCALE}>
                  {note}
                </Text>
              </View>
            ) : null}
          </View> : null}
        </View>

        <View style={[styles.right, usesAccessibilityLayout && styles.rightAccessible]}>
          <Text style={styles.mi} maxFontSizeMultiplier={DISPLAY_TEXT_SCALE}>
            {distLabel}
            <Text style={styles.miU} maxFontSizeMultiplier={SEMANTIC_TEXT_SCALE}> {distanceUnit}</Text>
          </Text>
          {secondary ? (
            <View style={styles.secRow}>
              {secondary.icon ? <SymbolView name={secondary.icon} size={11} tintColor={styles.est.color} resizeMode="scaleAspectFit" /> : null}
              <Text style={[styles.est, secondary.ran && styles.ran]} maxFontSizeMultiplier={SEMANTIC_TEXT_SCALE}>{secondary.label}</Text>
            </View>
          ) : null}
        </View>
      </PressableScale>

      {accessory}
    </View>
  );
}

function dueGlyphFor(icon: SFName): { name: DueGlyphName; tone: DueGlyphTone } | null {
  const symbol = typeof icon === 'string' ? icon : icon.ios;
  if (!symbol) return null;
  if (symbol.includes('bolt')) return { name: 'quality', tone: 'quality' };
  if (symbol.includes('mountain')) return { name: 'long', tone: 'long' };
  if (symbol.includes('moon') || symbol.includes('pause')) return { name: 'recovery', tone: 'neutral' };
  if (symbol.includes('figure.run')) return { name: 'easy', tone: 'easy' };
  return null;
}

const makeStyles = (C: Tokens) =>
  StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center' },
    rowAccessible: { alignItems: 'stretch' },
    tap: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
    tapAccessible: { flexDirection: 'column', alignItems: 'stretch' },
    bare: { paddingHorizontal: space.lg },
    card: {
      backgroundColor: C.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: C.line,
      borderRadius: radius.md,
      paddingVertical: space.m,
      paddingHorizontal: space.md,
    },
    tok: { width: 38, height: 38, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
    dueTile: { alignSelf: 'center' },
    main: { flex: 1, paddingTop: 1, paddingRight: space.sm },
    mainAccessible: { paddingRight: 0 },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
    titleRowAccessible: { flexWrap: 'wrap', alignItems: 'flex-start' },
    title: { color: C.ink, fontFamily: display, fontSize: fontSizes.sectionTitle, letterSpacing: -0.2, flexShrink: 1 },
    seal: { color: C.z2 },
    typeRow: { flexDirection: 'row', alignItems: 'center', gap: space.s, marginTop: 3 },
    typeRowAccessible: { flexDirection: 'column', alignItems: 'flex-start' },
    // The colour is the workout's own accent, applied at the call site.
    type: { ...eyebrowText(C, 'labelSm'), flexShrink: 1 },
    // The "Missed · Tue" origin as a compact chip so it never adds a row line.
    noteChip: { backgroundColor: C.fill, borderRadius: 5, paddingHorizontal: space.s, paddingVertical: 1.5 },
    noteChipTxt: { color: C.mute, fontSize: fontSizes.micro, fontWeight: '700' },
    right: { alignItems: 'flex-end' },
    rightAccessible: { alignItems: 'flex-start' },
    mi: { color: C.ink, fontSize: 22, fontFamily: display, letterSpacing: -0.4 },
    miU: { color: C.mute, fontSize: fontSizes.metadata, fontWeight: '700' },
    secRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: 3 },
    est: { ...statValueText(C, 'metadata', 'system'), color: C.mute, fontWeight: '700' },
    ran: { color: C.positiveText, fontSize: fontSizes.labelSm },
  });
