/**
 * TypeMarks — the shared type "bar-lane": one bar per distinct run type (solid),
 * or a seamless half/half split bar for a run that is BOTH its type AND quality
 * (a long run with an embedded MP/tempo block → half type-colour, half violet).
 * Separate bars = separate runs (a double).
 *
 * Used by the Dash calendar cell (CalendarCell) AND the Plan / week-detail day
 * row (DayRow) so the two surfaces can never drift.
 */
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useThemedStyles } from '@/theme/ThemeProvider';
import { space, type Tokens } from '@/theme/tokens';

/** One type mark: a solid bar (single-facet run) or a split bar (`split` set → a
 *  run that is BOTH its type AND quality). One per DISTINCT run type that day. */
export interface CellMark {
  color: string;
  /** Second colour → render a seamless half/half split bar (type + quality). */
  split?: string;
}

export function TypeMarks({ marks, style, testID }: { marks: CellMark[]; style?: StyleProp<ViewStyle>; testID?: string }) {
  const styles = useThemedStyles(makeStyles);
  if (!marks.length) return null;
  return (
    <View testID={testID} style={[styles.marks, style]}>
      {marks.map((m, i) =>
        m.split ? (
          <View key={i} testID="daycell-mark" style={[styles.mark, styles.markSplit]}>
            <View style={[styles.markHalf, { backgroundColor: m.color }]} />
            <View style={[styles.markHalf, { backgroundColor: m.split }]} />
          </View>
        ) : (
          <View key={i} testID="daycell-mark" style={[styles.mark, { backgroundColor: m.color }]} />
        ),
      )}
    </View>
  );
}

const makeStyles = (_C: Tokens) =>
  StyleSheet.create({
    marks: { flexDirection: 'row', gap: space.nudge, alignItems: 'center', height: 4 },
    mark: { width: 13, height: 3, borderRadius: 1.5 },
    markSplit: { width: 15, flexDirection: 'row', overflow: 'hidden' },
    markHalf: { flex: 1 },
  });
