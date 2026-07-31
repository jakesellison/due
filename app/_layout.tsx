import { useCallback, useEffect } from 'react';
import { LogBox, useColorScheme } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts, SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk';
import { SpaceMono_400Regular, SpaceMono_700Bold } from '@expo-google-fonts/space-mono';
import * as SplashScreen from 'expo-splash-screen';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppErrorBoundary } from '@/components/AppErrorBoundary';
import { ShareIntentGate } from '@/components/ShareIntentGate';
import { SessionProvider } from '@/app-lib/auth';
import { initSentry } from '@/app-lib/sentry';
import { usePushNotificationTaps } from '@/app-lib/pushNotifications';
import { ThemeProvider, useTheme, useScheme } from '@/theme/ThemeProvider';
import { sheetPresentation, THEMES } from '@/theme/tokens';

// A single shared QueryClient for the whole app.
const queryClient = new QueryClient();

// Crash/error reporting (audit-ops B3). No-op if `EXPO_PUBLIC_SENTRY_DSN`
// isn't configured or the native module isn't present in this build — see
// `src/app-lib/sentry.ts` for the defensive-init rationale.
initSentry();

// Silence the in-app LogBox overlay (dev-only; no-op in production). It otherwise
// floats over the bottom of every screen and obscures the tab bar during review.
LogBox.ignoreAllLogs();

// Hold the one native logo splash until the app fonts are ready. Errors are
// swallowed — if the splash module is unavailable we still render once font
// loading resolves instead of wedging startup.
SplashScreen.preventAutoHideAsync().catch(() => undefined);

/**
 * Root layout: wraps everything in the gesture root, SafeAreaProvider and the
 * react-query provider, and applies the light theme background. The dev session
 * is ensured inside the tab layout (so a screen is mounted to read it), not
 * here, to keep this file purely structural.
 */
export default function RootLayout() {
  // Brand faces: Space Grotesk (wordmark) + Space Mono (every data numeral —
  // the Liquid Glass v2.1 "data uniform"). `fontError` lets us proceed even if
  // an asset fails so the app is never wedged on the splash; text then falls
  // back to SF.
  const [fontsLoaded, fontError] = useFonts({
    SpaceGrotesk_700Bold,
    SpaceMono_400Regular,
    SpaceMono_700Bold,
  });
  const ready = fontsLoaded || !!fontError;
  const os = useColorScheme();

  // Route notification taps (foreground + cold start) into the run detail.
  usePushNotificationTaps();

  // Hide the splash once we're ready to paint the real UI (font in hand).
  const onLayout = useCallback(() => {
    if (ready) SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);

  // Belt-and-suspenders: also hide on the ready transition (onLayout may have
  // already fired before fonts resolved).
  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);

  // Keep the splash up (render nothing) until the font is resolved — no flash.
  if (!ready) return null;

  // The gesture root sits OUTSIDE the ThemeProvider, so it picks the structural
  // bg straight from the OS scheme (matches the resolved theme; brief flash-safe).
  const rootBg = THEMES[os === 'light' ? 'light' : 'dark'].bg;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: rootBg }} onLayout={onLayout}>
      <QueryClientProvider client={queryClient}>
        {/* Session state lives above the router so a newly-presented screen
            receives the resolved user on its first frame instead of booting a
            second auth request during the native transition. */}
        <SessionProvider>
          <SafeAreaProvider>
            {/* Uncontrolled: the provider loads the persisted preference
                (default 'system') and the You/Settings screen edits it. */}
            <ThemeProvider>
              <AppErrorBoundary>
                <ThemedStack />
              </AppErrorBoundary>
              <ShareIntentGate />
            </ThemeProvider>
          </SafeAreaProvider>
        </SessionProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

/** The navigation stack, themed from the active tokens (status bar + every
 *  screen's content background follow light/dark). */
function ThemedStack() {
  const C = useTheme();
  const scheme = useScheme();
  const content = { backgroundColor: C.bg };
  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: content }}>
        <Stack.Screen name="(tabs)" />
        {/* Session details are hierarchical destinations. Keeping them as cards
            lets a week sheet own the one modal task instead of stacking another
            dismissable surface on top of it. */}
        <Stack.Screen name="workout/[id]" options={{ presentation: 'card', contentStyle: content }} />
        <Stack.Screen
          name="week/[id]"
          options={{
            presentation: 'formSheet',
            sheetAllowedDetents: [sheetPresentation.compact, sheetPresentation.detail],
            sheetInitialDetentIndex: 0,
            sheetGrabberVisible: true,
            sheetExpandsWhenScrolledToEdge: true,
            sheetCornerRadius: sheetPresentation.cornerRadius,
            contentStyle: content,
          }}
        />
        <Stack.Screen name="run/[id]" options={{ presentation: 'card', contentStyle: content }} />
        {/* ONE registration for the whole Plans task: `app/plans/_layout.tsx`
            owns the stack inside this modal. Registering its screens flat here
            instead put every push (import, plan detail, starter preview) onto
            the stack BEHIND the presented modal, so tapping a tile did
            nothing. See that layout for the full note. */}
        <Stack.Screen name="plans" options={{ presentation: 'modal', contentStyle: content }} />
        <Stack.Screen name="routes/index" options={{ contentStyle: content }} />
        {/* Route selection and viewing stay in the caller's navigation stack.
            Only the unsaved, map-first builder is a modal task. */}
        <Stack.Screen name="routes/select" options={{ presentation: 'card', contentStyle: content }} />
        <Stack.Screen name="routes/[id]" options={{ presentation: 'card', contentStyle: content }} />
        <Stack.Screen name="routes/new" options={{ presentation: 'fullScreenModal', contentStyle: content }} />
        <Stack.Screen name="shoes/new" options={{ presentation: 'modal', contentStyle: content }} />
        <Stack.Screen name="shoes/[id]" options={{ presentation: 'modal', contentStyle: content }} />
        <Stack.Screen name="notifications" options={{ presentation: 'card', contentStyle: content }} />
        <Stack.Screen name="connections/strava" options={{ presentation: 'card', contentStyle: content }} />
        <Stack.Screen name="plan/history" options={{ presentation: 'modal', contentStyle: content }} />
        <Stack.Screen name="planner/[id]" options={{ presentation: 'fullScreenModal', contentStyle: content }} />
        <Stack.Screen
          name="week-calendar"
          options={{
            // A navigation utility, not a second dashboard mode: choose a date,
            // dismiss, and return to that date's weekly contract.
            presentation: 'formSheet',
            sheetAllowedDetents: [sheetPresentation.compact, sheetPresentation.detail],
            sheetInitialDetentIndex: 0,
            sheetGrabberVisible: true,
            sheetCornerRadius: sheetPresentation.cornerRadius,
            contentStyle: content,
          }}
        />
      </Stack>
    </>
  );
}
