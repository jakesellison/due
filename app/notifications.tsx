import { useCallback, useEffect, useState } from 'react';
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';

import { useSession } from '@/app-lib/auth';
import {
  loadNotificationPreferences,
  saveNotificationPreferences,
} from '@/app-lib/notificationPreferences';
import {
  pushPermissionGranted,
  registerPush,
  unregisterPush,
  type RegisterResult,
} from '@/app-lib/pushNotifications';
import { closeScreen } from '@/app-lib/nav';
import { SheetHeader } from '@/components/SheetHeader';
import { useTheme, useThemedStyles } from '@/theme/ThemeProvider';
import { fontSizes, radius, space, typeRole, type Tokens } from '@/theme/tokens';

function failureMessage(result: Exclude<RegisterResult, { ok: true }>): string {
  if (result.reason === 'denied') return 'Allow notifications in iOS Settings, then try again.';
  if (result.reason === 'no-project-id' || result.reason === 'unavailable') {
    return 'Notifications will be available after the next app build.';
  }
  return 'Couldn’t enable notifications — try again.';
}

/**
 * The notification category list. Only a working category ships here; future
 * notification types join this same ledger instead of adding switches to You.
 */
export default function NotificationSettingsScreen() {
  const styles = useThemedStyles(makeStyles);
  const C = useTheme();
  const router = useRouter();
  const { userId, ready } = useSession();
  const [runReady, setRunReady] = useState(false);
  const [systemAllowed, setSystemAllowed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([loadNotificationPreferences(), pushPermissionGranted()])
      .then(([saved, allowed]) => {
        if (!alive) return;
        setSystemAllowed(allowed);
        // Preserve the existing single-toggle behavior for people who enabled
        // notifications before category preferences were introduced.
        setRunReady((saved?.runReady ?? allowed) && allowed);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const onToggleRunReady = useCallback(
    async (next: boolean) => {
      if (!ready || !userId || busy) return;
      setBusy(true);
      setNote(null);
      try {
        if (next) {
          const result = await registerPush(userId);
          if (!result.ok) {
            setRunReady(false);
            setSystemAllowed(await pushPermissionGranted());
            setNote(failureMessage(result));
            return;
          }
          await saveNotificationPreferences({ runReady: true });
          setRunReady(true);
          setSystemAllowed(true);
          return;
        }

        await unregisterPush(userId);
        await saveNotificationPreferences({ runReady: false });
        setRunReady(false);
      } finally {
        setBusy(false);
      }
    },
    [busy, ready, userId],
  );

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        {/* The shared header. This screen and connections/strava hand-rolled
            byte-identical copies of it — back button, CENTERED title, 44x44
            spacer to balance the centering — which were also the app's only two
            centered sheet titles. `style` carries the divider SheetHeader does
            not draw by default. */}
        <SheetHeader
          navigation="back"
          navigationLabel="Back to You"
          title="Notifications"
          onClose={() => closeScreen(router)}
          style={styles.headerDivider}
        />

        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.intro}>
            Choose which training moments Due can alert you about.
          </Text>

          <Text style={styles.sectionTitle}>Training</Text>
          <View style={styles.card}>
            <View style={styles.preferenceRow}>
              <View style={styles.preferenceBody}>
                <Text style={styles.rowTitle}>Run ready</Text>
                <Text style={styles.rowDetail}>
                  When a synced run is ready to review
                </Text>
              </View>
              <Switch
                accessibilityLabel="Run ready notifications"
                value={runReady}
                onValueChange={onToggleRunReady}
                disabled={loading || busy || !ready}
                trackColor={{ true: C.yellow, false: C.line }}
              />
            </View>
          </View>
          {note ? <Text style={styles.note}>{note}</Text> : null}

          <Text style={styles.sectionTitle}>Delivery</Text>
          <View style={styles.card}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open iOS notification settings. ${systemAllowed ? 'Allowed' : 'Off'}`}
              onPress={() => Linking.openSettings()}
              style={({ pressed }) => [styles.systemRow, pressed && styles.pressed]}
            >
              <Text style={styles.rowTitle}>System access</Text>
              <View style={styles.rowValueGroup}>
                <Text style={styles.rowValue}>{systemAllowed ? 'Allowed' : 'Off'}</Text>
                <SymbolView
                  name="arrow.up.forward.app"
                  size={13}
                  tintColor={C.faint}
                  weight="semibold"
                  resizeMode="scaleAspectFit"
                />
              </View>
            </Pressable>
          </View>
          <Text style={styles.footnote}>
            iOS controls whether Due may deliver any notification to this device.
          </Text>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const makeStyles = (C: Tokens) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: C.bg },
    safe: { flex: 1 },
    headerDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line },
    scroll: {
      paddingHorizontal: space.lg,
      paddingTop: space.xl,
      paddingBottom: space.xxl,
    },
    intro: {
      ...typeRole.body,
      color: C.mute,
      marginBottom: space.sm,
    },
    sectionTitle: {
      ...typeRole.sectionTitle,
      color: C.ink,
      fontWeight: '700',
      marginBottom: space.md,
      marginTop: space.xl,
    },
    card: {
      backgroundColor: C.card,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: C.line,
      overflow: 'hidden',
    },
    preferenceRow: {
      minHeight: 76,
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.md,
      paddingHorizontal: space.lg,
      paddingVertical: space.md,
    },
    preferenceBody: { flex: 1, minWidth: 0 },
    rowTitle: { fontSize: fontSizes.sectionTitle, lineHeight: 21, fontWeight: '700', color: C.ink },
    rowDetail: {
      ...typeRole.metadata,
      color: C.mute,
      marginTop: space.xxs,
    },
    note: {
      ...typeRole.metadata,
      color: C.warningText,
      marginTop: space.sm,
      paddingHorizontal: space.xs,
    },
    systemRow: {
      minHeight: 58,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: space.md,
      paddingHorizontal: space.lg,
      paddingVertical: space.sm,
    },
    rowValueGroup: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
    },
    rowValue: { fontSize: fontSizes.labelLg, lineHeight: 19, fontWeight: '600', color: C.mute },
    pressed: { opacity: 0.65 },
    footnote: {
      ...typeRole.metadata,
      color: C.mute,
      marginTop: space.sm,
      paddingHorizontal: space.xs,
    },
  });
