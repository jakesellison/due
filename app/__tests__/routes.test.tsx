/**
 * Render smoke tests for the private saved-routes library under the `app`
 * Jest project (jest-expo). The data hooks, router and auth session are mocked so
 * these confirm the list renders its rows from a realistic `SavedRoute[]` — and
 * that the empty state shows when there are no routes — without touching Supabase
 * or navigation. (The builder's geometry/reducer logic is exhaustively node-tested
 * in src/lib/__tests__/routes.*.test.ts.)
 */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { RefreshControl, Text } from 'react-native';

import { screenWrapper } from '@/app-lib/__testsupport__/render';
import type { SavedRoute } from '@/app-lib/routes';

/** Flatten nested string/number children to a single string. */
function flattenText(c: unknown): string {
  if (typeof c === 'string') return c;
  if (typeof c === 'number') return String(c);
  if (Array.isArray(c)) return c.map(flattenText).join('');
  return '';
}

/** All rendered text content joined — for substring assertions. */
function allText(tree: ReactTestRenderer): string {
  return tree.root
    .findAllByType(Text)
    .map((n) => flattenText(n.props.children))
    .join(' | ');
}

// ---- Mocks -----------------------------------------------------------------

jest.mock('@/app-lib/auth', () => ({
  useSession: () => ({ userId: 'u1', ready: true, error: null }),
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn(), canGoBack: () => true }),
}));

const mockRoutes: { value: { data?: SavedRoute[]; isLoading: boolean; error: Error | null; refetch?: () => void } } = {
  value: { data: [], isLoading: false, error: null, refetch: jest.fn() },
};
jest.mock('@/app-lib/routes', () => ({
  useRoutes: () => mockRoutes.value,
  deleteRoute: jest.fn(),
  renameRoute: jest.fn(),
}));

// Imported AFTER the mocks are registered.
import RoutesScreen from '../routes/index';

/** Does any node carry this accessibilityLabel? */
function hasLabel(tree: ReactTestRenderer, label: string): boolean {
  return tree.root.findAll((n) => n.props?.accessibilityLabel === label).length > 0;
}

function render(node: React.ReactElement): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(screenWrapper(node));
  });
  return tree;
}

beforeEach(() => {
  mockPush.mockClear();
});

// ---- Fixtures --------------------------------------------------------------

const routes: SavedRoute[] = [
  {
    id: 'r1',
    name: 'Lakefront loop',
    points: [
      [41.88, -87.62],
      [41.89, -87.61],
      [41.88, -87.62],
    ],
    drawPath: [
      [41.88, -87.62],
      [41.89, -87.61],
      [41.88, -87.62],
    ],
    distanceMeters: 8047, // ~5.0 mi
    createdAt: '2026-06-01T08:00:00.000Z',
    updatedAt: '2026-06-04T08:00:00.000Z',
    archivedAt: null,
    provenance: 'due_builder',
  },
  {
    id: 'r2',
    name: 'Boulevard out-and-back',
    points: [
      [41.9, -87.65],
      [41.91, -87.64],
    ],
    drawPath: [
      [41.9, -87.65],
      [41.91, -87.64],
    ],
    distanceMeters: 3219, // ~2.0 mi
    createdAt: '2026-05-20T08:00:00.000Z',
    updatedAt: '2026-05-20T08:00:00.000Z',
    archivedAt: null,
    provenance: 'due_builder',
  },
];

// ---- Tests -----------------------------------------------------------------

describe('RoutesScreen', () => {
  it('renders a row per saved route with its name and distance', () => {
    mockRoutes.value = { data: routes, isLoading: false, error: null };
    const tree = render(<RoutesScreen />);
    const text = allText(tree);

    expect(text).toContain('Lakefront loop');
    expect(text).toContain('Boulevard out-and-back');
    // Distance label (miles) appears on each card.
    expect(text).toContain('5.0 mi');
    expect(text).toContain('2.0 mi');
    expect(hasLabel(tree, 'Build new route')).toBe(true);
  });

  it('wires pull-to-refresh on the list', () => {
    mockRoutes.value = { data: routes, isLoading: false, error: null };
    const tree = render(<RoutesScreen />);
    const rc = tree.root.findByType(RefreshControl);
    expect(rc).toBeDefined();
    expect(typeof rc.props.onRefresh).toBe('function');
    act(() => tree.unmount());
  });

  it('shows the empty state when there are no routes', () => {
    mockRoutes.value = { data: [], isLoading: false, error: null };
    const tree = render(<RoutesScreen />);
    const text = allText(tree);

    expect(text).toContain('No saved routes yet');
    expect(text).not.toContain('Lakefront loop');
    expect(hasLabel(tree, 'Build new route')).toBe(true);
  });
});
