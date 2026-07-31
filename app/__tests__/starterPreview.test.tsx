/**
 * Render tests for the starter preview screen (`app/plans/starter/[id].tsx`),
 * under the jest-expo `app` project. The starter catalog + anchor math +
 * normalizer are the REAL pure modules (not mocked) — only the runtime edges
 * (queries / auth / router) are stubbed. The screen's anchor state is driven
 * through the mounted `AnchorSheet`'s `onChange` prop, exactly the callback the
 * real sheet fires.
 */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Alert, Image, Text, View } from 'react-native';

import { screenWrapper } from '@/app-lib/__testsupport__/render';
import type { ImportedPlanDraft } from '@/lib';
import { todayIsoDate, type PlanAnchor } from '@/lib/plan/anchor';
import { weekStartOf } from '@/lib/time/week';

const DAY_MS = 86400 * 1000;
const noon = (iso: string) => Date.parse(`${iso}T12:00:00Z`);
const addDays = (iso: string, d: number) => new Date(noon(iso) + d * DAY_MS).toISOString().slice(0, 10);

/** A race date whose week is `weeksOut` weeks away from today (Saturday of that
 *  week), so `anchorPlan` sees exactly `weeksOut` weeks available. */
function raceDateWeeksOut(weeksOut: number): string {
  const monday = weekStartOf(todayIsoDate(), 'mon');
  return addDays(monday, (weeksOut - 1) * 7 + 5); // +5 = Saturday of that week
}

function flattenText(c: unknown): string {
  if (typeof c === 'string') return c;
  if (typeof c === 'number') return String(c);
  if (Array.isArray(c)) return c.map(flattenText).join('');
  return '';
}
/** Concatenate every Text node with NO separator, so a value split across an
 *  outer + nested (styled unit) Text reads contiguously — e.g. "12 wks". */
function allText(tree: ReactTestRenderer): string {
  return tree.root.findAllByType(Text).map((n) => flattenText(n.props.children)).join('');
}

// ---- Mocks -----------------------------------------------------------------

const mockInstallPlanDraft = jest.fn<Promise<{ planId: string }>, [ImportedPlanDraft, unknown]>(async () => ({ planId: 'p1' }));
interface MyPlanLike { id: string; raceName: string; status: string | null }
const mockMyPlans: { value: { data: MyPlanLike[] } } = { value: { data: [] } };
jest.mock('@/app-lib/queries', () => ({
  installPlanDraft: (draft: ImportedPlanDraft, qc: unknown) => mockInstallPlanDraft(draft, qc),
  useMyPlans: () => mockMyPlans.value,
}));

jest.mock('@/app-lib/auth', () => ({ useSession: () => ({ userId: 'u1', ready: true }) }));

const mockReplace = jest.fn();
const mockBack = jest.fn();
const mockSetParams = jest.fn();
const mockParams: { value: { id?: string } } = { value: { id: 'half-45' } };
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, back: mockBack, setParams: mockSetParams }),
  useLocalSearchParams: () => mockParams.value,
}));

import StarterPreviewScreen from '../plans/starter/[id]';
import { AnchorSheet } from '@/components/plan/AnchorSheet';

function renderTree(): ReactTestRenderer {
  let tree: ReactTestRenderer | undefined;
  act(() => {
    tree = create(screenWrapper(<StarterPreviewScreen />));
  });
  return tree!;
}

function byLabel(tree: ReactTestRenderer, label: string) {
  return tree.root.findAll((n) => typeof n.props?.onPress === 'function' && n.props?.accessibilityLabel === label)[0];
}

/** Drive the screen's anchor state through the mounted sheet's onChange. */
function setAnchor(tree: ReactTestRenderer, anchor: PlanAnchor) {
  act(() => {
    tree.root.findByType(AnchorSheet).props.onChange(anchor);
  });
}

beforeEach(() => {
  mockInstallPlanDraft.mockClear();
  mockMyPlans.value = { data: [] };
  mockParams.value = { id: 'half-45' };
  mockReplace.mockClear();
  mockBack.mockClear();
  mockSetParams.mockClear();
});

describe('StarterPreviewScreen', () => {
  it('renders the starter identity, stats, and the progression chart (default start anchor)', () => {
    const tree = renderTree();
    const text = allText(tree);
    expect(text).toContain('Half marathon');
    expect(text).toContain('Training volume45 mi/week');
    expect(text).toContain('499MI PLAN');
    expect(text).toContain('12weeks42mi/wk avg52mi peak');
    expect(text).not.toContain('16% quality');
    expect(text).not.toContain('Mileage profile'); // canonical cover replaces the duplicate chart
    expect(text).toContain('Training blocks');
    expect(tree.root.findAllByType(Text).some((node) => flattenText(node.props.children) === 'Weeks')).toBe(false);
    expect(tree.root.findAllByProps({ testID: 'phase-header-base' }).length).toBeGreaterThan(0);
    expect(tree.root.findAllByType(Image)).toHaveLength(0);
    expect(tree.root.findAll((node) => node.type === View && node.props.testID === 'plan-artwork-half')).toHaveLength(1);
  });

  it('changes training volume in place without replacing the preview route', () => {
    const tree = renderTree();
    act(() => {
      byLabel(tree, '60 miles per week')!.props.onPress();
    });

    expect(allText(tree)).toContain('Training volume60 mi/week');
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockSetParams).toHaveBeenCalledWith({ id: 'half-60' });
    act(() => tree.unmount());
  });

  it('shows the join notice when a race date trims the front of the block', () => {
    const tree = renderTree();
    setAnchor(tree, { kind: 'race', raceDate: raceDateWeeksOut(9) });
    expect(allText(tree)).toContain('Join at week 4 of 12');
  });

  it('shows a too-close notice and disables install in race mode, but start mode stays installable', () => {
    const tree = renderTree();
    setAnchor(tree, { kind: 'race', raceDate: raceDateWeeksOut(3) });
    // Plain notice + install disabled while race-anchored too close. byLabel[0]
    // is the ActionButton, which carries the resolved `disabled` prop.
    expect(allText(tree).toLowerCase()).toContain('too close');
    expect(byLabel(tree, 'Install plan')?.props.disabled).toBe(true);

    // A start-date anchor is always installable.
    setAnchor(tree, { kind: 'start', startDate: raceDateWeeksOut(3) });
    expect(byLabel(tree, 'Install plan')?.props.disabled).toBe(false);
  });

  it('confirms archiving an active plan, then installs a starter-sourced draft', async () => {
    const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockMyPlans.value = { data: [{ id: 'a', raceName: 'Old Plan', status: 'active' }] };
    const tree = renderTree();

    act(() => {
      byLabel(tree, 'Install plan')!.props.onPress();
    });
    expect(spy).toHaveBeenCalled();
    const [title, body, buttons] = spy.mock.calls[0] as [string, string, Array<{ text: string; onPress?: () => void }>];
    expect(title).toContain('Half · 45 mpw');
    expect(body).toBe('Your current plan will be archived — its history is kept.');
    expect(mockInstallPlanDraft).not.toHaveBeenCalled();

    // Fire the confirm action.
    const confirm = buttons.find((b) => /install|replace/i.test(b.text));
    await act(async () => {
      await confirm?.onPress?.();
    });
    expect(mockInstallPlanDraft).toHaveBeenCalledTimes(1);
    expect(mockInstallPlanDraft.mock.calls[0]?.[0].source).toBe('starter');
    expect(mockReplace).toHaveBeenCalledWith('/(tabs)');
    spy.mockRestore();
  });
});
