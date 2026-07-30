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
