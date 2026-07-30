/**
 * ChangeRow — one resolved plan-change line, shared across the three evolution
 * surfaces (day ledger, week card, whole-plan log) so they read identically.
 * A semantic dot, the subject title, then a right-aligned value — no "A → B"
 * arrows. The dot reuses the Week/Plan status grammar without restating the
 * change in a decorative icon tile.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { statValueText } from '@/components/ui/Stat';
import { useTheme, useThemedStyles } from '@/theme/ThemeProvider';
import { fontSizes, space, type Tokens } from '@/theme/tokens';
import { toneColorOr } from '@/theme/tone';
import type { WorkoutTone } from '@/lib';
import type { ResolvedChange } from '@/lib/plan/changeLog';

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** ISO instant → "Jul 1". */
export function changeShortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${MONTH_SHORT[d.getUTCMonth()] ?? ''} ${d.getUTCDate()}`;
}

export function ChangeRow({ change, when }: { change: ResolvedChange; when?: string }): React.JSX.Element {
  const C = useTheme();
  const styles = useThemedStyles(makeStyles);
  const iconColor = toneColorOr(C, change.tone as WorkoutTone | null);
  // The value carries type colour on a type change; relational verbs read muted;
  // numbers read as ink.
  const valueColor = change.verb === 'type' ? iconColor : change.verb === 'swap' || change.verb === 'move' ? C.mute : C.ink;
  const accessibilityLabel = [
    change.title,
    change.value,
    when ? changeShortDate(when) : null,
  ].filter(Boolean).join(', ');

  return (
    <View accessible accessibilityRole="text" accessibilityLabel={accessibilityLabel} style={styles.row}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.dot, { backgroundColor: change.tone ? iconColor : C.faint }]} />
      <Text style={styles.title} numberOfLines={1}>{change.title}</Text>
      {change.value ? <Text style={[styles.value, { color: valueColor }]} numberOfLines={1}>{change.value}</Text> : null}
      {when ? <Text style={styles.when}>{changeShortDate(when)}</Text> : null}
    </View>
  );
}

const makeStyles = (C: Tokens) =>
  StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 32 },
    dot: { width: 7, height: 7, borderRadius: 3.5 },
    title: { color: C.ink, fontSize: fontSizes.label, fontWeight: '600', flex: 1 },
    // The delta's colour is the change's own direction token, passed at the call
    // site, so the factory's C.ink is never the one that renders.
    value: { ...statValueText(C, 'label', 'system'), fontWeight: '800' },
    when: { ...statValueText(C, 'labelSm', 'system'), color: C.mute, fontWeight: '700', minWidth: 40, textAlign: 'right' },
  });
