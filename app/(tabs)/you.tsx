import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { SymbolView, type SFSymbol } from 'expo-symbols';

import {
  deleteAccount,
  signOut,
  useSession,
  type UserProfile,
} from '@/app-lib/auth';
import { showChoiceSheet } from '@/app-lib/choiceSheet';
import {
  useShoes,
  useMyPlans,
  type Shoe,
} from '@/app-lib/queries';
import { useRoutes } from '@/app-lib/routes';
import { metersToUnits } from '@/lib';
import { useStravaStatus, type StravaStatus } from '@/app-lib/strava';
import { useBackfillStatus, type BackfillStatus } from '@/app-lib/backfillStatus';
import { Screen } from '@/components/Screen';
import { SubscriptionCard } from '@/components/SubscriptionCard';
import { UserAvatar } from '@/components/UserAvatar';
import { SkeletonBlock, SkeletonGroup } from '@/components/loading/Skeleton';
import { hairlineTop } from '@/components/ui/Divider';
import { ListRow } from '@/components/ui/ListRow';
import { statValueText } from '@/components/ui/Stat';
import { TAB_BAR_INSET } from '@/components/GlassTabBar';
import { pushPermissionGranted } from '@/app-lib/pushNotifications';
import { loadNotificationPreferences } from '@/app-lib/notificationPreferences';
import {
  useAppPreferences,
  type AppPreferences,
} from '@/app-lib/preferences';
import { useTheme, useThemePreference, useThemedStyles, type ThemePreference } from '@/theme/ThemeProvider';
import { fontSizes, radius, space, typeRole, type Tokens } from '@/theme/tokens';
import { PoweredByStrava } from '@/components/StravaAttribution';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Jun 3" short date for the last-sync label. */
function shortDate(iso: string): string {
  const d = new Date(iso);
  const mon = MONTHS[d.getMonth()] ?? '';
  return `${mon} ${d.getDate()}`;
}

const STRAVA_ICON = require('../../assets/brand/strava/strava-app-icon-192.png');

/**
 * THESIS: You is the runner's private training library and setup, not a vanity
 * profile or a substitute Progress dashboard.
 * OWN-WORLD: one continuous dark canvas, compact matte ledgers, neutral system
 * glyphs, and Due's display/ledger/interface type registers.
 * STORY: identify the runner, find durable training objects, then manage gear,
 * connections, defaults, membership, and account.
 * FIRST VIEWPORT: page title, identity, and the complete Library instrument.
 * FORM: a persistent tab with progressively quieter grouped settings below.
 */
export default function SettingsScreen() {
  const styles = useThemedStyles(makeStyles);
  const C = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { userId, profile, ready } = useSession();
  const { status, loading, error, refresh } = useStravaStatus(!!userId);
  const shoes = useShoes(userId ?? null);
  const savedRoutes = useRoutes(ready ? userId : null);
  const myPlans = useMyPlans(ready ? userId : null);
  const sync = useBackfillStatus();
  const hasFocused = useRef(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // The connection screen owns OAuth and sync mutations. Refresh this summary
  // when it returns to focus without doubling the hook's initial status probe.
  useFocusEffect(useCallback(() => {
    if (!hasFocused.current) {
      hasFocused.current = true;
      return;
    }
    if (userId) void refresh();
  }, [refresh, userId]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        refresh(),
        myPlans.refetch(),
        savedRoutes.refetch(),
        queryClient.invalidateQueries({ queryKey: ['shoes'] }),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [myPlans, savedRoutes, refresh, queryClient]);

  const onSignOut = useCallback(async () => {
    setAuthBusy(true);
    try {
      await signOut();
      // Drop the previous account's cached data so it can't bleed into a later
      // session. Sign-out returns to the login gate (no new anonymous user).
      queryClient.clear();
    } catch {
      Alert.alert('Couldn’t sign out', 'Please try again.');
    } finally {
      setAuthBusy(false);
    }
  }, [queryClient]);

  const onDeleteAccount = useCallback(() => {
    Alert.alert(
      'Delete account?',
      'This permanently deletes your account and everything in it: plans, runs, shoes, photos, and your Strava connection. This can’t be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeletingAccount(true);
            try {
              await deleteAccount();
              await signOut();
              queryClient.clear();
            } catch {
              Alert.alert('Couldn’t delete account', 'Please try again.');
            } finally {
              setDeletingAccount(false);
            }
          },
        },
      ],
    );
  }, [queryClient]);

  const plans = myPlans.data ?? [];
  const savedPlanCount = plans.filter((plan) => plan.status !== 'active').length;
  const planLibraryMeta = myPlans.error
    ? 'Unavailable'
    : savedPlanCount === 0
      ? 'Starters and import'
      : `${savedPlanCount} saved ${savedPlanCount === 1 ? 'plan' : 'plans'} · starters and import`;
  const routeCount = savedRoutes.data?.length ?? 0;
  const routeLibraryMeta = savedRoutes.error
    ? 'Unavailable'
    : routeCount === 0
      ? 'Build for an upcoming run'
      : `${routeCount} saved ${routeCount === 1 ? 'route' : 'routes'}`;

  return (
    <Screen title="You" headerRight={null} headerDivider>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.ink} />
        }
      >
        <IdentityCard userId={userId} profile={profile} ready={ready} />

        <SectionHeading title="Library" />
        <View style={styles.card}>
          <HubRow
            icon="folder.fill"
            title="Plan library"
            meta={planLibraryMeta}
            loading={myPlans.isLoading}
            onPress={() => router.push('/plans')}
            first
          />
          <HubRow
            icon="map"
            title="Saved routes"
            meta={routeLibraryMeta}
            loading={savedRoutes.isLoading}
            onPress={() => router.push('/routes')}
          />
        </View>

        <SectionHeading title="Gear" />
        <View style={styles.card}>
          <ShoeList
            shoes={shoes.data ?? []}
            loading={shoes.isLoading}
            onSelect={(shoe) => router.push({ pathname: '/shoes/[id]', params: { id: shoe.id } })}
            onAdd={() => router.push('/shoes/new')}
          />
        </View>

        <SectionHeading title="Connections" />
        <View style={styles.card}>
          <StravaConnectionRow
            status={status}
            loading={loading}
            error={error}
            sync={sync}
            onPress={() => router.push('/connections/strava')}
          />
        </View>

        <SectionHeading title="Preferences" />
        <View style={styles.card}>
          <PreferenceRows />
          <NotificationsRow divider />
          <AppearanceRow />
        </View>

        <SectionHeading title="Membership" />
        <View style={styles.card}>
          <SubscriptionCard />
        </View>

        <SectionHeading title="Account" />
        <View style={styles.card}>
          <AccountRows
            profile={profile}
            busy={authBusy}
            onSignOut={onSignOut}
            deleting={deletingAccount}
            onDeleteAccount={onDeleteAccount}
          />
        </View>
        <PoweredByStrava />
      </ScrollView>
    </Screen>
  );
}

function SectionHeading({ title }: { title: string }) {
  const styles = useThemedStyles(makeStyles);
  return <Text style={styles.sectionHeading}>{title}</Text>;
}

function HubRow({
  icon,
  title,
  meta,
  loading = false,
  onPress,
  first = false,
}: {
  icon: SFSymbol;
  title: string;
  meta: string;
  loading?: boolean;
  onPress: () => void;
  first?: boolean;
}) {
  const styles = useThemedStyles(makeStyles);
  const C = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={loading ? `${title}. Loading.` : `${title}. ${meta}`}
      accessibilityState={{ busy: loading }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.planRow,
        first && styles.planRowFirst,
        pressed && styles.planRowPressed,
      ]}
    >
      <View style={styles.hubIcon}>
        <SymbolView name={icon} size={18} tintColor={C.mute} weight="semibold" resizeMode="scaleAspectFit" />
      </View>
      <View style={styles.planBody}>
        <Text style={styles.planName}>{title}</Text>
        {loading ? (
          <SkeletonGroup
            accessibilityLabel={`Loading ${title.toLowerCase()}`}
            style={styles.rowMetaSkeleton}
            testID={`you-${title === 'Plan library' ? 'plans' : 'routes'}-loading`}
          >
            <SkeletonBlock height={10} width="72%" />
          </SkeletonGroup>
        ) : (
          <Text style={styles.planMeta} numberOfLines={2}>{meta}</Text>
        )}
      </View>
      <SymbolView name="chevron.right" size={12} tintColor={C.faint} weight="semibold" resizeMode="scaleAspectFit" />
    </Pressable>
  );
}

function IdentityCard({
  userId,
  profile,
  ready,
}: {
  userId: string | null;
  profile: UserProfile | null;
  ready: boolean;
}) {
  const styles = useThemedStyles(makeStyles);
  const suffix = userId ? userId.slice(0, 8) : null;
  const title = profile?.displayName ?? (profile?.email ? profile.email.split('@')[0] : 'Runner');
  const meta = (() => {
    if (!ready) return 'Loading profile…';
    if (profile?.email) return profile.email;
    if (suffix) return `Anonymous session  ${suffix}`;
    return 'Anonymous session';
  })();
  return (
    <View style={styles.identity}>
      <UserAvatar profile={profile} size={54} />
      <View style={styles.identityBody}>
        <Text style={styles.identityTitle} numberOfLines={1}>{title}</Text>
        <Text style={styles.identityMeta} numberOfLines={1}>{meta}</Text>
      </View>
    </View>
  );
}

function AccountRows({
  profile,
  busy,
  onSignOut,
  deleting,
  onDeleteAccount,
}: {
  profile: UserProfile | null;
  busy: boolean;
  onSignOut: () => void;
  deleting: boolean;
  onDeleteAccount: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  // Strava is the identity provider — a signed-in user has a non-anonymous
  // session (their synthetic Strava-keyed email). The Strava connection itself
  // lives in the Connections section above.
  const signedIn = !!profile?.email && !profile.isAnonymous;
  return (
    <View>
      <View style={styles.accountRow}>
        <View style={styles.accountBody}>
          <Text style={styles.staticLabel}>Data privacy</Text>
          <Text style={styles.rowStatus} numberOfLines={1}>
            Private to your signed-in account
          </Text>
        </View>
        {signedIn ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Sign out"
            disabled={busy}
            onPress={onSignOut}
            style={({ pressed }) => [styles.tertiaryBtn, (pressed || busy) && styles.tertiaryPressed]}
          >
            <Text style={styles.tertiaryText}>Sign out</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={[styles.accountRow, styles.rowDivider]}>
        <View style={styles.accountBody}>
          <Text style={styles.staticLabel}>Delete account</Text>
          {/* No numberOfLines cap — this is the one destructive-action warning in
              the app; let it wrap to a second line rather than clip mid-sentence
              (UX#8 / re-score N2). accountBody already has flexShrink via
              minWidth: 0, so neighboring rows keep their alignment. */}
          <Text style={styles.rowStatus}>
            Permanently erases your account and all its data
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Delete account"
          disabled={deleting}
          onPress={onDeleteAccount}
          style={({ pressed }) => [styles.tertiaryBtn, (pressed || deleting) && styles.tertiaryPressed]}
        >
          <Text style={styles.tertiaryDanger}>{deleting ? 'Deleting…' : 'Delete'}</Text>
        </Pressable>
      </View>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel="Privacy policy"
        onPress={() => { Linking.openURL('https://due.run/privacy').catch(() => {}); }}
        style={({ pressed }) => [styles.accountRow, styles.rowDivider, pressed && styles.planRowPressed]}
      >
        <View style={styles.accountBody}>
          <Text style={styles.staticLabel}>Privacy policy</Text>
          <Text style={styles.rowStatus} numberOfLines={1}>due.run/privacy</Text>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel="Support"
        onPress={() => { Linking.openURL('mailto:hello@due.run').catch(() => {}); }}
        style={({ pressed }) => [styles.accountRow, styles.rowDivider, pressed && styles.planRowPressed]}
      >
        <View style={styles.accountBody}>
          <Text style={styles.staticLabel}>Support</Text>
          <Text style={styles.rowStatus} numberOfLines={1}>hello@due.run</Text>
        </View>
      </Pressable>
    </View>
  );
}

/** The category-level controls live on their own pushed screen. This row only
 *  summarizes the effective state so Preferences keeps one compact rhythm. */
function NotificationsRow({ divider = false }: { divider?: boolean }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(false);

  useFocusEffect(useCallback(() => {
    let alive = true;
    Promise.all([loadNotificationPreferences(), pushPermissionGranted()])
      .then(([saved, allowed]) => {
        if (alive) setEnabled((saved?.runReady ?? allowed) && allowed);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []));

  return (
    <ListRow
      title="Notifications"
      value={enabled ? 'On' : 'Off'}
      divided={divider}
      onPress={() => router.push('/notifications')}
    />
  );
}

const APPEARANCE_OPTS: { key: ThemePreference; label: string }[] = [
  { key: 'system', label: 'System' },
  { key: 'light', label: 'Light' },
  { key: 'dark', label: 'Dark' },
];

const DISTANCE_OPTS = [
  { key: 'mi', label: 'Miles' },
  { key: 'km', label: 'Kilometers' },
] as const;

const TEMPERATURE_OPTS = [
  { key: 'fahrenheit', label: 'Fahrenheit' },
  { key: 'celsius', label: 'Celsius' },
] as const;

function PreferenceRows() {
  const { preferences, setPreference } = useAppPreferences();
  return (
    <>
      <ChoiceSettingRow
        label="Distance"
        value={DISTANCE_OPTS.find((option) => option.key === preferences.distance)?.label ?? 'Miles'}
        options={DISTANCE_OPTS}
        onSelect={(value) => setPreference('distance', value)}
      />
      <ChoiceSettingRow
        label="Temperature"
        value={TEMPERATURE_OPTS.find((option) => option.key === preferences.temperature)?.label ?? 'Fahrenheit'}
        options={TEMPERATURE_OPTS}
        onSelect={(value) => setPreference('temperature', value)}
        divider
      />
    </>
  );
}

function ChoiceSettingRow<K extends AppPreferences[keyof AppPreferences]>({
  label,
  value,
  options,
  onSelect,
  divider = false,
}: {
  label: string;
  value: string;
  options: ReadonlyArray<{ key: K; label: string }>;
  onSelect: (value: K) => void;
  divider?: boolean;
}) {
  const choose = useCallback(() => {
    showChoiceSheet({ title: label, options, onPick: onSelect });
  }, [label, onSelect, options]);

  return <ListRow title={label} value={value} divided={divider} onPress={choose} />;
}

/** Appearance is a disclosure row, not an inline control group. The selected
 * value remains glanceable; tapping opens the native compact choice surface. */
function AppearanceRow() {
  const { preference, setPreference } = useThemePreference();
  const label = APPEARANCE_OPTS.find((option) => option.key === preference)?.label ?? 'System';

  const chooseAppearance = useCallback(() => {
    showChoiceSheet({ title: 'Appearance', options: APPEARANCE_OPTS, onPick: setPreference });
  }, [setPreference]);

  return <ListRow title="Appearance" value={label} divided onPress={chooseAppearance} />;
}

/**
 * The Shoes section: one row per shoe (photo thumbnail or shoe glyph, name,
 * mileage, Default tag; retired shoes recede), plus the Add-shoe row. Rows
 * push the shoe editor sheet.
 */
function ShoeList({
  shoes,
  loading,
  onSelect,
  onAdd,
}: {
  shoes: Shoe[];
  loading: boolean;
  onSelect: (shoe: Shoe) => void;
  onAdd: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const C = useTheme();
  const { preferences } = useAppPreferences();
  const units = preferences.distance;
  const unitWord = units === 'mi' ? 'miles' : 'kilometers';
  return (
    <View>
      {loading && shoes.length === 0 ? (
        <SkeletonGroup
          accessibilityLabel="Loading shoes"
          style={styles.shoeLoadingRow}
          testID="you-shoes-loading"
        >
          <SkeletonBlock height={38} width={38} style={styles.shoeThumb} />
          <View style={styles.planBody}>
            <SkeletonBlock height={14} width="44%" />
            <SkeletonBlock height={10} width="62%" style={styles.rowMetaSkeleton} />
          </View>
        </SkeletonGroup>
      ) : shoes.map((s, i) => {
        const photo = s.photoUrl;
        const retired = !!s.retiredAt;
        const distance = metersToUnits(s.totalMeters, units).toFixed(0);
        const meta = `${distance} ${units}${s.activityCount > 0 ? `  ${s.activityCount} runs` : ''}${retired ? '  retired' : ''}`;
        return (
          <Pressable
            key={s.id}
            accessibilityRole="button"
            accessibilityLabel={`Shoe ${s.name}, ${distance} ${unitWord}`}
            onPress={() => onSelect(s)}
            style={({ pressed }) => [
              styles.planRow,
              i === 0 && styles.planRowFirst,
              pressed && styles.planRowPressed,
              retired && styles.shoeRetired,
            ]}
          >
            {photo ? (
              <Image
                accessibilityIgnoresInvertColors
                source={{ uri: photo }}
                style={styles.shoeThumb}
              />
            ) : (
              <View style={[styles.shoeThumb, styles.shoeThumbEmpty]}>
                <SymbolView
                  name="shoe.2.fill"
                  size={17}
                  tintColor={C.faint}
                  resizeMode="scaleAspectFit"
                />
              </View>
            )}
            <View style={styles.planBody}>
              <Text style={styles.planName} numberOfLines={1}>
                {s.name}
              </Text>
              <Text style={styles.planMeta} numberOfLines={1}>
                {meta}
              </Text>
            </View>
            {s.isDefault ? <Text style={styles.activeTag}>Default</Text> : <Text style={styles.planChev}>›</Text>}
          </Pressable>
        );
      })}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add shoe"
        onPress={onAdd}
        style={({ pressed }) => [
          styles.planRow,
          shoes.length === 0 && !loading && styles.planRowFirst,
          pressed && styles.planRowPressed,
        ]}
      >
        <View style={[styles.shoeThumb, styles.shoeThumbEmpty]}>
          <SymbolView name="plus" size={15} tintColor={C.mute} weight="semibold" />
        </View>
        <View style={styles.planBody}>
          <Text style={styles.planName}>Add shoe</Text>
          <Text style={styles.planMeta}>Track mileage per pair</Text>
        </View>
      </Pressable>
    </View>
  );
}

function StravaConnectionRow({
  status,
  loading,
  error,
  sync,
  onPress,
}: {
  status: StravaStatus | null;
  loading: boolean;
  error: Error | null;
  sync: BackfillStatus;
  onPress: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const C = useTheme();
  const connected = status?.connected ?? false;
  const summary = (() => {
    if (loading && !status) return null;
    if (error) return 'Couldn’t reach server';
    if (!connected) return 'Not connected';
    if (sync.kind === 'running') return sync.label;
    if (sync.kind === 'rate_limited') return 'Import paused';
    return status?.lastActivityAt
      ? `Connected · Latest run ${shortDate(status.lastActivityAt)}`
      : 'Connected';
  })();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={summary ? `Strava connection, ${summary}` : 'Strava connection, loading'}
      accessibilityState={{ busy: summary == null }}
      onPress={onPress}
      style={({ pressed }) => [styles.connectionRow, pressed && styles.planRowPressed]}
    >
      <Image
        accessibilityIgnoresInvertColors
        source={STRAVA_ICON}
        style={styles.connectionIcon}
      />
      <View style={styles.planBody}>
        <Text style={styles.planName}>Strava</Text>
        {summary == null ? (
          <SkeletonGroup
            accessibilityLabel="Checking Strava connection"
            style={styles.rowMetaSkeleton}
            testID="you-strava-loading"
          >
            <SkeletonBlock height={10} width="66%" />
          </SkeletonGroup>
        ) : (
          <Text
            style={[
              styles.planMeta,
              sync.kind === 'rate_limited' && styles.connectionWarning,
            ]}
            numberOfLines={2}
          >
            {summary}
          </Text>
        )}
      </View>
      {sync.kind === 'running' ? (
        <ActivityIndicator color={C.mute} />
      ) : (
        <SymbolView
          name="chevron.right"
          size={12}
          tintColor={C.faint}
          weight="semibold"
          resizeMode="scaleAspectFit"
        />
      )}
    </Pressable>
  );
}

const makeStyles = (C: Tokens) => StyleSheet.create({
  scrollView: { flex: 1 },
  scroll: {
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: TAB_BAR_INSET + space.xl,
  },
  card: {
    backgroundColor: C.card,
    borderColor: C.line,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  sectionHeading: {
    ...typeRole.sectionTitle,
    fontWeight: '800',
    color: C.ink,
    paddingHorizontal: space.xxs,
    paddingTop: space.xl,
    paddingBottom: space.m,
  },

  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: space.lg,
    paddingBottom: space.sm,
    paddingHorizontal: space.xxs,
    gap: space.l,
  },
  identityBody: { flex: 1, minWidth: 0 },
  identityTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: C.ink,
    letterSpacing: -0.3,
  },
  identityMeta: {
    ...statValueText(C, 'metadata', 'system'),
    fontWeight: '600',
    color: C.mute,
    marginTop: 3,
  },

  staticLabel: { flex: 1, minWidth: 0, fontSize: fontSizes.body, fontWeight: '700', color: C.ink },
  accountRow: {
    minHeight: 58,
    paddingHorizontal: space.lg,
    paddingVertical: space.l,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  accountBody: { flex: 1, minWidth: 0 },

  // Durable-library and gear rows.
  rowMetaSkeleton: { marginTop: space.xs },
  shoeLoadingRow: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  planRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    minHeight: 68,
    paddingVertical: space.md,
    ...hairlineTop(C),
  },
  planRowFirst: { borderTopWidth: 0 },
  planRowPressed: { backgroundColor: C.fill },
  planBody: { flex: 1, minWidth: 0 },
  planName: { fontSize: fontSizes.sectionTitle, fontWeight: '700', color: C.ink, letterSpacing: -0.2 },
  planMeta: {
    ...statValueText(C, 'metadata', 'system'),
    color: C.mute,
    marginTop: space.xxs,
  },
  // Neutral, not yellow: a status label reading yellow would falsely imply
  // live position or an available primary action.
  activeTag: { fontSize: fontSizes.metadata, fontWeight: '700', color: C.mute, letterSpacing: 0.2 },
  planChev: { color: C.faint, fontSize: fontSizes.sectionTitle },

  // Shoe rows.
  shoeThumb: { width: 38, height: 38, borderRadius: radius.md },
  shoeThumbEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.fill,
  },
  hubIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.fill,
  },
  shoeRetired: { opacity: 0.55 },

  rowDivider: hairlineTop(C),
  connectionRow: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  // Unmodified brand artwork — the Strava icon carries its own corners.
  connectionIcon: {
    width: 40,
    height: 40,
  },
  connectionWarning: { color: C.warningText },
  rowStatus: { fontSize: fontSizes.metadata, fontWeight: '600', color: C.mute, marginTop: space.xxs },
  tertiaryBtn: { marginTop: space.s, alignSelf: 'flex-start' },
  tertiaryPressed: { opacity: 0.6 },
  tertiaryText: {
    fontSize: fontSizes.metadata,
    fontWeight: '700',
    color: C.mute,
    textDecorationLine: 'underline',
  },
  tertiaryDanger: {
    fontSize: fontSizes.metadata,
    fontWeight: '700',
    color: C.dangerText,
    textDecorationLine: 'underline',
  },
});
