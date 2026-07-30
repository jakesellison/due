import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  DEFAULT_APP_PREFERENCES,
  loadAppPreferences,
  saveAppPreferences,
} from '@/app-lib/preferences';

beforeEach(async () => {
  await AsyncStorage.clear();
});

test('loads device-friendly defaults when no preferences are stored', async () => {
  await expect(loadAppPreferences()).resolves.toEqual(DEFAULT_APP_PREFERENCES);
});

test('persists and restores user preferences', async () => {
  const preferences = {
    distance: 'km' as const,
    temperature: 'celsius' as const,
  };

  await saveAppPreferences(preferences);

  await expect(loadAppPreferences()).resolves.toEqual(preferences);
});

test('repairs invalid stored values independently', async () => {
  await AsyncStorage.setItem(
    'mileage.appPreferences',
    JSON.stringify({ distance: 'yards', temperature: 'celsius', weekStart: 'sun' }),
  );

  await expect(loadAppPreferences()).resolves.toEqual({
    distance: 'mi',
    temperature: 'celsius',
  });
});
