/**
 * Stat — a numeral with its label: the single most duplicated shape in the app.
 *
 * An audit counted 187 hand-written `fontVariant: ['tabular-nums']`
 * declarations across 38 files. Tabular figures are not decoration — they are
 * what stops a gauge, a splits table, or a plan header from twitching sideways
 * as the value changes — so every one of those 187 sites was RIGHT to want
 * them, and every one of them had to remember. The ones that forgot are why
 * some columns still shimmy.
 *
 * The three shapes it covers, from the survey:
 *   gauge stat tiles   value over an uppercase key (WeekGauges' support goals)
 *   session tables     key over the value ("COMPLETED" / "4 of 5")
 *   plan header stats  value + unit, key beneath ("23 WEEKS", "76 MI/WK AVG")
 *
 * So `labelPlacement` is a prop rather than a fixed order: the table variant
 * genuinely reads key-first, and forcing it below was going to keep those call
 * sites hand-rolled.
 *
 * The value rides the `data` face (SpaceMono_700Bold) — the app's contract-
 * numeral voice — and the label is an `Eyebrow`, so a stat can never disagree
 * with a section kicker about what an uppercase key looks like.
 *
 * Because a large share of the 187 sites are cells inside bespoke tables that
 * should NOT become a `<Stat>` element, `statValueText(C, size?)` is exported
 * for style-only migration:
 *
 *     splitPace: { ...statValueText(C, 'sm'), textAlign: 'right' },
 */
import { StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { Eyebrow, type EyebrowSize } from '@/components/ui/Eyebrow';
import { useThemedStyles } from '@/theme/ThemeProvider';
import { data, dataRegular, fontSizes, space, type Tokens } from '@/theme/tokens';

/**
 * Value tiers, each resolving to a `fontSizes` step — never a bare number.
 *
 * The ladder is keyed by the `fontSizes` rungs themselves. Wave 1 of the
 * migration shipped four aliases (`sm`/`md`/`lg`/`xl`); they remain valid and
 * map onto the same rungs, but the named tiers are the API — all six wave-1
 * field reports hit the same wall: the app's dense readouts live at 10–14pt,
 * BELOW the old `sm` floor of 12, so the primitive could not reach the very
 * band it was built for.
 *
 * `md` (= `body`) is the default because that is what an ordinary row value
 * (a day's distance, a split's pace) already renders at.
 */
export type StatSize =
  | 'micro' | 'labelSm' | 'metadata' | 'label' | 'labelLg' | 'body' | 'sectionTitle' | 'sheetTitle'
  | 'sm' | 'md' | 'lg' | 'xl';

const VALUE_SIZE: Record<StatSize, number> = {
  micro: fontSizes.micro,
  labelSm: fontSizes.labelSm,
  metadata: fontSizes.metadata,
  label: fontSizes.label,
  labelLg: fontSizes.labelLg,
  body: fontSizes.body,
  sectionTitle: fontSizes.sectionTitle,
  sheetTitle: fontSizes.sheetTitle,
  sm: fontSizes.metadata,
  md: fontSizes.body,
  lg: fontSizes.sectionTitle,
  xl: fontSizes.sheetTitle,
};

/**
 * Which numeral FACE a value rides. The app has three legitimate numeric
 * voices, and wave 1 proved all three exist in the wild at scale:
 *   data        SpaceMono 700 — contract numerals, the default
 *   dataRegular SpaceMono 400 — "supporting tabular data where bold would
 *               create a false primary metric" (the token's own words)
 *   system      the SF face — a value inside a label-tier row; the factory
 *               contributes size + tabular figures and deliberately leaves
 *               family and weight to the call site
 */
export type StatFace = 'data' | 'dataRegular' | 'system';

/**
 * Optical tracking. Mono digits are already wide, so the small tiers take
 * none; the large tiers pull in slightly so a hero figure does not read as
 * spaced-out. These are the only sub-token numbers here, and they are the
 * documented 1-3px-class optical nudge, not layout.
 */
const VALUE_TRACKING: Record<StatSize, number> = {
  micro: 0, labelSm: 0, metadata: 0, label: 0, labelLg: 0, body: 0,
  sectionTitle: -0.2, sheetTitle: -0.4,
  sm: 0, md: 0, lg: -0.2, xl: -0.4,
};

/** The label tier that visually balances each value tier. */
const LABEL_SIZE: Record<StatSize, EyebrowSize> = {
  micro: 'micro', labelSm: 'micro', metadata: 'micro', label: 'micro',
  labelLg: 'micro', body: 'micro', sectionTitle: 'labelSm', sheetTitle: 'labelSm',
  sm: 'micro', md: 'micro', lg: 'labelSm', xl: 'labelSm',
};

/** The numeral treatment as a spreadable style — for table cells and any other
 *  site that wants the type without the wrapper element. */
export const statValueText = (C: Tokens, size: StatSize = 'md', face: StatFace = 'data'): TextStyle => ({
  color: C.ink,
  // `system` omits the family ON PURPOSE: those call sites keep the SF face
  // and their own weight, and take only the size rung + tabular figures —
  // which is the one decision every numeral in the app must share.
  ...(face === 'data' ? { fontFamily: data } : face === 'dataRegular' ? { fontFamily: dataRegular } : null),
  fontSize: VALUE_SIZE[size],
  letterSpacing: VALUE_TRACKING[size],
  // The whole point. Digits share one advance width, so a changing value never
  // reflows the row around it.
  fontVariant: ['tabular-nums'],
});

export function Stat({
  value,
  label,
  unit,
  size = 'md',
  align = 'left',
  labelPlacement = 'below',
  valueColor,
  labelColor,
  style,
  testID,
  accessibilityLabel,
}: {
  /** Pre-formatted. A stat does not do arithmetic or unit conversion. */
  value: string | number;
  /** The uppercase key. Omit for a bare numeral that a neighbour already labels. */
  label?: string;
  /** A trailing unit on the value's baseline ("MI", "BPM") — rendered as an eyebrow. */
  unit?: string;
  size?: StatSize;
  align?: 'left' | 'center' | 'right';
  /** `below` (gauge tile, plan header) or `above` (session table column). */
  labelPlacement?: 'below' | 'above';
  /** A semantic TOKEN when the number itself carries state. Defaults to `C.ink`. */
  valueColor?: string;
  /** A semantic TOKEN for the key. Defaults to the eyebrow's `C.mute`. */
  labelColor?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  accessibilityLabel?: string;
}) {
  const styles = useThemedStyles(makeStyles);
  const key = label ? (
    <Eyebrow size={LABEL_SIZE[size]} color={labelColor} numberOfLines={1}>
      {label}
    </Eyebrow>
  ) : null;

  return (
    <View
      style={[styles.root, styles[align], style]}
      testID={testID}
      // One node to VoiceOver: "COMPLETED, 4 of 5" beats three separate stops.
      accessible
      accessibilityLabel={accessibilityLabel ?? [label, value, unit].filter(Boolean).join(' ')}
    >
      {labelPlacement === 'above' ? key : null}
      {/* The row is NOT re-aligned here: the root's `alignItems` already places
          it, and re-declaring alignment would overwrite the baseline the unit
          eyebrow sits on. */}
      <View style={styles.valueRow}>
        <Text
          maxFontSizeMultiplier={2}
          style={[styles[size], valueColor ? { color: valueColor } : null]}
        >
          {value}
        </Text>
        {unit ? <Eyebrow size={LABEL_SIZE[size]} style={styles.unit}>{unit}</Eyebrow> : null}
      </View>
      {labelPlacement === 'below' ? key : null}
    </View>
  );
}

const makeStyles = (C: Tokens) =>
  StyleSheet.create({
    // No gap: the label sits tight under its numeral by design, and the
    // xxs nudge below is the optical correction for a mono baseline.
    root: { minWidth: 0 },
    left: { alignItems: 'flex-start' },
    center: { alignItems: 'center' },
    right: { alignItems: 'flex-end' },
    // `baseline` so a unit eyebrow sits on the numeral's baseline rather than
    // floating at its cap height.
    valueRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.xs, minWidth: 0 },
    unit: { flexShrink: 1 },
    // One entry per rung, generated from the same factory the style-only
    // migrations use, so the element and the factory can never disagree.
    ...(Object.fromEntries(
      (Object.keys(VALUE_SIZE) as StatSize[]).map((k) => [k, statValueText(C, k)]),
    ) as Record<StatSize, TextStyle>),
  });
