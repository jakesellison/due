/**
 * Root layout — Phase 0 skeleton. The full theme system arrives in Phase 3;
 * until then the app boots to the brand ink ground so a loaded bundle is
 * visibly OURS (near-black, not Expo white).
 */
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#0F0F12' } }} />
    </>
  );
}
