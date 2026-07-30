import { StyleSheet, View, Text, type ViewProps } from 'react-native';
import type { ReactNode } from 'react';
import { SymbolView } from 'expo-symbols';
import { eyebrowText } from '@/components/ui/Eyebrow';
import { useTheme, useThemedStyles } from '@/theme/ThemeProvider';
import { radius, space, type Tokens } from '@/theme/tokens';

/**
 * Card / Section — the app's content-container vocabulary (the run-detail look):
 * a rounded surface on the page bg with a hairline border. `Section` adds the
 * uppercase eyebrow (SF Symbol + label) header. Both are themed at runtime.
 *
 * A Card owns its INTERIOR only. It deliberately carries no outer margin: a
 * container that reserves space below itself fights every parent that already
 * sets `gap`, and it was the single thing blocking adoption — 41 screens hand-
 * rolled this exact surface rather than inherit a margin they did not want.
 * Pass `style` for spacing when a parent has no gap of its own.
 */
export function Card({ style, children, ...rest }: ViewProps & { children: ReactNode }) {
  const styles = useThemedStyles(makeStyles);
  return <View style={[styles.card, style]} {...rest}>{children}</View>;
}

export function Section({ title, icon, right, children }: {
  title: string; icon?: string; right?: ReactNode; children: ReactNode;
}) {
  const styles = useThemedStyles(makeStyles);
  const C = useTheme();
  return (
    <Card>
      <View style={styles.head}>
        {icon ? <SymbolView name={icon as never} size={13} tintColor={C.mute} resizeMode="scaleAspectFit" /> : null}
        <Text style={styles.headLab}>{title}</Text>
        {right ? <><View style={{ flex: 1 }} />{right}</> : null}
      </View>
      {children}
    </Card>
  );
}

/**
 * The card SURFACE as a spreadable style — the same rounded, hairline-bordered
 * `C.card` plane the `Card` component draws.
 *
 * Exists because most of this codebase composes surfaces inside
 * `StyleSheet.create` rather than by wrapping JSX, so a component alone could
 * never be the single definition. Spread this when a style object needs the
 * card plane plus its own geometry:
 *
 *     plannedCard: { ...cardSurface(C), marginTop: space.xl },
 *
 * NOT for the selected state of a control. Several places use `C.card` as a
 * raised fill on a segmented button or toggle; that is the same colour doing a
 * different job, and it is not a card.
 */
export const cardSurface = (C: Tokens) =>
  ({
    backgroundColor: C.card,
    borderColor: C.line,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: space.lg,
  }) as const;

const makeStyles = (C: Tokens) => StyleSheet.create({
  card: cardSurface(C),
  head: { flexDirection: 'row', alignItems: 'center', gap: space.s, marginBottom: space.md },
  headLab: eyebrowText(C, 'metadata'),
});
