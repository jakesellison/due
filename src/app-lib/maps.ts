import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * Defensive `expo-maps` loader. Some test/native builds may not include the
 * module; callers can branch on `appleMapsAvailable` and render a fallback.
 */
export type AppleMapsModule = typeof import('expo-maps');

export let appleMaps: AppleMapsModule | null = null;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  appleMaps = require('expo-maps') as AppleMapsModule;
} catch {
  appleMaps = null;
}

export const appleMapsAvailable =
  Platform.OS === 'ios' && appleMaps?.AppleMaps?.View != null;

export type AppleMapProperties = NonNullable<
  import('expo-maps').AppleMaps.MapProps['properties']
>;

// The enum member value is not re-exported on `AppleMaps`, but the prop accepts
// this exact value.
export const MUTED_EMPHASIS = 'MUTED' as AppleMapProperties['emphasis'];

// ── Mapbox (route maps) ───────────────────────────────────────────────────────
// Public token (pk.…) — resolves like the Supabase keys: inlined EXPO_PUBLIC_*
// env (Doppler-injected) → app.config.js `extra`. Null until configured, in which
// case map surfaces fall back to Apple Maps / the SVG route.
const mapboxExtra = (Constants.expoConfig?.extra ?? {}) as { mapboxToken?: string | null };
export const mapboxToken: string | null =
  process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? mapboxExtra.mapboxToken ?? null;

// "Due Minimal" — custom label-free, cool, low-detail styles tuned to the app
// surfaces (parks/water/roads muted; no place/road labels). Authored via the
// Styles API; edit those styles to retune colors.
export const MAPBOX_STYLE = { light: 'redducks/cmqpuc6no009y01qn4kgtdk8n', dark: 'redducks/cmqpuc6vs002101s43lhzc75s' };
