import AsyncStorage from '@react-native-async-storage/async-storage';

export type NotificationPreferences = {
  /** Notify this device when a newly synced run is ready to review. */
  runReady: boolean;
};

const STORAGE_KEY = 'mileage.notificationPreferences';

export async function loadNotificationPreferences(): Promise<NotificationPreferences | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<NotificationPreferences>;
    return {
      runReady: value.runReady === true,
    };
  } catch {
    return null;
  }
}

export async function saveNotificationPreferences(
  preferences: NotificationPreferences,
): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
}

