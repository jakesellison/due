import { useCallback } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { useQueryClient } from '@tanstack/react-query';

import { closeScreen } from '@/app-lib/nav';
import { useAppPreferences } from '@/app-lib/preferences';
import { useSession } from '@/app-lib/auth';
import { deleteRoute, renameRoute, useRoute } from '@/app-lib/routes';
import { ExpandableRouteMap } from '@/components/run/ExpandableRouteMap';
import { SheetHeader } from '@/components/SheetHeader';
import { hairlineBottom } from '@/components/ui/Divider';
import { eyebrowText } from '@/components/ui/Eyebrow';
import { statValueText } from '@/components/ui/Stat';
import { metersToUnits, relativeDateLabel } from '@/lib';
import { useTheme, useThemedStyles } from '@/theme/ThemeProvider';
import { data, dataRegular, fontSizes, radius, space, type Tokens } from '@/theme/tokens';

/**
 * Focused saved-route viewer. Workout context keeps management actions out of
 * the planning flow; the library context offers rename, copy, and archive.
 */
export default function RouteViewerScreen() {
  const styles = useThemedStyles(makeStyles);
  const C = useTheme();
  const { preferences } = useAppPreferences();
  const units = preferences.distance;
  const { id, workoutId: rawWorkoutId } = useLocalSearchParams<{ id: string; workoutId?: string }>();
  const router = useRouter();
  const { userId, ready } = useSession();
  const queryClient = useQueryClient();
  const routeId = typeof id === 'string' ? id : null;
  const workoutId = typeof rawWorkoutId === 'string' ? rawWorkoutId : null;
  const query = useRoute(ready ? userId : null, routeId);
  const route = query.data ?? null;

  const onRename = useCallback(() => {
    if (!route) return;
    Alert.prompt(
      'Rename route',
      undefined,
      (text) => {
        const next = (text ?? '').trim();
        if (!next || next === route.name) return;
        renameRoute(route.id, next, queryClient).catch((err) =>
          Alert.alert('Couldn’t rename route', err instanceof Error ? err.message : String(err)),
        );
      },
      'plain-text',
      route.name,
    );
  }, [route, queryClient]);

  const onDelete = useCallback(() => {
    if (!route) return;
    Alert.alert('Remove from saved routes?', `“${route.name}” will stay attached to workouts that already use it.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          deleteRoute(route.id, queryClient)
            .then(() => closeScreen(router))
            .catch((err) =>
              Alert.alert('Couldn’t remove route', err instanceof Error ? err.message : String(err)),
            );
        },
      },
    ]);
  }, [route, queryClient, router]);

  const onDuplicate = useCallback(() => {
    if (!route) return;
    router.replace({ pathname: '/routes/new', params: { from: route.id, ...(workoutId ? { workoutId } : {}) } });
  }, [route, router, workoutId]);

  const body = (() => {
    if (query.error) {
      return (
        <View style={styles.centered}>
          <Text style={styles.errorTitle}>Couldn’t load this route</Text>
          <Text style={styles.errorBody}>{query.error.message}</Text>
        </View>
      );
    }
    if (!ready || query.isLoading) {
      return (
        <View style={styles.centered}>
          <ActivityIndicator color={C.ink} />
        </View>
      );
    }
    if (!route) {
      return (
        <View style={styles.centered}>
          <Text style={styles.errorTitle}>Route not found</Text>
        </View>
      );
    }

    const distance = metersToUnits(route.distanceMeters, units);
    const meta = `Updated ${relativeDateLabel(route.updatedAt)}`;

    return (
      <ScrollView style={styles.content} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.headerBlock}>
          <Text style={styles.name} numberOfLines={2}>
            {route.name}
          </Text>
          <Text style={styles.meta}>{meta}</Text>
        </View>

        {route.drawPath.length >= 2 ? (
          <ExpandableRouteMap
            path={route.drawPath}
            height={280}
            cornerRadius={radius.lg}
            lineColor={workoutId ? C.yellow : C.ink}
          />
        ) : (
          <View style={[styles.card, styles.mapFallback]}>
            <Text style={styles.fallbackText}>Map unavailable</Text>
          </View>
        )}

        <View style={[styles.card, styles.distanceCard]}>
          <Text style={styles.distanceLabel}>Distance</Text>
          <Text style={styles.distanceValue}>{distance.toFixed(1)} <Text style={styles.distanceUnit}>{units}</Text></Text>
        </View>

        <View style={styles.actions}>
          {!workoutId ? <ActionRow icon="pencil" label="Rename" onPress={onRename} /> : null}
          <ActionRow icon="square.on.square" label="Adjust a copy" onPress={onDuplicate} />
          {!workoutId ? <ActionRow icon="archivebox" label="Remove from saved routes" destructive onPress={onDelete} /> : null}
        </View>
      </ScrollView>
    );
  })();

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <SheetHeader
          title="Route"
          onClose={() => closeScreen(router)}
          navigation="back"
          navigationLabel={workoutId ? 'Back to workout' : 'Back to routes'}
          style={styles.sheetHeader}
        />
        {body}
      </SafeAreaView>
    </View>
  );
}

function ActionRow({
  icon,
  label,
  onPress,
  destructive,
}: {
  icon: SFSymbol;
  label: string;
  onPress: () => void;
  destructive?: boolean;
}) {
  const styles = useThemedStyles(makeStyles);
  const C = useTheme();
  const color = destructive ? C.dangerText : C.ink;
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={label}
      style={({ pressed }) => [styles.actionRow, pressed && styles.rowPressed]}
    >
      <SymbolView name={icon} size={18} tintColor={color} weight="semibold" />
      <Text style={[styles.actionLabel, { color }]}>{label}</Text>
    </Pressable>
  );
}

const makeStyles = (C: Tokens) => StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  safe: { flex: 1 },
  content: { flex: 1 },
  sheetHeader: { paddingTop: space.lg, ...hairlineBottom(C) },

  scroll: {
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.xl * 2,
    gap: space.lg,
  },

  headerBlock: { paddingHorizontal: space.xxs, gap: space.s },
  name: { fontSize: 20, fontWeight: '800', color: C.ink, letterSpacing: -0.6 },
  meta: { ...statValueText(C, 'body', 'system'), color: C.mute },

  card: {
    backgroundColor: C.card,
    borderColor: C.line,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
  },
  distanceCard: { paddingHorizontal: space.lg, paddingVertical: space.l },
  // Heavier and wider than the canonical eyebrow: it is the only key on the card
  // and sits over a 28pt mono numeral.
  distanceLabel: { ...eyebrowText(C, 'labelSm'), },
  distanceValue: { color: C.ink, fontFamily: data, fontSize: 28, marginTop: space.xs, fontVariant: ['tabular-nums'] },
  distanceUnit: { color: C.mute, fontFamily: dataRegular, fontSize: fontSizes.label },
  mapFallback: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallbackText: { color: C.mute, fontSize: fontSizes.body },

  actions: {},
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.lg,
    paddingHorizontal: space.xs,
    ...hairlineBottom(C),
  },
  rowPressed: { opacity: 0.5 },
  actionLabel: { fontSize: fontSizes.body, fontWeight: '700' },

  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.s },
  errorTitle: { fontSize: 20, fontWeight: '700', color: C.ink },
  errorBody: { fontSize: fontSizes.body, color: C.mute, textAlign: 'center' },

});
