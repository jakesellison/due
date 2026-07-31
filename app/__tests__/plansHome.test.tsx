/**
 * plans/index — the state-adaptive /plans home. This is the single plan-entry
 * surface: with no active plan it leads with a short choice context; with an
 * active plan it leads with one dominant current-plan object. The starter
 * shelf chooses a sensible opening tier from the runner's recent mileage, then
 * leaves all tier configuration to the preview screen.
 *
 * queries + router are mocked so these assert layout/state branching without
 * touching Supabase; suggestTier/STARTER_CATALOG run for real (pure).
 */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ActionSheetIOS, Alert, Image, StyleSheet, Text, View } from 'react-native';

import { screenWrapper } from '@/app-lib/__testsupport__/render';
import type { MyPlan } from '@/app-lib/queries';

function flattenText(c: unknown): string {
  if (typeof c === 'string') return c;
  if (typeof c === 'number') return String(c);
  if (Array.isArray(c)) return c.map(flattenText).join('');
  return '';
}

// ---- Mocks -----------------------------------------------------------------

const mockSession = { value: { userId: 'u1' as string | null, ready: true, error: null as Error | null } };
jest.mock('@/app-lib/auth', () => ({ useSession: () => mockSession.value }));

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockDismissTo = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack, dismissTo: mockDismissTo, canGoBack: () => true, replace: jest.fn() }),
}));

const mockMyPlans: { value: { data: MyPlan[]; isLoading: boolean; error: Error | null; refetch: jest.Mock } } = {
  value: { data: [], isLoading: false, error: null, refetch: jest.fn() },
};
const mockRecent: { value: { weeklyMiles: number | null; isLoading: boolean } } = {
  value: { weeklyMiles: null, isLoading: false },
};
const mockIdentitySources: { value: { data: Record<string, unknown> } } = { value: { data: {} } };
const mockSwitchActivePlan = jest.fn(async (..._a: unknown[]) => undefined);
const mockDeletePlan = jest.fn(async (..._a: unknown[]) => undefined);
const mockRenamePlan = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock('@/app-lib/queries', () => ({
  useMyPlans: () => mockMyPlans.value,
  useRecentWeeklyMiles: () => mockRecent.value,
  usePlanIdentitySources: () => mockIdentitySources.value,
  switchActivePlan: (...a: unknown[]) => mockSwitchActivePlan(...a),
  deletePlan: (...a: unknown[]) => mockDeletePlan(...a),
  renamePlan: (...a: unknown[]) => mockRenamePlan(...a),
  fetchPlanBundle: jest.fn(async () => null),
  exportPlanToRelative: jest.fn(() => ({})),
  planDueFilename: () => 'plan.due',
  invalidatePlanActivityCaches: jest.fn(async () => undefined),
}));

import PlansHome from '../plans/index';

function renderTree(): ReactTestRenderer {
  let tree: ReactTestRenderer | undefined;
  act(() => {
    tree = create(screenWrapper(<PlansHome />));
  });
  return tree!;
}

function texts(tree: ReactTestRenderer): string[] {
  return tree.root.findAllByType(Text).map((n) => flattenText(n.props.children));
}

const activePlan: MyPlan = {
  id: 'p-active',
  raceName: 'Chicago 2026',
  goalTime: '2:36',
  numWeeks: 18,
  status: 'active',
  distanceKind: 'marathon',
  raceDate: '2026-10-11',
  startDate: '2026-05-04',
};

/** The overflow-menu Pressable for a given plan (accessibilityLabel `${name} options`). */
function menuButton(tree: ReactTestRenderer, raceName: string) {
  return tree.root.find((n) => typeof n.props?.onPress === 'function' && n.props?.accessibilityLabel === `${raceName} options`);
}

beforeEach(() => {
  mockPush.mockClear();
  mockBack.mockClear();
  mockDismissTo.mockClear();
  mockSwitchActivePlan.mockClear();
  mockDeletePlan.mockClear();
  mockRenamePlan.mockClear();
  mockSession.value = { userId: 'u1', ready: true, error: null };
  mockMyPlans.value = { data: [], isLoading: false, error: null, refetch: jest.fn() };
  mockRecent.value = { weeklyMiles: null, isLoading: false };
  mockIdentitySources.value = { data: {} };
});

describe('PlansHome — no active plan', () => {
  test('leads with plan-choice context and keeps import as a secondary path', () => {
    const tree = renderTree();
    const t = texts(tree);
    expect(t.some((x) => x === 'Build toward race day')).toBe(true);
    expect(t.some((x) => x === 'Bring your own plan')).toBe(true);
    expect(t.some((x) => x === 'Current plan')).toBe(false);
    expect(t.some((x) => x === 'Saved plans')).toBe(false);
    // Covers are procedural instruments now: no raster art anywhere, and the
    // bring-your-own door carries the same generated language as the shelf.
    expect(tree.root.findAllByType(Image)).toHaveLength(0);
    expect(tree.root.findAll((node) => node.type === View && node.props.testID === 'plan-artwork-bring-your-own')).toHaveLength(1);
    expect(tree.root.findAll((node) => node.type === View && node.props.testID === 'plan-artwork-5k')).toHaveLength(1);
    act(() => tree.unmount());
  });
});

describe('PlansHome — active plan', () => {
  test('leads with the current plan object, then the starter shelf', () => {
    mockMyPlans.value = { data: [activePlan], isLoading: false, error: null, refetch: jest.fn() };
    mockIdentitySources.value = { data: {
      'p-active': {
        weeks: Array.from({ length: 18 }, (_, index) => ({ weekIndex: index + 1, phase: index < 4 ? 'base' : index < 14 ? 'build' : 'taper', targetMeters: 64_000 + index * 1_000 })),
        workouts: [{ weekIndex: 1, type: 'quality', isQuality: true, plannedDistanceMeters: 8_000, prescribedQualityMeters: 8_000, structure: [] }],
      },
    } };
    const tree = renderTree();
    const t = texts(tree);
    const current = t.findIndex((value) => value.startsWith('Current plan'));
    const shelf = t.indexOf('Starter plans');
    expect(current).toBeGreaterThanOrEqual(0);
    expect(shelf).toBeGreaterThanOrEqual(0);
    expect(current).toBeLessThan(shelf);
    expect(t.some((x) => x.includes('Chicago 2026'))).toBe(true);
    expect(t.some((x) => x === 'MI PLAN')).toBe(true);
    expect(tree.root.findAllByProps({ testID: 'plan-total-mileage' }).length).toBeGreaterThan(0);
    expect(tree.root.findAllByProps({ testID: 'plan-current-week-marker' }).length).toBeGreaterThan(0);
    const openLabel = 'Open current plan, Chicago 2026';
    const independentOpeners = tree.root
      .findAll((node) => node.props?.accessibilityLabel === openLabel)
      .filter((node) => node.parent?.props?.accessibilityLabel !== openLabel);
    expect(independentOpeners).toHaveLength(1);
    expect(t.some((x) => x === 'Choose a training block')).toBe(false);
    act(() => tree.unmount());
  });

  test('renders saved plans as a flat ledger on the page canvas', () => {
    mockMyPlans.value = {
      data: [activePlan, { ...activePlan, id: 'p-saved', raceName: 'Goal 10K', status: 'archived', distanceKind: '10k' }],
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    };
    const tree = renderTree();
    const ledger = tree.root.findByProps({ testID: 'saved-plan-ledger' });
    const ledgerStyle = StyleSheet.flatten(ledger.props.style);
    expect(ledgerStyle.borderWidth ?? 0).toBe(0);
    expect(ledgerStyle.backgroundColor).toBeUndefined();
    expect(ledgerStyle.borderBottomWidth).toBeGreaterThan(0);
    act(() => tree.unmount());
  });

  // Saved plans have ONE window. The hub used to show two of them behind a
  // "VIEW ALL n" door to /plans/saved, which rendered the same rows a second
  // time; the ledger now simply lists all of them and that screen is gone.
  test('lists every saved plan — no two-item cap, no second archive window', () => {
    const saved = Array.from({ length: 12 }, (_, index): MyPlan => ({
      ...activePlan,
      id: `p-saved-${index + 1}`,
      raceName: `Saved ${index + 1}`,
      status: 'archived',
    }));
    mockMyPlans.value = {
      data: [activePlan, ...saved],
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    };

    const tree = renderTree();
    const t = texts(tree);
    // The heading carries the full count instead of a link out.
    expect(t).toContain('12 PLANS');
    expect(t.some((x) => x.startsWith('VIEW ALL'))).toBe(false);
    expect(tree.root.findAll((node) => String(node.props?.accessibilityLabel ?? '').startsWith('View all'))).toHaveLength(0);

    // Every saved plan is on the page — not just the first two.
    for (let index = 1; index <= 12; index += 1) {
      expect(tree.root.findAll((node) => node.props?.accessibilityLabel === `Saved ${index} options`).length).toBeGreaterThan(0);
    }
    expect(mockPush).not.toHaveBeenCalledWith('/plans/saved');
    act(() => tree.unmount());
  });

  // The active plan's one window is the Plan tab. Plans is a modal ABOVE the
  // tabs, so opening it is a dismissal (dismissTo), not a push to a second
  // read-only dossier at /plans/[id].
  test('“Open plan” dismisses the modal onto the Plan tab, never /plans/[id]', () => {
    mockMyPlans.value = { data: [activePlan], isLoading: false, error: null, refetch: jest.fn() };
    const tree = renderTree();
    const openLabel = 'Open current plan, Chicago 2026';
    const opener = tree.root
      .findAll((node) => node.props?.accessibilityLabel === openLabel)
      .filter((node) => node.parent?.props?.accessibilityLabel !== openLabel)[0]!;

    act(() => opener.props.onPress());
    expect(mockDismissTo).toHaveBeenCalledWith('/plan');
    expect(mockPush).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });

  // A saved (non-active) plan still opens its inspector — that route keeps its
  // job, it just no longer doubles as a window onto the active plan.
  test('a saved plan row still pushes /plans/[id]', () => {
    const boston: MyPlan = { ...activePlan, id: 'p-saved', raceName: 'Boston 2027', status: 'archived' };
    mockMyPlans.value = { data: [activePlan, boston], isLoading: false, error: null, refetch: jest.fn() };
    const tree = renderTree();
    const row = tree.root.find((node) => typeof node.props?.onPress === 'function' && node.props?.accessibilityLabel === 'Boston 2027. View plan.');
    act(() => row.props.onPress());
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/plans/[id]', params: { id: 'p-saved' } });
    act(() => tree.unmount());
  });
});

describe('PlansHome — starter shelf', () => {
  test('renders one plan-shape row for every race distance', () => {
    const tree = renderTree();
    const t = texts(tree);
    for (const label of ['5K', '10K', 'Half Marathon', 'Marathon']) {
      expect(t.some((x) => x === label)).toBe(true);
    }
    for (const miles of ['3.1', '6.2', '13.1', '26.2']) {
      expect(t.some((x) => x === miles)).toBe(true);
    }
    const rows = tree.root.findAll((n) => typeof n.props?.onPress === 'function' && String(n.props?.accessibilityLabel ?? '').includes('average miles per week'));
    expect(rows).toHaveLength(4);
    act(() => tree.unmount());
  });

  test('recent mileage chooses the tier each distance opens at (weeklyMiles=44 → 45)', () => {
    mockRecent.value = { weeklyMiles: 44, isLoading: false };
    const tree = renderTree();
    const rows = tree.root.findAll((n) => typeof n.props?.onPress === 'function' && String(n.props?.accessibilityLabel ?? '').includes('average miles per week'));
    expect(rows).toHaveLength(4);
    expect(texts(tree)).toContain('45 MI/WK');
    expect(texts(tree).some((x) => x.includes('Opening volume is set from your recent training'))).toBe(true);
    act(() => tree.unmount());
  });
});

// /plans is now the app's ONLY active-plan switching surface (the You "Plan"
// section and the Plan-tab library toggle both collapsed into it). These drive
// flat ledger → overflow-menu → confirm path the moved machinery owns, covering
// the behavioral assertions the deleted you.test.tsx cases held.
describe('PlansHome — switching + menu guards', () => {
  const boston: MyPlan = {
    id: 'p-other',
    raceName: 'Boston 2027',
    goalTime: '2:42',
    numWeeks: 18,
    status: 'archived',
    distanceKind: 'marathon',
    raceDate: '2027-04-19',
  };

  test('activating an inactive plan calls switchActivePlan(planId, activePlanId, queryClient)', async () => {
    mockMyPlans.value = { data: [activePlan, boston], isLoading: false, error: null, refetch: jest.fn() };
    // Pick "Make active" from the action sheet, then confirm the Alert.
    const sheetSpy = jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation((opts, cb) => {
      cb(opts.options.indexOf('Make active'));
    });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      (buttons ?? []).find((b) => b.text === 'Switch')?.onPress?.();
    });

    const tree = renderTree();
    await act(async () => {
      menuButton(tree, 'Boston 2027').props.onPress();
    });
    // from = the tapped plan, active = the currently-active plan id, plus the client.
    expect(mockSwitchActivePlan).toHaveBeenCalledWith('p-other', 'p-active', expect.anything());

    sheetSpy.mockRestore();
    alertSpy.mockRestore();
    act(() => tree.unmount());
  });

  test('the active plan menu offers no "Make active" and never switches (guard no-op)', () => {
    mockMyPlans.value = { data: [activePlan, boston], isLoading: false, error: null, refetch: jest.fn() };
    let captured: readonly string[] = [];
    const sheetSpy = jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation((opts, cb) => {
      captured = opts.options;
      cb(opts.options.indexOf('Cancel'));
    });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

    const tree = renderTree();
    act(() => {
      menuButton(tree, 'Chicago 2026').props.onPress();
    });
    expect(captured).not.toContain('Make active');
    expect(mockSwitchActivePlan).not.toHaveBeenCalled();

    sheetSpy.mockRestore();
    alertSpy.mockRestore();
    act(() => tree.unmount());
  });

  test('deleting the active plan surfaces the active-plan guard warning', () => {
    mockMyPlans.value = { data: [activePlan, boston], isLoading: false, error: null, refetch: jest.fn() };
    const sheetSpy = jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation((opts, cb) => {
      cb(opts.options.indexOf('Delete'));
    });
    // Do NOT confirm — assert only that the guard warning is raised.
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

    const tree = renderTree();
    act(() => {
      menuButton(tree, 'Chicago 2026').props.onPress();
    });
    expect(alertSpy).toHaveBeenCalledWith('Delete your active plan?', expect.stringContaining('is active'), expect.any(Array));
    expect(mockDeletePlan).not.toHaveBeenCalled();

    sheetSpy.mockRestore();
    alertSpy.mockRestore();
    act(() => tree.unmount());
  });
});
