export type SyncProviderId = 'strava' | 'garmin' | 'coros' | 'healthkit';

export type SyncConnectionMode = 'oauth' | 'partner_api' | 'device_local';

export interface SyncProviderCapabilities {
  activityImport: boolean;
  workoutExport: boolean;
  routeExport: boolean;
}

export interface SyncProviderDefinition {
  id: SyncProviderId;
  label: string;
  connectionMode: SyncConnectionMode;
  capabilities: SyncProviderCapabilities;
  enabled: boolean;
  note: string;
}

export const SYNC_PROVIDERS: SyncProviderDefinition[] = [
  {
    id: 'garmin',
    label: 'Garmin',
    connectionMode: 'partner_api',
    capabilities: { activityImport: true, workoutExport: true, routeExport: true },
    enabled: false,
    note: 'Direct activity sync and workout push need Garmin partner API access.',
  },
  {
    id: 'coros',
    label: 'COROS',
    connectionMode: 'partner_api',
    capabilities: { activityImport: true, workoutExport: true, routeExport: false },
    enabled: false,
    note: 'Direct activity sync and workout push need COROS partner API access.',
  },
  {
    id: 'strava',
    label: 'Strava',
    connectionMode: 'oauth',
    capabilities: { activityImport: true, workoutExport: false, routeExport: false },
    enabled: true,
    note: 'Optional activity import fallback.',
  },
  {
    id: 'healthkit',
    label: 'Apple Health',
    connectionMode: 'device_local',
    capabilities: { activityImport: true, workoutExport: false, routeExport: false },
    enabled: false,
    note: 'Local device import candidate.',
  },
];


