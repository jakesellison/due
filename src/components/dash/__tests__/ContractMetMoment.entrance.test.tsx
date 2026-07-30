/**
 * ContractMetMoment's own entrance ("the strike") — separate file because it
 * needs its own `react-native-reanimated` mock (the shared `jest.setup.app.js`
 * mock hardcodes `useReducedMotion: () => false` and a non-spy `withTiming`;
 * this file needs both to be controllable per test).
 *
 * HONESTY NOTE on what these tests can and can't prove: the mock's
 * `useSharedValue` returns a fresh plain object on every render (no `useRef`
 * backing it), and `useAnimatedStyle` just calls its worklet synchronously at
 * render time. That means a shared-value mutation made inside a `useEffect`
 * (the real mount-time strike) is never reflected in anything queryable
 * afterwards — there is no frame-by-frame interpolation to observe here, and
 * no way to assert the settled/rest style is reached post-animation from a
 * synchronous render. What CAN be asserted, and what these tests pin:
 *   1. On the FIRST render (before any effect fires), non-reduced-motion
 *      starts the card hidden and the stamp oversized — i.e. a real
 *      away-from-rest starting frame exists, not just the resting transform.
 *   2. Under Reduce Motion, that same first render already IS the resting
 *      frame (card visible, stamp at its shipped scale) — zero intermediate
 *      frames, per the design constraint.
 *   3. The mount effect calls `withTiming` (proving the entrance is actually
 *      wired to animate) when motion is allowed, and does NOT call it at all
 *      under Reduce Motion (proving the guard suppresses the timing call
 *      itself, not just its visual result).
 * None of this proves the overshoot CURVE looks right on a real device —
 * that needs eyeballing on the lab bench (`app/lab/banked-card.tsx`'s Replay
 * control), not a jest assertion.
 */
import { render } from '@testing-library/react-native';

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

// `mock`-prefixed names are the one exception babel-plugin-jest-hoist allows
// a jest.mock factory below to close over.
const mockUseReducedMotion = jest.fn(() => false);
const mockWithTiming = jest.fn((value: number, _config?: unknown, callback?: (finished: boolean) => void) => {
  if (callback) callback(true);
  return value;
});

jest.mock('react-native-reanimated', () => {
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: { View, createAnimatedComponent: (component: unknown) => component },
    useAnimatedStyle: (fn: () => unknown) => fn(),
    useSharedValue: (value: unknown) => ({ value }),
    // Indirected through a closure, NOT `mockUseReducedMotion` directly: the
    // SUT import below is a hoisted ES import, so this factory runs before
    // the `const mock...` declarations further down the file have executed.
    // Capturing the mock fn by reference at factory-construction time would
    // bake in `undefined`; looking it up at CALL time (component render,
    // long after the whole file has finished evaluating) reads the real one.
    useReducedMotion: (...args: unknown[]) => mockUseReducedMotion(...(args as [])),
    withTiming: (...args: [number, unknown?, ((finished: boolean) => void)?]) => mockWithTiming(...args),
    // Minimal real piecewise-linear interpolate — the component's own
    // 3-point [0, 0.6, 1] usage is a straight line segment lookup, nothing
    // fancier is needed to exercise it under test.
    interpolate: (value: number, input: number[], output: number[]) => {
      if (value <= input[0]!) return output[0]!;
      if (value >= input[input.length - 1]!) return output[output.length - 1]!;
      for (let i = 1; i < input.length; i += 1) {
        if (value <= input[i]!) {
          const t = (value - input[i - 1]!) / (input[i]! - input[i - 1]!);
          return output[i - 1]! + t * (output[i]! - output[i - 1]!);
        }
      }
      return output[output.length - 1]!;
    },
    Easing: { bezier: () => (t: number) => t },
  };
});

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

function renderMoment() {
  return render(
    <ThemeProvider preference="dark">
      <ContractMetMoment week={metWeek()} onView={() => {}} onDismiss={() => {}} />
    </ThemeProvider>,
  );
}

afterEach(() => {
  mockUseReducedMotion.mockReset().mockReturnValue(false);
  mockWithTiming.mockClear();
});

test('starts away from rest — the card begins hidden and the stamp begins oversized', () => {
  const view = renderMoment();

  const card = view.getByTestId('contract-met-card');
  const strike = view.getByTestId('contract-met-strike');

  const cardStyle = card.props.style as Record<string, unknown>[];
  const opacity = cardStyle[cardStyle.length - 1]!.opacity as number;
  const strikeStyle = strike.props.style as { transform: { scale: number }[] };
  const scale = strikeStyle.transform[0]!.scale;

  expect(opacity).toBe(0);
  expect(scale).toBeGreaterThan(1); // oversized, not the shipped resting composition
});

test('wires the mount effect to withTiming when motion is allowed', () => {
  renderMoment();

  expect(mockWithTiming).toHaveBeenCalledTimes(1);
  expect(mockWithTiming).toHaveBeenCalledWith(1, expect.objectContaining({ duration: expect.any(Number) }));
});

test('Reduce Motion — appears at the resting frame immediately, no entrance', () => {
  mockUseReducedMotion.mockReturnValue(true);
  const view = renderMoment();

  const card = view.getByTestId('contract-met-card');
  const strike = view.getByTestId('contract-met-strike');

  const cardStyle = card.props.style as Record<string, unknown>[];
  const opacity = cardStyle[cardStyle.length - 1]!.opacity as number;
  const strikeStyle = strike.props.style as { transform: { scale: number }[] };
  const scale = strikeStyle.transform[0]!.scale;

  expect(opacity).toBe(1);
  expect(scale).toBe(1); // composes with the static `stampScale` transform to exactly 2.2
  expect(mockWithTiming).not.toHaveBeenCalled();
});
