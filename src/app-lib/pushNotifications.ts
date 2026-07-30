/**
 * pushNotifications.ts — client side of the "run banked" push.
 *
 * Registers this device's Expo push token into `push_tokens` (on opt-in) and
 * clears it (on opt-out). The token is minted by the Expo push service and needs
 * the EAS `projectId` (written to app.json `extra.eas.projectId` by `eas init`).
 *
 * IMPORTANT: expo-notifications is LAZY-loaded (require inside a guarded getter),
 * never a top-level import. Its module-load touches a native module
 * (ExpoPushTokenManager) that is absent until the dev client is rebuilt with the
 * config plugin — a static import would crash the whole app at launch on the old
 * build. Lazy + try/catch means every path no-ops gracefully until the rebuild,
 * and lights up automatically afterwards. Pushes also need a real device (the
 * iOS Simulator has no APNs).
 */
import { useEffect } from 'react';
import Constants from 'expo-constants';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { Alert, Linking, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { supabase } from './supabase';

// Type-only import — erased at compile, so it never triggers the native load.
import type { NotificationResponse, Subscription } from 'expo-notifications';

export type RegisterResult =
  | { ok: true }
  | { ok: false; reason: 'denied' | 'no-project-id' | 'token-failed' | 'db-failed' | 'unavailable' };

// Cached lazy handle to expo-notifications: undefined = not tried, null = absent.
// expo-notifications runs a native side-effect (device-token auto-registration)
// at MODULE LOAD that throws uncatchably when its native module is missing — so
// we probe for the native module FIRST (requireOptionalNativeModule returns null
// instead of throwing) and only require the JS module when it's really present.
let notifsModule: typeof import('expo-notifications') | null | undefined;
function notifs(): typeof import('expo-notifications') | null {
  if (notifsModule === undefined) {
    let nativePresent = false;
    try {
      nativePresent = requireOptionalNativeModule('ExpoPushTokenManager') != null;
    } catch {
      nativePresent = false;
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    notifsModule = nativePresent ? (require('expo-notifications') as typeof import('expo-notifications')) : null;
  }
  return notifsModule;
}

/** The EAS project id — written to app.json `extra.eas.projectId` by `eas init`
 *  (flows through app.config.js), or the EAS config resolved at build time. */
function easProjectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as
    | { eas?: { projectId?: string }; easProjectId?: string }
    | undefined;
  return extra?.eas?.projectId || extra?.easProjectId || Constants.easConfig?.projectId;
}

function devicePlatform(): 'ios' | 'android' {
  return Platform.OS === 'android' ? 'android' : 'ios';
}

async function currentToken(N: typeof import('expo-notifications'), projectId: string): Promise<string> {
  if (Platform.OS === 'android') {
    await N.setNotificationChannelAsync('default', {
      name: 'Run updates',
      importance: N.AndroidImportance.DEFAULT,
    });
  }
  return (await N.getExpoPushTokenAsync({ projectId })).data;
}

/**
 * Request permission (if needed), mint the Expo push token, and upsert it for
 * this user + device. Returns a typed result so the caller can surface a reason.
 */
export async function registerPush(userId: string): Promise<RegisterResult> {
  const N = notifs();
  if (!N) return { ok: false, reason: 'unavailable' };
  try {
    let status = (await N.getPermissionsAsync()).status;
    if (status !== 'granted') status = (await N.requestPermissionsAsync()).status;
    if (status !== 'granted') return { ok: false, reason: 'denied' };

    const projectId = easProjectId();
    if (!projectId) return { ok: false, reason: 'no-project-id' };

    const token = await currentToken(N, projectId);
    const { error } = await supabase
      .from('push_tokens')
      .upsert(
        { user_id: userId, token, platform: devicePlatform(), updated_at: new Date().toISOString() },
        { onConflict: 'user_id,token' },
      );
    return error ? { ok: false, reason: 'db-failed' } : { ok: true };
  } catch {
    return { ok: false, reason: 'token-failed' };
  }
}

/** Remove this device's token for the user (opt-out). Best-effort. */
export async function unregisterPush(userId: string): Promise<void> {
  const N = notifs();
  const projectId = easProjectId();
  if (!N || !projectId) return;
  try {
    const token = await currentToken(N, projectId);
    await supabase.from('push_tokens').delete().eq('user_id', userId).eq('token', token);
  } catch {
    // best-effort — nothing to surface on opt-out
  }
}

/** True once the OS notification permission is granted for this app. */
export async function pushPermissionGranted(): Promise<boolean> {
  const N = notifs();
  if (!N) return false;
  try {
    return (await N.getPermissionsAsync()).status === 'granted';
  } catch {
    return false;
  }
}

/**
 * One-time soft prompt after the user connects Strava (the moment runs start
 * syncing). Asks ONCE per user — a soft dialog first so a decline doesn't burn
 * the OS permission. If already granted, just registers silently.
 */
export async function promptPushAfterConnect(userId: string): Promise<void> {
  if (!notifs()) return;
  const key = `push-prompted-${userId}`;
  if (await AsyncStorage.getItem(key)) return;
  await AsyncStorage.setItem(key, '1');

  if (await pushPermissionGranted()) {
    void registerPush(userId);
    return;
  }
  Alert.alert('Get run updates?', 'Due can notify you when a run syncs, with a tap through to see it.', [
    { text: 'Not now', style: 'cancel' },
    { text: 'Enable', onPress: () => void registerPush(userId) },
  ]);
}

/** The app's own scheme. A notification may only ever open a link into Due. */
const APP_SCHEME = 'duerunning://';

/**
 * Open the deep link a notification carried (data.url = duerunning://run/<id>).
 *
 * The payload is NOT trusted. Expo push tokens are bearer credentials: anyone
 * holding an ExponentPushToken can send arbitrary title/body/data through
 * Expo's public push API without our project credentials (enhanced push
 * security is not enabled — `src/server/push.ts` posts with no Authorization
 * header). An unvalidated `url` therefore let a leaked token turn a tap into
 * "open any URL the OS resolves" — an https:// phishing page or another app's
 * scheme, dressed up as a Due notification. Only our own scheme is honoured.
 */
function routeFromResponse(response: NotificationResponse | null): void {
  const data = response?.notification?.request?.content?.data as { url?: string } | undefined;
  const url = data?.url;
  if (typeof url !== 'string' || !url.startsWith(APP_SCHEME)) return;
  Linking.openURL(url).catch(() => {});
}

/**
 * Wire notification taps to navigation: a foreground presentation handler, a
 * cold-start check (app opened FROM a notification), and a live tap listener.
 * Deep links route through expo-router (+native-intent). No-ops until the
 * expo-notifications native module is present (dev-client rebuild).
 */
export function usePushNotificationTaps(): void {
  useEffect(() => {
    const N = notifs();
    if (!N) return;
    let sub: Subscription | undefined;
    try {
      N.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: true,
          shouldSetBadge: false,
        }),
      });
      N.getLastNotificationResponseAsync().then(routeFromResponse).catch(() => {});
      sub = N.addNotificationResponseReceivedListener(routeFromResponse);
    } catch {
      // native module absent — no-op
    }
    return () => sub?.remove();
  }, []);
}
