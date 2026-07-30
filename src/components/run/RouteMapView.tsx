import { useMemo } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { Canvas, Circle, Group, Path } from '@shopify/react-native-skia';

import { mapboxStaticUrl, type LatLng } from '@/lib';
import { appleMaps, appleMapsAvailable, mapboxToken, MAPBOX_STYLE } from '@/app-lib/maps';
import { rnMapbox, rnMapboxAvailable } from '@/app-lib/rnmapbox';
import { useScheme, useTheme } from '@/theme/ThemeProvider';
import { radius } from '@/theme/tokens';

import { mapModel, projectRoute } from './RouteCard';

/**
 * The one route-map surface for the whole app. Draws a `path` ([lat,lng][]) on a
 * real, theme-matched Mapbox basemap and degrades gracefully so the route is
 * always visible.
 *
 * Interactive (viewer / builder):  rnMapbox live → Apple Maps → static image → Skia
 * Static (thumbnails):             static Mapbox image → Skia
 *
 * The route language matches the run detail: a solid **gold** line over a dark
 * casing, a green start dot and a pink finish dot. (Runs add a pace gradient;
 * a saved route has no pace, so it stays solid gold.) The Routes *library*
 * overrides `lineColor` to a neutral so gold stays the screen's lone accent —
 * "the FAB is the only yellow" (Sharpened design system).
 */
export interface RouteMapViewProps {
  path: LatLng[];
  width: number;
  height: number;
  /** Live, pannable map (rnMapbox/Apple) vs. a static image. Default false. */
  interactive?: boolean;
  /** Start/finish dots. Default true. */
  showMarkers?: boolean;
  /** Route-line colour. Default gold (`C.yellow`); library surfaces pass a neutral. */
  lineColor?: string;
  cornerRadius?: number;
  // ── Builder hooks (interactive + rnMapbox only; wired in P3) ──
  onPress?: (coord: LatLng) => void;
  waypoints?: LatLng[];
  onWaypointDrag?: (index: number, coord: LatLng) => void;
}

const PAD = 16;

export function RouteMapView({
  path,
  width,
  height,
  interactive = false,
  showMarkers = true,
  lineColor,
  cornerRadius,
  onPress,
  waypoints,
  onWaypointDrag,
}: RouteMapViewProps) {
  const C = useTheme();
  const scheme = useScheme();
  const isLight = scheme === 'light';
  const style = isLight ? MAPBOX_STYLE.light : MAPBOX_STYLE.dark;
  const hasRoute = path.length >= 2;
  // Gold is the default route language; the library overrides it to a neutral.
  const line = lineColor ?? C.yellow;

  const tileStyle = [styles.tile, { width, height, backgroundColor: C.panel, borderRadius: cornerRadius ?? radius.lg }];

  // ── 1. Interactive live maps (viewer / builder) ──
  if (interactive && hasRoute) {
    if (rnMapboxAvailable) {
      return (
        <View style={tileStyle}>
          <MapboxRouteGL
            path={path}
            isLight={isLight}
            showMarkers={showMarkers}
            gold={line}
            start={C.positiveText}
            pink={C.pink}
            ringColor={C.bg}
            onPress={onPress}
            waypoints={waypoints}
            onWaypointDrag={onWaypointDrag}
          />
        </View>
      );
    }
    if (appleMapsAvailable) {
      const { AppleMaps } = appleMaps!;
      const model = mapModel(path);
      const coordinates = path.map(([latitude, longitude]) => ({ latitude, longitude }));
      return (
        <View style={tileStyle}>
          <AppleMaps.View
            style={StyleSheet.absoluteFill}
            cameraPosition={{ coordinates: model.center, zoom: model.zoom }}
            properties={{
              mapType: AppleMaps.MapType.STANDARD,
              isMyLocationEnabled: false,
              isTrafficEnabled: false,
              selectionEnabled: false,
              pointsOfInterest: { including: [] },
            }}
            uiSettings={{ togglePitchEnabled: false, compassEnabled: false, scaleBarEnabled: false, myLocationButtonEnabled: false }}
            polylines={[{ id: 'route', coordinates, color: line, width: 4 }]}
            markers={
              showMarkers
                ? [
                    { id: 'start', coordinates: coordinates[0]!, tintColor: C.positiveText, systemImage: 'circle.fill', title: 'Start' },
                    { id: 'end', coordinates: coordinates[coordinates.length - 1]!, tintColor: C.pink, systemImage: 'flag.checkered', title: 'Finish' },
                  ]
                : []
            }
          />
        </View>
      );
    }
    // else: no native map — fall through to static/Skia (non-interactive degradation).
  }

  // ── 2. Static Mapbox image over a Skia underlay; Skia floor when no token. ──
  // Scale edge padding to the tile so a small carousel thumbnail frames tight
  // (more basemap + zoom) while a large card still breathes.
  const staticPad = Math.max(10, Math.min(44, Math.round(Math.min(width, height) * 0.18)));
  const staticUrl =
    mapboxToken && width > 0 && height > 0
      ? mapboxStaticUrl({ route: path, style, token: mapboxToken, width, height, strokeColor: line.replace('#', ''), padding: staticPad })
      : null;
  const proj = width > 0 && height > 0 ? projectRoute(path, width, height, PAD) : null;

  return (
    <View style={tileStyle}>
      {proj ? (
        <Canvas style={StyleSheet.absoluteFill}>
          <Group>
            <Path path={proj.path} color={line} style="stroke" strokeWidth={2.5} strokeJoin="round" strokeCap="round" />
            {showMarkers ? (
              <>
                <Circle cx={proj.start.x} cy={proj.start.y} r={4} color={line} />
                <Circle cx={proj.end.x} cy={proj.end.y} r={3.5} color={C.ink} />
              </>
            ) : null}
          </Group>
        </Canvas>
      ) : null}
      {staticUrl ? <Image source={{ uri: staticUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
    </View>
  );
}

/**
 * The live `@rnmapbox/maps` route map — the run-detail map language with a solid
 * gold line (no pace gradient) over a dark casing, plus green start / pink finish
 * dots. When `onPress` is set (the builder) it reports tapped coordinates and
 * renders draggable waypoint handles.
 */
function MapboxRouteGL({
  path,
  isLight,
  showMarkers,
  gold,
  start,
  pink,
  ringColor,
  onPress,
  waypoints,
  onWaypointDrag,
}: {
  path: LatLng[];
  isLight: boolean;
  showMarkers: boolean;
  gold: string;
  start: string;
  pink: string;
  ringColor: string;
  onPress?: (coord: LatLng) => void;
  waypoints?: LatLng[];
  onWaypointDrag?: (index: number, coord: LatLng) => void;
}) {
  const M = rnMapbox!;
  const styleURL = `mapbox://styles/${isLight ? MAPBOX_STYLE.light : MAPBOX_STYLE.dark}`;

  const bounds = useMemo(() => {
    let minLa = 90, maxLa = -90, minLn = 180, maxLn = -180;
    for (const [la, ln] of path) {
      minLa = Math.min(minLa, la); maxLa = Math.max(maxLa, la);
      minLn = Math.min(minLn, ln); maxLn = Math.max(maxLn, ln);
    }
    return { ne: [maxLn, maxLa] as [number, number], sw: [minLn, minLa] as [number, number] };
  }, [path]);

  const routeFC = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: [
        {
          type: 'Feature' as const,
          properties: {},
          geometry: { type: 'LineString' as const, coordinates: path.map(([la, ln]) => [ln, la]) },
        },
      ],
    }),
    [path],
  );

  const markerFC = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: [
        { type: 'Feature' as const, properties: { color: start }, geometry: { type: 'Point' as const, coordinates: [path[0]![1], path[0]![0]] } },
        { type: 'Feature' as const, properties: { color: pink }, geometry: { type: 'Point' as const, coordinates: [path[path.length - 1]![1], path[path.length - 1]![0]] } },
      ],
    }),
    [path, pink, start],
  );

  const handlePress = onPress
    ? (e: { geometry?: { coordinates?: number[] } }) => {
        const c = e.geometry?.coordinates;
        if (c && c.length >= 2) onPress([c[1]!, c[0]!]);
      }
    : undefined;

  return (
    <M.MapView
      style={StyleSheet.absoluteFill}
      styleURL={styleURL}
      scaleBarEnabled={false}
      compassEnabled={false}
      logoEnabled={false}
      attributionEnabled={false}
      pitchEnabled={false}
      rotateEnabled={false}
      onPress={handlePress}
    >
      <M.Camera defaultSettings={{ bounds: { ...bounds, paddingLeft: 36, paddingRight: 36, paddingTop: 40, paddingBottom: 48 } }} animationMode="none" />
      <M.ShapeSource id="route" shape={routeFC}>
        <M.LineLayer id="routeCasing" style={{ lineColor: ringColor, lineOpacity: isLight ? 0.16 : 0.5, lineWidth: 8, lineJoin: 'round', lineCap: 'round' }} />
        <M.LineLayer id="routeLine" style={{ lineColor: gold, lineWidth: 4.5, lineJoin: 'round', lineCap: 'round' }} />
      </M.ShapeSource>
      {showMarkers && !waypoints ? (
        <M.ShapeSource id="markers" shape={markerFC}>
          <M.CircleLayer id="markerDots" style={{ circleColor: ['get', 'color'], circleRadius: 6.5, circleStrokeColor: ringColor, circleStrokeWidth: 2.2 }} />
        </M.ShapeSource>
      ) : null}
      {waypoints
        ? waypoints.map((wp, i) => (
            <M.PointAnnotation
              key={`wp-${i}`}
              id={`wp-${i}`}
              coordinate={[wp[1], wp[0]]}
              draggable={!!onWaypointDrag}
              onDragEnd={(e: { geometry?: { coordinates?: number[] } }) => {
                const c = e.geometry?.coordinates;
                if (c && c.length >= 2 && onWaypointDrag) onWaypointDrag(i, [c[1]!, c[0]!]);
              }}
            >
              <View style={[wpStyles.dot, { backgroundColor: i === 0 ? start : gold, borderColor: ringColor }]} />
            </M.PointAnnotation>
          ))
        : null}
    </M.MapView>
  );
}

const styles = StyleSheet.create({
  tile: { overflow: 'hidden' },
});

const wpStyles = StyleSheet.create({
  dot: { width: 16, height: 16, borderRadius: radius.sm, borderWidth: 2.5 },
});
