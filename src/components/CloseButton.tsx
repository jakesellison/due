/**
 * CloseButton — the one dismiss-"X" for popup / modal / sheet headers, so the
 * glyph is CENTERED (an SF Symbol via RoundIconButton, not a text "×" that sits
 * off its baseline) and the button reads identically everywhere. Always
 * top-LEFT of the header by convention; pass `style` to position when needed.
 */
import { type StyleProp, type ViewStyle } from 'react-native';

import { RoundIconButton } from '@/components/RoundIconButton';

export function CloseButton({
  onPress,
  variant = 'flat',
  disabled = false,
  accessibilityLabel = 'Close',
  style,
}: {
  onPress: () => void;
  variant?: 'flat' | 'overlay';
  disabled?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <RoundIconButton
      icon="xmark"
      onPress={onPress}
      variant={variant}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel}
      style={style}
    />
  );
}
