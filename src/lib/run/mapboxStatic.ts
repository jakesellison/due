/**
 * mapboxStatic.ts — build Mapbox Static Images API URLs for the run hero/detail.
 *
 * Pure. No IO. Node-tested. A styled (label-free, cool) basemap with the route
 * baked in as a path overlay, `auto`-fit to the route bounds. The app renders the
 * returned URL as a plain <Image>, then overlays its own scrim/title — so the map
 * blends into the page and (being an image) never traps scroll.
 *
 * Style is a Mapbox style spec `owner/styleId` (e.g. `mapbox/light-v11`, or a
 * custom `<username>/<id>` with labels stripped and a cool palette).
 */

const MAX_PATH_POINTS = 320; // enough to render a looped/track workout (~30 laps) as real loops, not chords across the oval; still well under URL limits

/** Evenly downsample a route to at most `max` points, always keeping the ends. */
export function samplePath(route: [number, number][], max = MAX_PATH_POINTS): [number, number][] {
  if (route.length <= max) return route;
  const last = route.length - 1;
  const out: [number, number][] = [];
  for (let i = 0; i < max; i++) {
    const idx = Math.round((i * last) / (max - 1));
    if (out.length === 0 || idx !== Math.round(((i - 1) * last) / (max - 1))) out.push(route[idx]!);
  }
  if (out[0] !== route[0]) out.unshift(route[0]!);
  if (out[out.length - 1] !== route[last]) out.push(route[last]!);
  return out;
}

/** Google/Mapbox polyline encoding (precision 5) of [lat, lng] pairs. */
export function encodePolyline(coords: [number, number][]): string {
  let lastLat = 0;
  let lastLng = 0;
  let result = '';
  const enc = (delta: number): string => {
    let v = delta < 0 ? ~(delta << 1) : delta << 1;
    let out = '';
    while (v >= 0x20) {
      out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    out += String.fromCharCode(v + 63);
    return out;
  };
  for (const [lat, lng] of coords) {
    const la = Math.round(lat * 1e5);
    const lo = Math.round(lng * 1e5);
    result += enc(la - lastLat) + enc(lo - lastLng);
    lastLat = la;
    lastLng = lo;
  }
  return result;
}

export interface MapboxStaticOptions {
  /** Route as [lat, lng] pairs (same shape as `activities.route`). */
  route: [number, number][];
  /** Mapbox style: `owner/styleId`. */
  style: string;
  /** Public access token (pk.…). */
  token: string;
  width: number;
  height: number;
  /** Route stroke hex WITHOUT '#'. Defaults to the brand gold. */
  strokeColor?: string;
  strokeWidth?: number;
  /** Edge padding (px) so the route isn't flush to the frame. */
  padding?: number;
}

/**
 * Build the Static Images URL. Returns null when the route is too sparse to draw.
 * The route is baked as a `path` overlay and the viewport is `auto`-fit to it.
 */
export function mapboxStaticUrl(opts: MapboxStaticOptions): string | null {
  const { route, style, token, width, height, strokeColor = 'FFC93C', strokeWidth = 4, padding = 44 } = opts;
  if (!route || route.length < 2 || !token || !style) return null;
  const poly = encodeURIComponent(encodePolyline(samplePath(route)));
  const overlay = `path-${strokeWidth}+${strokeColor}-1(${poly})`;
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  return (
    `https://api.mapbox.com/styles/v1/${style}/static/${overlay}/auto/${w}x${h}@2x` +
    `?access_token=${token}&attribution=false&logo=false&padding=${padding}`
  );
}

// ── Fixed-view basemap + projection (for an SVG route overlay on the detail map) ──
const TILE_SIZE = 512; // Mapbox's tile/zoom convention

/** Web-Mercator world fraction (0..1) for a lng/lat. */
function worldFrac(lng: number, lat: number): [number, number] {
  const s = Math.min(Math.max(Math.sin((lat * Math.PI) / 180), -0.9999), 0.9999);
  return [(lng + 180) / 360, 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)];
}

export interface MapView {
  /** [lng, lat]. */
  center: [number, number];
  zoom: number;
}

/** Center + zoom that fits a [lat,lng] route into width×height with `pad` margin. */
export function fitMapView(route: [number, number][], width: number, height: number, pad = 36): MapView {
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (const [lat, lng] of route) {
    const [x, y] = worldFrac(lng, lat);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const fracW = Math.max(maxX - minX, 1e-9);
  const fracH = Math.max(maxY - minY, 1e-9);
  const zoom = Math.min(
    Math.log2((width - 2 * pad) / (TILE_SIZE * fracW)),
    Math.log2((height - 2 * pad) / (TILE_SIZE * fracH)),
    18,
  );
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return {
    center: [cx * 360 - 180, (Math.atan(Math.sinh((0.5 - cy) * 2 * Math.PI)) * 180) / Math.PI],
    zoom: Math.max(0, zoom),
  };
}

/** Project [lat,lng] → [x,y] pixels (points) for a fixed view of width×height. */
export function mercatorProjector(view: MapView, width: number, height: number): (lat: number, lng: number) => [number, number] {
  const worldSize = TILE_SIZE * Math.pow(2, view.zoom);
  const [cwx, cwy] = worldFrac(view.center[0], view.center[1]);
  return (lat, lng) => {
    const [wx, wy] = worldFrac(lng, lat);
    return [(wx - cwx) * worldSize + width / 2, (wy - cwy) * worldSize + height / 2];
  };
}

/** Static basemap (no overlay) at an explicit center/zoom, so an SVG overlay can match it. */
export function mapboxBasemapUrl(opts: { view: MapView; style: string; token: string; width: number; height: number }): string | null {
  const { view, style, token, width, height } = opts;
  if (!token || !style) return null;
  const [lng, lat] = view.center;
  return (
    `https://api.mapbox.com/styles/v1/${style}/static/${lng.toFixed(5)},${lat.toFixed(5)},${view.zoom.toFixed(2)},0` +
    `/${Math.round(width)}x${Math.round(height)}@2x?access_token=${token}&attribution=false&logo=false`
  );
}
