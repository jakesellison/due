import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';

import { SheetHeader } from '@/components/SheetHeader';

import { useSession } from '@/app-lib/auth';
import { useAppPreferences } from '@/app-lib/preferences';
import { closeScreen } from '@/app-lib/nav';
import { useRoutes, type SavedRoute } from '@/app-lib/routes';
import { ActionButton, ActionButtonLabel } from '@/components/ActionButton';
import { RouteMapView } from '@/components/run/RouteMapView';
import { hairlineTop } from '@/components/ui/Divider';
import { statValueText } from '@/components/ui/Stat';
import { formatDistance } from '@/lib';
import { useTheme, useThemedStyles } from '@/theme/ThemeProvider';
import { dataRegular, display, fontSizes, radius, space, typeRole, type Tokens } from '@/theme/tokens';

/** Private route management, reached from You rather than the primary tabs. */
export default function SavedRoutesScreen() {
  const C = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { ready, userId } = useSession();
  const routes = useRoutes(ready ? userId : null);
  const [refreshing, setRefreshing] = useState(false);
  const list = routes.data ?? [];

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await routes.refetch();
    } finally {
      setRefreshing(false);
    }
  }, [routes]);

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        {/* A COUNT is right-aligned mono meta, never a kicker above the title
            (DESIGN.md: "Hierarchy comes from scale, weight, and spacing — not a
            kicker above every heading"). Same treatment as the plans library's
            "2 PLANS" and the plan ledger's "23 weeks". */}
        <SheetHeader
          navigation="back"
          navigationLabel="Back"
          title="Saved routes"
          right={ready && !routes.isLoading && !routes.error && list.length > 0 ? (
            <Text style={styles.headerCount}>
              {`${list.length} ${list.length === 1 ? 'ROUTE' : 'ROUTES'}`}
            </Text>
          ) : undefined}
          onClose={() => closeScreen(router)}
          style={styles.header}
        />

        <ScrollView
          contentContainerStyle={[styles.scroll, list.length === 0 && styles.scrollEmpty]}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={C.ink} />}
        >
          {!ready || routes.isLoading ? (
            <View style={styles.state} accessibilityLabel="Loading saved routes">
              <ActivityIndicator color={C.mute} />
            </View>
          ) : routes.error ? (
            <View style={styles.state}>
              <Text style={styles.stateTitle}>Couldn’t load routes</Text>
              <Text style={styles.stateBody}>Check your connection and try again.</Text>
              <Pressable accessibilityRole="button" onPress={() => routes.refetch()} style={styles.retry}>
                <Text style={styles.retryText}>Try again</Text>
              </Pressable>
            </View>
          ) : list.length === 0 ? (
            <View style={styles.state}>
              <View style={styles.emptyIcon}>
                <SymbolView name="point.3.connected.trianglepath.dotted" size={28} tintColor={C.mute} />
              </View>
              <Text style={styles.stateTitle}>No saved routes yet</Text>
              <Text style={styles.stateBody}>Build one before a run to make sure the distance fits.</Text>
            </View>
          ) : (
            <View style={styles.list}>
              {list.map((route, index) => (
                <RouteRow
                  key={route.id}
                  route={route}
                  first={index === 0}
                  onPress={() => router.push({ pathname: '/routes/[id]', params: { id: route.id } })}
                />
              ))}
            </View>
          )}
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, space.lg) }]}>
          <ActionButton
            accessibilityLabel="Build new route"
            color={C.yellow}
            onPress={() => router.push('/routes/new')}
            variant="commit"
            contentStyle={styles.newButton}
          >
            <SymbolView name="plus" size={16} tintColor={C.accentInk} weight="bold" />
            <ActionButtonLabel>Build new route</ActionButtonLabel>
          </ActionButton>
        </View>
      </SafeAreaView>
    </View>
  );
}

function RouteRow({ route, first, onPress }: { route: SavedRoute; first: boolean; onPress: () => void }) {
  const C = useTheme();
  const { preferences } = useAppPreferences();
  const units = preferences.distance;
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${route.name}, ${formatDistance(route.distanceMeters, units)}`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, first && styles.rowFirst, pressed && styles.rowPressed]}
    >
      <RouteMapView
        path={route.drawPath}
        width={112}
        height={76}
        lineColor={C.ink}
        showMarkers={false}
        cornerRadius={radius.sm}
      />
      <View style={styles.rowCopy}>
        <Text style={styles.routeName} numberOfLines={2}>{route.name}</Text>
        <Text style={styles.routeDistance}>{formatDistance(route.distanceMeters, units)}</Text>
      </View>
      <SymbolView name="chevron.right" size={15} tintColor={C.faint} weight="semibold" />
    </Pressable>
  );
}

const makeStyles = (C: Tokens) => StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  safe: { flex: 1 },
  header: { paddingBottom: space.lg },
  headerCount: { ...statValueText(C, 'micro'), color: C.mute, lineHeight: 15 },
  scroll: { paddingHorizontal: space.lg, paddingBottom: 124 },
  scrollEmpty: { flexGrow: 1 },
  list: hairlineTop(C),
  row: { minHeight: 100, flexDirection: 'row', alignItems: 'center', gap: space.lg, paddingVertical: space.md, ...hairlineTop(C) },
  rowFirst: { borderTopWidth: 0 },
  rowPressed: { backgroundColor: C.fill },
  rowCopy: { flex: 1, minWidth: 0 },
  routeName: { color: C.ink, fontSize: fontSizes.sectionTitle, lineHeight: 20, fontWeight: '700', letterSpacing: -0.2 },
  routeDistance: { color: C.mute, fontFamily: dataRegular, fontSize: fontSizes.metadata, marginTop: space.s },
  state: { flex: 1, minHeight: 300, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xl, paddingBottom: 72 },
  emptyIcon: { marginBottom: space.lg },
  stateTitle: { color: C.ink, fontSize: fontSizes.sectionTitle, fontWeight: '800', textAlign: 'center' },
  stateBody: { color: C.mute, fontSize: fontSizes.labelLg, lineHeight: 20, textAlign: 'center', marginTop: space.sm, maxWidth: 280 },
  retry: { minHeight: 44, justifyContent: 'center', paddingHorizontal: space.lg, marginTop: space.lg },
  retryText: { color: C.ink, fontSize: fontSizes.labelLg, fontWeight: '800' },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: space.lg, paddingTop: space.md, backgroundColor: C.bg, ...hairlineTop(C) },
  newButton: { flexDirection: 'row', gap: space.sm },
});
