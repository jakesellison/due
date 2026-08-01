import { useMemo } from 'react';
import {
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { useAppPreferences } from '@/app-lib/preferences';
import { useTheme, useThemedStyles } from '@/theme/ThemeProvider';
import { alpha, data, display, fontSizes, radius, space, type Tokens } from '@/theme/tokens';

export type PlanArtworkKind = '5k' | '10k' | 'half' | 'marathon' | 'bring-your-own';

type DistanceArtworkKind = Exclude<PlanArtworkKind, 'bring-your-own'>;

/**
 * The identity table. `ground` names a NON-SEMANTIC plan-identity token that
 * tints the brand ground so the race families are told apart at a glance; it
 * never touches the geometry, and `tint` is per-family because the palette
 * entries are nowhere near equally luminous.
 *
 * Two of the five plan colours are deliberately unused. `planViolet` is
 * obvious — at poster scale a violet field reads as the quality contract. But
 * `planRose` fails the same test for a less obvious reason: the brand ground is
 * a violet-cast near-black (`#12101F`), so a rose tint over it lands with its
 * blue channel level with its red and renders plum, not rose. The family that
 * would have carried it takes the untinted brand plate instead — one cover on
 * the pure ground is a cleaner answer than four when one of them is lying.
 */
const DISTANCE_ART: Record<DistanceArtworkKind, {
  miles: string;
  kilometers: string;
  ground: 'planGreen' | 'planBlue' | 'planWarm' | null;
  tint: number;
}> = {
  // Ordered so NEIGHBOURS on the storefront shelf never share a hue family.
  '5k': { miles: '3.1', kilometers: '5', ground: 'planGreen', tint: 0.16 },
  '10k': { miles: '6.2', kilometers: '10', ground: null, tint: 0 },
  half: { miles: '13.1', kilometers: '21.1', ground: 'planBlue', tint: 0.2 },
  marathon: { miles: '26.2', kilometers: '42.2', ground: 'planWarm', tint: 0.2 },
};

/** The mileage mass. One flat value: variation is the ARC, not the alpha. */
const MASS_ALPHA = 0.28;
/**
 * An unknown week — the faint empty vessel the app already uses for work still
 * ahead (`StructureBar`'s to-do remainder). Well below `MASS_ALPHA`, because
 * with no arc to draw these weeks are context for the format mark, not the
 * subject of the cover.
 */
const TRACK_ALPHA = 0.09;
/** A zero-mileage week still occupies its slot in the block. */
const MIN_COLUMN = 0.09;
/** Slots drawn when no arc is known (bring-your-own): a plan-typical block. */
const EMPTY_SLOTS = 12;
/**
 * Empty slots stop well short of the band. At full height with the arc's tight
 * pitch, twelve equal columns stop being weeks and become one slab with slits
 * in it — so the empty case takes a lower rail and a wider gap, and the format
 * mark keeps the room above it.
 */
const EMPTY_SLOT_HEIGHT = 0.56;

interface PlanArtworkProps {
  kind: PlanArtworkKind;
  /**
   * The plan's REAL week-by-week mileage arc, in meters, week 1 → last. The
   * cover is a rendering of this and nothing else; omit it and the cover draws
   * empty weekly slots rather than inventing a shape.
   */
  weeks?: readonly number[] | null;
  aspectRatio?: number;
  radiusMode?: 'none' | 'card';
  style?: StyleProp<ViewStyle>;
}

interface Profile {
  /** Each week's height as a fraction of the peak week. */
  columns: number[];
  /** The one week the yellow mark belongs to, or -1 when the arc is unknown. */
  peakIndex: number;
}

/**
 * A plan cover is a poster-scale rendering of that plan's own mileage arc: one
 * column per weekly contract, rising from the card's baseline hairline, with
 * the peak week carrying the single yellow mark. The build ramp, the recovery
 * cutbacks, the peak, and the taper are all legible before a word is read —
 * two plans look different because they ARE different, not because a generator
 * gave them different blobs.
 *
 * Bring-your-own has no arc to draw, so it draws the empty weekly slots that a
 * plan would fill, and names the format instead of a race distance.
 */
export function PlanArtwork({
  kind,
  weeks,
  aspectRatio = 4 / 3,
  radiusMode = 'none',
  style,
}: PlanArtworkProps) {
  const C = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { preferences } = useAppPreferences();

  const art = kind === 'bring-your-own' ? null : DISTANCE_ART[kind];
  const profile = useMemo(() => deriveProfile(weeks), [weeks]);

  return (
    <View
      testID={`plan-artwork-${kind}`}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.frame, radiusMode === 'card' && styles.rounded, { aspectRatio }, style]}
    >
      {art?.ground ? (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: alpha(C[art.ground], art.tint) }]} />
      ) : null}

      <View style={[styles.profile, profile.peakIndex < 0 && styles.profileEmpty]}>
        {profile.columns.map((height, index) => (
          <View
            key={index}
            style={[
              styles.column,
              {
                height: `${Math.round(Math.max(MIN_COLUMN, height) * 100)}%`,
                backgroundColor:
                  index === profile.peakIndex
                    ? C.brandInk
                    : alpha(C.brandMute, profile.peakIndex < 0 ? TRACK_ALPHA : MASS_ALPHA),
              },
            ]}
          />
        ))}
      </View>

      <View style={styles.lockup}>
        {art ? (
          <>
            <Text maxFontSizeMultiplier={1.25} style={styles.distanceValue}>
              {preferences.distance === 'mi' ? art.miles : art.kilometers}
            </Text>
            <Text maxFontSizeMultiplier={1.25} style={styles.distanceUnit}>
              {preferences.distance.toUpperCase()}
            </Text>
          </>
        ) : (
          <Text maxFontSizeMultiplier={1.25} style={styles.formatMark}>.due</Text>
        )}
      </View>
    </View>
  );
}

/**
 * Normalize an arc to peak-relative fractions. A plan with fewer than two
 * usable weeks has no shape to show, so it falls back to empty slots (marked
 * by `peakIndex: -1`) instead of drawing a fabricated one.
 */
function deriveProfile(weeks?: readonly number[] | null): Profile {
  const values = (weeks ?? []).filter((value) => typeof value === 'number' && Number.isFinite(value) && value >= 0);
  const peak = values.reduce((max, value) => Math.max(max, value), 0);
  if (values.length < 2 || peak <= 0) {
    return { columns: new Array(EMPTY_SLOTS).fill(EMPTY_SLOT_HEIGHT), peakIndex: -1 };
  }
  return {
    columns: values.map((value) => value / peak),
    peakIndex: values.indexOf(peak),
  };
}

const makeStyles = (C: Tokens) => StyleSheet.create({
  frame: {
    position: 'relative',
    width: '100%',
    overflow: 'hidden',
    // The brand ground is dark in BOTH themes on purpose: a cover is a
    // deliberate brand surface, not a card that follows the page.
    backgroundColor: C.brand,
  },
  rounded: { borderRadius: radius.md },

  // Full-bleed and bottom-anchored: the card's own hairline is the baseline,
  // so the arc sits on the plan's facts rather than floating in a frame.
  profile: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '58%',
    flexDirection: 'row',
    alignItems: 'flex-end',
    // Tight enough that the top edge reads as one contour — a mileage profile,
    // not a bar chart — while each weekly contract stays its own column. It
    // also keeps a 20-week block resolving at the same pitch as an 8-week one.
    gap: space.xxs,
  },
  profileEmpty: { gap: space.s },
  column: {
    flex: 1,
    borderTopLeftRadius: radius.xs,
    borderTopRightRadius: radius.xs,
  },

  lockup: {
    position: 'absolute',
    top: space.l,
    left: space.lg,
    right: space.lg,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: space.sm,
  },
  distanceValue: {
    color: C.brandText,
    fontFamily: display,
    fontSize: fontSizes.numeralXl,
    lineHeight: 44,
    letterSpacing: -1.1,
  },
  distanceUnit: {
    color: C.brandMute,
    fontFamily: data,
    fontSize: fontSizes.labelSm,
    lineHeight: 16,
    letterSpacing: 1.2,
  },
  // The bring-your-own door's subject is the FILE, so the format takes the
  // display slot the race distance holds on every other cover — same grid
  // position, same weight, the ledger voice because `.due` is a format.
  formatMark: {
    color: C.brandText,
    fontFamily: data,
    fontSize: fontSizes.numeralLg,
    lineHeight: 44,
    letterSpacing: -0.6,
  },
});
