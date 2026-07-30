import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  loadNotificationPreferences,
  saveNotificationPreferences,
} from '../notificationPreferences';

beforeEach(async () => {
  await AsyncStorage.clear();
});

test('returns null before notification categories have been configured', async () => {
  await expect(loadNotificationPreferences()).resolves.toBeNull();
});

test('persists the run-ready category independently of system permission', async () => {
  await saveNotificationPreferences({ runReady: true });
  await expect(loadNotificationPreferences()).resolves.toEqual({ runReady: true });
});

test('repairs malformed category values to off', async () => {
  await AsyncStorage.setItem(
    'mileage.notificationPreferences',
    JSON.stringify({ runReady: 'yes' }),
  );
  await expect(loadNotificationPreferences()).resolves.toEqual({ runReady: false });
});

