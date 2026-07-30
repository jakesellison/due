/**
 * stravaProgress.ts — the "post plan progress to Strava run descriptions" opt-in,
 * stored on `users.settings.strava_description` (jsonb). Read/written by the You
 * screen toggle; read server-side by the ingest before writing a description.
 */
import { supabase } from './supabase';

/** Is the user opted in to writing plan progress into their Strava descriptions? */
export async function getStravaProgressOptIn(userId: string): Promise<boolean> {
  const { data } = await supabase.from('users').select('settings').eq('id', userId).maybeSingle();
  return !!(data?.settings as { strava_description?: boolean } | null)?.strava_description;
}

/** Set the opt-in, merging into the existing settings jsonb. Returns success. */
export async function setStravaProgressOptIn(userId: string, on: boolean): Promise<boolean> {
  const { data } = await supabase.from('users').select('settings').eq('id', userId).maybeSingle();
  const settings = { ...((data?.settings as Record<string, unknown> | null) ?? {}), strava_description: on };
  const { error } = await supabase.from('users').update({ settings }).eq('id', userId);
  return !error;
}
