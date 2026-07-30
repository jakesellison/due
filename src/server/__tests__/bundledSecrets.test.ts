/**
 * No secret-scoped credential may reach the shipped JS config.
 *
 * WHY THIS EXISTS (overnight security audit, high). `app.config.js` used to
 * pass the Mapbox DOWNLOADS:READ token as an `@rnmapbox/maps` plugin prop,
 * under a comment asserting it was "build-time only (admin), never bundled".
 * That was false: Expo's public-config sanitizer strips `hooks` and
 * `ios/android.config` but NOT the `plugins` array, so every resolved prop is
 * serialized into `EXConstants.bundle/app.config` inside the built app —
 * readable at runtime via `Constants.expoConfig.plugins`, and by anyone who
 * unzips an IPA. It was confirmed present in this repo's own simulator builds.
 *
 * The token now travels as the RNMAPBOX_MAPS_DOWNLOAD_TOKEN environment
 * variable, which the Mapbox podspec reads directly, so it never enters the JS
 * config at all.
 *
 * These assertions run against the config SOURCE rather than a resolved config
 * so they stay fast and hermetic (no `expo config` subprocess, no env). The
 * property they protect is structural: a secret can only get into the bundle by
 * being written into this file.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const appConfig = readFileSync(join(REPO_ROOT, 'app.config.js'), 'utf8');

describe('app.config.js', () => {
  it('does not pass the Mapbox download token as a plugin prop', () => {
    // The prop is the leak — the plugin deprecated it for this reason too.
    expect(appConfig).not.toMatch(/RNMapboxMapsDownloadToken\s*:/);
  });

  it('does not reference the download token env var in the JS config at all', () => {
    // Reading it here would mean it is being placed into config somewhere;
    // the podspec reads the environment directly instead.
    expect(appConfig).not.toMatch(/process\.env\.MAPBOX_DOWNLOAD_TOKEN/);
    expect(appConfig).not.toMatch(/process\.env\.RNMAPBOX_MAPS_DOWNLOAD_TOKEN/);
  });

  it('contains no literal secret-scoped token of any provider', () => {
    // sk. = Mapbox secret scope; the pk. public token is expected and fine.
    expect(appConfig).not.toMatch(/\bsk\.[A-Za-z0-9_.-]{20,}/);
    expect(appConfig).not.toMatch(/\bsk-[A-Za-z0-9_-]{20,}/); // OpenAI/Anthropic style
    expect(appConfig).not.toMatch(/service_role/);
    expect(appConfig).not.toMatch(/-----BEGIN [A-Z ]*PRIVATE KEY-----/);
  });

  it('still registers the Mapbox plugin (the fix must not disable maps)', () => {
    expect(appConfig).toMatch(/'@rnmapbox\/maps'/);
  });
});
