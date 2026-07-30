import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import * as Location from 'expo-location';
import { useQueryClient } from '@tanstack/react-query';

import { appleMaps, appleMapsAvailable, MAPBOX_STYLE } from '@/app-lib/maps';
import { rnMapbox, rnMapboxAvailable } from '@/app-lib/rnmapbox';
import { closeScreen } from '@/app-lib/nav';
import { useSession } from '@/app-lib/auth';
import { useAppPreferences } from '@/app-lib/preferences';
import { createRoute, useRoute } from '@/app-lib/routes';
import { useWorkoutDetail } from '@/app-lib/queries';
import { CloseButton } from '@/components/CloseButton';
import { ActionButton, ActionButtonLabel } from '@/components/ActionButton';
import { ModalFooter } from '@/components/ModalFooter';
import { RoundIconButton } from '@/components/RoundIconButton';
import { OverlayNav } from '@/components/OverlayNav';
import { SheetHeader } from '@/components/SheetHeader';
import { Divider, hairlineBottom, hairlineTop } from '@/components/ui/Divider';
import { statValueText } from '@/components/ui/Stat';
import {
  builderDistanceMeters,
  builderReducer,
  canCloseLoop,
  DEFAULT_ROUTE_BUILDER_CAMERA,
  defaultRouteName,
  formatDistance,
  initialBuilderState,
  renderedPath,
  routePointsForSave,
  routeDistanceFit,
  routePlanningBlock,
  routeSnapAvailable,
  snapSegment,
  type BuilderState,
  type LatLng,
  type RouteSegment,
} from '@/lib';
import { useScheme, useTheme, useThemedStyles } from '@/theme/ThemeProvider';
import { data, fontSizes, radius, SCRIM, sheetPresentation, space, type Tokens } from '@/theme/tokens';

const MIN_ROUTE_ZOOM = 3;
const MAX_ROUTE_ZOOM = 20;

function clampRouteZoom(zoom: number): number {
  return Math.min(MAX_ROUTE_ZOOM, Math.max(MIN_ROUTE_ZOOM, zoom));
}

/**
 * A map-first route builder. The map creates waypoints while a matte bottom
 * sheet keeps the workout target, distance fit, finish shape, and save action
 * visible throughout the task.
 *
 * Snapping (default ON): each new straight segment is asynchronously snapped to
 * the walking network via OSRM; the result replaces the straight line in place.
 * A failed snap is visible and blocks save until the user retries or explicitly
 * disables snapping to accept straight segments.
 */
export default function RouteBuilderScreen() {
  const styles = useThemedStyles(makeStyles);
  const C = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { userId, ready } = useSession();
  const { preferences } = useAppPreferences();
  const units = preferences.distance;
  const queryClient = useQueryClient();
  const { from, targetMeters, workoutId: rawWorkoutId } = useLocalSearchParams<{ from?: string; targetMeters?: string; workoutId?: string }>();
  const workoutId = typeof rawWorkoutId === 'string' ? rawWorkoutId : null;
  const workoutDetail = useWorkoutDetail(ready ? userId : null, workoutId);
  const workout = workoutDetail.workout;
  // Workout data is authoritative; the URL value only gives the sheet a useful
  // hint while the active plan query is loading.
  const targetHint = targetMeters && Number.isFinite(Number(targetMeters)) ? Number(targetMeters) : null;
  const target = workout?.planned_distance_meters && workout.planned_distance_meters > 0
    ? workout.planned_distance_meters
    : targetHint;
  const planningBlocked = workout
    ? routePlanningBlock(
        { type: workout.type, date: workout.date, plannedDistanceMeters: workout.planned_distance_meters },
        workoutDetail.today,
        workoutDetail.matchedActivities.length > 0,
      )
    : null;

  const [state, dispatch] = useReducer(builderReducer, undefined, () => initialBuilderState(routeSnapAvailable));

  // "Adjust a copy": load the source route's waypoints into a fresh builder.
  const source = useRoute(ready ? userId : null, typeof from === 'string' ? from : null);
  const loadedFrom = useRef<string | null>(null);
  useEffect(() => {
    const src = source.data;
    if (!src || loadedFrom.current === src.id) return;
    if (src.points.length === 0) return;
    loadedFrom.current = src.id;
    const drawPathCloses =
      src.drawPath.length >= 3 && sameLatLng(src.drawPath[0]!, src.drawPath[src.drawPath.length - 1]!);
    const pointsClose =
      src.points.length >= 3 && sameLatLng(src.points[0]!, src.points[src.points.length - 1]!);
    // Older loop rows stored the closing leg only in `path`; carry that signal
    // into the editable waypoints so Adjust a copy cannot silently open it.
    const points = drawPathCloses && !pointsClose
      ? [...src.points, src.points[0]!]
      : src.points;
    dispatch({ type: 'load', points, snap: routeSnapAvailable });
  }, [source.data]);

  const [camera, setCamera] = useState<{ center: LatLng; zoom: number }>({
    ...DEFAULT_ROUTE_BUILDER_CAMERA,
  });
  const mapCenter = useRef<LatLng>(DEFAULT_ROUTE_BUILDER_CAMERA.center);
  const mapZoom = useRef(DEFAULT_ROUTE_BUILDER_CAMERA.zoom);
  const [visibleMapZoom, setVisibleMapZoom] = useState(DEFAULT_ROUTE_BUILDER_CAMERA.zoom);
  const [currentLocation, setCurrentLocation] = useState<LatLng | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [locating, setLocating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [name, setName] = useState('');
  const [mapBearing, setMapBearing] = useState(0);
  const [failedSnapKeys, setFailedSnapKeys] = useState<Set<string>>(() => new Set());
  const [finishMode, setFinishMode] = useState<'loop' | 'out-back' | null>(null);

  const updateObservedZoom = useCallback((zoom: number) => {
    if (!Number.isFinite(zoom)) return;
    const next = clampRouteZoom(zoom);
    mapZoom.current = next;
    setVisibleMapZoom((previous) => Math.abs(previous - next) < 0.05 ? previous : next);
  }, []);

  const zoomMap = useCallback((delta: -1 | 1) => {
    const next = clampRouteZoom(mapZoom.current + delta);
    if (next === mapZoom.current) return;
    mapZoom.current = next;
    setVisibleMapZoom(next);
    setCamera({ center: mapCenter.current, zoom: next });
  }, []);

  // When duplicating, fit the camera to the loaded route instead of geolocating.
  useEffect(() => {
    const src = source.data;
    if (!src || src.points.length === 0) return;
    const lats = src.points.map((p) => p[0]);
    const lngs = src.points.map((p) => p[1]);
    setCamera({
      center: [(Math.min(...lats) + Math.max(...lats)) / 2, (Math.min(...lngs) + Math.max(...lngs)) / 2],
      zoom: 14,
    });
    mapCenter.current = [(Math.min(...lats) + Math.max(...lats)) / 2, (Math.min(...lngs) + Math.max(...lngs)) / 2];
    updateObservedZoom(14);
    setCameraReady(true);
  }, [source.data, updateObservedZoom]);

  // Reuse location only when permission already exists. First-time permission
  // is requested exclusively by the explicit "Use current location" action.
  useEffect(() => {
    if (typeof from === 'string') return;
    let cancelled = false;
    (async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status === 'granted') {
          const pos = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          if (!cancelled) {
            const current: LatLng = [pos.coords.latitude, pos.coords.longitude];
            setCurrentLocation(current);
            setCamera({ center: current, zoom: 15 });
            mapCenter.current = current;
            updateObservedZoom(15);
            setCameraReady(true);
            return;
          }
        }
      } catch {
        // Keep the NYC fallback; explicit location and manual pan remain.
      }
      if (!cancelled) setCameraReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [from, updateObservedZoom]);

  const distanceMeters = builderDistanceMeters(state);
  const distanceLabel = formatDistance(distanceMeters, units);
  const targetLabel = target && target > 0 ? formatDistance(target, units) : null;
  const fit = target != null && target > 0 ? routeDistanceFit(distanceMeters, target) : null;
  const onTarget = fit?.fit === 'on-target';
  const fitLabel = fit
    ? fit.fit === 'on-target'
      ? 'On target'
      : `${formatDistance(Math.abs(fit.deltaMeters), units)} ${fit.fit}`
    : null;
  const distanceProgress = target && target > 0 ? Math.min(1, distanceMeters / target) : 0;
  const fullPath = useMemo(() => renderedPath(state), [state]);
  const mapPath = useMemo(() => visibleBuilderPath(state, failedSnapKeys), [state, failedSnapKeys]);
  const snapping = useMemo(
    () => state.snap && state.segments.some((seg, index) => !seg.snapped && !failedSnapKeys.has(segmentKey(index, seg))),
    [failedSnapKeys, state.segments, state.snap],
  );

  // Snap pass: whenever a segment is still straight and snapping is on, fire an
  // OSRM request for it; on success, dispatch snapResolved (the reducer guards
  // against stale results by endpoint match). We track in-flight requests by a
  // per-segment endpoint key so we don't re-fire the same gap.
  const inFlight = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!state.snap) return;
    state.segments.forEach((seg, index) => {
      if (seg.snapped) return;
      const from = seg.path[0]!;
      const to = seg.path[seg.path.length - 1]!;
      const key = segmentKey(index, seg);
      if (failedSnapKeys.has(key)) return;
      if (inFlight.current.has(key)) return;
      inFlight.current.add(key);
      (async () => {
        const result = await snapSegment(from, to);
        inFlight.current.delete(key);
        if (result && result.path.length >= 2) {
          dispatch({
            type: 'snapResolved',
            index,
            path: result.path,
            meters: result.distanceMeters,
            endpoints: [from, to],
          });
        } else {
          setFailedSnapKeys((prev) => {
            const next = new Set(prev);
            next.add(key);
            return next;
          });
        }
      })();
    });
  }, [failedSnapKeys, state.segments, state.snap]);

  const onMapClick = useCallback((event: { coordinates?: { latitude?: number; longitude?: number } }) => {
    const lat = event?.coordinates?.latitude;
    const lng = event?.coordinates?.longitude;
    if (typeof lat !== 'number' || typeof lng !== 'number') return;
    dispatch({ type: 'add', point: [lat, lng] });
  }, []);

  const onCameraMove = useCallback((event: { bearing?: number; zoom?: number; coordinates?: { latitude?: number; longitude?: number } }) => {
    const latitude = event.coordinates?.latitude;
    const longitude = event.coordinates?.longitude;
    if (typeof latitude === 'number' && typeof longitude === 'number') {
      mapCenter.current = [latitude, longitude];
    }
    if (typeof event.zoom === 'number') updateObservedZoom(event.zoom);
    if (typeof event.bearing !== 'number') return;
    const bearing = Math.round(((event.bearing % 360) + 360) % 360);
    setMapBearing((prev) => {
      const diff = Math.abs(prev - bearing);
      return Math.min(diff, 360 - diff) < 2 ? prev : bearing;
    });
  }, [updateObservedZoom]);

  const startAtCurrentLocation = useCallback(async () => {
    if (currentLocation) {
      dispatch({ type: 'add', point: currentLocation });
      return;
    }
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const current: LatLng = [pos.coords.latitude, pos.coords.longitude];
      setCurrentLocation(current);
      setCamera({ center: current, zoom: 15 });
      mapCenter.current = current;
      updateObservedZoom(15);
      dispatch({ type: 'add', point: current });
    } finally {
      setLocating(false);
    }
  }, [currentLocation, updateObservedZoom]);

  const addMapCenter = useCallback(() => {
    dispatch({ type: 'add', point: mapCenter.current });
  }, []);

  const openSave = useCallback(() => {
    setName(defaultRouteName(distanceMeters, units));
    setSheetOpen(true);
  }, [distanceMeters, units]);

  const onSave = useCallback(async () => {
    if (!userId || state.points.length < 2) return;
    setSaving(true);
    try {
      // The stored path is the rendered polyline when any segment actually
      // snapped (so the viewer draws the real shape); otherwise null (straight).
      const anySnapped = state.segments.some((s) => s.snapped);
      const finalName = name.trim() || defaultRouteName(distanceMeters, units);
      const route = await createRoute(
        {
          userId,
          name: finalName,
          points: routePointsForSave(state),
          path: anySnapped ? fullPath : null,
          distanceMeters,
          ...(workoutId ? { workoutId } : {}),
        },
        queryClient,
      );
      setSheetOpen(false);
      if (workoutId) {
        router.dismissTo({ pathname: '/workout/[id]', params: { id: workoutId } });
      } else {
        router.replace({ pathname: '/routes/[id]', params: { id: route.id } });
      }
    } catch (err) {
      setSaving(false);
      Alert.alert('Couldn’t save route', err instanceof Error ? err.message : String(err));
    }
  }, [userId, state, name, distanceMeters, fullPath, queryClient, router, units, workoutId]);

  const hasPoints = state.points.length > 0;
  const snapFailed = state.snap && failedSnapKeys.size > 0;
  const canSave = state.points.length >= 2 && !snapping && !snapFailed && !planningBlocked;
  const onCancelBuilder = useCallback(() => {
    if (!hasPoints) {
      closeScreen(router);
      return;
    }
    Alert.alert('Discard route?', 'Your unsaved route will be lost.', [
      { text: 'Keep editing', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: () => closeScreen(router),
      },
    ]);
  }, [hasPoints, router]);
  const returnedToStart =
    state.points.length >= 2 &&
    state.points[0]![0] === state.points[state.points.length - 1]![0] &&
    state.points[0]![1] === state.points[state.points.length - 1]![1];
  const workoutContextInvalid = !!workoutId && !workoutDetail.loading && (!workout || !!planningBlocked);
  const builderTitle = workoutId && targetLabel
    ? `${targetLabel.toUpperCase()} ${(workout?.type ?? 'run').toUpperCase()}`
    : 'BUILD ROUTE';

  const finishLoop = () => {
    if (!canCloseLoop(state)) return;
    dispatch({ type: 'closeLoop' });
    setFinishMode('loop');
  };
  const finishOutAndBack = () => {
    if (state.points.length < 2 || returnedToStart) return;
    dispatch({ type: 'outAndBack' });
    setFinishMode('out-back');
  };
  const undo = () => {
    dispatch({ type: 'undo' });
    setFinishMode(null);
    setFailedSnapKeys(new Set());
  };
  const clear = () => {
    dispatch({ type: 'clear' });
    setFinishMode(null);
    setFailedSnapKeys(new Set());
  };

  return (
    <View style={styles.root}>
      {appleMapsAvailable && cameraReady ? (
        <BuilderMap
          camera={camera}
          path={mapPath}
          points={state.points}
          closed={state.closed}
          onMapClick={onMapClick}
          onCameraMove={onCameraMove}
        />
      ) : (
        <View style={styles.mapFallback}>
          {!cameraReady ? (
            <ActivityIndicator color={C.ink} />
          ) : (
            <Text style={styles.fallbackText}>Map unavailable on this device.</Text>
          )}
        </View>
      )}

      <SafeAreaView style={styles.overlay} pointerEvents="box-none" edges={[]}>
        <OverlayNav topInset={insets.top}>
          <CloseButton
            onPress={onCancelBuilder}
            variant="overlay"
            accessibilityLabel="Close route builder"
          />
          <View style={[styles.card, styles.topTitle]} pointerEvents="none">
            <Text style={styles.topTitleText}>{builderTitle}</Text>
          </View>
          <RoundIconButton
            icon="arrow.uturn.backward"
            onPress={undo}
            disabled={!hasPoints}
            variant="overlay"
            accessibilityLabel="Undo last point"
          />
        </OverlayNav>

        <View
          style={[styles.bottom, { paddingBottom: insets.bottom + space.sm }]}
          pointerEvents="box-none"
        >
          <View style={styles.mapControlsRow} pointerEvents="box-none">
            <View style={[styles.card, styles.zoomControl]}>
              <Pressable
                testID="route-zoom-in"
                onPress={() => zoomMap(1)}
                disabled={visibleMapZoom >= MAX_ROUTE_ZOOM}
                accessibilityRole="button"
                accessibilityLabel="Zoom in"
                accessibilityState={{ disabled: visibleMapZoom >= MAX_ROUTE_ZOOM }}
                style={({ pressed }) => [styles.zoomButton, pressed && styles.pressed]}
              >
                <SymbolView name="plus" size={17} tintColor={C.ink} weight="semibold" />
              </Pressable>
              <Divider vertical style={styles.zoomDivider} />
              <Pressable
                testID="route-zoom-out"
                onPress={() => zoomMap(-1)}
                disabled={visibleMapZoom <= MIN_ROUTE_ZOOM}
                accessibilityRole="button"
                accessibilityLabel="Zoom out"
                accessibilityState={{ disabled: visibleMapZoom <= MIN_ROUTE_ZOOM }}
                style={({ pressed }) => [styles.zoomButton, pressed && styles.pressed]}
              >
                <SymbolView name="minus" size={17} tintColor={C.ink} weight="semibold" />
              </Pressable>
            </View>
            <Compass bearing={mapBearing} />
          </View>

          <View style={styles.startRow}>
            {!hasPoints ? (
              <Pressable
                onPress={startAtCurrentLocation}
                disabled={locating}
                accessibilityRole="button"
                accessibilityLabel="Use current location as route start"
                accessibilityState={{ disabled: locating }}
                style={({ pressed }) => [pressed && styles.pressed, locating && styles.disabled]}
              >
                <View style={[styles.card, styles.startBtn]}>
                  <View style={styles.startBtnInner}>
                    {locating ? (
                      <ActivityIndicator color={C.ink} />
                    ) : (
                      <SymbolView name="location.fill" size={15} tintColor={C.ink} weight="semibold" />
                    )}
                    <Text style={styles.startBtnText}>Use current location</Text>
                  </View>
                </View>
              </Pressable>
            ) : null}
            <Pressable
              onPress={addMapCenter}
              accessibilityRole="button"
              accessibilityLabel="Add waypoint at map center"
              accessibilityHint="Pan the map, then activate this button to place a waypoint without tapping the map."
              style={({ pressed }) => [pressed && styles.pressed]}
            >
              <View style={[styles.card, styles.startBtn]}>
                <View style={styles.startBtnInner}>
                  <SymbolView name="plus.viewfinder" size={15} tintColor={C.ink} weight="semibold" />
                  <Text style={styles.startBtnText}>Add map center</Text>
                </View>
              </View>
            </Pressable>
          </View>

          {snapping ? <SnappingIndicator /> : null}
          {snapFailed ? (
            <View style={styles.snapFailure}>
              <Text style={styles.snapFailureText}>Couldn’t follow roads. Turn off Snap to use straight lines.</Text>
            </View>
          ) : null}

          <View style={styles.builderSheet}>
            <View style={styles.distanceRow}>
              <Text
                style={styles.distanceValue}
                accessibilityLabel={`${distanceLabel}, ${state.points.length} ${state.points.length === 1 ? 'waypoint' : 'waypoints'}`}
                accessibilityLiveRegion="polite"
              >
                {distanceLabel.toUpperCase()}
              </Text>
              {targetLabel ? (
                <View style={styles.targetCopy}>
                  <Text style={styles.distanceTarget}>TARGET {targetLabel.toUpperCase()}</Text>
                  <Text style={[styles.fitLabel, onTarget && styles.fitOnTarget]}>{fitLabel}</Text>
                </View>
              ) : null}
            </View>
            {targetLabel ? (
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${Math.round(distanceProgress * 100)}%` }]} />
              </View>
            ) : null}

            <View style={styles.finishControl} accessibilityRole="radiogroup">
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: finishMode === 'loop', disabled: !canCloseLoop(state) }}
                accessibilityLabel="Finish as loop"
                disabled={!canCloseLoop(state)}
                onPress={finishLoop}
                style={[styles.finishOption, finishMode === 'loop' && styles.finishOptionSelected]}
              >
                <Text style={[styles.finishText, finishMode === 'loop' && styles.finishTextSelected]}>Loop</Text>
              </Pressable>
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: finishMode === 'out-back', disabled: state.points.length < 2 || returnedToStart }}
                accessibilityLabel="Finish as out and back"
                disabled={state.points.length < 2 || returnedToStart}
                onPress={finishOutAndBack}
                style={[styles.finishOption, finishMode === 'out-back' && styles.finishOptionSelected]}
              >
                <Text style={[styles.finishText, finishMode === 'out-back' && styles.finishTextSelected]}>Out & back</Text>
              </Pressable>
            </View>

            <View style={styles.controls}>
                <ToolButton
                  label="Undo"
                  icon="arrow.uturn.backward"
                  disabled={!hasPoints}
                  onPress={undo}
                />
                <ToolButton
                  label="Snap"
                  icon={state.snap ? 'point.3.connected.trianglepath.dotted' : 'line.diagonal'}
                  active={state.snap}
                  disabled={!routeSnapAvailable}
                  onPress={() => {
                    dispatch({ type: 'setSnap', snap: !state.snap });
                    setFailedSnapKeys(new Set());
                  }}
                />
                <ToolButton
                  label="Clear"
                  icon="trash"
                  disabled={!hasPoints}
                  onPress={clear}
                />
            </View>

            {workoutContextInvalid ? (
              <Text style={styles.contextError}>This workout is no longer available for route planning.</Text>
            ) : null}

            <ActionButton
              accessibilityLabel={workoutId ? 'Save and attach route' : 'Save route'}
              disabled={!canSave || workoutContextInvalid}
              color={C.yellow}
              onPress={openSave}
              variant="commit"
            >
              <ActionButtonLabel>{workoutId ? 'Save & attach' : 'Save route'}</ActionButtonLabel>
            </ActionButton>
          </View>
        </View>
      </SafeAreaView>

      {sheetOpen ? (
        <SaveSheet
          name={name}
          onChangeName={setName}
          distanceLabel={distanceLabel}
          fitLabel={fitLabel}
          saving={saving}
          attach={!!workoutId}
          onCancel={() => setSheetOpen(false)}
          onSave={onSave}
        />
      ) : null}
    </View>
  );
}

function Compass({ bearing }: { bearing: number }) {
  const styles = useThemedStyles(makeStyles);
  const C = useTheme();
  return (
    <View style={styles.compassWrap} pointerEvents="none">
      <View style={[styles.card, styles.compass]}>
        <View style={styles.compassInner}>
          <SymbolView
            name="location.north.fill"
            size={18}
            tintColor={C.ink}
            weight="semibold"
            style={{ transform: [{ rotate: `${-bearing}deg` }] }}
          />
          <Text style={styles.compassLabel}>N</Text>
        </View>
      </View>
    </View>
  );
}

function segmentKey(index: number, seg: RouteSegment): string {
  const from = seg.path[0]!;
  const to = seg.path[seg.path.length - 1]!;
  return `${index}:${from[0]},${from[1]}>${to[0]},${to[1]}`;
}

function sameLatLng(a: LatLng, b: LatLng): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

function visibleBuilderPath(state: BuilderState, failedSnapKeys: Set<string>): LatLng[] {
  if (state.points.length === 0) return [];
  const out: LatLng[] = [state.points[0]!];
  for (let index = 0; index < state.segments.length; index++) {
    const seg = state.segments[index]!;
    if (state.snap && !seg.snapped && !failedSnapKeys.has(segmentKey(index, seg))) break;
    for (let i = 1; i < seg.path.length; i++) out.push(seg.path[i]!);
  }
  return out;
}

function SnappingIndicator() {
  const styles = useThemedStyles(makeStyles);
  const C = useTheme();
  return (
    <View style={styles.snappingRow} pointerEvents="none">
      <View style={[styles.card, styles.snappingPill]}>
        <View style={styles.snappingInner}>
          <ActivityIndicator color={C.ink} />
          <Text style={styles.snappingText}>Snapping</Text>
        </View>
      </View>
    </View>
  );
}

interface BuilderMapProps {
  camera: { center: LatLng; zoom: number };
  path: LatLng[];
  points: LatLng[];
  closed: boolean;
  onMapClick: (event: { coordinates?: { latitude?: number; longitude?: number } }) => void;
  onCameraMove: (event: { bearing?: number; zoom?: number; coordinates?: { latitude?: number; longitude?: number } }) => void;
}

/**
 * The draw map. Prefers the live `@rnmapbox` map (our custom label-free style +
 * gold route, matching the rest of the app); falls back to the Apple map where
 * Mapbox isn't available so drawing never breaks. Both: tap to drop a waypoint,
 * a controlled camera that only recenters on geolocation (never on a tap), and a
 * bearing report for the compass rose.
 */
function BuilderMap(props: BuilderMapProps) {
  if (rnMapboxAvailable) return <BuilderMapGL {...props} />;
  return <BuilderMapApple {...props} />;
}

/** rnMapbox draw map — gold route + casing over the custom style, waypoint dots. */
function BuilderMapGL({ camera, path, points, onMapClick, onCameraMove }: BuilderMapProps) {
  const C = useTheme();
  const isLight = useScheme() === 'light';
  const M = rnMapbox!;
  const styleURL = `mapbox://styles/${isLight ? MAPBOX_STYLE.light : MAPBOX_STYLE.dark}`;

  const routeFC = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features:
        path.length >= 2
          ? [{ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: path.map(([la, ln]) => [ln, la]) } }]
          : [],
    }),
    [path],
  );
  const wpFC = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: points.map((p, i) => ({
        type: 'Feature' as const,
        properties: { color: i === 0 ? C.positiveText : C.yellow },
        geometry: { type: 'Point' as const, coordinates: [p[1], p[0]] },
      })),
    }),
    [points, C.positiveText, C.yellow],
  );

  return (
    <M.MapView
      style={StyleSheet.absoluteFill}
      styleURL={styleURL}
      scaleBarEnabled={false}
      compassEnabled={false}
      logoEnabled={false}
      attributionEnabled={false}
      pitchEnabled={false}
      onPress={(e: { geometry?: { coordinates?: number[] } }) => {
        const c = e.geometry?.coordinates;
        if (c && c.length >= 2) onMapClick({ coordinates: { latitude: c[1]!, longitude: c[0]! } });
      }}
      onCameraChanged={(e: { properties?: { center?: number[]; heading?: number; zoom?: number } }) => {
        const properties = e?.properties;
        const center = properties?.center;
        onCameraMove({
          bearing: properties?.heading,
          zoom: properties?.zoom,
          coordinates: center && center.length >= 2 ? { latitude: center[1], longitude: center[0] } : undefined,
        });
      }}
    >
      <M.Camera centerCoordinate={[camera.center[1], camera.center[0]]} zoomLevel={camera.zoom} animationMode="flyTo" animationDuration={350} />
      {path.length >= 2 ? (
        <M.ShapeSource id="broute" shape={routeFC}>
          <M.LineLayer id="brouteCasing" style={{ lineColor: C.bg, lineOpacity: isLight ? 0.16 : 0.5, lineWidth: 8, lineJoin: 'round', lineCap: 'round' }} />
          <M.LineLayer id="brouteLine" style={{ lineColor: C.yellow, lineWidth: 4.5, lineJoin: 'round', lineCap: 'round' }} />
        </M.ShapeSource>
      ) : null}
      {points.length > 0 ? (
        <M.ShapeSource id="bwp" shape={wpFC}>
          <M.CircleLayer id="bwpDots" style={{ circleColor: ['get', 'color'], circleRadius: 5.5, circleStrokeColor: C.bg, circleStrokeWidth: 2 }} />
        </M.ShapeSource>
      ) : null}
    </M.MapView>
  );
}

/** The Apple Map fallback: tap-to-add via onMapClick, gold route polyline, flat S/E annotations. */
function BuilderMapApple({
  camera,
  path,
  points,
  closed,
  onMapClick,
  onCameraMove,
}: BuilderMapProps) {
  const C = useTheme();
  const { AppleMaps } = appleMaps!;
  const mapRef = useRef<import('expo-maps').AppleMaps.MapView>(null);

  useEffect(() => {
    mapRef.current?.setCameraPosition({
      coordinates: { latitude: camera.center[0], longitude: camera.center[1] },
      zoom: camera.zoom,
    });
  }, [camera]);

  const coordinates = useMemo(
    () => path.map(([latitude, longitude]) => ({ latitude, longitude })),
    [path],
  );

  type Annotation = NonNullable<import('expo-maps').AppleMaps.MapProps['annotations']>[number];
  const annotations = useMemo<Annotation[]>(() => {
    if (points.length === 0) return [];
    const start = points[0]!;
    const out: Annotation[] = [
      {
        id: 'start',
        coordinates: { latitude: start[0], longitude: start[1] },
        backgroundColor: 'rgba(255,255,255,0)',
        text: '◆',
        textColor: C.yellow,
        title: '',
      },
    ];
    if (points.length > 1 && !closed) {
      const last = points[points.length - 1]!;
      out.push({
        id: 'end',
        coordinates: { latitude: last[0], longitude: last[1] },
        backgroundColor: 'rgba(255,255,255,0)',
        text: '◆',
        textColor: C.ink,
        title: '',
      });
    }
    return out;
  }, [closed, points, C]);

  return (
    <AppleMaps.View
      ref={mapRef}
      style={StyleSheet.absoluteFill}
      cameraPosition={{ coordinates: { latitude: camera.center[0], longitude: camera.center[1] }, zoom: camera.zoom }}
      onMapClick={onMapClick}
      onCameraMove={onCameraMove}
      properties={{
        mapType: AppleMaps.MapType.STANDARD,
        isMyLocationEnabled: true,
        isTrafficEnabled: false,
        selectionEnabled: false,
        pointsOfInterest: { including: [] },
      }}
      uiSettings={{
        togglePitchEnabled: false,
        compassEnabled: false,
        scaleBarEnabled: false,
        myLocationButtonEnabled: false,
      }}
      polylines={
        coordinates.length >= 2
          ? [{ id: 'route', coordinates, color: C.yellow, width: 4 }]
          : []
      }
      annotations={annotations}
    />
  );
}

function ToolButton({
  label,
  icon,
  onPress,
  disabled,
  active,
}: {
  label: string;
  icon?: SFSymbol;
  onPress: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  const styles = useThemedStyles(makeStyles);
  const C = useTheme();
  const color = active ? C.yellow : C.ink;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected: active }}
      style={({ pressed }) => [styles.tool, pressed && styles.pressed, disabled && styles.disabled]}
    >
      {icon ? (
        <SymbolView name={icon} size={20} tintColor={color} weight="semibold" />
      ) : null}
      <Text style={[styles.toolLabel, active && styles.toolLabelActive]}>{label}</Text>
    </Pressable>
  );
}

/** Shared transactional sheet: name field (prefilled) + commit action. */
function SaveSheet({
  name,
  onChangeName,
  distanceLabel,
  fitLabel,
  saving,
  attach,
  onCancel,
  onSave,
}: {
  name: string;
  onChangeName: (s: string) => void;
  distanceLabel: string;
  fitLabel: string | null;
  saving: boolean;
  attach: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const C = useTheme();
  return (
    <Modal
      visible
      transparent
      animationType="slide"
      onRequestClose={() => { if (!saving) onCancel(); }}
    >
      <View style={styles.sheetBackdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          accessibilityLabel="Dismiss save route"
          disabled={saving}
          onPress={onCancel}
        />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sheetKeyboard} pointerEvents="box-none">
          <View accessibilityViewIsModal style={styles.saveSheet}>
            <SheetHeader
              title={attach ? 'Save & attach' : 'Save route'}
              onClose={onCancel}
              closeDisabled={saving}
              style={styles.saveSheetHeader}
            />
            <View style={styles.saveSheetBody}>
              <Text style={styles.sheetMeta}>{[distanceLabel, fitLabel].filter(Boolean).join(' · ')}</Text>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={onChangeName}
                placeholder="Route name"
                placeholderTextColor={C.faint}
                autoFocus
                selectTextOnFocus
                editable={!saving}
                returnKeyType="done"
                onSubmitEditing={onSave}
              />
            </View>
            <ModalFooter surface="panel">
              <ActionButton
                onPress={onSave}
                loading={saving}
                loadingLabel="Saving…"
                loadingAccessibilityLabel="Saving route"
                accessibilityLabel={attach ? 'Save and attach route' : 'Save route'}
                color={C.yellow}
                variant="commit"
              >
                <ActionButtonLabel>{attach ? 'Save & attach' : 'Save'}</ActionButtonLabel>
              </ActionButton>
            </ModalFooter>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const makeStyles = (C: Tokens) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: C.bg },
    card: {
      backgroundColor: C.card,
      borderColor: C.line,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: radius.md,
    },
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

    overlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      justifyContent: 'space-between',
    },

    topTitle: { minHeight: 44, maxWidth: '58%', borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.lg },
    topTitleText: { color: C.ink, fontSize: fontSizes.label, fontWeight: '800', letterSpacing: 0.4, textAlign: 'center' },
    mapControlsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: space.sm,
      paddingHorizontal: space.lg,
    },
    zoomControl: {
      height: 44,
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: radius.sm,
      overflow: 'hidden',
    },
    zoomButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    // Short of the control's full 44pt height, so the rule reads as a seam
    // between the two buttons rather than an edge — hence height + self-centring
    // rather than the Divider's default stretch.
    zoomDivider: { height: 24, alignSelf: 'center' },
    compassWrap: {},
    compass: { width: 42, height: 42, borderRadius: radius.pill },
    compassInner: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 1,
    },
    compassLabel: {
      fontSize: fontSizes.micro,
      fontWeight: '900',
      color: C.ink,
      lineHeight: 10,
    },

    bottom: { paddingBottom: space.sm, gap: space.sm },

    startRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: space.sm, paddingHorizontal: space.lg },
    startBtn: { borderRadius: radius.pill },
    startBtnInner: {
      height: 42,
      paddingHorizontal: space.md,
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
    },
    startBtnText: { fontSize: fontSizes.label, fontWeight: '800', color: C.ink },

    snappingRow: { alignItems: 'center' },
    snappingPill: { borderRadius: radius.pill },
    snappingInner: {
      height: 34,
      paddingHorizontal: space.md,
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
    },
    snappingText: {
      fontSize: fontSizes.metadata,
      fontWeight: '800',
      color: C.ink,
    },
    snapFailure: { marginHorizontal: space.lg, borderRadius: radius.sm, backgroundColor: C.card, borderWidth: StyleSheet.hairlineWidth, borderColor: C.line, paddingHorizontal: space.lg, paddingVertical: space.md },
    snapFailureText: { color: C.mute, fontSize: fontSizes.metadata, lineHeight: 17, fontWeight: '600', textAlign: 'center' },

    builderSheet: { backgroundColor: C.card, ...hairlineTop(C), borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.sm, gap: space.md },
    distanceRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: space.lg },
    targetCopy: { alignItems: 'flex-end', paddingBottom: space.s },
    fitLabel: { ...statValueText(C, 'labelLg', 'system'), color: C.warningText, fontWeight: '800', marginTop: 3 },
    fitOnTarget: { color: C.mute },
    progressTrack: { height: 7, borderRadius: radius.xs, backgroundColor: C.slate, overflow: 'hidden' },
    progressFill: { height: 7, borderRadius: radius.xs, backgroundColor: C.yellow },
    finishControl: { minHeight: 44, flexDirection: 'row', padding: 3, borderRadius: radius.sm, backgroundColor: C.recess, borderWidth: StyleSheet.hairlineWidth, borderColor: C.line },
    finishOption: { flex: 1, minHeight: 38, borderRadius: radius.xs, alignItems: 'center', justifyContent: 'center' },
    finishOptionSelected: { backgroundColor: C.slate },
    finishText: { color: C.mute, fontSize: fontSizes.label, fontWeight: '700' },
    finishTextSelected: { color: C.ink },
    contextError: { color: C.dangerText, fontSize: fontSizes.metadata, lineHeight: 17, fontWeight: '600', textAlign: 'center' },

    distanceValue: {
      fontFamily: data,
      fontSize: 38,
      color: C.ink,
      letterSpacing: -1.2,
      fontVariant: ['tabular-nums'],
    },
    distanceTarget: {
      ...statValueText(C, 'micro', 'dataRegular'),
      color: C.mute,
      fontWeight: '700',
      letterSpacing: 0.5,
    },
    controls: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'flex-start' },
    tool: { minHeight: 48, alignItems: 'center', justifyContent: 'center', gap: space.xs, paddingHorizontal: space.lg, minWidth: 72 },
    toolLabel: { fontSize: fontSizes.labelSm, fontWeight: '600', color: C.mute },
    toolLabelActive: { color: C.yellowText },

    pressed: { opacity: 0.5 },
    disabled: { opacity: 0.35 },

    sheetBackdrop: {
      flex: 1,
      backgroundColor: SCRIM,
    },
    sheetKeyboard: { flex: 1, justifyContent: 'flex-end' },
    saveSheet: {
      overflow: 'hidden',
      backgroundColor: C.panel,
      borderTopLeftRadius: sheetPresentation.cornerRadius,
      borderTopRightRadius: sheetPresentation.cornerRadius,
    },
    saveSheetHeader: {
      paddingTop: space.lg,
      ...hairlineBottom(C),
    },
    saveSheetBody: { padding: space.lg, gap: space.md },
    sheetMeta: { fontSize: fontSizes.body, fontWeight: '600', color: C.mute },
    input: {
      backgroundColor: C.fill,
      borderRadius: radius.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: C.line,
      paddingHorizontal: space.l,
      paddingVertical: space.md,
      fontSize: fontSizes.body,
      fontWeight: '600',
      color: C.ink,
    },
  });
