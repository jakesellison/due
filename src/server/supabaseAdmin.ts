import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getEnv } from './env';

/**
 * Service-role Supabase client. Bypasses RLS — used only for trusted
 * server-side writes (tokens, ingested activities). Never expose this key
 * to clients.
 */
export function createAdminClient(): SupabaseClient {
  const { supabaseUrl, supabaseServiceRoleKey } = getEnv();
  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false },
  });
}
