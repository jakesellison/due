import { mapboxToken } from './maps';

/**
 * Defensive `@rnmapbox/maps` loader. The JS package can be present without the
 * native module being linked (a build that didn't include it), so we probe by
 * calling a native method (`setAccessToken`) inside the try — if the native side
 * is missing it throws, and callers fall back to the static Mapbox image.
 */
export type RnMapboxModule = typeof import('@rnmapbox/maps');

let mod: RnMapboxModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  mod = require('@rnmapbox/maps') as RnMapboxModule;
  if (mod?.default && mapboxToken) mod.default.setAccessToken(mapboxToken);
  else mod = null; // no token → no interactive map
} catch {
  mod = null;
}

export const rnMapbox = mod;
export const rnMapboxAvailable = mod != null;
