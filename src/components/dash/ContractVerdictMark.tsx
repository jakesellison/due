import { StyleSheet, View } from 'react-native';

import { useThemedStyles } from '@/theme/ThemeProvider';
import { radius, type Tokens } from '@/theme/tokens';

export type ContractVerdictTone = 'positive' | 'short' | 'planned';

/** Shared weekly-contract mark: one fixed dot geometry, with tone carrying state. */
export function ContractVerdictMark({
  tone,
  testID,
}: {
  tone: ContractVerdictTone;
  testID?: string;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View
      testID={testID}
      style={styles.wrap}
      accessible={false}
      importantForAccessibility="no"
    >
      <View
        testID={testID ? `${testID}-${tone}` : undefined}
        style={
          tone === 'short'
            ? styles.short
            : tone === 'planned'
              ? styles.planned
              : styles.positive
        }
      />
    </View>
  );
}

const makeStyles = (C: Tokens) =>
  StyleSheet.create({
    wrap: {
      width: 16,
      height: 16,
      flexShrink: 0,
      alignItems: 'center',
      justifyContent: 'center',
    },
    positive: {
      width: 8,
      height: 8,
      borderRadius: radius.xs,
      backgroundColor: C.z2,
      shadowColor: C.z2,
      shadowOpacity: 0.5,
      shadowRadius: 4,
      shadowOffset: { width: 0, height: 0 },
    },
    short: {
      width: 8,
      height: 8,
      borderRadius: radius.xs,
      backgroundColor: C.warningText,
    },
    planned: {
      width: 8,
      height: 8,
      borderRadius: radius.xs,
      backgroundColor: C.faint,
    },
  });
