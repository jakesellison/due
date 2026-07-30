import { Tabs } from 'expo-router';
import { usePathname } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';

import { useSession } from '@/app-lib/auth';
import { useAutoStravaSync } from '@/app-lib/autoStravaSync';
import { AuthLanding } from '@/components/AuthLanding';
import { GlassTabBar } from '@/components/GlassTabBar';
import { useTheme, useThemedStyles } from '@/theme/ThemeProvider';
import { fontSizes, radius, space, type Tokens } from '@/theme/tokens';

// Make Week (index) the initial route for this tab group regardless of file
// ordering (expo-router reads this to seed the navigator's initial state).
export const unstable_settings = {
  initialRouteName: 'index',
};

/**
 * The three-tab shell. Week owns the current contract, Plan owns the active
 * training block, and You owns the runner's durable library and setup.
 */
export default function TabsLayout() {
  return <TabsGate />;
}

function TabsGate() {
  const { ready, userId, profile, error, retry } = useSession();
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const signedIn = profile?.isAnonymous === false && !!profile.email;
  const C = useTheme();
  const styles = useThemedStyles(makeStyles);

  useAutoStravaSync(ready && !!userId && signedIn, queryClient, pathname);

  if (!ready) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={C.mute} />
      </View>
    );
  }

  // ensureSession() threw — show a retry screen rather than the empty Tabs shell.
  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>Couldn’t start your session</Text>
        <Text style={styles.errorBody}>{error.message}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Try again"
          onPress={retry}
          style={({ pressed }) => [styles.retryBtn, pressed && styles.retryPressed]}
        >
          <Text style={styles.retryText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  // Session-first: no session id at all → login gate (e.g. after sign-out).
  if (!userId) {
    return <AuthLanding />;
  }

  // A session exists but it's an anonymous one → still the login gate.
  if (profile?.isAnonymous === true) {
    return <AuthLanding />;
  }

  return (
    <Tabs
      initialRouteName="index"
      tabBar={(props) => <GlassTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: C.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Week' }} />
      <Tabs.Screen name="plan" options={{ title: 'Plan' }} />
      <Tabs.Screen name="you" options={{ title: 'You' }} />
    </Tabs>
  );
}

const makeStyles = (C: Tokens) => StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
    backgroundColor: C.bg,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: C.ink,
    marginBottom: space.sm,
    textAlign: 'center',
  },
  errorBody: {
    fontSize: fontSizes.body,
    color: C.mute,
    textAlign: 'center',
    marginBottom: space.lg,
  },
  retryBtn: {
    backgroundColor: C.yellow,
    borderRadius: radius.pill,
    paddingHorizontal: 20,
    paddingVertical: space.md,
  },
  retryPressed: { opacity: 0.85 },
  retryText: { fontSize: fontSizes.body, fontWeight: '800', color: C.accentInk },
});
