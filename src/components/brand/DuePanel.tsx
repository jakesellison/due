import {
  StyleSheet,
  View,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';
import { radius } from '@/theme/tokens';

/** The standard matte card used by the Week, Plan, and Progress surfaces. */
export function DuePanel({
  children,
  contentStyle,
  fillColor,
  lineColor,
  style,
  ...rest
}: ViewProps & {
  contentStyle?: StyleProp<ViewStyle>;
  fillColor?: string;
  lineColor?: string;
}) {
  const C = useTheme();

  return (
    <View
      {...rest}
      style={[
        styles.root,
        { backgroundColor: fillColor ?? C.card, borderColor: lineColor ?? C.line },
        style,
      ]}
    >
      <View style={contentStyle}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'relative',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
  },
});
