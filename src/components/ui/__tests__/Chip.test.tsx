/**
 * Chip — the pill badge. The point of the tone table is that every accented
 * wash is DERIVED from the token that colours its label, so the tests assert
 * `alpha(token, …)` rather than a literal — a hand-mixed `rgba(240,136,62,0.16)`
 * (which is what `app/realign.tsx` actually carried) would pass a literal
 * comparison and still be wrong.
 */
import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { Chip } from '@/components/ui/Chip';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { alpha, fontSizes, radius, THEMES } from '@/theme/tokens';

const C = THEMES.dark;

const renderDark = (node: React.ReactElement) =>
  render(<ThemeProvider preference="dark">{node}</ThemeProvider>);

const chipStyle = (id: string) =>
  StyleSheet.flatten(screen.getByTestId(id, { includeHiddenElements: true }).props.style);
const labelStyle = (text: string) => StyleSheet.flatten(screen.getByText(text).props.style);

test('renders a pill carrying its label', () => {
  renderDark(<Chip label="Threshold" testID="chip" />);

  expect(screen.getByText('Threshold')).toBeTruthy();
  expect(chipStyle('chip').borderRadius).toBe(radius.pill);
});

test('the neutral tone is the plain control fill, adding no meaning', () => {
  renderDark(<Chip label="Threshold" testID="chip" />);

  expect(chipStyle('chip').backgroundColor).toBe(C.fill);
  expect(labelStyle('Threshold').color).toBe(C.mute);
});

test('every accented tone is an alpha wash of the token that colours its label', () => {
  renderDark(
    <>
      <Chip label="Quality" tone="quality" testID="quality" />
      <Chip label="Long" tone="long" testID="long" />
      <Chip label="Deficit" tone="warning" testID="warning" />
      <Chip label="Met" tone="positive" testID="positive" />
      <Chip label="Missed" tone="danger" testID="danger" />
      <Chip label="Due" tone="accent" testID="accent" />
      <Chip label="Easy" tone="easy" testID="easy" />
    </>,
  );

  expect(chipStyle('quality').backgroundColor).toBe(alpha(C.qual, 0.14));
  expect(labelStyle('Quality').color).toBe(C.qualText);

  expect(chipStyle('long').backgroundColor).toBe(alpha(C.cyan, 0.14));
  expect(labelStyle('Long').color).toBe(C.cyanText);

  expect(chipStyle('warning').backgroundColor).toBe(alpha(C.warningText, 0.14));
  expect(labelStyle('Deficit').color).toBe(C.warningText);

  expect(chipStyle('positive').backgroundColor).toBe(alpha(C.positiveText, 0.14));
  expect(labelStyle('Met').color).toBe(C.positiveText);

  expect(chipStyle('danger').backgroundColor).toBe(alpha(C.dangerText, 0.14));
  expect(labelStyle('Missed').color).toBe(C.dangerText);

  expect(chipStyle('accent').backgroundColor).toBe(alpha(C.yellow, 0.14));
  expect(labelStyle('Due').color).toBe(C.yellowText);

  expect(chipStyle('easy').backgroundColor).toBe(alpha(C.easy, 0.14));
  expect(labelStyle('Easy').color).toBe(C.easyText);
});

test('no tone invents a colour outside the palette', () => {
  const palette = new Set<string>(Object.values(C));
  const derived = new Set<string>([...palette].map((token) => alpha(token, 0.14)));
  const tones = ['neutral', 'outline', 'accent', 'quality', 'long', 'easy', 'positive', 'warning', 'danger'] as const;

  renderDark(
    <>
      {tones.map((tone) => (
        <Chip key={tone} label={tone} tone={tone} testID={tone} />
      ))}
    </>,
  );

  for (const tone of tones) {
    const bg = chipStyle(tone).backgroundColor as string;
    expect(palette.has(bg) || derived.has(bg)).toBe(true);
    expect(palette.has(labelStyle(tone).color as string)).toBe(true);
  }
});

test('the outline tone takes a hairline edge instead of a wash', () => {
  renderDark(<Chip label="Manual" tone="outline" testID="chip" />);

  const style = chipStyle('chip');
  expect(style.backgroundColor).toBe(C.panel);
  expect(style.borderWidth).toBe(StyleSheet.hairlineWidth);
  expect(style.borderColor).toBe(C.line);
});

test('sizes resolve to fontSizes tiers and the roomy pill grows with them', () => {
  renderDark(
    <>
      <Chip label="Micro" testID="micro" />
      <Chip label="Small" size="labelSm" testID="small" />
    </>,
  );

  expect(labelStyle('Micro').fontSize).toBe(fontSizes.micro);
  expect(labelStyle('Small').fontSize).toBe(fontSizes.labelSm);
  expect(chipStyle('micro').minHeight).toBe(18);
  expect(chipStyle('small').minHeight).toBe(22);
});

test('uppercases by default and stands down for a formatted value', () => {
  renderDark(
    <>
      <Chip label="Threshold" testID="tag" />
      <Chip label="7:42/mi" uppercase={false} testID="value" />
    </>,
  );

  expect(labelStyle('Threshold').textTransform).toBe('uppercase');
  expect(labelStyle('7:42/mi').textTransform).toBeUndefined();
  // Tracking rides with the uppercasing — lowercase text at 0.3 just looks loose.
  expect(labelStyle('7:42/mi').letterSpacing).toBeUndefined();
});

test('follows the theme rather than baking a wash in', () => {
  render(
    <ThemeProvider preference="light">
      <Chip label="Quality" tone="quality" testID="chip" />
    </ThemeProvider>,
  );

  expect(chipStyle('chip').backgroundColor).toBe(alpha(THEMES.light.qual, 0.14));
  expect(labelStyle('Quality').color).toBe(THEMES.light.qualText);
});
