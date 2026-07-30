/**
 * Render smoke tests for the You tab under the `app` Jest project. Strava
 * management is covered on its dedicated screen; this file only verifies the
 * compact connection summary and the rest of the private-library/settings
 * surface without touching the network or Supabase.
 */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ActionSheetIOS, Alert, RefreshControl, Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { resetAppPreferencesForTests } from '@/app-lib/preferences';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { StravaStatus, UseStravaStatus } from '@/app-lib/strava';
import type { MyPlan, Shoe } from '@/app-lib/queries';
import { resetBackfillStatusForTests } from '@/app-lib/backfillStatus';
import { ThemeProvider } from '@/theme/ThemeProvider';

function flattenText(c: unknown): string {
  if (typeof c === 'string') return c;
  if (typeof c === 'number') return String(c);
  if (Array.isArray(c)) return c.map(flattenText).join('');
  return '';
}

// ---- Mocks -----------------------------------------------------------------

const mockDeleteAccount = jest.fn(async () => undefined);
const mockSignOut = jest.fn(async () => undefined);
jest.mock('@/app-lib/auth', () => ({
  useSession: () => ({ userId: 'u1', ready: true, error: null }),
  deleteAccount: () => mockDeleteAccount(),
  signOut: () => mockSignOut(),
}));

const mockRoutes = {
  value: { data: [] as unknown[], isLoading: false, error: null as Error | null, refetch: jest.fn() },
};
jest.mock('@/app-lib/routes', () => ({
  useRoutes: () => mockRoutes.value,
}));

const mockStatus: { value: UseStravaStatus } = {
  value: { status: null, loading: true, error: null, refresh: jest.fn() },
};
const mockConnectStrava = jest.fn();
const mockDisconnectStrava = jest.fn(async (_?: unknown) => undefined);
jest.mock('@/app-lib/strava', () => ({
  useStravaStatus: () => mockStatus.value,
  connectStrava: (...a: unknown[]) => mockConnectStrava(...a),
  disconnectStrava: () => mockDisconnectStrava(),
}));

const mockMyPlans: { value: { data: MyPlan[]; isLoading: boolean } } = {
  value: { data: [], isLoading: false },
};
const mockSwitchActivePlan = jest.fn(async (..._a: unknown[]) => undefined);
const mockShoes: { value: { data: Shoe[]; isLoading: boolean } } = {
  value: { data: [], isLoading: false },
};
jest.mock('@/app-lib/queries', () => ({
  useMyPlans: () => mockMyPlans.value,
  switchActivePlan: (...a: unknown[]) => mockSwitchActivePlan(...a),
  useShoes: () => mockShoes.value,
}));

const mockRunBackfill = jest.fn(async (_opts?: unknown) => ({
  imported: 0,
  enriched: 0,
  rateLimited: false,
  complete: true,
}));
const mockInvalidateActivityCaches = jest.fn(async (_qc?: unknown) => undefined);
const mockGetInterruptedMode = jest.fn(async (_userId: string) => null as 'latest' | 'history' | null);
const mockPersistInterruptedMode = jest.fn(async (_userId: string, _mode: unknown) => undefined);
const mockClearInterruptedMode = jest.fn(async (_userId: string) => undefined);
jest.mock('@/app-lib/backfill', () => ({
  runBackfill: (opts?: unknown) => mockRunBackfill(opts),
  retireSeedActivities: jest.fn(async () => 0),
  invalidateActivityCaches: (qc?: unknown) => mockInvalidateActivityCaches(qc),
  getInterruptedMode: (userId: string) => mockGetInterruptedMode(userId),
  persistInterruptedMode: (userId: string, mode: unknown) => mockPersistInterruptedMode(userId, mode),
  clearInterruptedMode: (userId: string) => mockClearInterruptedMode(userId),
}));

// Push module pulls expo-notifications (throws on import under jest-expo) + the
// real supabase client — stub it out; the row's behaviour isn't under test here.
jest.mock('@/app-lib/pushNotifications', () => ({
  registerPush: jest.fn(async () => ({ ok: true })),
  unregisterPush: jest.fn(async () => {}),
  pushPermissionGranted: jest.fn(async () => false),
  promptPushAfterConnect: jest.fn(async () => {}),
}));
const mockGetStravaProgressOptIn = jest.fn(async () => false);
const mockSetStravaProgressOptIn = jest.fn(async (_userId: string, _enabled: boolean) => true);
jest.mock('@/app-lib/stravaProgress', () => ({
  getStravaProgressOptIn: () => mockGetStravaProgressOptIn(),
  setStravaProgressOptIn: (userId: string, enabled: boolean) => mockSetStravaProgressOptIn(userId, enabled),
}));

const mockBack = jest.fn();
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack, canGoBack: () => true, replace: jest.fn() }),
  useFocusEffect: (effect: () => void | (() => void)) => {
    const React = jest.requireActual<typeof import('react')>('react');
    React.useEffect(effect, [effect]);
  },
}));

import SettingsScreen from '../(tabs)/you';

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
            <SettingsScreen />
          </ThemeProvider>
        </SafeAreaProvider>
      </QueryClientProvider>,
    );
  });
  return tree!;
}

function texts(tree: ReactTestRenderer): string[] {
  return tree.root.findAllByType(Text).map((n) => flattenText(n.props.children));
}

beforeEach(() => {
  AsyncStorage.clear();
  resetAppPreferencesForTests();
  // The backfill/sync status is now a cross-screen singleton (Dash reads the
  // same state) rather than component-local — reset it so one test's running
  // import doesn't leak into the next test's fresh SettingsScreen render.
  resetBackfillStatusForTests();
  mockDeleteAccount.mockClear();
  mockDeleteAccount.mockResolvedValue(undefined);
  mockSignOut.mockClear();
  mockSignOut.mockResolvedValue(undefined);
  mockConnectStrava.mockClear();
  mockConnectStrava.mockResolvedValue('connected');
  mockDisconnectStrava.mockClear();
  mockGetStravaProgressOptIn.mockClear();
  mockGetStravaProgressOptIn.mockResolvedValue(false);
  mockSetStravaProgressOptIn.mockClear();
  mockSetStravaProgressOptIn.mockResolvedValue(true);
  mockRunBackfill.mockClear();
  mockRunBackfill.mockResolvedValue({ imported: 0, enriched: 0, rateLimited: false, complete: true });
  mockInvalidateActivityCaches.mockClear();
  mockGetInterruptedMode.mockClear();
  mockGetInterruptedMode.mockResolvedValue(null);
  mockPersistInterruptedMode.mockClear();
  mockClearInterruptedMode.mockClear();
  mockBack.mockClear();
  mockPush.mockClear();
  mockSwitchActivePlan.mockClear();
  mockMyPlans.value = { data: [], isLoading: false };
  mockShoes.value = { data: [], isLoading: false };
  mockRoutes.value = { data: [], isLoading: false, error: null, refetch: jest.fn() };
});

/** Find a pressable host node whose descendant Text matches `label`. */
function pressableWithText(tree: ReactTestRenderer, label: string) {
  return tree.root
    .findAll((n) => typeof n.props?.onPress === 'function')
    .find((n) => n.findAllByType(Text).some((c) => flattenText(c.props.children).includes(label)));
}

describe('YouScreen', () => {
  test('leads with the runner library and retains expected setup surfaces', () => {
    mockStatus.value = { status: null, loading: true, error: null, refresh: jest.fn() };
    const tree = renderTree();
    const t = texts(tree);
    expect(t.some((x) => x === 'You')).toBe(true);
    expect(t.some((x) => x.includes('Library'))).toBe(true);
    expect(t.some((x) => x.includes('Plan library'))).toBe(true);
    expect(t.some((x) => x.includes('Saved routes'))).toBe(true);
    expect(t.some((x) => x.includes('Gear'))).toBe(true);
    expect(t.some((x) => x.includes('Free'))).toBe(true);
    expect(t.some((x) => x.includes('Connections'))).toBe(true);
    expect(t.some((x) => x.includes('Preferences'))).toBe(true);
    expect(t.some((x) => x.includes('Membership'))).toBe(true);
    expect(t.some((x) => x.includes('Account'))).toBe(true);
    expect(t.some((x) => x.includes('Strava'))).toBe(true);
    expect(t.some((x) => x.includes('Garmin'))).toBe(false);
    expect(t.some((x) => x.includes('COROS'))).toBe(false);
    expect(t.some((x) => x.includes('Apple Health'))).toBe(false);
    expect(t.some((x) => x.includes('Timezone'))).toBe(false);
    expect(t.some((x) => x === 'Distance')).toBe(true);
    expect(t.some((x) => x === 'Miles')).toBe(true);
    expect(t.some((x) => x === 'Temperature')).toBe(true);
    expect(t.some((x) => x === 'Fahrenheit')).toBe(true);
    expect(t.some((x) => x === 'Week starts')).toBe(false);
    expect(t.some((x) => x === 'Monday')).toBe(false);
    expect(t.some((x) => x.includes('Workout destination'))).toBe(false);
    expect(t.some((x) => x.includes('Push planned workouts'))).toBe(false);
    expect(t.some((x) => x === 'Notifications')).toBe(true);
    expect(t.some((x) => x === 'Off')).toBe(true);
    expect(t.some((x) => x === 'Appearance')).toBe(true);
    expect(t.some((x) => x === 'Dark')).toBe(true);
    expect(tree.root.findByProps({ testID: 'you-strava-loading' })).toBeDefined();
    expect(t.some((x) => x.includes('Checking'))).toBe(false);
    expect(t.some((x) => x === 'Done')).toBe(false);
    act(() => tree.unmount());
  });

  test('keeps library and gear geometry in place while their data loads', () => {
    mockStatus.value = { status: null, loading: true, error: null, refresh: jest.fn() };
    mockMyPlans.value = { data: [], isLoading: true };
    mockRoutes.value = { data: [], isLoading: true, error: null, refetch: jest.fn() };
    mockShoes.value = { data: [], isLoading: true };

    const tree = renderTree();
    expect(tree.root.findByProps({ testID: 'you-plans-loading' })).toBeDefined();
    expect(tree.root.findByProps({ testID: 'you-routes-loading' })).toBeDefined();
    expect(tree.root.findByProps({ testID: 'you-shoes-loading' })).toBeDefined();
    expect(tree.root.findByProps({ accessibilityLabel: 'Add shoe' })).toBeDefined();
    act(() => tree.unmount());
  });

  test('notifications is a disclosure row that opens category settings', () => {
    mockStatus.value = { status: null, loading: false, error: null, refresh: jest.fn() };
    const tree = renderTree();
    const row = tree.root.findByProps({ accessibilityLabel: 'Notifications, Off' });

    act(() => row.props.onPress());

    expect(mockPush).toHaveBeenCalledWith('/notifications');
    act(() => tree.unmount());
  });

  test('appearance is a compact disclosure row that opens the native picker', () => {
    mockStatus.value = { status: null, loading: false, error: null, refresh: jest.fn() };
    const picker = jest
      .spyOn(ActionSheetIOS, 'showActionSheetWithOptions')
      .mockImplementation(() => undefined);
    const tree = renderTree();
    const row = tree.root.findByProps({ accessibilityLabel: 'Appearance, Dark' });

    act(() => row.props.onPress());

    // Cancel is LAST now: every selector routes through `showChoiceSheet`,
    // which puts it after the real options so the callback index maps straight
    // onto them. iOS detaches Cancel into its own group either way, so this is
    // a code convention, not a visible change. The convention itself is pinned
    // in src/app-lib/__tests__/choiceSheet.test.ts.
    expect(picker).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Appearance',
        options: ['System', 'Light', 'Dark', 'Cancel'],
        cancelButtonIndex: 3,
      }),
      expect.any(Function),
    );
    picker.mockRestore();
    act(() => tree.unmount());
  });

  test('distance is a persisted preference rather than static metadata', async () => {
    mockStatus.value = { status: null, loading: false, error: null, refresh: jest.fn() };
    const picker = jest
      .spyOn(ActionSheetIOS, 'showActionSheetWithOptions')
      .mockImplementation((_options, callback) => callback(1)); // 2nd option; Cancel is last
    const tree = renderTree();
    const row = tree.root.findByProps({ accessibilityLabel: 'Distance, Miles' });

    await act(async () => {
      row.props.onPress();
      await Promise.resolve();
    });

    expect(texts(tree)).toContain('Kilometers');
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      'mileage.appPreferences',
      expect.stringContaining('"distance":"km"'),
    );
    picker.mockRestore();
    act(() => tree.unmount());
  });

  test('temperature is a persisted preference rather than static metadata', async () => {
    mockStatus.value = { status: null, loading: false, error: null, refresh: jest.fn() };
    const picker = jest
      .spyOn(ActionSheetIOS, 'showActionSheetWithOptions')
      .mockImplementation((_options, callback) => callback(1)); // 2nd option; Cancel is last
    const tree = renderTree();
    const row = tree.root.findByProps({ accessibilityLabel: 'Temperature, Fahrenheit' });

    await act(async () => {
      row.props.onPress();
      await Promise.resolve();
    });

    expect(texts(tree)).toContain('Celsius');
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      'mileage.appPreferences',
      expect.stringContaining('"temperature":"celsius"'),
    );
    picker.mockRestore();
    act(() => tree.unmount());
  });

  test('opens the durable libraries from the first instrument', () => {
    mockStatus.value = { status: null, loading: false, error: null, refresh: jest.fn() };
    const tree = renderTree();
    const plans = pressableWithText(tree, 'Plan library');
    const routes = pressableWithText(tree, 'Saved routes');
    expect(plans).toBeDefined();
    expect(routes).toBeDefined();

    act(() => plans!.props.onPress());
    expect(mockPush).toHaveBeenCalledWith('/plans');
    act(() => routes!.props.onPress());
    expect(mockPush).toHaveBeenCalledWith('/routes');
    act(() => tree.unmount());
  });

  test('wires pull-to-refresh on the scroll view', () => {
    mockStatus.value = { status: null, loading: false, error: null, refresh: jest.fn() };
    const tree = renderTree();
    const rc = tree.root.findByType(RefreshControl);
    expect(rc).toBeDefined();
    expect(typeof rc.props.onRefresh).toBe('function');
    act(() => tree.unmount());
  });

  test('Not connected stays a compact disclosure row', () => {
    const status: StravaStatus = { connected: false, athleteId: null };
    mockStatus.value = { status, loading: false, error: null, refresh: jest.fn() };
    const tree = renderTree();
    const t = texts(tree);
    expect(t.some((x) => x.includes('Not connected'))).toBe(true);
    expect(
      tree.root.findAll((node) => node.props.accessibilityLabel === 'Connect with Strava'),
    ).toHaveLength(0);
    const row = tree.root.findByProps({
      accessibilityLabel: 'Strava connection, Not connected',
    });
    act(() => row.props.onPress());
    expect(mockPush).toHaveBeenCalledWith('/connections/strava');
    act(() => tree.unmount());
  });

  test('Connected shows the provider and latest run without management plumbing', () => {
    const status: StravaStatus = {
      connected: true,
      athleteId: '12345',
      lastActivityAt: '2026-05-30T13:00:00Z',
    };
    mockStatus.value = { status, loading: false, error: null, refresh: jest.fn() };
    const tree = renderTree();
    expect(texts(tree)).toContain('Connected · Latest run May 30');
    expect(texts(tree)).not.toContain('Plan context on Strava');
    expect(texts(tree)).not.toContain('Sync now');
    expect(texts(tree)).not.toContain('Disconnect Strava');
    act(() => tree.unmount());
  });

});

// audit-ops H2: in-app account deletion (Apple Guideline 5.1.1(v)).
describe('SettingsScreen — Delete account', () => {
  test('confirming the destructive alert calls the delete endpoint then signs out', async () => {
    mockStatus.value = { status: null, loading: false, error: null, refresh: jest.fn() };
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      const confirm = (buttons ?? []).find((b) => b.text === 'Delete');
      confirm?.onPress?.();
    });

    const tree = renderTree();
    const deleteBtn = tree.root.findByProps({ accessibilityLabel: 'Delete account' });
    await act(async () => {
      deleteBtn.props.onPress();
    });

    expect(mockDeleteAccount).toHaveBeenCalledTimes(1);
    expect(mockSignOut).toHaveBeenCalledTimes(1);
    // Sign-out must follow a SUCCESSFUL delete, not race ahead of it.
    expect(mockDeleteAccount.mock.invocationCallOrder[0]!).toBeLessThan(mockSignOut.mock.invocationCallOrder[0]!);

    alertSpy.mockRestore();
    act(() => tree.unmount());
  });

  test('cancelling the alert never calls the delete endpoint', () => {
    mockStatus.value = { status: null, loading: false, error: null, refresh: jest.fn() };
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

    const tree = renderTree();
    const deleteBtn = tree.root.findByProps({ accessibilityLabel: 'Delete account' });
    act(() => {
      deleteBtn.props.onPress();
    });

    expect(Alert.alert).toHaveBeenCalled();
    expect(mockDeleteAccount).not.toHaveBeenCalled();
    expect(mockSignOut).not.toHaveBeenCalled();

    alertSpy.mockRestore();
    act(() => tree.unmount());
  });

  test('a failed delete shows an error and does not sign out', async () => {
    mockStatus.value = { status: null, loading: false, error: null, refresh: jest.fn() };
    mockDeleteAccount.mockRejectedValueOnce(new Error('server exploded'));
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      const confirm = (buttons ?? []).find((b) => b.text === 'Delete');
      confirm?.onPress?.();
    });

    const tree = renderTree();
    const deleteBtn = tree.root.findByProps({ accessibilityLabel: 'Delete account' });
    await act(async () => {
      deleteBtn.props.onPress();
    });

    expect(mockDeleteAccount).toHaveBeenCalledTimes(1);
    expect(mockSignOut).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenLastCalledWith('Couldn’t delete account', 'Please try again.');

    alertSpy.mockRestore();
    act(() => tree.unmount());
  });
});

describe('YouScreen — Library', () => {
  test('renders a single plan-library row that opens the /plans home', () => {
    const tree = renderTree();
    const t = texts(tree);
    expect(t.some((x) => x === 'Library')).toBe(true);
    const row = pressableWithText(tree, 'Plan library');
    expect(row).toBeDefined();
    act(() => {
      row!.props.onPress();
    });
    expect(mockPush).toHaveBeenCalledWith('/plans');
    act(() => tree.unmount());
  });
});

describe('YouScreen — Gear', () => {
  const shoe = (over: Partial<Shoe>): Shoe => ({
    id: 's1',
    name: 'Pegasus 41',
    photoPath: null,
    photoUrl: null,
    startingMeters: 0,
    isDefault: false,
    retiredAt: null,
    totalMeters: 0,
    activityCount: 0,
    ...over,
  });

  test('empty state still offers the Add shoe row', () => {
    mockStatus.value = { status: null, loading: false, error: null, refresh: jest.fn() };
    const tree = renderTree();
    expect(texts(tree).some((x) => x === 'Gear')).toBe(true);
    expect(texts(tree).some((x) => x === 'Add shoe')).toBe(true);
    act(() => tree.unmount());
  });

  test('renders shoe rows with mileage, Default tag and retired state', () => {
    mockStatus.value = { status: null, loading: false, error: null, refresh: jest.fn() };
    mockShoes.value = {
      data: [
        shoe({ id: 'a', name: 'Pegasus 41', isDefault: true, totalMeters: 547177, activityCount: 42 }),
        shoe({ id: 'b', name: 'Vaporfly 3', totalMeters: 80467, activityCount: 5, retiredAt: '2026-01-01T00:00:00Z' }),
      ],
      isLoading: false,
    };
    const tree = renderTree();
    const t = texts(tree);
    expect(t.some((x) => x === 'Pegasus 41')).toBe(true);
    expect(t.some((x) => x.includes('340 mi') && x.includes('42 runs'))).toBe(true);
    expect(t.some((x) => x === 'Default')).toBe(true);
    expect(t.some((x) => x === 'Vaporfly 3')).toBe(true);
    expect(t.some((x) => x.includes('50 mi') && x.includes('retired'))).toBe(true);
    act(() => tree.unmount());
  });
});
