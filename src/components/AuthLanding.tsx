import { useCallback, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DueMark } from '@/components/DueMark';
import { ConnectWithStravaButton } from '@/components/ConnectWithStravaButton';
import { signInWithStrava, type StravaSignInResult } from '@/app-lib/auth';
import { useTheme, useThemedStyles } from '@/theme/ThemeProvider';
import { fontSizes, space, type Tokens } from '@/theme/tokens';

interface AuthLandingProps {
  onSignedIn?: () => void;
}

export function AuthLanding({ onSignedIn }: AuthLandingProps) {
  const C = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [busy, setBusy] = useState(false);

  const onPress = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await signInWithStrava();
      handleResult(result);
      if (result === 'signed_in') onSignedIn?.();
    } finally {
      setBusy(false);
    }
  }, [busy, onSignedIn]);

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <View style={styles.brand}>
            <DueMark size={112} color={C.yellow} />
          </View>

          <View style={styles.panel}>
            <ConnectWithStravaButton onPress={onPress} busy={busy} />
            <Text style={styles.legal}>You sign in to Due with your Strava account.</Text>
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

function handleResult(result: StravaSignInResult): void {
  if (result === 'signed_in' || result === 'cancelled' || result === 'dismissed') return;
  Alert.alert('Couldn’t sign in with Strava', result.message || 'Please try again.');
}

const makeStyles = (C: Tokens) => ({
  root: {
    flex: 1,
    backgroundColor: C.bg,
  },
  safe: {
    flex: 1,
  },
  center: {
    flex: 1,
    justifyContent: 'center' as const,
    paddingHorizontal: space.xl,
    paddingBottom: space.xxl,
  },
  brand: {
    alignItems: 'center' as const,
    marginBottom: space.xxl,
  },
  panel: {
    padding: space.m,
    alignItems: 'center' as const,
  },
  legal: {
    marginTop: space.lg,
    fontSize: fontSizes.metadata,
    lineHeight: 17,
    fontWeight: '500' as const,
    color: C.faint,
    textAlign: 'center' as const,
  },
});
