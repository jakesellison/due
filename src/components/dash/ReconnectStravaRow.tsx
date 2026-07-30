/**
 * ReconnectStravaRow — Dash's compact revoked-connection row.
 *
 * When a user's Strava grant is revoked (deauthorized on Strava, or the
 * refresh token dies), sync stops but Dash otherwise renders normally — the
 * only signal used to be buried in You → Connections, which nobody visits.
 * The server now answers 409 on sync and `connected: false` on the status
 * probe; this row surfaces that state at the top of Dash and links to the
 * reconnect flow. Renders nothing while the probe is loading or connected.
 */
import { Pressable, StyleSheet, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';

import { useTheme, useThemedStyles } from '@/theme/ThemeProvider';
import { fontSizes, radius, space, type Tokens } from '@/theme/tokens';

export function ReconnectStravaRow() {
  const C = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Strava disconnected. Reconnect"
      onPress={() => router.push('/you')}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <SymbolView
        name="bolt.slash.fill"
        size={14}
        tintColor={C.warningText}
        weight="semibold"
        resizeMode="scaleAspectFit"
        style={styles.icon}
      />
      <Text style={styles.label} numberOfLines={1}>
        Strava disconnected
      </Text>
      <Text style={styles.cta}>Reconnect</Text>
      <SymbolView name="chevron.right" size={12} tintColor={C.faint} weight="semibold" resizeMode="scaleAspectFit" />
    </Pressable>
  );
}

const makeStyles = (C: Tokens) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
      backgroundColor: C.card,
      borderColor: C.line,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: radius.md,
      paddingVertical: space.sm,
      paddingHorizontal: space.md,
      marginBottom: space.sm,
    },
    pressed: { opacity: 0.7 },
    icon: { width: 22 },
    // The problem reads as attention (orange); the CTA is the action (yellow).
    label: { flex: 1, minWidth: 0, color: C.warningText, fontSize: fontSizes.metadata, fontWeight: '700' },
    cta: { color: C.yellowText, fontSize: fontSizes.metadata, fontWeight: '700' },
  });
