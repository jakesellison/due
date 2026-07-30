import { Pressable, type StyleProp, type ViewStyle } from 'react-native';
import { useRouter } from 'expo-router';

import { useSession } from '@/app-lib/auth';

import { UserAvatar } from './UserAvatar';

/**
 * The persistent top-right profile button. Lives in every tab header (via the
 * shared Screen, plus the Dash and Routes headers) and opens the You account hub.
 */
export function HeaderAvatar({ size = 34, style }: { size?: number; style?: StyleProp<ViewStyle> }) {
  const router = useRouter();
  const { profile } = useSession();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Profile and settings"
      onPress={() => router.push('/you')}
      style={({ pressed }) => [TARGET_STYLE, style, pressed ? { opacity: 0.8 } : null]}
    >
      <UserAvatar profile={profile} size={size} />
    </Pressable>
  );
}

const TARGET_STYLE = {
  minWidth: 44,
  minHeight: 44,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
};
