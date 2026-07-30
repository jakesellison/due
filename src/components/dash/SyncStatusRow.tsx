/**
 * SyncStatusRow — Dash's compact backfill-visibility row (PM#1).
 *
 * A brand-new tester who just connected Strava lands straight on Dash while
 * the eager history backfill runs for real in the background (`you.tsx`'s
 * `startBackfill`) — until now that had zero surface outside You →
 * Connections, so a thin/fresh account read as silently broken. This reads
 * the SHARED `useBackfillStatus` (see `backfillStatus.ts`) — it never starts
 * or resumes anything itself, it only shows what's already running and links
 * to where the controls live. Renders nothing once idle/done.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';

import { useBackfillStatus } from '@/app-lib/backfillStatus';
import { useTheme, useThemedStyles } from '@/theme/ThemeProvider';
import { fontSizes, radius, space, type Tokens } from '@/theme/tokens';

export function SyncStatusRow() {
  const status = useBackfillStatus();
  const C = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();

  if (status.kind === 'idle' || status.kind === 'done') return null;

  const paused = status.kind === 'rate_limited';
  const label = status.kind === 'running' ? status.label : 'Import paused — rate limited';
  const fraction = status.kind === 'running' ? status.fraction : null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}. Open sync settings`}
      onPress={() => router.push('/you')}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.iconWrap}>
        <SymbolView
          name={paused ? 'exclamationmark.arrow.circlepath' : 'arrow.trianglehead.2.clockwise.rotate.90'}
          size={14}
          tintColor={paused ? C.warningText : C.mute}
          weight="semibold"
          resizeMode="scaleAspectFit"
        />
      </View>
      <View style={styles.body}>
        <Text style={[styles.label, paused && styles.labelWarn]} numberOfLines={1}>
          {label}
        </Text>
        {/* Only a KNOWN fraction (the enrich phase reports a remaining count)
            draws a determinate bar — an unknown-total summaries page never
            fabricates a percentage. */}
        {!paused && fraction != null ? (
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%` }]} />
          </View>
        ) : null}
      </View>
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
    iconWrap: { width: 22, alignItems: 'center', justifyContent: 'center' },
    body: { flex: 1, minWidth: 0, gap: space.s },
    label: { color: C.mute, fontSize: fontSizes.metadata, fontWeight: '700' },
    labelWarn: { color: C.warningText },
    track: { height: 3, borderRadius: radius.xs, backgroundColor: C.fill, overflow: 'hidden' },
    fill: { height: '100%', borderRadius: radius.xs, backgroundColor: C.yellow },
  });
