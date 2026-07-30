/**
 * ContractMetMoment — the run-that-closed-the-week's-mileage-contract escalation.
 * Pins: the banked/target numbers render, both actions fire exactly once, the
 * root stays non-modal (box-none) so the Dash beneath is tappable, the shared
 * WeekContractStamp is the hero (not a re-drawn shape), and — FIX 1 — leaving
 * without tapping View/Close still counts as acknowledged.
 *
 * `useFocusEffect` is mocked as a plain mount-effect (real `useEffect` under
 * the hood): this component has no navigator context in isolation, and RTL's
 * `unmount()` is the stand-in for "the runner left" — it exercises the exact
 * cleanup path `useFocusEffect` calls on a real blur or unmount.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';

import { resetAppPreferencesForTests, useAppPreferences } from '@/app-lib/preferences';
import { ThemeProvider } from '@/theme/ThemeProvider';
import type { WeekGoal } from '@/lib/kpi/weekGoals';
import { ContractMetMoment } from '../ContractMetMoment';

jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void | (() => void)) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { useEffect } = require('react');
    useEffect(() => effect(), []);
  },
}));

const MI = 1609.344;

function metWeek(): WeekGoal {
  const stat = (targetMi: number) => ({
    actualMeters: targetMi * MI,
    targetMeters: targetMi * MI,
    hit: true,
    fraction: 1,
  });
  return {
    weekIndex: 4,
    weekStart: '2026-07-06',
    label: 'W4',
    isCurrent: true,
    isFuture: false,
    mileage: stat(42),
    quality: stat(10),
    long: stat(18),
    allMet: true,
  };
}

/**
 * A round closing run: 10km in 50:00. Chosen so BOTH unit systems land on exact
 * strings — 5:00/km, and 6.2 mi @ 8:03/mi — instead of assertions that would
 * drift with a rounding change.
 */
const RUN = { label: 'TEMPO', distanceMeters: 10_000, movingTimeS: 3_000 };

function renderMoment(
  onView: () => void,
  onDismiss: () => void,
  extra: Partial<React.ComponentProps<typeof ContractMetMoment>> = {},
) {
  return render(
    <ThemeProvider preference="dark">
      <ContractMetMoment week={metWeek()} onView={onView} onDismiss={onDismiss} {...extra} />
    </ThemeProvider>,
  );
}

// The distance preference is a plain module-level store, not a Context — the
// established way to flip it in a test is to mount a sibling that calls
// `setPreference` and press it, same as preferences.reactivity.test.tsx.
function KilometerMoment({
  onView,
  onDismiss,
  ...extra
}: {
  onView: () => void;
  onDismiss: () => void;
} & Partial<React.ComponentProps<typeof ContractMetMoment>>) {
  const { setPreference } = useAppPreferences();
  return (
    <ThemeProvider preference="dark">
      <Pressable accessibilityRole="button" accessibilityLabel="Use kilometers" onPress={() => setPreference('distance', 'km')}>
        <Text>Use kilometers</Text>
      </Pressable>
      <ContractMetMoment week={metWeek()} onView={onView} onDismiss={onDismiss} {...extra} />
    </ThemeProvider>
  );
}

afterEach(() => {
  resetAppPreferencesForTests();
});

test('renders the banked total and the target as plain numbers', () => {
  renderMoment(jest.fn(), jest.fn());

  expect(screen.getByText('42.0')).toBeTruthy();
  expect(screen.getByText(' / 42 mi')).toBeTruthy();
});

test('fires onView and onDismiss exactly once from their own controls', () => {
  const onView = jest.fn();
  const onDismiss = jest.fn();
  renderMoment(onView, onDismiss);

  fireEvent.press(screen.getByRole('button', { name: 'View run' }));
  fireEvent.press(screen.getByRole('button', { name: 'Close' }));

  expect(onView).toHaveBeenCalledTimes(1);
  expect(onDismiss).toHaveBeenCalledTimes(1);
});

// ── The shape: a scrimmed overlay that owns the screen ───────────────────────
//
// This replaces an earlier `pointerEvents: 'box-none'` assertion. The component
// used to be a card floating over a live, still-scrollable Dash with no scrim —
// it looked like a dialog and behaved like neither a dialog nor an inline card.
// It is now what the modal audit records for this surface: a scrimmed
// acknowledgement overlay that absorbs taps and dismisses on a scrim tap.

test('lays a scrim over the Dash instead of letting taps fall through to it', () => {
  renderMoment(jest.fn(), jest.fn());

  const root = screen.getByTestId('contract-met-root');
  expect(root.props.pointerEvents).toBeUndefined(); // no longer box-none
  expect(screen.getByTestId('contract-met-scrim')).toBeTruthy();
});

test('dismisses on a scrim tap, exactly once and without firing onView', () => {
  const onView = jest.fn();
  const onDismiss = jest.fn();
  renderMoment(onView, onDismiss);

  fireEvent.press(screen.getByTestId('contract-met-scrim'));

  expect(onDismiss).toHaveBeenCalledTimes(1);
  expect(onView).not.toHaveBeenCalled();
});

test('does not double-acknowledge on leave after the scrim was tapped', () => {
  const onDismiss = jest.fn();
  const view = renderMoment(jest.fn(), onDismiss);

  fireEvent.press(screen.getByTestId('contract-met-scrim'));
  expect(onDismiss).toHaveBeenCalledTimes(1);

  view.unmount();
  expect(onDismiss).toHaveBeenCalledTimes(1);
});

// ── FIX 1: acknowledge on leave, not just on tap ─────────────────────────────
//
// This is non-modal — there is no scrim forcing a choice. A runner
// who switches tabs or navigates elsewhere without tapping View/Close must
// still count as "seen", or the moment replays on every Dash open for the 48h
// recency window. `useFocusEffect`'s cleanup (mocked here as a mount-effect
// cleanup — see the top-of-file note) is what catches that.

test('acknowledges when the runner leaves without tapping View or Close (scrolling away / switching tabs)', () => {
  const onView = jest.fn();
  const onDismiss = jest.fn();
  const view = renderMoment(onView, onDismiss);

  expect(onDismiss).not.toHaveBeenCalled();
  view.unmount();

  expect(onDismiss).toHaveBeenCalledTimes(1);
  expect(onView).not.toHaveBeenCalled();
});

test('does not double-acknowledge on leave after Close was already tapped', () => {
  const onView = jest.fn();
  const onDismiss = jest.fn();
  const view = renderMoment(onView, onDismiss);

  fireEvent.press(screen.getByRole('button', { name: 'Close' }));
  expect(onDismiss).toHaveBeenCalledTimes(1);

  view.unmount();
  expect(onDismiss).toHaveBeenCalledTimes(1);
});

test('does not acknowledge via the leave handler after View was tapped', () => {
  const onView = jest.fn();
  const onDismiss = jest.fn();
  const view = renderMoment(onView, onDismiss);

  fireEvent.press(screen.getByRole('button', { name: 'View run' }));
  expect(onView).toHaveBeenCalledTimes(1);
  expect(onDismiss).not.toHaveBeenCalled();

  view.unmount();
  expect(onDismiss).not.toHaveBeenCalled();
});

test('renders the shared WeekContractStamp as the hero, not a re-drawn shape', () => {
  renderMoment(jest.fn(), jest.fn());

  expect(screen.getByTestId('contract-met-stamp-4', { includeHiddenElements: true })).toBeTruthy();
});

test('formats the banked total and target in kilometers under the km preference', () => {
  render(<KilometerMoment onView={jest.fn()} onDismiss={jest.fn()} />);

  fireEvent.press(screen.getByRole('button', { name: 'Use kilometers' }));

  // 42mi banked/target -> 67.592448km: "67.6" banked, "68" target (rounded).
  expect(screen.getByText('67.6')).toBeTruthy();
  expect(screen.getByText(' / 68 km')).toBeTruthy();
});

// ── The supporting contracts (quality / long) as NUMBERS ─────────────────────
//
// The stamp's violet/cyan arcs already say hit-or-missed. These rows carry the
// magnitude the arcs cannot: 5.9-of-6.0 and 12.0-of-6.0 draw the same hollow
// and filled arc respectively, but read very differently as numbers.

test('reports the supporting quality and long contracts by magnitude', () => {
  renderMoment(jest.fn(), jest.fn());

  expect(screen.getByText('QUALITY')).toBeTruthy();
  expect(screen.getByText('10.0 / 10.0')).toBeTruthy();
  expect(screen.getByText('LONG')).toBeTruthy();
  expect(screen.getByText('18.0 / 18.0')).toBeTruthy();
});

test('omits a supporting contract the week never prescribed, rather than showing 0.0 / 0.0', () => {
  const noLong = metWeek();
  noLong.long = { actualMeters: 0, targetMeters: 0, hit: false, fraction: 0 };
  render(
    <ThemeProvider preference="dark">
      <ContractMetMoment week={noLong} onView={jest.fn()} onDismiss={jest.fn()} />
    </ThemeProvider>,
  );

  expect(screen.getByText('QUALITY')).toBeTruthy();
  expect(screen.queryByText('LONG')).toBeNull();
  expect(screen.queryByText('0.0 / 0.0')).toBeNull();
});

test('drops the whole supporting block when the week prescribed neither goal', () => {
  const bare = metWeek();
  bare.quality = { actualMeters: 0, targetMeters: 0, hit: false, fraction: 0 };
  bare.long = { actualMeters: 0, targetMeters: 0, hit: false, fraction: 0 };
  render(
    <ThemeProvider preference="dark">
      <ContractMetMoment week={bare} onView={jest.fn()} onDismiss={jest.fn()} />
    </ThemeProvider>,
  );

  expect(screen.queryByTestId('contract-met-supporting')).toBeNull();
});

test('converts the supporting contracts under the km preference too', () => {
  render(<KilometerMoment onView={jest.fn()} onDismiss={jest.fn()} />);

  fireEvent.press(screen.getByRole('button', { name: 'Use kilometers' }));

  expect(screen.getByText('16.1 / 16.1')).toBeTruthy(); // 10 mi
  expect(screen.getByText('29.0 / 29.0')).toBeTruthy(); // 18 mi
});

// ── The run that closed the contract ─────────────────────────────────────────

test('names the run that closed the contract — kind, distance, pace', () => {
  renderMoment(jest.fn(), jest.fn(), { run: RUN });

  expect(screen.getByTestId('contract-met-run')).toHaveTextContent('TEMPO · 6.2 mi · 8:03/mi');
});

test('formats the closing run in km under the km preference', () => {
  // The whole reason this component takes raw meters/seconds rather than a
  // pre-formatted string: anything baked as `/mi` upstream would lie here.
  render(<KilometerMoment onView={jest.fn()} onDismiss={jest.fn()} run={RUN} />);

  fireEvent.press(screen.getByRole('button', { name: 'Use kilometers' }));

  expect(screen.getByTestId('contract-met-run')).toHaveTextContent('TEMPO · 10.0 km · 5:00/km');
});

test('drops the pace when the run has no moving time, keeping kind and distance', () => {
  renderMoment(jest.fn(), jest.fn(), { run: { ...RUN, movingTimeS: null } });

  expect(screen.getByTestId('contract-met-run')).toHaveTextContent('TEMPO · 6.2 mi');
  expect(screen.queryByText(/\/mi$/)).toBeNull();
});

test('renders no run line at all when the closing run is unknown', () => {
  renderMoment(jest.fn(), jest.fn());

  expect(screen.queryByTestId('contract-met-run')).toBeNull();
});

// ── The horizon: plan week + streak ──────────────────────────────────────────

test('reports the streak this week extends', () => {
  renderMoment(jest.fn(), jest.fn(), { streakWeeks: 4 });

  expect(screen.getByText('W4 · 4 IN A ROW')).toBeTruthy();
});

test('shows the plan week alone on a first met week — 1 is not a streak', () => {
  renderMoment(jest.fn(), jest.fn(), { streakWeeks: 1 });

  expect(screen.getByText('W4')).toBeTruthy();
  expect(screen.queryByText(/IN A ROW/)).toBeNull();
});
