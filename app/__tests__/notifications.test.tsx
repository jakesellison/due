import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Linking, Switch, Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ThemeProvider } from '@/theme/ThemeProvider';

const mockBack = jest.fn();
const mockRegisterPush = jest.fn(async () => ({ ok: true as const }));
const mockUnregisterPush = jest.fn(async () => undefined);
const mockPermissionGranted = jest.fn(async () => false);

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: jest.fn(),
    back: mockBack,
    canGoBack: () => true,
    replace: jest.fn(),
  }),
}));

jest.mock('@/app-lib/auth', () => ({
  useSession: () => ({ userId: 'u1', ready: true }),
}));

jest.mock('@/app-lib/pushNotifications', () => ({
  registerPush: () => mockRegisterPush(),
  unregisterPush: () => mockUnregisterPush(),
  pushPermissionGranted: () => mockPermissionGranted(),
}));

import NotificationSettingsScreen from '../notifications';

function renderTree(): ReactTestRenderer {
  let tree: ReactTestRenderer | undefined;
  act(() => {
    tree = create(
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 47, left: 0, right: 0, bottom: 34 },
        }}
      >
        <ThemeProvider preference="dark">
          <NotificationSettingsScreen />
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return tree!;
}

function flattenText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(flattenText).join('');
  return '';
}

function textValues(tree: ReactTestRenderer): string[] {
  return tree.root.findAllByType(Text).map((node) => flattenText(node.props.children));
}

beforeEach(async () => {
  await AsyncStorage.clear();
  mockBack.mockClear();
  mockRegisterPush.mockClear();
  mockRegisterPush.mockResolvedValue({ ok: true });
  mockUnregisterPush.mockClear();
  mockPermissionGranted.mockClear();
  mockPermissionGranted.mockResolvedValue(false);
});

test('renders one working category and a system-settings escape hatch', async () => {
  const tree = renderTree();
  await act(async () => {
    await Promise.resolve();
  });

  expect(textValues(tree)).toContain('Notifications');
  expect(textValues(tree)).toContain('Run ready');
  expect(textValues(tree)).toContain('System access');
  expect(tree.root.findByProps({ accessibilityLabel: 'Run ready notifications' }).props.value).toBe(false);
  expect(
    tree.root.findByProps({ accessibilityLabel: 'Open iOS notification settings. Off' }),
  ).toBeDefined();
  act(() => tree.unmount());
});

test('enabling run-ready notifications registers the device and persists the category', async () => {
  const tree = renderTree();
  await act(async () => {
    await Promise.resolve();
  });
  const toggle = tree.root.findByProps({ accessibilityLabel: 'Run ready notifications' });

  await act(async () => {
    await toggle.props.onValueChange(true);
  });

  expect(mockRegisterPush).toHaveBeenCalledTimes(1);
  expect(AsyncStorage.setItem).toHaveBeenCalledWith(
    'mileage.notificationPreferences',
    JSON.stringify({ runReady: true }),
  );
  expect(tree.root.findByProps({ accessibilityLabel: 'Run ready notifications' }).props.value).toBe(true);
  act(() => tree.unmount());
});

test('system access row opens native app settings', async () => {
  const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
  const tree = renderTree();
  await act(async () => {
    await Promise.resolve();
  });
  const row = tree.root.findByProps({ accessibilityLabel: 'Open iOS notification settings. Off' });

  await act(async () => {
    await row.props.onPress();
  });

  expect(openSettings).toHaveBeenCalledTimes(1);
  openSettings.mockRestore();
  act(() => tree.unmount());
});

