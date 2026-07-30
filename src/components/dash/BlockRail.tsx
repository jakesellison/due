/**
 * BlockRail — the block record rendered as compact weekly contract stamps.
 *
 * The numeral inside each stamp is that week's mileage contract. Settled hits
 * become quiet solid seals, misses keep the same neutral x vocabulary as the
 * month calendar, the live week gets the only yellow outline, and future weeks
 * recede. Violet / cyan ticks are earned quality / long-run accents; they are
 * absent until those supporting contracts are actually met. The record itself
 * is read-only on Week; its single action opens the active block in Plan.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SymbolView } from 'expo-symbols';

import { WeekContractStampGrid } from '@/components/WeekContractStamp';
import type { WeekGoal } from '@/lib';
import { eyebrowText } from '@/components/ui/Eyebrow';
import { useTheme, useThemedStyles } from '@/theme/ThemeProvider';
import { fontSizes, radius, space, type Tokens } from '@/theme/tokens';

export function BlockRail({
  weeks,
  settledWeeks,
  hitWeeks,
  phaseLabel,
  onOpenPlan,
}: {
  weeks: WeekGoal[];
  settledWeeks: number;
  hitWeeks: number;
  phaseLabel?: string | null;
  onOpenPlan: () => void;
}) {
  const C = useTheme();
  const styles = useThemedStyles(makeStyles);
  const orderedWeeks = [...weeks].sort((a, b) => a.weekIndex - b.weekIndex);

  return (
    <View style={styles.card}>
      <View
        accessible
        accessibilityRole="summary"
        accessibilityLabel={`Training block${phaseLabel ? `, ${phaseLabel} phase` : ''}. Each stamp shows its weekly mileage contract and completed supporting goals.`}
        style={styles.profile}
      >
        <View style={styles.header}>
          <Text style={styles.title} numberOfLines={1} maxFontSizeMultiplier={1.25}>Training block</Text>
          {phaseLabel ? (
            <Text style={styles.position} numberOfLines={1} maxFontSizeMultiplier={1.1}>{phaseLabel}</Text>
          ) : null}
        </View>

        <View style={styles.record}>
          <WeekContractStampGrid weeks={orderedWeeks} testIDPrefix="block-stamp" />
        </View>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open training block in Plan. ${hitWeeks} of ${settledWeeks} completed weeks met their contracts.`}
        onPress={onOpenPlan}
        style={({ pressed }) => [styles.history, pressed && styles.pressed]}
      >
        <Text style={styles.historyPrimary} numberOfLines={1} maxFontSizeMultiplier={1.35}>
          <Text style={styles.historyCount}>
            {settledWeeks > 0 ? `${hitWeeks}/${settledWeeks}` : 'History'}
          </Text>
          <Text style={styles.historyLabel}>
            {settledWeeks > 0 ? ' contracts met' : ' starts here'}
          </Text>
        </Text>
        <SymbolView name="chevron.right" size={11} tintColor={C.mute} weight="semibold" resizeMode="scaleAspectFit" />
      </Pressable>
    </View>
  );
}

const makeStyles = (C: Tokens) =>
  StyleSheet.create({
    card: {
      backgroundColor: C.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: C.line,
      borderRadius: radius.md,
      paddingHorizontal: space.l,
      paddingBottom: space.sm,
      marginBottom: space.l,
    },
    profile: { paddingTop: space.l },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
    title: {
      ...eyebrowText(C, 'metadata'),
      color: C.ink,
      flexShrink: 1,
    },
    // The phase label is an eyebrow that happens to carry a numeral ("BUILD 3
    // OF 5"), so it keeps tabular figures on top of the eyebrow treatment.
    position: {
      ...eyebrowText(C, 'micro'),
      fontVariant: ['tabular-nums'],
    },
    record: { marginTop: space.lg, gap: space.sm },
    history: {
      minHeight: 42,
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.s,
      marginTop: space.md,
    },
    historyPrimary: { fontSize: fontSizes.metadata, letterSpacing: -0.05, flex: 1 },
    historyCount: { color: C.ink, fontWeight: '800' },
    historyLabel: { color: C.mute, fontWeight: '700' },
    pressed: { opacity: 0.58 },
  });
