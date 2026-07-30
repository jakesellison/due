import { Image, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { SymbolView } from 'expo-symbols';

import type { UserProfile } from '@/app-lib/auth';
import { useTheme, useThemedStyles } from '@/theme/ThemeProvider';
import type { Tokens } from '@/theme/tokens';

/**
 * Initials for the no-photo avatar: first letters of the first and last words
 * of the display name ("Jacob Ellison" → "JE"), else the first letter of the
 * email local part. Null when neither exists (caller shows the person glyph).
 */
export function avatarInitials(profile: UserProfile | null): string | null {
  const name = profile?.displayName?.trim();
  if (name) {
    const words = name.split(/\s+/);
    const first = words[0]?.[0] ?? '';
    const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : '';
    return (first + last).toUpperCase() || null;
  }
  const email = profile?.email?.trim();
  if (email) return email[0]!.toUpperCase();
  return null;
}

export function UserAvatar({
  profile,
  size = 34,
  style,
}: {
  profile: UserProfile | null;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const radius = size / 2;
  const initials = avatarInitials(profile);
  const C = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: radius }, style]}>
      {profile?.avatarUrl ? (
        <Image
          accessibilityIgnoresInvertColors
          source={{ uri: profile.avatarUrl }}
          resizeMode="cover"
          style={{ width: size, height: size, borderRadius: radius }}
        />
      ) : initials ? (
        <Text
          allowFontScaling={false}
          style={[styles.initials, { fontSize: Math.round(size * 0.38) }]}
        >
          {initials}
        </Text>
      ) : (
        <SymbolView
          name="person.fill"
          size={Math.round(size * 0.55)}
          tintColor={C.mute}
          resizeMode="scaleAspectFit"
        />
      )}
    </View>
  );
}

const makeStyles = (C: Tokens) =>
  StyleSheet.create({
    avatar: {
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      backgroundColor: C.fill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: C.line,
    },
    initials: {
      color: C.ink,
      fontWeight: '800',
      letterSpacing: 0.5,
      fontVariant: ['tabular-nums'],
    },
  });
