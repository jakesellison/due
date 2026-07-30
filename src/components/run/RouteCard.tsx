import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Canvas, Circle, Group, Path } from '@shopify/react-native-skia';

import { appleMaps, appleMapsAvailable, MUTED_EMPHASIS } from '@/app-lib/maps';
import { formatDistance, formatDuration, polylinePath } from '@/lib';
import { statValueText } from '@/components/ui/Stat';
import { useTheme, useThemedStyles } from '@/theme/ThemeProvider';
import { radius, space, type Tokens } from '@/theme/tokens';

/**
 * The run's route inside the glass card. Primary rendering is a REAL Apple Map
 * (expo-maps `AppleMaps.View`) on iOS: a muted/standard style map, the camera
 * fitted to the route's padded bounding box, the route drawn as an ink polyline,
 * a volt start marker and an ink end marker. Interaction noise we don't need
 * (pitch toggle, compass, POIs) is disabled; pinch + pan stay on.
 *
 * Fallback: when expo-maps is unavailable at runtime (the module failed to load,
 * e.g. pre-iOS-17 or a missing native build) we render the previous clean Skia
 * path projection of the loop so the card never goes blank. The `projectRoute`
 * helper + the `polylinePath` lib stay intact for that path (and its tests).
 *
 * Either way the map fills a rounded-26 clip ~220pt tall inside the card, with
 * the unchanged caption row (distance · time · effort) below.
 */

export interface RouteCardProps {
  /** Closed-loop route as [[lat, lng], ...]. */
  route: [number, number][];
  distanceMeters: number;
  movingTimeS: number | null;
  sufferScore?: number | null;
  width?: number;
}

const MAP_H = 220;
const PADDING = 18;

export function RouteCard({
  route,
  distanceMeters,
  movingTimeS,
  sufferScore,
  width = 340,
}: RouteCardProps) {
  const styles = useThemedStyles(makeStyles);
  const caption = useMemo(() => {
    const parts = [formatDistance(distanceMeters, 'mi')];
    if (movingTimeS != null) parts.push(formatDuration(movingTimeS));
    if (sufferScore != null) parts.push(`${sufferScore} effort`);
    return parts.join('  ');
  }, [distanceMeters, movingTimeS, sufferScore]);

  if (!route || route.length < 2) return null;

  return (
    <View style={[styles.card, { width }]}>
      <View style={styles.inner}>
        <View style={[styles.mapClip, { width: width - 2, height: MAP_H }]}>
          {appleMapsAvailable ? (
            <AppleMapRoute route={route} />
          ) : (
            <SkiaRoute route={route} width={width - 2} />
          )}
        </View>
        <Text style={styles.caption} numberOfLines={1}>
          {caption}
        </Text>
      </View>
    </View>
  );
}

/** The real Apple Map: muted standard map, fitted camera, ink polyline + dots. */
function AppleMapRoute({ route }: { route: [number, number][] }) {
  const C = useTheme();
  const { AppleMaps } = appleMaps!;
  const model = useMemo(() => mapModel(route), [route]);

  const coordinates = useMemo(
    () => route.map(([latitude, longitude]) => ({ latitude, longitude })),
    [route],
  );

  return (
    <AppleMaps.View
      style={StyleSheet.absoluteFill}
      cameraPosition={{ coordinates: model.center, zoom: model.zoom }}
      properties={{
        mapType: AppleMaps.MapType.STANDARD,
        // The MUTED emphasis enum value (deemphasised imagery). expo-maps does
        // not re-export AppleMapsMapStyleEmphasis on the AppleMaps namespace, and
        // the enum's value IS the literal 'MUTED', so we pass it directly.
        emphasis: MUTED_EMPHASIS,
        isMyLocationEnabled: false,
        isTrafficEnabled: false,
        selectionEnabled: false,
        elevation: AppleMaps.MapStyleElevation.FLAT,
        // Hide all points of interest so the route reads cleanly.
        pointsOfInterest: { including: [] },
      }}
      uiSettings={{
        togglePitchEnabled: false,
        compassEnabled: false,
        scaleBarEnabled: false,
        myLocationButtonEnabled: false,
      }}
      polylines={[
        {
          id: 'route',
          coordinates,
          color: C.ink,
          width: 3,
          contourStyle: AppleMaps.ContourStyle.STRAIGHT,
        },
      ]}
      markers={[
        {
          id: 'start',
          coordinates: { latitude: route[0]![0], longitude: route[0]![1] },
          tintColor: C.yellow,
          systemImage: 'circle.fill',
          title: 'Start',
        },
        {
          id: 'end',
          coordinates: {
            latitude: route[route.length - 1]![0],
            longitude: route[route.length - 1]![1],
          },
          tintColor: C.ink,
          systemImage: 'flag.checkered',
          title: 'Finish',
        },
      ]}
    />
  );
}

/** The Skia path fallback (no map tiles) — the prior clean projection. */
function SkiaRoute({ route, width }: { route: [number, number][]; width: number }) {
  const C = useTheme();
  const model = useMemo(() => projectRoute(route, width, MAP_H, PADDING), [route, width]);
  if (!model) return null;
  return (
    <Canvas style={{ width, height: MAP_H }}>
      <Group>
        <Path
          path={model.shadow}
          color={C.line}
          style="stroke"
          strokeWidth={3}
          strokeJoin="round"
          strokeCap="round"
        />
        <Path
          path={model.path}
          color={C.ink}
          style="stroke"
          strokeWidth={3}
          strokeJoin="round"
          strokeCap="round"
        />
        <Circle cx={model.start.x} cy={model.start.y} r={4.5} color={C.yellow} />
        <Circle cx={model.end.x} cy={model.end.y} r={3.5} color={C.ink} />
      </Group>
    </Canvas>
  );
}

/**
 * Compute the Apple Map camera: the bounding-box centre + a zoom level chosen so
 * the route (padded +15%) fits the view. expo-maps exposes only centre + zoom
 * (no fitToBounds), so we derive zoom from the larger of the lat/lng spans using
 * the Web-Mercator tile relation (zoom ≈ log2(360 / spanDegrees)).
 */
export function mapModel(route: [number, number][]): {
  center: { latitude: number; longitude: number };
  zoom: number;
} {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const [lat, lng] of route) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }
  const center = { latitude: (minLat + maxLat) / 2, longitude: (minLng + maxLng) / 2 };

  // Pad the spans by 15% so the route doesn't kiss the frame.
  const latSpan = (maxLat - minLat) * 1.15;
  // Longitude degrees shrink with latitude; normalise so the span is comparable.
  const cosLat = Math.cos((center.latitude * Math.PI) / 180) || 1;
  const lngSpan = (maxLng - minLng) * 1.15 * cosLat;
  const span = Math.max(latSpan, lngSpan, 1e-4);

  // zoom = log2(360 / span), clamped to sane bounds.
  const zoom = Math.max(2, Math.min(18, Math.log2(360 / span)));
  return { center, zoom };
}

interface ProjectedRoute {
  path: string;
  shadow: string;
  start: { x: number; y: number };
  end: { x: number; y: number };
}

/**
 * Project a [[lat, lng], ...] loop into canvas pixels: equirectangular (lng
 * scaled by cos(meanLat)), fit to a padded box with aspect preserved + centered.
 * Returns null when the route is too small to draw. (Skia fallback only.)
 */
export function projectRoute(
  route: [number, number][],
  w: number,
  h: number,
  pad: number,
): ProjectedRoute | null {
  if (!route || route.length < 2) return null;

  const meanLat = route.reduce((s, p) => s + p[0], 0) / route.length;
  const cosLat = Math.cos((meanLat * Math.PI) / 180) || 1;

  const pts = route.map(([lat, lng]) => ({ px: lng * cosLat, py: lat }));

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.px < minX) minX = p.px;
    if (p.px > maxX) maxX = p.px;
    if (p.py < minY) minY = p.py;
    if (p.py > maxY) maxY = p.py;
  }
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  if (spanX <= 0 && spanY <= 0) return null;

  const availW = w - pad * 2;
  const availH = h - pad * 2;
  const scale = Math.min(
    spanX > 0 ? availW / spanX : Infinity,
    spanY > 0 ? availH / spanY : Infinity,
  );
  const drawW = spanX * scale;
  const drawH = spanY * scale;
  const offX = pad + (availW - drawW) / 2;
  const offY = pad + (availH - drawH) / 2;

  const sx = (px: number) => offX + (px - minX) * scale;
  const sy = (py: number) => offY + (maxY - py) * scale;

  const screen = pts.map((p) => ({ x: sx(p.px), y: sy(p.py) }));
  const path = polylinePath(screen);
  const shadow = polylinePath(screen.map((p) => ({ x: p.x, y: p.y + 1 })));

  return {
    path,
    shadow,
    start: screen[0]!,
    end: screen[screen.length - 1]!,
  };
}

const makeStyles = (C: Tokens) => StyleSheet.create({
  card: {
    backgroundColor: C.card,
    borderColor: C.line,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  inner: {
    paddingHorizontal: 1,
    paddingTop: 1,
    paddingBottom: space.md,
  },
  mapClip: {
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  caption: {
    ...statValueText(C, 'metadata', 'system'),
    color: C.mute,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
  },
});
