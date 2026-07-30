/**
 * Divider — the hairline rule. The factories carry most of the 172 call sites,
 * so they are tested at least as hard as the element: what they must produce is
 * a border WIDTH/COLOUR pair on the right side, in the right theme.
 */
import { render, screen } from '@testing-library/react-native';
import { StyleSheet, type ViewStyle } from 'react-native';

import { Divider, hairlineBottom, hairlineTop } from '@/components/ui/Divider';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { space, THEMES } from '@/theme/tokens';

const C = THEMES.dark;

const renderDark = (node: React.ReactElement) =>
  render(<ThemeProvider preference="dark">{node}</ThemeProvider>);

const styleOf = (id: string) =>
  StyleSheet.flatten(screen.getByTestId(id, { includeHiddenElements: true }).props.style);

test('draws a one-hairline rule in the line token', () => {
  renderDark(<Divider testID="rule" />);

  const style = styleOf('rule');
  expect(style.height).toBe(StyleSheet.hairlineWidth);
  expect(style.backgroundColor).toBe(C.line);
  expect(style.alignSelf).toBe('stretch');
});

test('insets to the app gutter, or to an explicit column', () => {
  renderDark(
    <>
      <Divider inset testID="gutter" />
      <Divider inset={54} testID="column" />
      <Divider testID="flush" />
    </>,
  );

  expect(styleOf('gutter').marginHorizontal).toBe(space.lg);
  expect(styleOf('column').marginHorizontal).toBe(54);
  expect(styleOf('flush').marginHorizontal).toBe(0);
});

test('turns sideways for a column rule between two stats', () => {
  renderDark(<Divider vertical testID="col" />);

  const style = styleOf('col');
  expect(style.width).toBe(StyleSheet.hairlineWidth);
  expect(style.height).toBeUndefined();
  expect(style.backgroundColor).toBe(C.line);
});

test('is hidden from VoiceOver — a rule carries nothing to announce', () => {
  renderDark(<Divider testID="rule" />);

  const node = screen.getByTestId('rule', { includeHiddenElements: true });
  expect(node.props.accessibilityElementsHidden).toBe(true);
  expect(node.props.importantForAccessibility).toBe('no-hide-descendants');
});

test('follows the theme', () => {
  render(
    <ThemeProvider preference="light">
      <Divider testID="rule" />
    </ThemeProvider>,
  );

  expect(styleOf('rule').backgroundColor).toBe(THEMES.light.line);
});

// ── the factories: the main migration target ────────────────────────────────

test('hairlineTop and hairlineBottom return the border pair for their own side', () => {
  expect(hairlineTop(C)).toEqual({
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.line,
  });
  expect(hairlineBottom(C)).toEqual({
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.line,
  });
});

test('the factories track the theme instead of freezing a colour', () => {
  expect(hairlineTop(THEMES.light).borderTopColor).toBe(THEMES.light.line);
  expect(hairlineBottom(THEMES.light).borderBottomColor).toBe(THEMES.light.line);
});

test('the factories compose into a StyleSheet without touching layout', () => {
  const rowStyle = StyleSheet.flatten<ViewStyle>([{ paddingVertical: space.md }, hairlineTop(C)]);

  expect(rowStyle.paddingVertical).toBe(space.md);
  expect(rowStyle.borderTopWidth).toBe(StyleSheet.hairlineWidth);
  // A border must not smuggle in a height, a margin, or a background.
  expect(Object.keys(hairlineTop(C))).toEqual(['borderTopWidth', 'borderTopColor']);
});
