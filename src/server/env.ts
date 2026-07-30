/**
 * Reads + validates required environment variables at call time (not module
 * load) so tests can populate `process.env` before invoking `getEnv()`.
 */

export interface Env {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  supabaseAnonKey: string;
  stravaClientId: string;
  stravaClientSecret: string;
  stravaWebhookVerifyToken: string;
  stravaStateSecret: string;
  appBaseUrl: string;
}

const REQUIRED: Record<keyof Env, string> = {
  supabaseUrl: 'SUPABASE_URL',
  supabaseServiceRoleKey: 'SUPABASE_SERVICE_ROLE_KEY',
  supabaseAnonKey: 'SUPABASE_ANON_KEY',
  stravaClientId: 'STRAVA_CLIENT_ID',
  stravaClientSecret: 'STRAVA_CLIENT_SECRET',
  stravaWebhookVerifyToken: 'STRAVA_WEBHOOK_VERIFY_TOKEN',
  stravaStateSecret: 'STRAVA_STATE_SECRET',
  appBaseUrl: 'APP_BASE_URL',
};

/** Returns validated env config, throwing a clear error listing any missing vars. */
export function getEnv(): Env {
  const out = {} as Env;
  const missing: string[] = [];
  for (const key of Object.keys(REQUIRED) as (keyof Env)[]) {
    const name = REQUIRED[key];
    const value = process.env[name];
    if (value == null || value === '') {
      missing.push(name);
    } else {
      out[key] = value;
    }
  }
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  return out;
}
