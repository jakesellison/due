import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { SymbolView } from 'expo-symbols';
import { useQueryClient } from '@tanstack/react-query';

import { useSession } from '@/app-lib/auth';
import { closeScreen } from '@/app-lib/nav';
import { useAppPreferences } from '@/app-lib/preferences';
import { useWorkoutDetail } from '@/app-lib/queries';
import {
  attachRouteToWorkout,
  useRoutes,
  useWorkoutRoute,
  type SavedRoute,
} from '@/app-lib/routes';
import { ActionButton, ActionButtonLabel } from '@/components/ActionButton';
import { OverlayNav } from '@/components/OverlayNav';
import { ModalFooter } from '@/components/ModalFooter';
import { RoundIconButton } from '@/components/RoundIconButton';
import { SheetHeader } from '@/components/SheetHeader';
import { RouteMapView } from '@/components/run/RouteMapView';
import { hairlineBottom, hairlineTop } from '@/components/ui/Divider';
import { formatDistance, routeDistanceFit, routePlanningBlock } from '@/lib';
import { useTheme, useThemedStyles } from '@/theme/ThemeProvider';
import { dataRegular, fontSizes, radius, space, type Tokens } from '@/theme/tokens';

/** Workout-aware route selection. Empty libraries continue straight to build. */
export default function SelectRouteScreen() {
  const C = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const queryClient = useQueryClient();
  const { workoutId: rawWorkoutId } = useLocalSearchParams<{ workoutId?: string }>();
  const workoutId = typeof rawWorkoutId === 'string' ? rawWorkoutId : null;
  const { ready, userId } = useSession();
  const { preferences } = useAppPreferences();
  const units = preferences.distance;
  const detail = useWorkoutDetail(ready ? userId : null, workoutId);
  const routes = useRoutes(ready ? userId : null);
  const selection = useWorkoutRoute(ready ? userId : null, workoutId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const redirected = useRef(false);
  const selectionInitialized = useRef(false);

  const workout = detail.workout;
  const targetMeters = workout?.planned_distance_meters ?? 0;
  const blocked = workout
    ? routePlanningBlock(
        { type: workout.type, date: workout.date, plannedDistanceMeters: workout.planned_distance_meters },
        detail.today,
        detail.matchedActivities.length > 0,
      )
    : null;
  const list = useMemo(
    () => [...(routes.data ?? [])].sort(
      (a, b) => Math.abs(a.distanceMeters - targetMeters) - Math.abs(b.distanceMeters - targetMeters),
    ),
    [routes.data, targetMeters],
  );

  useEffect(() => {
    if (selectionInitialized.current || !routes.data || selection.isLoading) return;
    const attachedId = selection.data?.route.id ?? null;
    setSelectedId(attachedId && routes.data.some((route) => route.id === attachedId) ? attachedId : null);
    selectionInitialized.current = true;
  }, [routes.data, selection.data?.route.id, selection.isLoading]);

  const buildRoute = useCallback((replace = false) => {
    if (!workoutId || !targetMeters) return;
    const destination = {
      pathname: '/routes/new' as const,
      params: { workoutId, targetMeters: String(targetMeters) },
    };
    if (replace) router.replace(destination);
    else router.push(destination);
  }, [router, targetMeters, workoutId]);

  useEffect(() => {
    if (redirected.current || !workout || blocked || routes.isLoading || routes.error) return;
    if ((routes.data ?? []).length === 0) {
      redirected.current = true;
      buildRoute(true);
    }
  }, [blocked, buildRoute, routes.data, routes.error, routes.isLoading, workout]);

  const attach = useCallback(async () => {
    if (!userId || !workoutId || !selectedId || saving) return;
    setSaving(true);
    try {
      await attachRouteToWorkout(userId, workoutId, selectedId, queryClient);
      router.dismissTo({ pathname: '/workout/[id]', params: { id: workoutId } });
    } catch (error) {
      Alert.alert('Couldn’t attach route', error instanceof Error ? error.message : String(error));
      setSaving(false);
    }
  }, [queryClient, router, saving, selectedId, userId, workoutId]);

  if (!ready || detail.loading || routes.isLoading || selection.isLoading) {
    return <CenteredState loading label="Loading saved routes" />;
  }

  if (!workoutId || detail.error || !workout || blocked) {
    return (
      <CenteredState
        title="Route planning unavailable"
        body={blocked === 'completed' ? 'This workout already has a completed run.' : 'Open an upcoming distance workout to choose a route.'}
        onClose={() => closeScreen(router)}
      />
    );
  }

  if (routes.error || selection.error) {
    return (
      <CenteredState
        title="Couldn’t load routes"
        body="Check your connection and try again."
        action="Try again"
        onAction={() => {
          void routes.refetch();
          void selection.refetch();
        }}
        onClose={() => closeScreen(router)}
      />
    );
  }

  const context = `${formatDistance(targetMeters, units)} ${(workout.type ?? 'run').toUpperCase()}`;

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <SheetHeader
          title="Choose route"
          context={`FOR ${context}`}
          onClose={() => closeScreen(router)}
          navigation="back"
          navigationLabel="Back to workout"
          style={styles.sheetHeader}
        />

        <ScrollView style={styles.content} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <Text style={styles.intro}>Use a saved route or build one for this workout.</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Build new route"
            onPress={() => buildRoute(false)}
            style={({ pressed }) => [styles.buildRow, pressed && styles.pressed]}
          >
            <SymbolView name="plus" size={18} tintColor={C.ink} weight="semibold" />
            <Text style={styles.buildText}>Build new route</Text>
          </Pressable>

          <Text style={styles.section}>Saved routes</Text>
          <View style={styles.routeList}>
            {list.map((route, index) => (
              <PickerRouteRow
                key={route.id}
                route={route}
                targetMeters={targetMeters}
                selected={selectedId === route.id}
                first={index === 0}
                onPress={() => setSelectedId(route.id)}
              />
            ))}
          </View>
        </ScrollView>

        <ModalFooter>
          <ActionButton
            accessibilityLabel="Use route for workout"
            loadingAccessibilityLabel="Attaching route to workout"
            loadingLabel="Attaching…"
            disabled={!selectedId}
            loading={saving}
            color={C.yellow}
            onPress={attach}
            variant="commit"
          >
            <ActionButtonLabel>Use for workout</ActionButtonLabel>
          </ActionButton>
        </ModalFooter>
      </SafeAreaView>
    </View>
  );
}

function PickerRouteRow({ route, targetMeters, selected, first, onPress }: { route: SavedRoute; targetMeters: number; selected: boolean; first: boolean; onPress: () => void }) {
  const C = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { preferences } = useAppPreferences();
  const units = preferences.distance;
  const fit = routeDistanceFit(route.distanceMeters, targetMeters);
  const fitLabel = fit.fit === 'on-target'
    ? 'on target'
    : `${formatDistance(Math.abs(fit.deltaMeters), units)} ${fit.fit}`;
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${route.name}, ${formatDistance(route.distanceMeters, units)}, ${fitLabel}`}
      onPress={onPress}
      style={({ pressed }) => [styles.routeRow, first && styles.routeRowFirst, selected && styles.routeRowSelected, pressed && styles.pressed]}
    >
      <RouteMapView path={route.drawPath} width={124} height={82} lineColor={C.ink} showMarkers={false} cornerRadius={radius.sm} />
      <View style={styles.routeCopy}>
        <Text style={styles.routeName} numberOfLines={2}>{route.name}</Text>
        <Text style={[styles.routeDistance, fit.fit !== 'on-target' && styles.routeDistanceOff]}>
          {formatDistance(route.distanceMeters, units)} · {fitLabel}
        </Text>
      </View>
      <View style={[styles.check, selected && styles.checkSelected]}>
        {selected ? <SymbolView name="checkmark" size={13} tintColor={C.bg} weight="bold" /> : null}
      </View>
    </Pressable>
  );
}

function CenteredState({ loading, label, title, body, action, onAction, onClose }: {
  loading?: boolean;
  label?: string;
  title?: string;
  body?: string;
  action?: string;
  onAction?: () => void;
  onClose?: () => void;
}) {
  const C = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <SafeAreaView style={styles.centered} accessibilityLabel={label}>
      {/* The shared overlay row, not a hand-placed absolute button: this
          centered loading/error state was the last screen positioning its own
          back affordance (top: space.lg, where every header sits at
          inset + space.sm). */}
      {onClose ? (
        <OverlayNav floating topInset={0} style={styles.centerNav}>
          <RoundIconButton icon="chevron.left" onPress={onClose} accessibilityLabel="Back to workout" />
        </OverlayNav>
      ) : null}
      {loading ? <ActivityIndicator color={C.mute} /> : null}
      {title ? <Text style={styles.stateTitle}>{title}</Text> : null}
      {body ? <Text style={styles.stateBody}>{body}</Text> : null}
      {action && onAction ? (
        <Pressable accessibilityRole="button" onPress={onAction} style={styles.stateAction}>
          <Text style={styles.stateActionText}>{action}</Text>
        </Pressable>
      ) : null}
    </SafeAreaView>
  );
}

const makeStyles = (C: Tokens) => StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  safe: { flex: 1 },
  content: { flex: 1 },
  sheetHeader: { paddingTop: space.lg, ...hairlineBottom(C) },
  scroll: { paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.xl },
  intro: { color: C.mute, fontSize: fontSizes.labelLg, lineHeight: 20, marginBottom: space.lg },
  buildRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, borderWidth: 1, borderColor: C.mute, borderRadius: radius.sm },
  buildText: { color: C.ink, fontSize: fontSizes.label, fontWeight: '800' },
  section: { color: C.ink, fontSize: fontSizes.labelLg, fontWeight: '800', marginTop: space.xl, marginBottom: space.sm },
  routeList: hairlineTop(C),
  routeRow: { minHeight: 106, flexDirection: 'row', alignItems: 'center', gap: space.lg, paddingVertical: space.md, paddingHorizontal: space.s, ...hairlineTop(C) },
  routeRowFirst: { borderTopWidth: 0 },
  routeRowSelected: { borderWidth: 1, borderColor: C.mute, borderRadius: radius.sm, paddingHorizontal: space.md },
  routeCopy: { flex: 1, minWidth: 0 },
  routeName: { color: C.ink, fontSize: fontSizes.sectionTitle, lineHeight: 20, fontWeight: '700' },
  routeDistance: { color: C.mute, fontFamily: dataRegular, fontSize: fontSizes.metadata, marginTop: space.s },
  routeDistanceOff: { color: C.warningText },
  check: { width: 24, height: 24, borderRadius: radius.pill, borderWidth: 1, borderColor: C.mute, alignItems: 'center', justifyContent: 'center' },
  checkSelected: { backgroundColor: C.ink, borderColor: C.ink },
  centered: { flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  centerNav: { top: space.sm },
  stateTitle: { color: C.ink, fontSize: 19, fontWeight: '800', textAlign: 'center' },
  stateBody: { color: C.mute, fontSize: fontSizes.labelLg, lineHeight: 20, textAlign: 'center', maxWidth: 300, marginTop: space.sm },
  stateAction: { minHeight: 44, justifyContent: 'center', paddingHorizontal: space.lg, marginTop: space.lg },
  stateActionText: { color: C.ink, fontSize: fontSizes.labelLg, fontWeight: '800' },
  pressed: { opacity: 0.72 },
});
