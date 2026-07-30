import { useCallback, useEffect, useState } from 'react';

import type {
  SyncProviderCapabilities,
  SyncProviderId,
} from '@/lib';
import { SYNC_PROVIDERS } from '@/lib';
import { API_BASE, resilientFetch } from './api';
import { supabase } from './supabase';

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

export interface SyncStatusResponse {
  providers: SyncProviderStatus[];
}

export interface UseSyncStatus {
  providers: SyncProviderStatus[];
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<SyncProviderStatus[]>;
}

export async function fetchSyncStatus(): Promise<SyncStatusResponse> {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) return { providers: fallbackProviders() };

  // Idempotent GET status probe: safe to retry on a transient network/5xx blip.
  const res = await resilientFetch(`${API_BASE}/api/sync/status`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    retries: 2,
  });
  if (!res.ok) {
    throw new Error(`sync status ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as SyncStatusResponse;
}

export function useSyncStatus(enabled: boolean): UseSyncStatus {
  const [providers, setProviders] = useState<SyncProviderStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async (): Promise<SyncProviderStatus[]> => {
    setLoading(true);
    setError(null);
    try {
      const next = await fetchSyncStatus();
      setProviders(next.providers);
      return next.providers;
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      const fallback = fallbackProviders();
      setProviders(fallback);
      return fallback;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
  }, [enabled, refresh]);

  return { providers, loading, error, refresh };
}

function fallbackProviders(): SyncProviderStatus[] {
  return SYNC_PROVIDERS.map((provider) => ({
    provider: provider.id,
    label: provider.label,
    connected: false,
    state: provider.enabled ? 'available' : provider.connectionMode === 'partner_api' ? 'partner_required' : 'planned',
    enabled: provider.enabled,
    providerAccountId: null,
    lastActivityAt: null,
    capabilities: provider.capabilities,
    note: provider.note,
  }));
}
