import { ActivityIndicator, Image, Pressable, StyleSheet } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';

// Official Strava OAuth asset. The brand guidelines specify 48 px @1x /
// 96 px @2x and prohibit modifying the artwork.
const CONNECT_BUTTON = require('../../assets/brand/strava/btn_strava_connect_with_orange_x2.png');
const BUTTON_HEIGHT = 48;
const BUTTON_WIDTH = Math.round(BUTTON_HEIGHT * (474 / 96));

export function ConnectWithStravaButton({
  onPress,
  busy = false,
}: {
  onPress: () => void;
  busy?: boolean;
}) {
  const C = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Connect with Strava"
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.hitArea,
        pressed && !busy && styles.pressed,
        busy && styles.busy,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={C.ink} />
      ) : (
        <Image
          accessibilityIgnoresInvertColors
          source={CONNECT_BUTTON}
          style={styles.image}
          resizeMode="contain"
        />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hitArea: {
    minWidth: BUTTON_WIDTH,
    minHeight: 58,
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    width: BUTTON_WIDTH,
    height: BUTTON_HEIGHT,
  },
  pressed: { opacity: 0.86 },
  busy: { opacity: 0.7 },
});

