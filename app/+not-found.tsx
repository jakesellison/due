import { Link, Stack } from 'expo-router';
import { Text, View } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';
import { fontSizes, space } from '@/theme/tokens';

/**
 * Fallback for unmatched routes / stale deep links. Replaces expo-router's
 * default debug "Unmatched Route" screen with an on-brand screen and a way home.
 */
export default function NotFound() {
  const C = useTheme();
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View
        style={{
          flex: 1,
          backgroundColor: C.bg,
          alignItems: 'center',
          justifyContent: 'center',
          padding: space.xxl,
        }}
      >
        <Text style={{ fontSize: 22, fontWeight: '800', color: C.ink, marginBottom: space.m }}>
          Page not found
        </Text>
        <Text style={{ fontSize: fontSizes.body, color: C.mute, textAlign: 'center', marginBottom: space.xl, lineHeight: 21 }}>
          That link doesn’t lead anywhere in Due.
        </Text>
        <Link href="/" style={{ fontSize: fontSizes.body, fontWeight: '700', color: C.yellowText }}>
          Go to Dashboard
        </Link>
      </View>
    </>
  );
}
