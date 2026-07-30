/**
 * Stat — a numeral with its key. The contract worth pinning is the one the 187
 * hand-rolled sites kept having to remember: tabular figures and the mono data
 * face on the value, and an Eyebrow (not a second uppercase dialect) on the
 * label.
 */
import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { Stat, statValueText } from '@/components/ui/Stat';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { data, fontSizes, THEMES } from '@/theme/tokens';

const C = THEMES.dark;

const renderDark = (node: React.ReactElement) =>
  render(<ThemeProvider preference="dark">{node}</ThemeProvider>);

const styleOf = (text: string) => StyleSheet.flatten(screen.getByText(text).props.style);

test('renders the value, its key, and its unit', () => {
  renderDark(<Stat value="76" label="Mi/wk avg" unit="mi" />);

  expect(screen.getByText('76')).toBeTruthy();
  expect(screen.getByText('Mi/wk avg')).toBeTruthy();
  expect(screen.getByText('mi')).toBeTruthy();
});

test('accepts a number as readily as a preformatted string', () => {
  renderDark(<Stat value={23} label="Weeks" />);

  expect(screen.getByText('23')).toBeTruthy();
});

test('puts the value on the mono data face with tabular figures', () => {
  renderDark(<Stat value="4 of 5" label="Completed" />);

  const style = styleOf('4 of 5');
  expect(style.fontFamily).toBe(data);
  expect(style.fontVariant).toEqual(['tabular-nums']);
  expect(style.color).toBe(C.ink);
  // The face is the weight; a fontWeight beside a single-weight family is
  // either ignored or synthesised into a fake bold.
  expect(style.fontWeight).toBeUndefined();
});

test('maps each size onto a fontSizes tier', () => {
  renderDark(
    <>
      <Stat value="11" size="sm" />
      <Stat value="22" size="md" />
      <Stat value="33" size="lg" />
      <Stat value="44" size="xl" />
    </>,
  );

  expect(styleOf('11').fontSize).toBe(fontSizes.metadata);
  expect(styleOf('22').fontSize).toBe(fontSizes.body);
  expect(styleOf('33').fontSize).toBe(fontSizes.sectionTitle);
  expect(styleOf('44').fontSize).toBe(fontSizes.sheetTitle);
});

test('renders the key as an eyebrow, not a second uppercase dialect', () => {
  renderDark(<Stat value="42.0" label="Banked" size="lg" />);

  const style = styleOf('Banked');
  expect(style.textTransform).toBe('uppercase');
  expect(style.letterSpacing).toBe(0.5);
  expect(style.color).toBe(C.mute);
});

test('takes a semantic value colour when the number itself carries state', () => {
  renderDark(<Stat value="-4.2" label="Deficit" valueColor={C.warningText} labelColor={C.warningText} />);

  expect(styleOf('-4.2').color).toBe(C.warningText);
  expect(styleOf('Deficit').color).toBe(C.warningText);
});

test('reads as one VoiceOver stop, key then value then unit', () => {
  renderDark(<Stat value="4 of 5" label="Completed" testID="completed" />);

  expect(screen.getByTestId('completed').props.accessibilityLabel).toBe('Completed 4 of 5');
});

// ── label placement: the session-table shape reads key-first ─────────────────

/** The rendered text nodes, in tree order. */
const readingOrder = () => screen.getAllByText(/\S/).map((node) => node.props.children);

test('places the key below the value by default — the gauge-tile shape', () => {
  renderDark(<Stat value="76" label="Mi/wk" unit="mi" />);

  expect(readingOrder()).toEqual(['76', 'mi', 'Mi/wk']);
});

test('places the key above the value on request — the session-table shape', () => {
  renderDark(<Stat value="4 of 5" label="Completed" labelPlacement="above" />);

  expect(readingOrder()).toEqual(['Completed', '4 of 5']);
});

// ── the style factory: for table cells that stay bespoke elements ────────────

test('statValueText carries the same numeral contract for StyleSheet composition', () => {
  const style = statValueText(C, 'sm');
  expect(style.fontFamily).toBe(data);
  expect(style.fontVariant).toEqual(['tabular-nums']);
  expect(style.fontSize).toBe(fontSizes.metadata);
  expect(style.color).toBe(C.ink);
  expect(statValueText(THEMES.light).color).toBe(THEMES.light.ink);
});
