import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useThemedStyles } from '@/theme/ThemeProvider';
import { radius, type Tokens } from '@/theme/tokens';

const clamp = (value: number) => (Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0);
const pct = (value: number): `${number}%` => `${clamp(value) * 100}%`;

/**
 * The shared mileage-contract rail used by the Week scorecard and its editor.
 * Yellow is reserved for mileage already banked; the neutral extension is work
 * still scheduled. Mileage not covered by the projection remains the rail's
 * neutral empty geometry; warning color belongs to the verdict beside it.
 */
export function ContractMileageTrack({
  actualFraction,
  projectedFraction,
  paceFraction,
  arrivingFromFraction,
  targetMarkFraction,
  style,
  testID,
}: {
  actualFraction: number;
  projectedFraction: number;
  paceFraction?: number | null;
  /**
   * Lower edge of the span a just-banked run added. When set, that span is
   * distinguished on top of the banked fill so the runner sees WHICH miles are
   * new rather than only a total moving. Null/absent on every ordinary render.
   */
  arrivingFromFraction?: number | null;
  targetMarkFraction?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const styles = useThemedStyles(makeStyles);
  const actual = clamp(actualFraction);
  const projected = Math.max(actual, clamp(projectedFraction));

  return (
    <View
      accessible={false}
      importantForAccessibility="no"
      pointerEvents="none"
      style={[styles.root, style]}
      testID={testID}
    >
      <View testID={testID ? `${testID}-rail` : undefined} style={styles.rail}>
        {projected > actual ? (
          <View
            testID={testID ? `${testID}-scheduled` : undefined}
            style={[styles.scheduled, { left: pct(actual), width: pct(projected - actual) }]}
          />
        ) : null}
        {actual > 0 ? (
          <View
            testID={testID ? `${testID}-banked` : undefined}
            style={[styles.banked, { width: pct(actual) }]}
          />
        ) : null}
        {arrivingFromFraction != null && clamp(arrivingFromFraction) < actual ? (
          <View
            testID={testID ? `${testID}-arrival` : undefined}
            style={[
              styles.arrival,
              {
                left: pct(arrivingFromFraction),
                width: pct(actual - clamp(arrivingFromFraction)),
              },
            ]}
          />
        ) : null}
      </View>

      {paceFraction != null && paceFraction > 0 ? (
        <View style={[styles.paceMark, { left: pct(Math.min(0.995, paceFraction)) }]} />
      ) : null}
      {targetMarkFraction != null ? (
        <View
          testID={testID ? `${testID}-target-mark` : undefined}
          style={[styles.targetMark, { left: pct(targetMarkFraction) }]}
        />
      ) : null}
    </View>
  );
}

const makeStyles = (C: Tokens) =>
  StyleSheet.create({
    root: { position: 'relative', height: 11 },
    // PILL, not `radius.xs`. The rail is 11pt tall, so a fully rounded end needs
    // 5.5 — at 4 the caps were clipped flat enough to read as square ends at
    // real size, which is what the track's far right actually looked like.
    // `pill` clamps to half the height, giving a true capsule at any height.
    rail: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      overflow: 'hidden',
      borderRadius: radius.pill,
      backgroundColor: C.fill,
    },
    // Rounded on the LEADING edge only.
    //
    // The right cap is the head of the fill and reads as one — square there made
    // the bar look cut off. The LEFT end is deliberately square: the rail is
    // already a pill and clips its children, so a radius here nested a second
    // curve just inside the rail's own, and the two slightly-different arcs read
    // as a doubled edge. Square + clipped gives one clean curve at that end.
    banked: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      left: 0,
      borderTopRightRadius: radius.pill,
      borderBottomRightRadius: radius.pill,
      backgroundColor: C.yellow,
    },
    // The just-banked span, brighter than the settled fill it sits on. `ink` on
    // yellow keeps this inside the accent's contract (text/marks on yellow are
    // always accentInk) instead of introducing a second accent hue.
    // Square where it JOINS the settled fill, rounded where it caps it.
    //
    // Its right edge is the fill's right edge, so it has to carry the same cap —
    // a square corner here would poke outside the yellow's curve and show dark
    // ink beyond the bar's head. The left edge stays square because that end is
    // a join, not a terminus; rounding it notched a curve into the yellow.
    arrival: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      borderTopRightRadius: radius.pill,
      borderBottomRightRadius: radius.pill,
      backgroundColor: C.accentInk,
      opacity: 0.28,
    },
    // Same leading cap as the banked fill. This is the still-scheduled
    // projection: it is a filled segment that ENDS mid-rail, so it terminates
    // the same way the yellow does. Its left edge stays square because that is a
    // join with the banked fill, not an end. One rule across the track: a
    // segment's terminus is capped, a join is not.
    scheduled: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      borderTopRightRadius: radius.pill,
      borderBottomRightRadius: radius.pill,
      backgroundColor: C.faint,
      opacity: 0.72,
    },
    paceMark: {
      position: 'absolute',
      top: -2,
      bottom: -2,
      width: 2,
      marginLeft: -1,
      borderRadius: 1,
      backgroundColor: C.ink,
    },
    targetMark: {
      position: 'absolute',
      top: -3,
      bottom: -3,
      width: 2,
      marginLeft: -1,
      borderRadius: 1,
      backgroundColor: C.faint,
    },
  });
