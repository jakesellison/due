/**
 * Render tests for the bring-your-own-AI plan import screen (jest-expo `app`
 * project). The chat installer + server parser are gone; ingest is the real,
 * pure `parsePlanImport`, fed by a picked file or a paste, then the review +
 * `installPlanDraft`. Document picker / file system / queries / auth / router
 * are mocked; the parser is NOT (it's pure).
 */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Alert, Image, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ThemeProvider } from '@/theme/ThemeProvider';
import type { ImportedPlanDraft } from '@/lib';
import { nextMondayIso, todayIsoDate } from '@/lib';
import { formatAnchorDate } from '@/components/plan/AnchorSheet';

const DAY_MS = 86400 * 1000;
const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

function flattenText(c: unknown): string {
  if (typeof c === 'string') return c;
  if (typeof c === 'number') return String(c);
  if (Array.isArray(c)) return c.map(flattenText).join('');
  return '';
}
function allText(tree: ReactTestRenderer): string {
  return tree.root.findAllByType(Text).map((n) => flattenText(n.props.children)).join(' | ');
}

/**
 * A valid Due-format plan (v3 "relative": dateless week+day offsets), as the
 * user's AI now emits it. Dates enter only at install time via the anchor.
 */
const validPlanJson = JSON.stringify({
  formatVersion: 3,
  source: 'import',
  plan: { name: 'Chicago Marathon', distanceKind: 'marathon', goalTimeSeconds: 9360, numWeeks: 18 },
  workouts: [
    { week: 1, day: 0, type: 'easy', title: 'Easy run', plannedDistanceMeters: 9656 },
    { week: 1, day: 2, type: 'quality', title: 'Threshold', plannedDistanceMeters: 16093 },
    { week: 1, day: 5, type: 'long', title: 'Long run', plannedDistanceMeters: 24140 },
    { week: 18, day: 5, type: 'race', title: 'Race day', plannedDistanceMeters: 42195 },
    // A Sunday shakeout AFTER a Saturday race — dropped when race-anchored.
    { week: 18, day: 6, type: 'easy', title: 'Shakeout', plannedDistanceMeters: 3000 },
  ],
});

/** The retired v1 shape (fixed calendar dates) — must be rejected on sight. */
const v1DatedPlanJson = JSON.stringify({
  source: 'import',
  plan: { raceName: 'Chicago Marathon', raceDate: '2026-10-11', distanceKind: 'marathon', startDate: '2026-06-08', numWeeks: 18 },
  workouts: [{ date: '2026-06-08', type: 'easy', title: 'Easy run', plannedDistanceMeters: 9656 }],
});

const mockGetDocumentAsync = jest.fn();
jest.mock('expo-document-picker', () => ({ getDocumentAsync: (...a: unknown[]) => mockGetDocumentAsync(...a) }));

const mockSetStringAsync = jest.fn<Promise<boolean>, [string]>(async () => true);
jest.mock('expo-clipboard', () => ({ setStringAsync: (value: string) => mockSetStringAsync(value) }));

const mockReadAsStringAsync = jest.fn<Promise<string>, [string, unknown]>(async () => validPlanJson);
// `getInfoAsync` is the pre-read size guard (`readPlanFile`) — a plan file is
// read only after its size is known to be under the import cap. Default it to a
// small, existing file; individual tests override it to exercise the refusal.
const mockGetInfoAsync = jest.fn(async (_uri: string) => ({ exists: true, size: 1024 }));
jest.mock('expo-file-system/legacy', () => ({
  EncodingType: { Base64: 'base64', UTF8: 'utf8' },
  readAsStringAsync: (uri: string, opts: unknown) => mockReadAsStringAsync(uri, opts),
  getInfoAsync: (uri: string) => mockGetInfoAsync(uri),
}));

const mockInstallPlanDraft = jest.fn<Promise<{ planId: string }>, [ImportedPlanDraft, unknown]>(async () => ({ planId: 'p1' }));
interface MyPlanLike { id: string; raceName: string; status: string | null }
const mockMyPlans: { value: { data: MyPlanLike[] } } = { value: { data: [] } };
jest.mock('@/app-lib/queries', () => ({
  installPlanDraft: (draft: ImportedPlanDraft, qc: unknown) => mockInstallPlanDraft(draft, qc),
  useMyPlans: () => mockMyPlans.value,
}));

jest.mock('@/app-lib/auth', () => ({ useSession: () => ({ userId: 'u1', ready: true }) }));

const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockDismissTo = jest.fn();
const mockParams: { value: { src?: string } } = { value: {} };
jest.mock('expo-router', () => ({
  useRouter: () => ({
    back: mockBack,
    canGoBack: () => true,
    dismissTo: mockDismissTo,
    replace: mockReplace,
  }),
  useLocalSearchParams: () => mockParams.value,
}));

import InstallPlanScreen from '../plans/install';

function renderTree(): ReactTestRenderer {
  let tree: ReactTestRenderer | undefined;
  const queryClient = new QueryClient();
  act(() => {
    tree = create(
      <ThemeProvider preference="dark">
        <QueryClientProvider client={queryClient}>
          <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}>
            <InstallPlanScreen />
          </SafeAreaProvider>
        </QueryClientProvider>
      </ThemeProvider>,
    );
  });
  return tree!;
}

function byLabel(tree: ReactTestRenderer, label: string) {
  return tree.root.findAll((n) => typeof n.props?.onPress === 'function' && n.props?.accessibilityLabel === label)[0];
}
/** Any node (not just pressables) carrying an accessibility label — e.g. the paste field. */
function byAnyLabel(tree: ReactTestRenderer, label: string) {
  return tree.root.findAll((n) => n.props?.accessibilityLabel === label)[0];
}
/** The AnchorSheet — the parent-owned control we drive to change the anchor. */
function findAnchorSheet(tree: ReactTestRenderer) {
  return tree.root.findAll(
    (n) => typeof n.props?.onChange === 'function' && !!n.props?.anchor && !!n.props?.plan,
  )[0];
}

const fileAsset = { canceled: false, assets: [{ uri: 'file:///plan.due', name: 'plan.due', mimeType: 'application/json', size: 100 }] };

beforeEach(() => {
  mockGetDocumentAsync.mockReset();
  mockReadAsStringAsync.mockClear();
  mockReadAsStringAsync.mockResolvedValue(validPlanJson);
  mockInstallPlanDraft.mockClear();
  mockMyPlans.value = { data: [] };
  mockParams.value = {};
  mockBack.mockClear();
  mockReplace.mockClear();
  mockDismissTo.mockClear();
  mockSetStringAsync.mockClear();
});

describe('InstallPlanScreen', () => {
  it('renders a focused import source hub', () => {
    const tree = renderTree();
    expect(allText(tree)).toContain('Import a plan');
    expect(byLabel(tree, 'Open the plan file')).toBeTruthy();
    expect(byLabel(tree, 'Convert an existing plan')).toBeTruthy();
    expect(byLabel(tree, 'Create a new plan')).toBeTruthy();
    // The hero is generated from Due's own instrument language, not a photo.
    expect(tree.root.findAllByType(Image)).toHaveLength(0);
    expect(tree.root.findAll((n) => n.type === View && n.props?.testID === 'plan-artwork-bring-your-own')).toHaveLength(1);
  });

  it('returns to the previous screen with back navigation', () => {
    const tree = renderTree();

    act(() => {
      byLabel(tree, 'Back')!.props.onPress();
    });

    expect(mockBack).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  it('opens a focused AI conversion guide and copies the real prompt', async () => {
    jest.useFakeTimers();
    const tree = renderTree();
    act(() => {
      byLabel(tree, 'Convert an existing plan')!.props.onPress();
    });
    expect(allText(tree)).toContain('Convert a plan');
    expect(byLabel(tree, 'Copy the import prompt')).toBeTruthy();
    await act(async () => {
      await byLabel(tree, 'Copy the import prompt')!.props.onPress();
    });
    expect(mockSetStringAsync).toHaveBeenCalledTimes(1);
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  it('imports a .due file → review → install', async () => {
    mockGetDocumentAsync.mockResolvedValue(fileAsset);
    const tree = renderTree();
    await act(async () => {
      await byLabel(tree, 'Open the plan file')!.props.onPress();
    });
    const text = allText(tree);
    expect(text).toContain('Chicago Marathon');
    expect(text).toContain('Easy run');
    expect(text).toContain('Mileage profile');
    expect(text).toContain('Training blocks');
    expect(tree.root.findAll((n) => n.props?.testID === 'plan-blueprint').length).toBeGreaterThan(0);
    expect(tree.root.findAllByType(Image)).toHaveLength(0);

    await act(async () => {
      await byLabel(tree, 'Install plan')!.props.onPress();
    });
    expect(mockInstallPlanDraft).toHaveBeenCalledTimes(1);
    expect(mockDismissTo).toHaveBeenCalledWith('/plan');
  });

  it('shows an error and stays on import when the file is not a valid plan', async () => {
    const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockReadAsStringAsync.mockResolvedValueOnce('not json {');
    mockGetDocumentAsync.mockResolvedValue(fileAsset);
    const tree = renderTree();
    await act(async () => {
      await byLabel(tree, 'Open the plan file')!.props.onPress();
    });
    expect(spy).toHaveBeenCalled();
    expect(allText(tree)).toContain('Import a plan');
    expect(allText(tree)).not.toContain('Chicago Marathon');
    spy.mockRestore();
  });

  // Reading an arbitrary picked/shared file into memory unbounded is a crash
  // waiting to happen, so the size is checked FIRST and an oversized file is
  // never read at all.
  it('refuses an oversized file without reading it', async () => {
    const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockGetInfoAsync.mockResolvedValueOnce({ exists: true, size: 50 * 1024 * 1024 });
    mockGetDocumentAsync.mockResolvedValue(fileAsset);
    const tree = renderTree();
    await act(async () => {
      await byLabel(tree, 'Open the plan file')!.props.onPress();
    });
    expect(mockReadAsStringAsync).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalled();
    expect(allText(tree)).toContain('Import a plan');
    spy.mockRestore();
  });

  it('auto-imports a .due file opened/shared into the app (src param)', async () => {
    mockParams.value = { src: 'file:///inbox/plan.due' };
    const tree = renderTree();
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockReadAsStringAsync).toHaveBeenCalledWith('file:///inbox/plan.due', expect.anything());
    expect(allText(tree)).toContain('Chicago Marathon');
  });

  it('confirms before replacing an active plan', async () => {
    const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockMyPlans.value = { data: [{ id: 'a', raceName: 'Old Plan', status: 'active' }] };
    mockGetDocumentAsync.mockResolvedValue(fileAsset);
    const tree = renderTree();
    await act(async () => {
      await byLabel(tree, 'Open the plan file')!.props.onPress();
    });
    await act(async () => {
      await byLabel(tree, 'Install plan')!.props.onPress();
    });
    expect(spy).toHaveBeenCalledWith('Install Chicago Marathon', 'Your current plan will be archived — its history is kept.', expect.any(Array));
    expect(mockInstallPlanDraft).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  // ── Source-neutral reframe + install-time anchoring ────────────────────────
  it('puts direct import above the optional AI paths', () => {
    const tree = renderTree();
    const text = allText(tree);
    expect(text).toContain('Bring your plan into Due');
    expect(text).toContain('Create with AI');
    expect(text.indexOf('Open .due file')).toBeLessThan(text.indexOf('Create with AI'));
  });

  it('pastes a valid v3 plan → review with the default next-Monday anchor', async () => {
    const tree = renderTree();
    await act(async () => {
      byLabel(tree, 'Show paste plan text')!.props.onPress();
    });
    await act(async () => {
      byAnyLabel(tree, 'Paste plan text')!.props.onChangeText(validPlanJson);
    });
    await act(async () => {
      await byLabel(tree, 'Use pasted text')!.props.onPress();
    });
    const text = allText(tree);
    expect(text).toContain('Chicago Marathon');
    expect(text).toContain('Easy run');
    expect(text).toContain(`Starts ${formatAnchorDate(nextMondayIso(todayIsoDate()))}`);
  });

  it('re-anchors to a race date → re-renders dates and shows join-at-week when trimmed', async () => {
    mockGetDocumentAsync.mockResolvedValue(fileAsset);
    const tree = renderTree();
    await act(async () => {
      await byLabel(tree, 'Open the plan file')!.props.onPress();
    });
    // A race ~14 usable weeks out: the 18-week plan trims from the front → join at week 5.
    const raceDate = addDays(nextMondayIso(todayIsoDate()), 89);
    await act(async () => {
      findAnchorSheet(tree)!.props.onChange({ kind: 'race', raceDate });
    });
    const text = allText(tree);
    expect(text).toContain(`Race ${formatAnchorDate(raceDate)}`);
    expect(text).toContain('join at week 5');
    expect(text).toContain('14 weeks');
    expect(text).not.toContain("You'll join at week 5 of 18.");
  });

  it('rejects a retired plan with the v3 migration message', async () => {
    const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const tree = renderTree();
    await act(async () => {
      byLabel(tree, 'Show paste plan text')!.props.onPress();
    });
    await act(async () => {
      byAnyLabel(tree, 'Paste plan text')!.props.onChangeText(v1DatedPlanJson);
    });
    await act(async () => {
      await byLabel(tree, 'Use pasted text')!.props.onPress();
    });
    expect(spy).toHaveBeenCalledWith('Couldn’t import plan', expect.stringContaining('older Due pace format'));
    expect(allText(tree)).toContain('Import a plan');
    expect(allText(tree)).not.toContain('Chicago Marathon');
    spy.mockRestore();
  });

  it('installs the anchored + normalized draft (dated from the default anchor)', async () => {
    mockGetDocumentAsync.mockResolvedValue(fileAsset);
    const tree = renderTree();
    await act(async () => {
      await byLabel(tree, 'Open the plan file')!.props.onPress();
    });
    await act(async () => {
      await byLabel(tree, 'Install plan')!.props.onPress();
    });
    expect(mockInstallPlanDraft).toHaveBeenCalledTimes(1);
    const draft = mockInstallPlanDraft.mock.calls[0]![0];
    expect(draft.plan.raceName).toBe('Chicago Marathon');
    expect(draft.plan.startDate).toBe(nextMondayIso(todayIsoDate()));
    // Normalized → workouts carry real calendar dates, not week/day offsets.
    const first = draft.workouts[0]!;
    expect(typeof first.date).toBe('string');
    expect(first).not.toHaveProperty('week');
  });

  it('folds an anchoring warning (dropped tail workout) into the review notes', async () => {
    mockGetDocumentAsync.mockResolvedValue(fileAsset);
    const tree = renderTree();
    await act(async () => {
      await byLabel(tree, 'Open the plan file')!.props.onPress();
    });
    // Full-length race on a Saturday → the week-18 Sunday shakeout lands after
    // race day and is dropped, with a warning that must reach "Heads up".
    const raceDate = addDays(nextMondayIso(todayIsoDate()), (18 - 1) * 7 + 5);
    await act(async () => {
      findAnchorSheet(tree)!.props.onChange({ kind: 'race', raceDate });
    });
    const text = allText(tree);
    expect(text).toContain('Heads up');
    expect(text).toContain('Dropped "Shakeout"');
  });

  it('keeps the plan summary while hard-disabling Install when the race anchor is too close', async () => {
    mockGetDocumentAsync.mockResolvedValue(fileAsset);
    const tree = renderTree();
    await act(async () => {
      await byLabel(tree, 'Open the plan file')!.props.onPress();
    });
    // A race only ~2 weeks out — far inside the 18-week plan's minimum, so the
    // anchor refuses (draft is null) yet the full-length fallback keeps the
    // chart + summary on screen while Install stays disabled.
    const raceDate = addDays(nextMondayIso(todayIsoDate()), 14);
    await act(async () => {
      findAnchorSheet(tree)!.props.onChange({ kind: 'race', raceDate });
    });
    const text = allText(tree);
    expect(text).toContain('TOO CLOSE');
    expect(text).toContain('Chicago Marathon');
    const cta = tree.root.findAll(
      (n) => n.props?.accessibilityLabel === 'Install plan' && typeof n.props?.disabled === 'boolean',
    )[0];
    expect(cta?.props.disabled).toBe(true);
  });

  it('uses the Plan-tab phase interaction and keeps a collapsed block closed', async () => {
    mockGetDocumentAsync.mockResolvedValue(fileAsset);
    const tree = renderTree();
    await act(async () => {
      await byLabel(tree, 'Open the plan file')!.props.onPress();
    });
    // The first training block opens around the selected week.
    expect(allText(tree)).toContain('Threshold');
    const blockHeader = tree.root.findAll(
      (n) => typeof n.props?.onPress === 'function'
        && typeof n.props?.accessibilityLabel === 'string'
        && n.props.accessibilityLabel.startsWith('Build phase,'),
    )[0];
    await act(async () => {
      blockHeader!.props.onPress();
    });
    expect(allText(tree)).not.toContain('Threshold');
  });
});
