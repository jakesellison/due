/**
 * GhostButton — the secondary action. What is pinned: the fill+hairline anatomy
 * that distinguishes it from ActionButton's solid accent, that destructive uses
 * the danger TOKEN plus a wash of it (never a new red), and that a disabled
 * button is inert rather than merely dimmed.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { GhostButton } from '@/components/ui/GhostButton';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { alpha, fontSizes, radius, THEMES } from '@/theme/tokens';

const C = THEMES.dark;

const renderDark = (node: React.ReactElement) =>
  render(<ThemeProvider preference="dark">{node}</ThemeProvider>);

const faceStyle = (id: string) =>
  StyleSheet.flatten(screen.getByTestId(id, { includeHiddenElements: true }).props.style);
const labelStyle = (text: string) => StyleSheet.flatten(screen.getByText(text).props.style);

test('renders a labelled button', () => {
  renderDark(<GhostButton label="Close" onPress={jest.fn()} />);

  expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
  expect(screen.getByText('Close')).toBeTruthy();
});

test('fires onPress exactly once', () => {
  const onPress = jest.fn();
  renderDark(<GhostButton label="Close" onPress={onPress} />);

  fireEvent.press(screen.getByRole('button', { name: 'Close' }));

  expect(onPress).toHaveBeenCalledTimes(1);
});

test('wears the fill + hairline anatomy, not a solid accent', () => {
  renderDark(<GhostButton label="Close" onPress={jest.fn()} testID="ghost" />);

  const style = faceStyle('ghost');
  expect(style.backgroundColor).toBe(C.fill);
  expect(style.borderWidth).toBe(StyleSheet.hairlineWidth);
  expect(style.borderColor).toBe(C.line);
  expect(style.borderRadius).toBe(radius.md);
  expect(labelStyle('Close').color).toBe(C.mute);
  expect(labelStyle('Close').fontSize).toBe(fontSizes.body);
});

test('carries no raised lip — depth is not a material in this app', () => {
  renderDark(<GhostButton label="Close" onPress={jest.fn()} testID="ghost" />);

  const style = faceStyle('ghost');
  expect(style.borderBottomWidth).toBeUndefined();
  expect(style.borderBottomColor).toBeUndefined();
});

test('clears the 44pt touch floor', () => {
  renderDark(<GhostButton label="Close" onPress={jest.fn()} testID="ghost" />);

  expect(faceStyle('ghost').minHeight).toBeGreaterThanOrEqual(44);
});

test('destructive takes the danger token and an alpha wash of it', () => {
  renderDark(<GhostButton label="Delete" destructive onPress={jest.fn()} testID="ghost" />);

  const style = faceStyle('ghost');
  expect(labelStyle('Delete').color).toBe(C.dangerText);
  expect(style.backgroundColor).toBe(alpha(C.dangerText, 0.1));
  expect(style.borderColor).toBe(alpha(C.dangerText, 0.28));
});

test('disabled is inert, recessive, and announced as disabled', () => {
  const onPress = jest.fn();
  renderDark(<GhostButton label="Install" disabled onPress={onPress} testID="ghost" />);

  const button = screen.getByRole('button', { name: 'Install' });
  fireEvent.press(button);

  expect(onPress).not.toHaveBeenCalled();
  expect(button.props.accessibilityState).toMatchObject({ disabled: true });
  expect(labelStyle('Install').color).toBe(C.faint);
});

test('takes an explicit accessibility label when the visible one is not the whole story', () => {
  renderDark(<GhostButton label="Delete" accessibilityLabel="Delete plan" onPress={jest.fn()} />);

  expect(screen.getByRole('button', { name: 'Delete plan' })).toBeTruthy();
});

test('follows the theme', () => {
  render(
    <ThemeProvider preference="light">
      <GhostButton label="Close" onPress={jest.fn()} testID="ghost" />
    </ThemeProvider>,
  );

  expect(faceStyle('ghost').backgroundColor).toBe(THEMES.light.fill);
  expect(labelStyle('Close').color).toBe(THEMES.light.mute);
});
