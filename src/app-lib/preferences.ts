import { useCallback, useEffect, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type DistancePreference = 'mi' | 'km';
export type TemperaturePreference = 'fahrenheit' | 'celsius';

export interface AppPreferences {
  distance: DistancePreference;
  temperature: TemperaturePreference;
}

const STORE_KEY = 'mileage.appPreferences';

export const DEFAULT_APP_PREFERENCES: AppPreferences = {
  distance: 'mi',
  temperature: 'fahrenheit',
};

function isDistance(value: unknown): value is DistancePreference {
  return value === 'mi' || value === 'km';
}

function isTemperature(value: unknown): value is TemperaturePreference {
  return value === 'fahrenheit' || value === 'celsius';
}

export async function loadAppPreferences(): Promise<AppPreferences> {
  try {
    const stored = await AsyncStorage.getItem(STORE_KEY);
    if (!stored) return DEFAULT_APP_PREFERENCES;
    const value = JSON.parse(stored) as Partial<AppPreferences>;
    return {
      distance: isDistance(value.distance) ? value.distance : DEFAULT_APP_PREFERENCES.distance,
      temperature: isTemperature(value.temperature)
        ? value.temperature
        : DEFAULT_APP_PREFERENCES.temperature,
    };
  } catch {
    return DEFAULT_APP_PREFERENCES;
  }
}

export async function saveAppPreferences(preferences: AppPreferences): Promise<void> {
  await AsyncStorage.setItem(STORE_KEY, JSON.stringify(preferences));
}

type Listener = () => void;

let snapshot = DEFAULT_APP_PREFERENCES;
let loadStarted = false;
let editVersion = 0;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function ensurePreferencesLoaded(): void {
  if (loadStarted) return;
  loadStarted = true;
  const versionAtLoad = editVersion;
  loadAppPreferences()
    .then((stored) => {
      // A tap made while storage was loading is newer than the stored value.
      if (versionAtLoad !== editVersion) return;
      snapshot = stored;
      emit();
    })
    .catch(() => undefined);
}

export function useAppPreferences(): {
  preferences: AppPreferences;
  setPreference: <K extends keyof AppPreferences>(key: K, value: AppPreferences[K]) => void;
} {
  useEffect(() => {
    ensurePreferencesLoaded();
  }, []);
  const preferences = useSyncExternalStore(subscribe, () => snapshot, () => snapshot);

  const setPreference = useCallback(
    <K extends keyof AppPreferences>(key: K, value: AppPreferences[K]) => {
      if (snapshot[key] === value) return;
      editVersion += 1;
      snapshot = { ...snapshot, [key]: value };
      emit();
      saveAppPreferences(snapshot).catch(() => undefined);
    },
    [],
  );

  return { preferences, setPreference };
}

/** Reset the module store between isolated Jest cases. Production callers
 * should never need this; the singleton is what makes a preference update
 * propagate across every mounted tab without an app restart. */
export function resetAppPreferencesForTests(): void {
  snapshot = DEFAULT_APP_PREFERENCES;
  loadStarted = false;
  editVersion = 0;
  emit();
}
