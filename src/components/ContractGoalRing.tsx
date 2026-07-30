/** A compact supporting-contract ring shared by Week and Progress. */
import { StyleSheet, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import Svg, { Circle } from 'react-native-svg';

import { useTheme } from '@/theme/ThemeProvider';

function clampFraction(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

export function ContractGoalRing({
  id,
  fraction,
  color,
  complete,
  size = 18,
  strokeWidth = 2.25,
}: {
  id: string;
  fraction: number;
  color: string;
  complete?: boolean;
  size?: number;
  strokeWidth?: number;
}) {
  const C = useTheme();
  const shownFraction = clampFraction(fraction);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const isComplete = complete ?? shownFraction >= 0.999;

  return (
    <View
      testID={`${id}-progress`}
      style={[styles.ring, { width: size, height: size }]}
      accessible={false}
      importantForAccessibility="no"
    >
      <Svg width={size} height={size}>
        {isComplete ? (
          <Circle
            testID={`${id}-complete-fill`}
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill={color}
          />
        ) : (
          <>
            <Circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={color}
              strokeWidth={strokeWidth}
              opacity={0.2}
            />
            {shownFraction > 0.01 ? (
              <Circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={color}
                strokeWidth={strokeWidth}
                strokeLinecap="round"
                strokeDasharray={`${circumference} ${circumference}`}
                strokeDashoffset={circumference * (1 - shownFraction)}
                rotation={-90}
                origin={`${size / 2}, ${size / 2}`}
              />
            ) : null}
          </>
        )}
      </Svg>
      {isComplete ? (
        <View testID={`${id}-complete`} pointerEvents="none" style={styles.check}>
          <SymbolView
            name="checkmark"
            size={Math.max(7, size * 0.44)}
            tintColor={C.bg}
            weight="bold"
            resizeMode="scaleAspectFit"
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  ring: { alignItems: 'center', justifyContent: 'center' },
  check: {
    position: 'absolute',
    inset: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
