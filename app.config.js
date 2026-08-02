// Dynamic Expo config: extends app.json and bakes Supabase config into
// `extra` at build time. Values come from EXPO_PUBLIC_* when set, falling
// back to the Doppler-native names (SUPABASE_URL / SUPABASE_ANON_KEY) that
// `scripts/secrets.mjs` injects from GCP Secret Manager. This makes a plain
// `npm run ios` produce a working bundle — no manual
// env remapping — and prevents the require-time crash from a build made
// without the mapping. The anon key is public-safe by design (RLS enforces
// access); the service-role key must NEVER appear here.
/**
 * Which environment this build targets. Today `prod` is the only provisioned
 * one — see docs/environments.md. Declared here so the app can verify at
 * runtime that the secret set it was built with matches what it claims to be
 * (src/app-lib/appEnv.ts); an unknown value is a hard build error rather than a
 * silent fallback, because a typo would otherwise disable that check.
 */
const APP_ENVIRONMENTS = ['prod', 'dev'];
const appEnv = process.env.APP_ENV ?? 'prod';
if (!APP_ENVIRONMENTS.includes(appEnv)) {
  throw new Error(
    `APP_ENV must be one of ${APP_ENVIRONMENTS.join(' | ')} (got ${JSON.stringify(appEnv)}).`,
  );
}

module.exports = ({ config }) => ({
  ...config,
  // @rnmapbox/maps needs a DOWNLOADS:READ secret token so the iOS build can
  // fetch the Mapbox SDK.
  //
  // It is passed via the RNMAPBOX_MAPS_DOWNLOAD_TOKEN ENVIRONMENT VARIABLE, not
  // as a plugin prop. The prop form (which this used to use, under a comment
  // claiming it was "never bundled") is BOTH deprecated by the plugin and a
  // real credential leak: Expo's public-config sanitizer strips hooks and
  // ios/android.config but NOT the plugins array, so the resolved props are
  // serialized into EXConstants.bundle/app.config inside every built app —
  // readable at runtime via Constants.expoConfig.plugins and by anyone who
  // unzips an IPA. Verified in this repo's own simulator builds.
  //
  // The podspec reads ENV['RNMAPBOX_MAPS_DOWNLOAD_TOKEN'] directly, so the
  // token reaches CocoaPods without ever entering the JS config. Local builds
  // get it from scripts/secrets.mjs (the manifest injects it under this exact
  // name); EAS builds need it as an EAS secret (or an `env` entry in eas.json).
  plugins: [
    ...(config.plugins ?? []),
    '@rnmapbox/maps',
    '@react-native-community/datetimepicker',
    // Sentry: crash reporting via the runtime DSN, plus build-time SOURCE-MAP
    // upload so stack traces symbolicate. org/project are set here; the auth
    // token is injected from the env (SENTRY_AUTH_TOKEN in Doppler for local
    // local builds; it is also an EAS secret for cloud builds). Uploads
    // are skipped automatically when no token is present.
    ['@sentry/react-native', { organization: 'red-ducks-studio', project: 'due-app' }],
    // Local push (run-banked notification). Config-plugin sets up the iOS
    // push entitlement / APNs at prebuild; needs a dev-client rebuild to take.
    'expo-notifications',
  ],
  extra: {
    ...config.extra,
    appEnv,
    supabaseUrl:
      process.env.EXPO_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? null,
    supabaseAnonKey:
      process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
      process.env.SUPABASE_ANON_KEY ??
      null,
    apiBaseUrl:
      process.env.EXPO_PUBLIC_API_BASE_URL ??
      process.env.APP_BASE_URL ??
      null,
    // Public pk token — baked so the static maps + GL view work in release builds too.
    mapboxToken: process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? null,
    // Crash reporting is OPTIONAL, unlike Supabase's fail-loud guard above: a
    // build made without this env var should just ship with reporting
    // disabled, not refuse to boot. `null` here is the "not configured" state
    // `src/app-lib/sentry.ts` gates on.
    sentryDsn: process.env.EXPO_PUBLIC_SENTRY_DSN ?? null,
  },
});
