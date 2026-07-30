/**
 * Chip — the pill badge: a prescribed intensity ("THRESHOLD"), a session state
 * ("COMPLETED"), a realign delta ("−4.2 MI"), a plan tag ("ACTIVE").
 *
 * 46 hand-rolled `borderRadius: radius.pill` containers exist; the ~32 that
 * carry a label rather than being a dot or a progress track are this. They had
 * settled on two different fills for the same neutral badge (`C.fill` in
 * DayRow/PlanOutlineView, `C.panel` + hairline in SessionView) and three
 * different vertical paddings for the same 18pt pill, and the accented ones had
 * started inventing colour: `app/realign.tsx` carried
 * `backgroundColor: 'rgba(240,136,62,0.16)'` — a hand-mixed wash of the warning
 * orange whose relationship to `C.warningText` was invisible to a theme change.
 *
 * So the tones here are DERIVED, never authored: every wash is
 * `alpha(<token>, …)` of the same token that colours the label. Change
 * `warningText` and the deficit chip follows.
 *
 * Uppercase is the default because a chip is a tag, not a sentence — but it is
 * a prop, because a chip that carries a formatted value ("7:42/mi") should not
 * be shouted.
 */
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { SymbolView, type SFSymbol } from 'expo-symbols';

import { useTheme } from '@/theme/ThemeProvider';
import { alpha, fontSizes, radius, space, type Tokens } from '@/theme/tokens';

/**
 * Tones name the MEANING, not the colour — `quality`, not `violet` — so a chip
 * keeps saying the right thing if the palette moves. They map onto the same
 * type→colour language the day strip uses (long = cyan, quality = violet,
 * easy = steel blue).
 */
export type ChipTone =
  | 'neutral'
  | 'outline'
  | 'accent'
  | 'quality'
  | 'long'
  | 'easy'
  | 'positive'
  | 'warning'
  | 'danger';

/** One wash strength for every accented tone. Strong enough to read as a
 *  surface on both `bg` and `card`, weak enough that the label stays the
 *  brightest thing in the pill. */
const WASH = 0.14;

export type ChipSize = 'micro' | 'labelSm';

function toneStyle(C: Tokens, tone: ChipTone): { bg: string; fg: string; border: string | null } {
  switch (tone) {
    // The dominant badge: a neutral raised tag that adds no meaning of its own.
    case 'neutral':
      return { bg: C.fill, fg: C.mute, border: null };
    // The SessionView variant — a chip sitting on a card that already uses
    // `C.fill` elsewhere, so it needs an edge instead of a wash to separate.
    case 'outline':
      return { bg: C.panel, fg: C.mute, border: C.line };
    case 'accent':
      return { bg: alpha(C.yellow, WASH), fg: C.yellowText, border: null };
    case 'quality':
      return { bg: alpha(C.qual, WASH), fg: C.qualText, border: null };
    case 'long':
      return { bg: alpha(C.cyan, WASH), fg: C.cyanText, border: null };
    case 'easy':
      return { bg: alpha(C.easy, WASH), fg: C.easyText, border: null };
    case 'positive':
      return { bg: alpha(C.positiveText, WASH), fg: C.positiveText, border: null };
    case 'warning':
      return { bg: alpha(C.warningText, WASH), fg: C.warningText, border: null };
    case 'danger':
      return { bg: alpha(C.dangerText, WASH), fg: C.dangerText, border: null };
  }
}

export function Chip({
  label,
  tone = 'neutral',
  size = 'micro',
  icon,
  uppercase = true,
  style,
  testID,
}: {
  label: string;
  tone?: ChipTone;
  size?: ChipSize;
  /** An SF Symbol before the label, tinted to the tone's own colour. */
  icon?: SFSymbol;
  /** False for chips carrying a formatted value (a pace, a time) rather than a tag. */
  uppercase?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const C = useTheme();
  const { bg, fg, border } = toneStyle(C, tone);
  return (
    <View
      testID={testID}
      style={[
        styles.chip,
        size === 'labelSm' && styles.chipRoomy,
        { backgroundColor: bg },
        border ? { borderWidth: StyleSheet.hairlineWidth, borderColor: border } : null,
        style,
      ]}
    >
      {icon ? (
        <SymbolView name={icon} size={size === 'micro' ? 10 : 11} tintColor={fg} resizeMode="scaleAspectFit" />
      ) : null}
      <Text
        // A chip is sized for one short token; unbounded growth turns an 18pt
        // pill into a three-line block inside a row that cannot give the space.
        maxFontSizeMultiplier={1.6}
        numberOfLines={1}
        style={[
          styles.label,
          { color: fg, fontSize: fontSizes[size] },
          uppercase && styles.upper,
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // `minHeight` rather than `height`: the pill hugs one line, but a chip inside
  // an accessibility-sized row must be allowed to grow rather than clip.
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    minHeight: 18,
    paddingHorizontal: space.s,
    paddingVertical: space.xxs,
    borderRadius: radius.pill,
    flexShrink: 1,
  },
  chipRoomy: { minHeight: 22, paddingHorizontal: space.md, paddingVertical: space.xs },
  label: { fontWeight: '800' },
  // The letter-spacing only applies uppercased — tracking lowercase text at
  // 0.3 just looks loose.
  upper: { textTransform: 'uppercase', letterSpacing: 0.3 },
});
