import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { SymbolView, type SFSymbol } from 'expo-symbols';

import type { DueGlyphName } from '@/components/brand/DueGlyph';
import { useTheme } from '@/theme/ThemeProvider';
import { alpha } from '@/theme/tokens';

export type DueGlyphTone = 'brand' | 'current' | 'easy' | 'long' | 'neutral' | 'positive' | 'quality' | 'warning';

/** A quiet rounded housing for the app's custom glyph vocabulary. */
export function DueGlyphTile({
  name,
  tone = 'neutral',
  overlay,
  size = 40,
  style,
  testID,
}: {
  name: DueGlyphName;
  tone?: DueGlyphTone;
  /** A secondary workout identity, drawn as a small unboxed corner mark. */
  overlay?: { name: DueGlyphName; tone: DueGlyphTone };
  size?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const C = useTheme();
  const colors = toneColors(C, tone);
  const radius = Math.max(7, Math.round(size * 0.23));

  return (
    <View
      testID={testID}
      style={[
        styles.root,
        {
          width: size,
          height: size,
          borderRadius: radius,
          backgroundColor: colors.fill,
          borderColor: colors.line,
        },
        style,
      ]}
    >
      <SymbolView
        name={SYMBOLS[name]}
        size={Math.round(size * 0.45)}
        tintColor={colors.ink}
        weight="semibold"
        resizeMode="scaleAspectFit"
      />
      {overlay ? (
        <SymbolView
          testID={testID ? `${testID}-overlay` : undefined}
          name={SYMBOLS[overlay.name]}
          size={Math.max(9, Math.round(size * 0.27))}
          tintColor={toneColors(C, overlay.tone).ink}
          weight="bold"
          resizeMode="scaleAspectFit"
          style={styles.overlay}
        />
      ) : null}
    </View>
  );
}

const SYMBOLS: Record<DueGlyphName, SFSymbol> = {
  base: 'square.grid.2x2',
  build: 'chart.line.uptrend.xyaxis',
  contract: 'checklist',
  easy: 'figure.run',
  history: 'clock.arrow.circlepath',
  intent: 'target',
  long: 'mountain.2.fill',
  mileage: 'chart.bar.xaxis',
  peak: 'flag.checkered',
  quality: 'bolt.fill',
  recovery: 'moon.zzz.fill',
  taper: 'chart.bar.xaxis.descending',
};

function toneColors(C: ReturnType<typeof useTheme>, tone: DueGlyphTone) {
  switch (tone) {
    case 'brand':
      return { fill: C.brand, line: C.brand, ink: C.brandInk };
    case 'current':
      return { fill: C.card, line: C.line, ink: C.ink };
    case 'quality':
      return { fill: alpha(C.qual, 0.14), line: alpha(C.qual, 0.25), ink: C.qualText };
    case 'easy':
      return { fill: alpha(C.easy, 0.13), line: alpha(C.easy, 0.25), ink: C.easyText };
    case 'long':
      return { fill: alpha(C.cyan, 0.12), line: alpha(C.cyan, 0.23), ink: C.cyanText };
    case 'positive':
      return { fill: alpha(C.positiveText, 0.12), line: alpha(C.positiveText, 0.22), ink: C.positiveText };
    case 'warning':
      return { fill: alpha(C.warningText, 0.12), line: alpha(C.warningText, 0.22), ink: C.warningText };
    case 'neutral':
    default:
      return { fill: C.fill, line: C.line, ink: C.mute };
  }
}

const styles = StyleSheet.create({
  root: {
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  overlay: {
    position: 'absolute',
    top: 3,
    right: 3,
  },
});
