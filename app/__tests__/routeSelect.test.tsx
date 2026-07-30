import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ThemeProvider } from '@/theme/ThemeProvider';
import type { SavedRoute } from '@/app-lib/routes';

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockDismissTo = jest.fn();
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ workoutId: 'w1' }),
  useRouter: () => ({ push: mockPush, back: mockBack, replace: mockReplace, dismissTo: mockDismissTo, canGoBack: () => true }),
}));

jest.mock('@/app-lib/auth', () => ({
  useSession: () => ({ userId: 'u1', ready: true, error: null }),
}));

const mockDetail = {
  value: {
    loading: false,
    error: null,
    workout: {
      id: 'w1', week_id: 'wk1', date: '2026-07-22', type: 'easy', title: '6 mi easy',
      planned_distance_meters: 9656, planned_duration_s: null, structure: [], is_quality: false, notes: null,
    },
    activities: [], matchedActivities: [], actual: null, primaryActivityId: null,
    weekIndex: 1, today: '2026-07-21', refetch: jest.fn(),
  },
};
jest.mock('@/app-lib/queries', () => ({
  useWorkoutDetail: () => mockDetail.value,
}));

const riverLoop: SavedRoute = {
  id: 'r1', name: 'River loop', points: [[41.88, -87.62], [41.89, -87.61]],
  drawPath: [[41.88, -87.62], [41.89, -87.61]], distanceMeters: 9656,
  createdAt: '2026-07-20T12:00:00Z', updatedAt: '2026-07-20T12:00:00Z',
  archivedAt: null, provenance: 'due_builder',
};
const mockRoutes = { value: { data: [riverLoop], isLoading: false, error: null, refetch: jest.fn() } };
const mockAttach = jest.fn(async () => undefined);
jest.mock('@/app-lib/routes', () => ({
  useRoutes: () => mockRoutes.value,
  useWorkoutRoute: () => ({ data: null, isLoading: false, error: null }),
  attachRouteToWorkout: mockAttach,
}));

import SelectRouteScreen from '../routes/select';

function renderScreen(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <QueryClientProvider client={new QueryClient()}>
        <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}>
          <ThemeProvider preference="dark"><SelectRouteScreen /></ThemeProvider>
        </SafeAreaProvider>
      </QueryClientProvider>,
    );
  });
  return tree;
}

beforeEach(() => {
  mockPush.mockClear();
  mockBack.mockClear();
  mockReplace.mockClear();
  mockDismissTo.mockClear();
  mockAttach.mockClear();
  mockRoutes.value = { data: [riverLoop], isLoading: false, error: null, refetch: jest.fn() };
});

test('selects a saved route and enables the contextual attach action', async () => {
  const tree = renderScreen();
  const row = tree.root.find((node) => node.props.accessibilityLabel === 'River loop, 6.0 mi, on target');
  await act(async () => row.props.onPress());

  expect(tree.root.findAll((node) => node.props.accessibilityRole === 'radio' && node.props.accessibilityState?.checked).length).toBeGreaterThan(0);

  const actions = tree.root.findAll(
    (node) => node.props.accessibilityLabel === 'Use route for workout' && typeof node.props.onPress === 'function',
  );
  const action = actions.find((node) => node.props.accessibilityState?.disabled === false)!;
  expect(action.props.disabled).toBe(false);
  act(() => tree.unmount());
});

test('returns to the workout with back navigation instead of another modal dismissal', () => {
  const tree = renderScreen();
  const back = tree.root.find(
    (node) => node.props.accessibilityLabel === 'Back to workout' && typeof node.props.onPress === 'function',
  );

  act(() => back.props.onPress());

  expect(mockBack).toHaveBeenCalledTimes(1);
  act(() => tree.unmount());
});

test('an empty library continues directly to the workout-aware builder', () => {
  mockRoutes.value = { data: [], isLoading: false, error: null, refetch: jest.fn() };
  const tree = renderScreen();
  expect(mockReplace).toHaveBeenCalledWith({
    pathname: '/routes/new',
    params: { workoutId: 'w1', targetMeters: '9656' },
  });
  act(() => tree.unmount());
});
