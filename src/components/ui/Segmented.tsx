/**
 * Segmented — the app's ONE filled segmented control.
 *
 * Due had two visual grammars for "pick one of these": a filled track whose
 * selected segment lifts onto the card surface (WorkoutBuilder's
 * Distance / Time, routes/new's Loop / Out & back) and a flat underline rail
 * (the starter plan's training-volume tiers). DESIGN.md allows exactly one —
 * "Control … selection supplies the shape" — so the filled treatment is the
 * system's answer and this is where its anatomy lives:
 *
 *     track    C.recess, radius.md, 3pt padding    (the unselected positions)
 *     segment  C.card + a hairline edge, radius.sm (the selected position)
 *     label    C.mute → C.ink when selected
 *
 * The track is the RECESSED step and the selected segment the card plane, so
 * selection reads as the position that lifts out of the groove. Inverting those
 * two (a light track under a darker selected tile) reads as a hole instead —
 * verified on device.
 *
 * Living in `src/components/ui/` also means the fill + hairline are declared
 * ONCE rather than re-derived per screen (the uiConsistency ratchet's whole
 * point). `mono` puts numeric segments on the ledger face — a volume tier is a
 * quantity, not a word.
 */
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { useThemedStyles } from '@/theme/ThemeProvider';
import { data, fontSizes, radius, space, type Tokens } from '@/theme/tokens';

export interface SegmentedOption<T extends string> {
  value: T;
  /** Visible label. Sentence case (or a terse quantity); never an eyebrow. */
  label: string;
  /** Spoken label when the visible one is too terse ("45 miles per week"). */
  accessibilityLabel?: string;
  /** Force-disable a position (the selected one is always inert). */
  disabled?: boolean;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  mono = false,
  accessibilityLabel,
  style,
  testID,
}: {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Ledger face for numeric segments (volume tiers, paces). */
  mono?: boolean;
  /** Names the GROUP; each segment keeps its own label. */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.track, style]} accessibilityLabel={accessibilityLabel} testID={testID}>
      {options.map((option) => {
        const on = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityLabel={option.accessibilityLabel ?? option.label}
            accessibilityState={{ selected: on, disabled: option.disabled ?? false }}
            // Re-picking the current position is a no-op; disabling it also
            // stops the press dim from implying something is about to change.
            disabled={option.disabled ?? on}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [styles.segment, on && styles.segmentOn, pressed && styles.pressed]}
          >
            <Text
              numberOfLines={1}
              maxFontSizeMultiplier={1.4}
              style={[styles.label, mono ? styles.labelMono : styles.labelSystem, on && styles.labelOn]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const makeStyles = (C: Tokens) =>
  StyleSheet.create({
    track: {
      flexDirection: 'row',
      minHeight: 44,
      padding: 3,
      borderRadius: radius.md,
      backgroundColor: C.recess,
    },
    segment: {
      flex: 1,
      minWidth: 0,
      minHeight: 38,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: space.s,
      borderRadius: radius.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'transparent',
    },
    // Selection supplies the shape: the raised card fill plus its hairline edge.
    segmentOn: { backgroundColor: C.card, borderColor: C.line },
    pressed: { opacity: 0.6 },
    label: { color: C.mute, fontSize: fontSizes.metadata },
    // Only the 700 weight of Space Mono is loaded, so the ledger face declares
    // no weight of its own (a second weight here is synthesised, not selected).
    labelSystem: { fontWeight: '800' },
    labelMono: { fontFamily: data, fontSize: fontSizes.labelSm },
    labelOn: { color: C.ink },
  });
