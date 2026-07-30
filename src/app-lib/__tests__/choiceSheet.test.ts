/**
 * showChoiceSheet — the shared "pick one of N" native selector.
 *
 * Pins the two things the three previous hand-rolled copies disagreed on and
 * got wrong in different ways: WHERE Cancel sits in the options array, and how
 * the callback index maps back to an option. A regression here is an off-by-one
 * that silently invokes the wrong menu action, which is exactly the class of
 * bug this file exists to make impossible.
 */
import { ActionSheetIOS, Alert, Platform } from 'react-native';

import { showChoiceSheet } from '../choiceSheet';

type Key = 'a' | 'b' | 'kill';
const OPTIONS = [
  { key: 'a' as const, label: 'Alpha' },
  { key: 'b' as const, label: 'Beta' },
  { key: 'kill' as const, label: 'Delete' },
];

/** Grab the config + callback the sheet was invoked with. */
function lastIosCall() {
  const spy = ActionSheetIOS.showActionSheetWithOptions as unknown as jest.Mock;
  const [config, callback] = spy.mock.calls[spy.mock.calls.length - 1]!;
  return { config, callback: callback as (i: number) => void };
}

beforeEach(() => {
  jest.restoreAllMocks();
  Platform.OS = 'ios';
  jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation(() => {});
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

test('puts Cancel last and points cancelButtonIndex at it', () => {
  showChoiceSheet<Key>({ title: 'Plan', options: OPTIONS, onPick: jest.fn() });

  const { config } = lastIosCall();
  expect(config.options).toEqual(['Alpha', 'Beta', 'Delete', 'Cancel']);
  expect(config.cancelButtonIndex).toBe(3);
  expect(config.title).toBe('Plan');
});

test('maps each callback index straight onto its option — no arithmetic', () => {
  const onPick = jest.fn();
  showChoiceSheet<Key>({ options: OPTIONS, onPick });

  const { callback } = lastIosCall();
  callback(0);
  callback(2);

  expect(onPick.mock.calls).toEqual([['a'], ['kill']]);
});

test('a Cancel tap picks nothing', () => {
  const onPick = jest.fn();
  showChoiceSheet<Key>({ options: OPTIONS, onPick });

  lastIosCall().callback(3); // the Cancel index

  expect(onPick).not.toHaveBeenCalled();
});

test('an out-of-range dismissal picks nothing rather than throwing', () => {
  const onPick = jest.fn();
  showChoiceSheet<Key>({ options: OPTIONS, onPick });

  expect(() => lastIosCall().callback(99)).not.toThrow();
  expect(onPick).not.toHaveBeenCalled();
});

test('marks the destructive option by index, and omits the key when unset', () => {
  showChoiceSheet<Key>({ options: OPTIONS, onPick: jest.fn(), destructiveKey: 'kill' });
  expect(lastIosCall().config.destructiveButtonIndex).toBe(2);

  showChoiceSheet<Key>({ options: OPTIONS, onPick: jest.fn() });
  expect(lastIosCall().config).not.toHaveProperty('destructiveButtonIndex');
});

test('falls back to a cancel-styled Alert off iOS', () => {
  Platform.OS = 'android';
  const onPick = jest.fn();
  showChoiceSheet<Key>({ title: 'Plan', options: OPTIONS, onPick, destructiveKey: 'kill' });

  const spy = Alert.alert as unknown as jest.Mock;
  const [title, , buttons] = spy.mock.calls[spy.mock.calls.length - 1]!;
  expect(title).toBe('Plan');
  expect(buttons.map((b: { text: string }) => b.text)).toEqual(['Alpha', 'Beta', 'Delete', 'Cancel']);
  expect(buttons[2].style).toBe('destructive');
  expect(buttons[3].style).toBe('cancel');

  buttons[1].onPress();
  expect(onPick).toHaveBeenCalledWith('b');
});
