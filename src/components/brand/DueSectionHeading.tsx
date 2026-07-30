import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { DueGlyphTile, type DueGlyphTone } from '@/components/brand/DueGlyphTile';
import type { DueGlyphName } from '@/components/brand/DueGlyph';
import { statValueText } from '@/components/ui/Stat';
import { useTheme, useThemedStyles } from '@/theme/ThemeProvider';
import { display, fontSizes, space, type Tokens } from '@/theme/tokens';

export function DueSectionHeading({
  title,
  meta,
  glyph,
  tone = 'neutral',
}: {
  title: string;
  meta?: string;
  glyph?: DueGlyphName;
  tone?: DueGlyphTone;
}) {
  const styles = useThemedStyles(makeStyles);
  const { fontScale } = useWindowDimensions();
  const accessible = fontScale >= 1.6;

  return (
    <View style={[styles.root, accessible && styles.rootAccessible]}>
      <View style={[styles.identity, accessible && styles.identityAccessible]}>
        {glyph ? <DueGlyphTile name={glyph} tone={tone} size={28} /> : null}
        <Text style={[styles.title, accessible && styles.titleAccessible]}>{title}</Text>
      </View>
      {meta ? <Text style={[styles.meta, accessible && styles.metaAccessible]}>{meta}</Text> : null}
    </View>
  );
}

const makeStyles = (C: Tokens) => StyleSheet.create({
  root: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
  rootAccessible: { flexDirection: 'column', alignItems: 'flex-start' },
  identity: { minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: space.m },
  identityAccessible: { alignItems: 'flex-start' },
  title: { flexShrink: 1, color: C.ink, fontFamily: display, fontSize: fontSizes.body, letterSpacing: -0.15 },
  titleAccessible: { fontSize: fontSizes.body },
  meta: { ...statValueText(C, 'micro'), color: C.mute },
  metaAccessible: { fontSize: fontSizes.micro },
});
