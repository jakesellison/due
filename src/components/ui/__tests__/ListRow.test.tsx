/**
 * ListRow — the settings / library / hub row. What is pinned: the single
 * geometry the five row styles in `you.tsx` were each approximating, that a
 * chevron follows the row's pressability rather than being remembered, and that
 * VoiceOver hears the row's VALUE and not just its title.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';

import { ListRow } from '@/components/ui/ListRow';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { space, THEMES } from '@/theme/tokens';

const C = THEMES.dark;

const renderDark = (node: React.ReactElement) =>
  render(<ThemeProvider preference="dark">{node}</ThemeProvider>);

const rowStyle = (id: string) => {
  const node = screen.getByTestId(id, { includeHiddenElements: true });
  const style = node.props.style;
  return StyleSheet.flatten(typeof style === 'function' ? style({ pressed: false }) : style);
};

test('renders the title, sub-line, and right-hand value', () => {
  renderDark(<ListRow title="Notifications" sub="Run ready" value="On" onPress={jest.fn()} />);

  expect(screen.getByText('Notifications')).toBeTruthy();
  expect(screen.getByText('Run ready')).toBeTruthy();
  expect(screen.getByText('On')).toBeTruthy();
});

test('fires onPress exactly once', () => {
  const onPress = jest.fn();
  renderDark(<ListRow title="Appearance" value="Dark" onPress={onPress} />);

  fireEvent.press(screen.getByRole('button', { name: 'Appearance, Dark' }));

  expect(onPress).toHaveBeenCalledTimes(1);
});

test('reads title, sub, and value as one VoiceOver stop', () => {
  renderDark(<ListRow title="Shoes" sub="Endorphin Speed" value="412 mi" onPress={jest.fn()} />);

  expect(screen.getByRole('button', { name: 'Shoes, Endorphin Speed, 412 mi' })).toBeTruthy();
});

test('is a plain View — no button role — when it goes nowhere', () => {
  renderDark(<ListRow title="Member since" value="2024" testID="row" />);

  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.getByTestId('row')).toBeTruthy();
});

test('the chevron follows pressability, and can be overridden either way', () => {
  const { toJSON: pressable } = renderDark(<ListRow title="Plans" onPress={jest.fn()} />);
  expect(JSON.stringify(pressable())).toContain('chevron.right');

  const { toJSON: staticRow } = renderDark(<ListRow title="Version" value="1.2" />);
  expect(JSON.stringify(staticRow())).not.toContain('chevron.right');

  const { toJSON: suppressed } = renderDark(
    <ListRow title="Sign out" onPress={jest.fn()} chevron={false} />,
  );
  expect(JSON.stringify(suppressed())).not.toContain('chevron.right');
});

test('clears the 44pt touch floor and sits on the app gutter', () => {
  renderDark(<ListRow title="Distance" value="Miles" onPress={jest.fn()} testID="row" />);

  const style = rowStyle('row');
  expect(style.minHeight).toBeGreaterThanOrEqual(44);
  expect(style.paddingHorizontal).toBe(space.lg);
  expect(style.gap).toBe(space.md);
});

test('compact drops to the 44pt floor for dense secondary lists', () => {
  renderDark(<ListRow title="Split 4" value="7:42" compact testID="row" />);

  expect(rowStyle('row').minHeight).toBe(44);
});

test('divided draws the separator ABOVE the row, in the line token', () => {
  renderDark(<ListRow title="Temperature" value="Fahrenheit" divided testID="row" />);

  const style = rowStyle('row');
  expect(style.borderTopWidth).toBe(StyleSheet.hairlineWidth);
  expect(style.borderTopColor).toBe(C.line);
  expect(style.borderBottomWidth).toBeUndefined();
});

test('undivided rows carry no rule at all', () => {
  renderDark(<ListRow title="Distance" value="Miles" testID="row" />);

  expect(rowStyle('row').borderTopWidth).toBeUndefined();
});

test('tints on press rather than scaling — a list must not appear to move', () => {
  // Pressable resolves its own `pressed` state through the responder
  // lifecycle, not through the `onPress` prop, so this drives the real thing:
  // grant the responder, let the highlight delay elapse, read the style back.
  jest.useFakeTimers();
  try {
    renderDark(<ListRow title="Routes" onPress={jest.fn()} testID="row" />);

    const row = screen.getByTestId('row');
    expect(StyleSheet.flatten(row.props.style).backgroundColor).toBeUndefined();

    fireEvent(row, 'responderGrant', {
      nativeEvent: { touches: [], changedTouches: [], identifier: 1, pageX: 0, pageY: 0, locationX: 0, locationY: 0, target: 1, timestamp: 0 },
      persist: () => undefined,
    });
    act(() => {
      jest.advanceTimersByTime(200);
    });

    const pressed = StyleSheet.flatten(screen.getByTestId('row').props.style);
    expect(pressed.backgroundColor).toBe(C.fill);
    // No scale: only free-standing buttons and cards shrink under a finger.
    expect(pressed.transform).toBeUndefined();
  } finally {
    jest.useRealTimers();
  }
});

test('an icon renders in the standard leading tile, and a leading node replaces it', () => {
  const { toJSON: withIcon } = renderDark(<ListRow title="Plan library" icon="calendar" onPress={jest.fn()} />);
  expect(JSON.stringify(withIcon())).toContain('calendar');

  const { toJSON: withLeading } = renderDark(
    <ListRow title="Jake" icon="calendar" leading={<Text>AVATAR</Text>} onPress={jest.fn()} />,
  );
  const flat = JSON.stringify(withLeading());
  expect(flat).toContain('AVATAR');
  expect(flat).not.toContain('calendar');
});

test('a right node replaces the value readout', () => {
  renderDark(<ListRow title="Sync" value="On" right={<Text>CHIP</Text>} onPress={jest.fn()} />);

  expect(screen.getByText('CHIP')).toBeTruthy();
  expect(screen.queryByText('On')).toBeNull();
});

test('disabled rows are inert and recede', () => {
  renderDark(<ListRow title="Delete account" onPress={jest.fn()} disabled testID="row" />);

  // Not a Pressable carrying `disabled` — not a Pressable at all, so there is
  // no button for VoiceOver to land on and no handler for a tap to reach.
  expect(screen.queryByRole('button')).toBeNull();
  expect(rowStyle('row').opacity).toBe(0.5);
});

test('follows the theme', () => {
  render(
    <ThemeProvider preference="light">
      <ListRow title="Appearance" value="Light" divided testID="row" />
    </ThemeProvider>,
  );

  expect(rowStyle('row').borderTopColor).toBe(THEMES.light.line);
});
