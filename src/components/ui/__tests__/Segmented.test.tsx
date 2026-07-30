/**
 * Segmented — the app's one filled pick-one control.
 *
 * The assertions that matter are the ones the starter-plan tier rail used to
 * own by hand: the selected position is the raised card plate (not an
 * underline), it is inert to a second press, and each segment keeps its own
 * spoken label while the group keeps its own.
 */
import { render, screen, fireEvent } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { ThemeProvider } from '@/theme/ThemeProvider';
import { THEMES } from '@/theme/tokens';
import { Segmented, type SegmentedOption } from '../Segmented';

const C = THEMES.dark;

const OPTIONS: SegmentedOption<'a' | 'b'>[] = [
  { value: 'a', label: '30 mi/week', accessibilityLabel: '30 miles per week' },
  { value: 'b', label: '45 mi/week', accessibilityLabel: '45 miles per week' },
];

function renderControl(value: 'a' | 'b', onChange = jest.fn()) {
  render(
    <ThemeProvider preference="dark">
      <Segmented
        mono
        accessibilityLabel="Training volume"
        options={OPTIONS}
        value={value}
        onChange={onChange}
      />
    </ThemeProvider>,
  );
  return onChange;
}

test('the selected position is the raised card plate with a hairline edge', () => {
  renderControl('b');
  const selected = StyleSheet.flatten(screen.getByLabelText('45 miles per week').props.style);
  const other = StyleSheet.flatten(screen.getByLabelText('30 miles per week').props.style);
  expect(selected.backgroundColor).toBe(C.card);
  expect(selected.borderColor).toBe(C.line);
  // Unselected positions stay unboxed — selection supplies the shape.
  expect(other.backgroundColor).toBeUndefined();
  expect(other.borderColor).toBe('transparent');
});

test('picking another position reports it; the current one is inert', () => {
  const onChange = renderControl('b');
  fireEvent.press(screen.getByLabelText('30 miles per week'));
  expect(onChange).toHaveBeenCalledWith('a');

  onChange.mockClear();
  fireEvent.press(screen.getByLabelText('45 miles per week'));
  expect(onChange).not.toHaveBeenCalled();
});

test('a11y: the group is named and each segment reports its own selected state', () => {
  renderControl('b');
  expect(screen.getByLabelText('Training volume')).toBeTruthy();
  expect(screen.getByLabelText('45 miles per week').props.accessibilityState.selected).toBe(true);
  expect(screen.getByLabelText('30 miles per week').props.accessibilityState.selected).toBe(false);
});
