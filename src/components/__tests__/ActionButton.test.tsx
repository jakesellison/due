import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

jest.mock('expo-haptics', () => ({
  ImpactFeedbackStyle: { Light: 'Light' },
  impactAsync: jest.fn(),
}));

import { ActionButton, ActionButtonLabel } from '../ActionButton';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { THEMES } from '@/theme/tokens';

function ancestors(node: ReactTestInstance): ReactTestInstance[] {
  const result: ReactTestInstance[] = [];
  let current: ReactTestInstance | null = node;
  while (current) {
    result.push(current);
    current = current.parent;
  }
  return result;
}

test('exposes a visible, non-interactive busy state to VoiceOver', () => {
  const onPress = jest.fn();
  const view = render(
    <ThemeProvider preference="dark">
      <ActionButton
        color={THEMES.dark.yellow}
        accessibilityLabel="Save route"
        loading
        loadingLabel="Saving…"
        loadingAccessibilityLabel="Saving route"
        onPress={onPress}
      >
        <ActionButtonLabel>Save</ActionButtonLabel>
      </ActionButton>
    </ThemeProvider>,
  );

  const button = view.getByRole('button', { name: 'Saving route' });
  expect(button.props.accessibilityState).toEqual({ disabled: true, busy: true });
  fireEvent.press(button);
  expect(onPress).not.toHaveBeenCalled();
  expect(view.getByText('Saving…')).toBeTruthy();
  expect(view.queryByText('Save')).toBeNull();
});

test('uses the canonical commit height and a neutral unavailable fill', () => {
  const view = render(
    <ThemeProvider preference="dark">
      <ActionButton color={THEMES.dark.yellow} disabled variant="commit" accessibilityLabel="Continue">
        <ActionButtonLabel>Continue</ActionButtonLabel>
      </ActionButton>
    </ThemeProvider>,
  );

  const label = view.getByText('Continue');
  const chain = ancestors(label);
  expect(chain.some((node) => StyleSheet.flatten(node.props.style)?.minHeight === 52)).toBe(true);
  expect(chain.some((node) => StyleSheet.flatten(node.props.style)?.backgroundColor === THEMES.dark.slate)).toBe(true);
});

// The lip is the thing this component used to have and deliberately does not:
// a darker bottom edge that made the primary CTA the app's one piece of
// decorative depth, on its own press physics, ignoring Reduce Motion. Nothing
// in the tree may reintroduce depth of any kind.
test('carries no elevation — no lip, border, or shadow on any surface', () => {
  const view = render(
    <ThemeProvider preference="dark">
      <ActionButton color={THEMES.dark.yellow} accessibilityLabel="Install plan" variant="commit">
        <ActionButtonLabel>Install plan</ActionButtonLabel>
      </ActionButton>
    </ThemeProvider>,
  );

  for (const node of ancestors(view.getByText('Install plan'))) {
    const style = StyleSheet.flatten(node.props.style) ?? {};
    expect(style.borderBottomWidth ?? 0).toBe(0);
    expect(style.borderWidth ?? 0).toBe(0);
    expect(style.shadowOpacity ?? 0).toBe(0);
    expect(style.elevation ?? 0).toBe(0);
  }
});

// The action voice is what replaces the lip: a solid accent field is only
// readable as a control (rather than as one of the app's many yellow
// MEASUREMENTS) because it carries a tracked-uppercase legend.
test('renders its label in the tracked-uppercase action voice', () => {
  const view = render(
    <ThemeProvider preference="dark">
      <ActionButton color={THEMES.dark.yellow} accessibilityLabel="Install plan">
        <ActionButtonLabel>Install plan</ActionButtonLabel>
      </ActionButton>
    </ThemeProvider>,
  );

  const style = StyleSheet.flatten(view.getByText('Install plan').props.style);
  expect(style.textTransform).toBe('uppercase');
  expect(style.letterSpacing).toBeGreaterThan(0);
  expect(style.color).toBe(THEMES.dark.accentInk);
});
