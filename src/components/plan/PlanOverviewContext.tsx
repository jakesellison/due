import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SymbolView } from 'expo-symbols';

import { statValueText } from '@/components/ui/Stat';
import { useTheme, useThemedStyles } from '@/theme/ThemeProvider';
import { display, fontSizes, space, type Tokens } from '@/theme/tokens';

interface PlanOverviewContextProps {
  name: string;
  goalTime?: string | null;
  primaryFacts: string;
  secondaryFacts: string;
  onSecondaryPress?: () => void;
  secondaryAccessibilityLabel?: string;
}

/**
 * Shared plan identity at overview altitude. The active Plan tab and the
 * pre-install review intentionally use the same typography and alignment; the
 * review may make its right-hand fact interactive to change the plan anchor.
 */
export function PlanOverviewContext({
  name,
  goalTime,
  primaryFacts,
  secondaryFacts,
  onSecondaryPress,
  secondaryAccessibilityLabel,
}: PlanOverviewContextProps) {
  const C = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { fontScale } = useWindowDimensions();
  const accessible = fontScale >= 1.6;

  const secondary = onSecondaryPress ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={secondaryAccessibilityLabel ?? secondaryFacts}
      onPress={onSecondaryPress}
      style={({ pressed }) => [
        styles.secondaryAction,
        accessible && styles.secondaryActionAccessible,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.fact, accessible && styles.factAccessible]}>{secondaryFacts}</Text>
      <SymbolView name="chevron.right" size={10} tintColor={C.faint} weight="semibold" resizeMode="scaleAspectFit" />
    </Pressable>
  ) : (
    <Text style={[styles.fact, accessible && styles.factAccessible]}>{secondaryFacts}</Text>
  );

  return (
    <View testID="plan-overview-context" style={styles.context}>
      <View style={[styles.titleRow, accessible && styles.titleRowAccessible]}>
        <Text style={[styles.title, accessible && styles.titleAccessible]}>{name}</Text>
        {goalTime ? <Text style={styles.goalTime}>{goalTime}</Text> : null}
      </View>
      <View style={[styles.facts, accessible && styles.factsAccessible]}>
        <Text style={[styles.fact, accessible && styles.factAccessible]}>{primaryFacts}</Text>
        {secondary}
      </View>
    </View>
  );
}

const makeStyles = (C: Tokens) => StyleSheet.create({
  context: {
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.lg,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: space.lg,
  },
  titleRowAccessible: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: space.s,
  },
  title: {
    flex: 1,
    minWidth: 0,
    color: C.ink,
    fontFamily: display,
    fontSize: 21,
    letterSpacing: -0.4,
  },
  titleAccessible: { fontSize: 21 },
  goalTime: {
    ...statValueText(C, 'labelSm', 'system'),
    color: C.mute,
    fontWeight: '800',
  },
  facts: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: space.sm,
    marginTop: space.s,
  },
  factsAccessible: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: space.s,
  },
  fact: {
    ...statValueText(C, 'labelSm', 'system'),
    color: C.mute,
    fontWeight: '700',
  },
  factAccessible: { fontSize: fontSizes.labelSm },
  secondaryAction: {
    minHeight: 44,
    marginVertical: -space.lg,
    marginRight: -space.md,
    paddingHorizontal: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: space.s,
  },
  secondaryActionAccessible: {
    minHeight: 44,
    marginVertical: 0,
    marginLeft: -space.md,
    justifyContent: 'flex-start',
  },
  pressed: { opacity: 0.58 },
});
