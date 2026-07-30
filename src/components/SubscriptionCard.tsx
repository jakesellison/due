import { StyleSheet, Text, View } from 'react-native';

import { useThemedStyles } from '@/theme/ThemeProvider';
import { fontSizes, space, type Tokens } from '@/theme/tokens';

/**
 * Reserved billing slot in the You hub. Non-interactive placeholder — no
 * payments, StoreKit, or entitlements yet. A future billing build swaps the
 * internals without touching the hub layout.
 */
export function SubscriptionCard() {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.card}>
      <Text style={styles.plan}>Free plan</Text>
      <Text style={styles.note}>Plans coming soon.</Text>
    </View>
  );
}

const makeStyles = (C: Tokens) =>
  StyleSheet.create({
    card: {
      minHeight: 68,
      justifyContent: 'center',
      paddingHorizontal: space.lg,
      paddingVertical: space.md,
    },
    plan: { fontSize: fontSizes.body, fontWeight: '700', color: C.ink },
    note: { fontSize: fontSizes.metadata, color: C.mute, fontWeight: '600', marginTop: space.xs },
  });
