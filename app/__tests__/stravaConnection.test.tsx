import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Alert, Switch, Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { StravaStatus, UseStravaStatus } from '@/app-lib/strava';
import {
  resetBackfillStatusForTests,
  setBackfillStatus,
} from '@/app-lib/backfillStatus';
import { ThemeProvider } from '@/theme/ThemeProvider';

function flattenText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(flattenText).join('');
  return '';
}

jest.mock('@/app-lib/auth', () => ({
  useSession: () => ({ userId: 'u1', ready: true, error: null }),
}));

const mockStatus: { value: UseStravaStatus } = {
  value: { status: null, loading: true, error: null, refresh: jest.fn() },
};
const mockConnectStrava = jest.fn();
const mockDisconnectStrava = jest.fn(async () => undefined);
jest.mock('@/app-lib/strava', () => ({
  useStravaStatus: () => mockStatus.value,
  connectStrava: (...args: unknown[]) => mockConnectStrava(...args),
  disconnectStrava: () => mockDisconnectStrava(),
}));

const mockRunBackfill = jest.fn(async (_opts?: unknown) => ({
  imported: 0,
  enriched: 0,
  rateLimited: false,
  complete: true,
}));
const mockInvalidateActivityCaches = jest.fn(async (_queryClient?: unknown) => undefined);
const mockGetInterruptedMode = jest.fn(async (_userId: string) => null as 'latest' | 'history' | null);
const mockPersistInterruptedMode = jest.fn(async (_userId: string, _mode: unknown) => undefined);
const mockClearInterruptedMode = jest.fn(async (_userId: string) => undefined);
jest.mock('@/app-lib/backfill', () => ({
  runBackfill: (opts?: unknown) => mockRunBackfill(opts),
  retireSeedActivities: jest.fn(async () => 0),
  invalidateActivityCaches: (queryClient?: unknown) => mockInvalidateActivityCaches(queryClient),
  getInterruptedMode: (userId: string) => mockGetInterruptedMode(userId),
  persistInterruptedMode: (userId: string, mode: unknown) =>
    mockPersistInterruptedMode(userId, mode),
  clearInterruptedMode: (userId: string) => mockClearInterruptedMode(userId),
}));

jest.mock('@/app-lib/pushNotifications', () => ({
  promptPushAfterConnect: jest.fn(async () => undefined),
}));

const mockGetStravaProgressOptIn = jest.fn(async () => false);
const mockSetStravaProgressOptIn = jest.fn(async (_userId: string, _enabled: boolean) => true);
jest.mock('@/app-lib/stravaProgress', () => ({
  getStravaProgressOptIn: () => mockGetStravaProgressOptIn(),
  setStravaProgressOptIn: (userId: string, enabled: boolean) =>
    mockSetStravaProgressOptIn(userId, enabled),
}));

const mockBack = jest.fn();
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({
    back: mockBack,
    replace: mockReplace,
    canGoBack: () => true,
  }),
}));

import StravaConnectionScreen from '../connections/strava';

function renderTree(): ReactTestRenderer {
  let tree: ReactTestRenderer | undefined;
  const queryClient = new QueryClient();
  act(() => {
    tree = create(
      <QueryClientProvider client={queryClient}>
        <SafeAreaProvider
          initialMetrics={{
            frame: { x: 0, y: 0, width: 390, height: 844 },
            insets: { top: 47, left: 0, right: 0, bottom: 34 },
          }}
        >
          <ThemeProvider preference="dark">
            <StravaConnectionScreen />
          </ThemeProvider>
        </SafeAreaProvider>
      </QueryClientProvider>,
    );
  });
  return tree!;
}

function texts(tree: ReactTestRenderer): string[] {
  return tree.root.findAllByType(Text).map((node) => flattenText(node.props.children));
}

beforeEach(() => {
  AsyncStorage.clear();
  resetBackfillStatusForTests();
  mockConnectStrava.mockClear();
  mockConnectStrava.mockResolvedValue('dismissed');
  mockDisconnectStrava.mockClear();
  mockRunBackfill.mockClear();
  mockRunBackfill.mockResolvedValue({
    imported: 0,
    enriched: 0,
    rateLimited: false,
    complete: true,
  });
  mockInvalidateActivityCaches.mockClear();
  mockGetInterruptedMode.mockClear();
  mockGetInterruptedMode.mockResolvedValue(null);
  mockPersistInterruptedMode.mockClear();
  mockClearInterruptedMode.mockClear();
  mockGetStravaProgressOptIn.mockClear();
  mockGetStravaProgressOptIn.mockResolvedValue(false);
  mockSetStravaProgressOptIn.mockClear();
  mockSetStravaProgressOptIn.mockResolvedValue(true);
  mockBack.mockClear();
  mockReplace.mockClear();
});

describe('StravaConnectionScreen', () => {
  test('uses the official connect action when disconnected', async () => {
    mockStatus.value = {
      status: { connected: false, athleteId: null },
      loading: false,
      error: null,
      refresh: jest.fn(),
    };
    const tree = renderTree();
    expect(texts(tree)).toContain('Not connected');
    const connect = tree.root.findByProps({ accessibilityLabel: 'Connect with Strava' });

    await act(async () => connect.props.onPress());

    expect(mockConnectStrava).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  test('separates imported data, outbound plan context, sync, and revocation', async () => {
    mockStatus.value = {
      status: {
        connected: true,
        athleteId: '123',
        writeAuthorized: true,
        lastActivityAt: '2026-05-30T13:00:00Z',
      },
      loading: false,
      error: null,
      refresh: jest.fn(),
    };
    const tree = renderTree();
    await act(async () => Promise.resolve());
    const copy = texts(tree);

    expect(copy).toContain('Connected · Latest run May 30');
    expect(copy).toContain('Data from Strava');
    expect(copy).toContain('Run history');
    expect(copy).toContain('Past 12 months');
    expect(copy.some((line) => line.includes('Recent runs may also include'))).toBe(false);
    expect(copy).toContain('Shared with Strava');
    expect(copy).toContain('Sync');
    expect(copy).toContain('Re-import past 12 months');
    expect(copy).toContain('Connection');
    expect(tree.root.findByProps({ accessibilityLabel: 'Powered by Strava' })).toBeDefined();

    const toggle = tree.root.findAllByType(Switch).find(
      (node) => node.props.accessibilityLabel === 'Plan context on Strava',
    );
    expect(toggle).toBeDefined();
    await act(async () => toggle!.props.onValueChange(true));
    expect(mockSetStravaProgressOptIn).toHaveBeenCalledWith('u1', true);
    act(() => tree.unmount());
  });

  test('sync now checks latest while the repair action scans history', async () => {
    const status: StravaStatus = { connected: true, athleteId: '123', writeAuthorized: true };
    mockStatus.value = {
      status,
      loading: false,
      error: null,
      refresh: jest.fn(async () => status),
    };
    const tree = renderTree();
    const sync = tree.root.findByProps({
      accessibilityLabel: 'Sync now. Check Strava for new runs',
    });

    await act(async () => sync.props.onPress());
    expect(mockRunBackfill).toHaveBeenLastCalledWith(
      expect.objectContaining({ mode: 'latest' }),
    );

    const repair = tree.root.findByProps({
      accessibilityLabel:
        'Re-import past 12 months. Repair missing or incomplete activity history',
    });
    await act(async () => repair.props.onPress());
    expect(mockRunBackfill).toHaveBeenLastCalledWith(
      expect.objectContaining({ mode: 'history' }),
    );
    act(() => tree.unmount());
  });

  test('resumes a rate-limited history import in history mode', async () => {
    const status: StravaStatus = { connected: true, athleteId: '123', writeAuthorized: true };
    mockStatus.value = {
      status,
      loading: false,
      error: null,
      refresh: jest.fn(async () => status),
    };
    setBackfillStatus({ kind: 'rate_limited', mode: 'history' });
    const tree = renderTree();
    const resume = tree.root.findByProps({
      accessibilityLabel:
        'Resume import. Continue where the paused import stopped',
    });

    await act(async () => resume.props.onPress());

    expect(mockRunBackfill).toHaveBeenLastCalledWith(
      expect.objectContaining({ mode: 'history' }),
    );
    act(() => tree.unmount());
  });

  test('disconnect clears synced caches and the interrupted import marker', async () => {
    const status: StravaStatus = { connected: true, athleteId: '123', writeAuthorized: true };
    mockStatus.value = {
      status,
      loading: false,
      error: null,
      refresh: jest.fn(async () => ({ connected: false, athleteId: null })),
    };
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      buttons?.find((button) => button.text === 'Disconnect')?.onPress?.();
    });
    const tree = renderTree();
    const disconnect = tree.root.findByProps({ accessibilityLabel: 'Disconnect Strava' });

    await act(async () => disconnect.props.onPress());

    expect(mockDisconnectStrava).toHaveBeenCalledTimes(1);
    expect(mockInvalidateActivityCaches).toHaveBeenCalledTimes(1);
    expect(mockClearInterruptedMode).toHaveBeenCalledWith('u1');
    expect(mockBack).toHaveBeenCalledTimes(1);
    alert.mockRestore();
    act(() => tree.unmount());
  });
});
