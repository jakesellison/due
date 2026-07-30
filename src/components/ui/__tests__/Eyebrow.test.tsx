/**
 * Eyebrow — the uppercase kicker. What is pinned here is what the 70
 * hand-rolled copies disagreed about: the default size, the single weight, the
 * single letter-spacing, and that colour is the ONE axis a call site may move.
 */
import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { Eyebrow, eyebrowText } from '@/components/ui/Eyebrow';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { fontSizes, THEMES } from '@/theme/tokens';

const C = THEMES.dark;

const renderDark = (node: React.ReactElement) =>
  render(<ThemeProvider preference="dark">{node}</ThemeProvider>);

const styleOf = (text: string) => StyleSheet.flatten(screen.getByText(text).props.style);

test('renders its label with the canonical eyebrow treatment', () => {
  renderDark(<Eyebrow>This week</Eyebrow>);

  const style = styleOf('This week');
  expect(style.textTransform).toBe('uppercase');
  expect(style.color).toBe(C.mute);
  expect(style.fontSize).toBe(fontSizes.labelSm);
  expect(style.fontWeight).toBe('700');
  expect(style.letterSpacing).toBe(0.5);
});

test('resolves each size to a fontSizes tier, never a bare number', () => {
  renderDark(
    <>
      <Eyebrow size="micro">Micro</Eyebrow>
      <Eyebrow size="labelSm">Small</Eyebrow>
      <Eyebrow size="metadata">Meta</Eyebrow>
    </>,
  );

  expect(styleOf('Micro').fontSize).toBe(fontSizes.micro);
  expect(styleOf('Small').fontSize).toBe(fontSizes.labelSm);
  expect(styleOf('Meta').fontSize).toBe(fontSizes.metadata);
});

test('takes an accent colour without giving up the rest of the treatment', () => {
  renderDark(<Eyebrow color={C.qualText}>Quality</Eyebrow>);

  const style = styleOf('Quality');
  expect(style.color).toBe(C.qualText);
  expect(style.textTransform).toBe('uppercase');
  expect(style.letterSpacing).toBe(0.5);
});

test('caps Dynamic Type growth so a one-word kicker cannot wrap to three lines', () => {
  renderDark(<Eyebrow>Completed</Eyebrow>);

  expect(screen.getByText('Completed').props.maxFontSizeMultiplier).toBe(2);
});

test('follows the theme rather than baking a colour in', () => {
  render(
    <ThemeProvider preference="light">
      <Eyebrow>Light</Eyebrow>
    </ThemeProvider>,
  );

  expect(styleOf('Light').color).toBe(THEMES.light.mute);
});

// ── the style factory: the StyleSheet.create half of the primitive ───────────

test('eyebrowText composes into a StyleSheet with the same treatment', () => {
  expect(eyebrowText(C)).toEqual({
    color: C.mute,
    fontSize: fontSizes.labelSm,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  });
  expect(eyebrowText(C, 'micro').fontSize).toBe(fontSizes.micro);
  expect(eyebrowText(THEMES.light).color).toBe(THEMES.light.mute);
});

test('eyebrowText reserves no margin — spacing belongs to the layout', () => {
  const style: Record<string, unknown> = eyebrowText(C);
  expect(style.marginBottom).toBeUndefined();
  expect(style.marginTop).toBeUndefined();
});
