/**
 * plans/[id] — read-only plan detail (audit-code Lane 2 [Medium]): before this
 * fix, the screen only checked `q.isLoading` then `!bundle`, so a network
 * error (e.g. airplane mode) rendered the same "This plan couldn't be found"
 * copy as a genuinely-missing plan, with no retry. This must now distinguish
 * a network error (message + Retry) from a real not-found.
 */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@/theme/ThemeProvider';

const mockSession: { value: { userId: string | null; ready: boolean; error: Error | null } } = {
  value: { userId: 'u1', ready: true, error: null },
};
jest.mock('@/app-lib/auth', () => ({
  useSession: () => mockSession.value,
}));

const mockDismissTo = jest.fn();
const mockRouter = { push: jest.fn(), back: jest.fn(), dismissTo: mockDismissTo, canGoBack: () => true, replace: jest.fn() };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({ id: 'plan1' }),
}));

const mockPlanByIdRefetch = jest.fn();
const mockPlanById: { value: { data: unknown; isLoading: boolean; error: Error | null; refetch: typeof mockPlanByIdRefetch } } = {
  value: { data: null, isLoading: true, error: null, refetch: mockPlanByIdRefetch },
};

jest.mock('@/app-lib/queries', () => ({
  usePlanById: () => mockPlanById.value,
  planDueFilename: () => 'plan.due',
  // The screen re-projects a stored plan through this to build the outline.
  // Returning a non-plan makes normalizeRelativePlan reject, so the draft is
  // null and these cases assert the surrounding branch, not the outline.
  exportPlanToRelative: () => ({}),
}));

// Imported AFTER the mocks are registered.
import PlanDetailScreen from '../plans/[id]';

function renderTree(node: React.ReactElement): ReactTestRenderer {
  let tree: ReactTestRenderer | undefined;
  const queryClient = new QueryClient();
  act(() => {
    tree = create(
      <QueryClientProvider client={queryClient}>
        <SafeAreaProvider
          initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}
        >
          <ThemeProvider preference="dark">{node}</ThemeProvider>
        </SafeAreaProvider>
      </QueryClientProvider>,
    );
  });
  return tree!;
}

function textOf(tree: ReactTestRenderer): string {
  return tree.root.findAllByType(Text).map((n) => n.props.children).join('|');
}

beforeEach(() => {
  mockPlanByIdRefetch.mockClear();
  mockDismissTo.mockClear();
  mockSession.value = { userId: 'u1', ready: true, error: null };
});

/** A minimal stored-plan bundle at the given lifecycle status. */
function bundle(status: string) {
  return {
    plan: { id: 'plan1', race_name: 'Chicago 2026', status, num_weeks: 1, start_date: '2026-05-04', race_date: '2026-10-11', distance_kind: 'marathon' },
    weeks: [{ id: 'w1', week_index: 1, phase: 'base', target_meters: 64_000, is_recovery: false }],
    workouts: [{ week_id: 'w1', type: 'easy', planned_distance_meters: 10_000, is_quality: false, prescribed_quality_meters: null, structure: null }],
  };
}

test('shows a spinner while loading', () => {
  mockPlanById.value = { data: null, isLoading: true, error: null, refetch: mockPlanByIdRefetch };
  const tree = renderTree(<PlanDetailScreen />);
  expect(textOf(tree)).not.toContain("couldn't be found");
  act(() => tree.unmount());
});

test('session not ready yet + a disabled query (isLoading false, data undefined, error null) shows loading — NOT "not found"', () => {
  // The exact pre-ready boot window: usePlanById(ready ? userId : null, ...) is
  // disabled, so react-query v5 reports isLoading=false/error=null/data=undefined
  // even though nothing has actually resolved yet. Screen must key off `ready`,
  // not `isLoading`, to avoid flashing a false not-found here.
  mockSession.value = { userId: null, ready: false, error: null };
  mockPlanById.value = { data: undefined, isLoading: false, error: null, refetch: mockPlanByIdRefetch };
  const tree = renderTree(<PlanDetailScreen />);
  const text = textOf(tree);
  expect(text).not.toContain('couldn’t be found');
  expect(text).not.toContain('Couldn’t load this plan');
  act(() => tree.unmount());
});

test('a network error shows a message + Retry — NOT the generic "not found" copy', () => {
  mockPlanById.value = { data: null, isLoading: false, error: new Error('network unreachable'), refetch: mockPlanByIdRefetch };
  const tree = renderTree(<PlanDetailScreen />);
  const text = textOf(tree);
  expect(text).toContain('Couldn’t load this plan');
  expect(text).toContain('network unreachable');
  expect(text).not.toContain('couldn’t be found');

  const retry = tree.root.findAll(
    (n) => typeof n.props?.onPress === 'function' && n.props?.accessibilityLabel === 'Retry',
  );
  expect(retry.length).toBeGreaterThan(0);
  act(() => retry[0]!.props.onPress());
  expect(mockPlanByIdRefetch).toHaveBeenCalledTimes(1);

  act(() => tree.unmount());
});

// One window per plan. The ACTIVE plan's is the Plan tab (+ week/[id] beneath
// it), so this route must not render a second dossier of it. Nothing in the app
// links here for the active plan any more, but deep links still can.
test('an ACTIVE plan redirects to the Plan tab instead of rendering a second window', () => {
  mockPlanById.value = { data: bundle('active'), isLoading: false, error: null, refetch: mockPlanByIdRefetch };
  const tree = renderTree(<PlanDetailScreen />);
  expect(mockDismissTo).toHaveBeenCalledWith('/plan');
  // …and it paints nothing of the plan while the redirect runs.
  expect(textOf(tree)).not.toContain('Chicago 2026');
  act(() => tree.unmount());
});

test('a NON-active plan is this screen’s subject — it renders, no redirect', () => {
  mockPlanById.value = { data: bundle('archived'), isLoading: false, error: null, refetch: mockPlanByIdRefetch };
  const tree = renderTree(<PlanDetailScreen />);
  expect(mockDismissTo).not.toHaveBeenCalled();
  const text = textOf(tree);
  expect(text).toContain('Chicago 2026');
  expect(text).not.toContain('couldn’t be found');
  act(() => tree.unmount());
});

test('a genuinely missing plan (fetch succeeded, no data) shows the friendly not-found copy, no retry', () => {
  mockPlanById.value = { data: null, isLoading: false, error: null, refetch: mockPlanByIdRefetch };
  const tree = renderTree(<PlanDetailScreen />);
  const text = textOf(tree);
  expect(text).toContain('couldn’t be found');
  const retry = tree.root.findAll(
    (n) => typeof n.props?.onPress === 'function' && n.props?.accessibilityLabel === 'Retry',
  );
  expect(retry.length).toBe(0);
  act(() => tree.unmount());
});
