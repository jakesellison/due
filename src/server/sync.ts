import type { SupabaseClient } from '@supabase/supabase-js';

import {
  SYNC_PROVIDERS,
  type SyncProviderCapabilities,
  type SyncProviderId,
} from '../lib/sync/providers';
import { requireUser } from './apiAuth';

export type SyncProviderState = 'connected' | 'available' | 'partner_required' | 'planned';

export interface SyncProviderStatus {
  provider: SyncProviderId;
  label: string;
  connected: boolean;
  state: SyncProviderState;
  enabled: boolean;
  providerAccountId: string | null;
  lastActivityAt: string | null;
  capabilities: SyncProviderCapabilities;
  note: string;
}

interface ConnectionRow {
  provider: string;
  provider_athlete_id: string | null;
  status: string | null;
}

interface LatestActivityRow {
  source: string;
  start_date: string | null;
}

/**
 * Verify the caller's Supabase bearer token for sync API endpoints.
 *
 * @deprecated Back-compat alias for `requireUser` in `apiAuth.ts`, which is now
 * the single implementation shared by every endpoint. Import that directly in
 * new code; this re-export exists so existing call sites keep working.
 */
export const authUser = requireUser;

export async function providerStatuses(
  admin: SupabaseClient,
  userId: string,
): Promise<SyncProviderStatus[]> {
  const connections = await connectionRows(admin, userId);
  const latest = await latestActivityBySource(admin, userId);

  return SYNC_PROVIDERS.map((provider) => {
    const conn = connections.get(provider.id);
    const connected = conn?.status == null ? !!conn : conn.status === 'active';
    const state: SyncProviderState = connected
      ? 'connected'
      : provider.enabled
        ? 'available'
        : provider.connectionMode === 'partner_api'
          ? 'partner_required'
          : 'planned';

    return {
      provider: provider.id,
      label: provider.label,
      connected,
      state,
      enabled: provider.enabled,
      providerAccountId: conn?.provider_athlete_id ?? null,
      lastActivityAt: latest.get(provider.id) ?? null,
      capabilities: provider.capabilities,
      note: provider.note,
    };
  });
}

async function connectionRows(
  admin: SupabaseClient,
  userId: string,
): Promise<Map<SyncProviderId, ConnectionRow>> {
  const { data, error } = await admin
    .from('integration_connections')
    .select('provider, provider_athlete_id, status')
    .eq('user_id', userId);
  if (error) throw new Error(`integration connection status failed: ${error.message}`);

  const out = new Map<SyncProviderId, ConnectionRow>();
  for (const row of (data ?? []) as ConnectionRow[]) {
    if (isProviderId(row.provider)) out.set(row.provider, row);
  }
  return out;
}

async function latestActivityBySource(
  admin: SupabaseClient,
  userId: string,
): Promise<Map<SyncProviderId, string>> {
  const out = new Map<SyncProviderId, string>();

  await Promise.all(
    SYNC_PROVIDERS.map(async (provider) => {
      const { data, error } = await admin
        .from('activities')
        .select('source, start_date')
        .eq('user_id', userId)
        .eq('source', provider.id)
        .order('start_date', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(`latest ${provider.id} activity failed: ${error.message}`);
      const start = (data as LatestActivityRow | null)?.start_date;
      if (start) out.set(provider.id, start);
    }),
  );

  return out;
}

function isProviderId(value: string): value is SyncProviderId {
  return SYNC_PROVIDERS.some((provider) => provider.id === value);
}
