import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { SymbolView } from 'expo-symbols';

import { useSession } from '@/app-lib/auth';
import {
  clearInterruptedMode,
  getInterruptedMode,
  invalidateActivityCaches,
  persistInterruptedMode,
  retireSeedActivities,
  runBackfill,
  type BackfillMode,
  type BackfillProgress,
} from '@/app-lib/backfill';
import {
  getBackfillStatus,
  setBackfillStatus,
  useBackfillStatus,
} from '@/app-lib/backfillStatus';
import { closeScreen } from '@/app-lib/nav';
import { promptPushAfterConnect } from '@/app-lib/pushNotifications';
import {
  connectStrava,
  disconnectStrava,
  useStravaStatus,
} from '@/app-lib/strava';
import {
  getStravaProgressOptIn,
  setStravaProgressOptIn,
} from '@/app-lib/stravaProgress';
import { ConnectWithStravaButton } from '@/components/ConnectWithStravaButton';
import { SheetHeader } from '@/components/SheetHeader';
import { PoweredByStrava } from '@/components/StravaAttribution';
import { hairlineBottom, hairlineTop } from '@/components/ui/Divider';
import { useTheme, useThemedStyles } from '@/theme/ThemeProvider';
import { fontSizes, radius, space, typeRole, type Tokens } from '@/theme/tokens';

const STRAVA_ICON = require('../../assets/brand/strava/strava-app-icon-192.png');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function shortDate(iso: string): string {
  const date = new Date(iso);
  return `${MONTHS[date.getMonth()] ?? ''} ${date.getDate()}`;
}

function progressLabel(progress: BackfillProgress): string {
  if (progress.phase === 'summaries') return `Checking runs · ${progress.imported} found`;
  if (progress.phase === 'enrich') {
    const remaining = progress.remaining ?? 0;
    return `Adding activity detail · ${progress.enriched}${remaining > 0 ? ` of ${progress.enriched + remaining}` : ''}`;
  }
  return `Checked ${progress.imported} runs`;
}

function progressFraction(progress: BackfillProgress): number | null {
  if (progress.phase !== 'enrich' || progress.remaining == null) return null;
  const total = progress.enriched + progress.remaining;
  return total > 0 ? progress.enriched / total : null;
}

/**
 * A pushed connection detail screen. The You tab only identifies Strava and
 * summarizes its state; OAuth, imported-data disclosure, outbound plan context,
 * sync repair, and revocation live together here.
 */
export default function StravaConnectionScreen() {
  const styles = useThemedStyles(makeStyles);
  const C = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { userId } = useSession();
  const { status, loading, error, refresh } = useStravaStatus(!!userId);
  const sync = useBackfillStatus();
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    getInterruptedMode(userId).then((mode) => {
      if (cancelled || !mode) return;
      if (getBackfillStatus().kind === 'idle') {
        setBackfillStatus({ kind: 'rate_limited', mode });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const startBackfill = useCallback(
    async (firstConnect: boolean, mode: BackfillMode = 'latest') => {
      if (!userId) return;
      setBackfillStatus({ kind: 'running', label: 'Starting import…', fraction: null });
      try {
        if (firstConnect) {
          setBackfillStatus({ kind: 'running', label: 'Preparing your library…', fraction: null });
          await retireSeedActivities(userId);
        }
        const result = await runBackfill({
          mode,
          onProgress: (progress) =>
            setBackfillStatus({
              kind: 'running',
              label: progressLabel(progress),
              fraction: progressFraction(progress),
            }),
        });
        await invalidateActivityCaches(queryClient);
        if (result.rateLimited) {
          setBackfillStatus({ kind: 'rate_limited', mode });
          await persistInterruptedMode(userId, mode);
          return;
        }
        await clearInterruptedMode(userId);
        setBackfillStatus({
          kind: 'done',
          imported: result.imported,
          enriched: result.enriched,
        });
      } catch {
        setBackfillStatus({ kind: 'idle' });
        Alert.alert('Couldn’t sync Strava', 'Check your connection and try again.');
      }
    },
    [queryClient, userId],
  );

  const onConnect = useCallback(async () => {
    if (connecting) return;
    const wasConnected = status?.connected ?? false;
    setConnecting(true);
    try {
      const result = await connectStrava();
      if (result !== 'connected') return;
      const next = await refresh();
      if (!next?.connected) return;
      await startBackfill(!wasConnected, 'history');
      if (userId) void promptPushAfterConnect(userId);
    } finally {
      setConnecting(false);
    }
  }, [connecting, refresh, startBackfill, status?.connected, userId]);

  const onReconnectForWrite = useCallback(async (): Promise<boolean> => {
    if (connecting) return false;
    setConnecting(true);
    try {
      const result = await connectStrava();
      if (result !== 'connected') return false;
      const next = await refresh();
      return next?.writeAuthorized === true;
    } finally {
      setConnecting(false);
    }
  }, [connecting, refresh]);

  const onSyncNow = useCallback(
    () => startBackfill(false, sync.kind === 'rate_limited' ? sync.mode : 'latest'),
    [startBackfill, sync],
  );

  const onRepairHistory = useCallback(
    () => startBackfill(false, 'history'),
    [startBackfill],
  );

  const onDisconnect = useCallback(() => {
    Alert.alert(
      'Disconnect Strava?',
      'This revokes Due’s access on Strava and removes the Strava runs synced here. You can reconnect anytime.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            setDisconnecting(true);
            try {
              await disconnectStrava();
              await refresh();
              await invalidateActivityCaches(queryClient);
              if (userId) await clearInterruptedMode(userId);
              setBackfillStatus({ kind: 'idle' });
              closeScreen(router);
            } catch {
              Alert.alert('Couldn’t disconnect Strava', 'Please try again.');
            } finally {
              setDisconnecting(false);
            }
          },
        },
      ],
    );
  }, [queryClient, refresh, router, userId]);

  const connected = status?.connected ?? false;
  const statusLine = (() => {
    if (loading && !status) return 'Checking connection…';
    if (error) return 'Couldn’t reach Strava';
    if (!connected) return 'Not connected';
    if (sync.kind === 'running') return sync.label;
    if (sync.kind === 'rate_limited') return 'Import paused by Strava';
    return status?.lastActivityAt
      ? `Connected · Latest run ${shortDate(status.lastActivityAt)}`
      : 'Connected';
  })();

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        {/* The shared header. This screen and app/notifications hand-rolled
            byte-identical copies of it — back button, CENTERED title, 44x44
            spacer to balance the centering — which were also the app's only two
            centered sheet titles. `style` carries the divider SheetHeader does
            not draw by default. */}
        <SheetHeader
          navigation="back"
          navigationLabel="Back to You"
          title="Strava"
          onClose={() => closeScreen(router)}
          style={styles.headerDivider}
        />

        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.identity}>
            <Image
              accessibilityIgnoresInvertColors
              source={STRAVA_ICON}
              style={styles.identityIcon}
            />
            <View style={styles.identityBody}>
              <Text style={styles.identityTitle}>Strava</Text>
              <Text
                style={[
                  styles.identityStatus,
                  sync.kind === 'rate_limited' && styles.warningText,
                ]}
              >
                {statusLine}
              </Text>
            </View>
            {loading && !status ? <ActivityIndicator color={C.mute} /> : null}
          </View>

          {error && !status ? (
            <View style={styles.card}>
              <ActionRow
                icon="arrow.clockwise"
                title="Try again"
                detail="Check the connection status"
                onPress={() => void refresh()}
              />
            </View>
          ) : null}

          {!loading && !connected ? (
            <>
              <Text style={styles.intro}>
                Connect your running history so Due can match completed runs to your plan.
              </Text>
              <View style={styles.connectButton}>
                <ConnectWithStravaButton onPress={onConnect} busy={connecting} />
              </View>
            </>
          ) : null}

          {connected ? (
            <>
              <SectionTitle>Data from Strava</SectionTitle>
              <View style={styles.card}>
                <DataSummaryRow />
              </View>

              <SectionTitle>Shared with Strava</SectionTitle>
              <View style={styles.card}>
                <PlanContextPreference
                  userId={userId}
                  writeAuthorized={status?.writeAuthorized === true}
                  connecting={connecting}
                  onReconnect={onReconnectForWrite}
                />
              </View>

              <SectionTitle>Sync</SectionTitle>
              <View style={styles.card}>
                {sync.kind === 'running' ? (
                  <View style={styles.syncStatus}>
                    <ActivityIndicator color={C.ink} />
                    <View style={styles.syncStatusBody}>
                      <Text style={styles.rowTitle}>{sync.label}</Text>
                      {sync.fraction != null ? (
                        <View style={styles.progressTrack}>
                          <View
                            style={[
                              styles.progressFill,
                              { width: `${Math.round(sync.fraction * 100)}%` },
                            ]}
                          />
                        </View>
                      ) : null}
                    </View>
                  </View>
                ) : null}
                <ActionRow
                  icon="arrow.clockwise"
                  title={sync.kind === 'rate_limited' ? 'Resume import' : 'Sync now'}
                  detail={
                    sync.kind === 'rate_limited'
                      ? 'Continue where the paused import stopped'
                      : 'Check Strava for new runs'
                  }
                  onPress={onSyncNow}
                  divider={sync.kind === 'running'}
                  disabled={sync.kind === 'running'}
                />
                <ActionRow
                  icon="clock.arrow.circlepath"
                  title="Re-import past 12 months"
                  detail="Repair missing or incomplete activity history"
                  onPress={onRepairHistory}
                  divider
                  disabled={sync.kind === 'running'}
                />
              </View>

              <SectionTitle>Connection</SectionTitle>
              <View style={styles.card}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Disconnect Strava"
                  onPress={onDisconnect}
                  disabled={disconnecting}
                  style={({ pressed }) => [
                    styles.disconnectRow,
                    pressed && styles.pressed,
                    disconnecting && styles.disabled,
                  ]}
                >
                  <Text style={styles.disconnectText}>
                    {disconnecting ? 'Disconnecting…' : 'Disconnect Strava'}
                  </Text>
                </Pressable>
              </View>

              <PoweredByStrava compact style={styles.attribution} />
            </>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function SectionTitle({ children }: { children: string }) {
  const styles = useThemedStyles(makeStyles);
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

function DataSummaryRow() {
  const styles = useThemedStyles(makeStyles);
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale >= 1.3;
  return (
    <View style={[styles.dataRow, stacked && styles.dataRowStacked]}>
      <Text style={styles.rowTitle}>Run history</Text>
      <Text style={[styles.dataValue, stacked && styles.dataValueStacked]}>
        Past 12 months
      </Text>
    </View>
  );
}

function ActionRow({
  icon,
  title,
  detail,
  onPress,
  divider = false,
  disabled = false,
}: {
  icon: string;
  title: string;
  detail: string;
  onPress: () => void;
  divider?: boolean;
  disabled?: boolean;
}) {
  const styles = useThemedStyles(makeStyles);
  const C = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${detail}`}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.actionRow,
        divider && styles.divider,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <View style={styles.rowIcon}>
        <SymbolView
          name={icon as never}
          size={16}
          tintColor={C.mute}
          resizeMode="scaleAspectFit"
        />
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowDetail}>{detail}</Text>
      </View>
      <SymbolView
        name="chevron.right"
        size={12}
        tintColor={C.faint}
        weight="semibold"
        resizeMode="scaleAspectFit"
      />
    </Pressable>
  );
}

function PlanContextPreference({
  userId,
  writeAuthorized,
  connecting,
  onReconnect,
}: {
  userId: string | null;
  writeAuthorized: boolean;
  connecting: boolean;
  onReconnect: () => Promise<boolean>;
}) {
  const styles = useThemedStyles(makeStyles);
  const C = useTheme();
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale >= 1.3;
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!userId) return;
    getStravaProgressOptIn(userId)
      .then((value) => {
        if (alive) setEnabled(value);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [userId]);

  const onToggle = useCallback(async (next: boolean) => {
    if (!userId || busy) return;
    setBusy(true);
    setEnabled(next);
    try {
      const saved = await setStravaProgressOptIn(userId, next);
      if (!saved) {
        setEnabled(!next);
        Alert.alert('Couldn’t save preference', 'Please try again.');
      }
    } catch {
      setEnabled(!next);
      Alert.alert('Couldn’t save preference', 'Please try again.');
    } finally {
      setBusy(false);
    }
  }, [busy, userId]);

  const reconnect = useCallback(async () => {
    if (!userId || busy || connecting) return;
    setBusy(true);
    try {
      const authorized = await onReconnect();
      if (!authorized) {
        Alert.alert(
          'Strava permission needed',
          'Allow activity updates to add Due context to new runs.',
        );
        return;
      }
      const saved = await setStravaProgressOptIn(userId, true);
      if (!saved) {
        Alert.alert('Couldn’t save preference', 'Please try again.');
        return;
      }
      setEnabled(true);
    } catch {
      Alert.alert('Couldn’t reconnect Strava', 'Please try again.');
    } finally {
      setBusy(false);
    }
  }, [busy, connecting, onReconnect, userId]);

  return (
    <View style={styles.preference}>
      <View style={[styles.preferenceHeader, stacked && styles.preferenceHeaderStacked]}>
        <Text style={styles.preferenceTitle}>Plan context</Text>
        {writeAuthorized ? (
          <Switch
            accessibilityLabel="Plan context on Strava"
            value={enabled}
            onValueChange={onToggle}
            disabled={busy}
            ios_backgroundColor={C.line}
            trackColor={{ true: C.yellow, false: C.line }}
            style={stacked ? styles.preferenceControlStacked : undefined}
          />
        ) : null}
      </View>
      <View style={styles.preferenceDescription}>
        <Text style={styles.preferenceDetail}>
          Add the current week’s allocation and contract progress to descriptions of new Strava runs.
        </Text>
        {!writeAuthorized ? (
          <View style={styles.reconnect}>
            <Text style={styles.reconnectNote}>
              Reconnect once to allow Due to update new activity descriptions.
            </Text>
            <ConnectWithStravaButton
              onPress={reconnect}
              busy={busy || connecting}
            />
          </View>
        ) : null}
      </View>
    </View>
  );
}

const makeStyles = (C: Tokens) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: C.bg },
    safe: { flex: 1 },
    headerDivider: hairlineBottom(C),
    scroll: {
      paddingHorizontal: space.lg,
      paddingTop: space.xl,
      paddingBottom: space.xxl,
    },
    identity: {
      minHeight: 72,
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.lg,
    },
    identityIcon: {
      width: 56,
      height: 56,
      borderRadius: radius.md,
    },
    identityBody: { flex: 1, minWidth: 0 },
    identityTitle: {
      ...typeRole.sectionTitle,
      color: C.ink,
      fontWeight: '800',
    },
    identityStatus: {
      ...typeRole.metadata,
      color: C.mute,
      fontWeight: '600',
      marginTop: space.xxs,
    },
    warningText: { color: C.warningText },
    intro: {
      ...typeRole.body,
      color: C.mute,
      marginTop: space.lg,
      paddingRight: space.xl,
    },
    connectButton: {
      alignItems: 'center',
      marginTop: space.lg,
      marginBottom: space.sm,
    },
    sectionTitle: {
      ...typeRole.sectionTitle,
      color: C.ink,
      fontWeight: '700',
      marginTop: space.xl,
      marginBottom: space.md,
    },
    card: {
      backgroundColor: C.card,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: C.line,
      overflow: 'hidden',
    },
    dataRow: {
      minHeight: 58,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: space.md,
      paddingHorizontal: space.lg,
      paddingVertical: space.sm,
    },
    dataValue: {
      fontSize: fontSizes.labelLg,
      lineHeight: 19,
      fontWeight: '600',
      color: C.mute,
      textAlign: 'right',
      flexShrink: 1,
    },
    dataRowStacked: {
      flexDirection: 'column',
      alignItems: 'flex-start',
      justifyContent: 'flex-start',
      gap: space.xs,
      paddingVertical: space.md,
    },
    dataValueStacked: {
      textAlign: 'left',
    },
    actionRow: {
      minHeight: 68,
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.md,
      paddingHorizontal: space.lg,
      paddingVertical: space.md,
    },
    divider: hairlineTop(C),
    rowIcon: {
      width: 32,
      height: 32,
      borderRadius: radius.sm,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: C.fill,
    },
    rowBody: { flex: 1, minWidth: 0 },
    rowTitle: {
      fontSize: fontSizes.body,
      lineHeight: 20,
      fontWeight: '700',
      color: C.ink,
    },
    rowDetail: {
      ...typeRole.metadata,
      color: C.mute,
      marginTop: space.xxs,
      flexShrink: 1,
    },
    syncStatus: {
      minHeight: 68,
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.md,
      paddingHorizontal: space.lg,
      paddingVertical: space.md,
    },
    syncStatusBody: { flex: 1, minWidth: 0 },
    progressTrack: {
      height: 3,
      borderRadius: radius.pill,
      backgroundColor: C.fill,
      overflow: 'hidden',
      marginTop: space.sm,
    },
    progressFill: {
      height: '100%',
      borderRadius: radius.pill,
      backgroundColor: C.easy,
    },
    preference: {},
    preferenceHeader: {
      minHeight: 58,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: space.lg,
      paddingHorizontal: space.lg,
      paddingVertical: space.sm,
    },
    preferenceHeaderStacked: {
      flexDirection: 'column',
      alignItems: 'stretch',
      gap: space.sm,
      paddingVertical: space.md,
    },
    preferenceTitle: {
      fontSize: fontSizes.body,
      lineHeight: 20,
      fontWeight: '700',
      color: C.ink,
      flexShrink: 1,
    },
    preferenceControlStacked: { alignSelf: 'flex-start' },
    preferenceDescription: {
      ...hairlineTop(C),
      paddingHorizontal: space.lg,
      paddingVertical: space.md,
    },
    preferenceDetail: {
      ...typeRole.metadata,
      color: C.mute,
      alignSelf: 'stretch',
    },
    reconnect: {
      alignItems: 'flex-start',
      marginTop: space.md,
    },
    reconnectNote: {
      ...typeRole.metadata,
      color: C.mute,
      marginBottom: space.sm,
    },
    disconnectRow: {
      minHeight: 58,
      justifyContent: 'center',
      paddingHorizontal: space.lg,
      paddingVertical: space.sm,
    },
    disconnectText: {
      fontSize: fontSizes.body,
      lineHeight: 20,
      fontWeight: '700',
      color: C.dangerText,
    },
    attribution: {
      marginTop: space.xl,
      paddingHorizontal: space.xs,
    },
    pressed: { backgroundColor: C.fill },
    disabled: { opacity: 0.45 },
  });
