/**
 * Render smoke tests for the run-detail Activity components (jest-expo `app`
 * project). They confirm the route card renders without throwing given realistic
 * route data.
 *
 * victory-native + reanimated are mocked exactly as the Dash component tests do
 * (the real CartesianChart wires Skia + gestures that don't init headlessly);
 * the render child is invoked with a representative chartBounds so our Skia
 * path-drawing code paths execute against the mocked Skia primitives.
 */
import { Text } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { METERS_PER_MILE } from '@/lib';

jest.mock('react-native-reanimated', () => ({
  useAnimatedReaction: () => undefined,
  runOnJS: (fn: (...a: unknown[]) => unknown) => fn,
  useDerivedValue: (fn: () => unknown) => ({ value: fn() }),
  useSharedValue: (v: unknown) => ({ value: v }),
}));

jest.mock('victory-native', () => {
  const React = require('react');
  return {
    CartesianChart: ({ children }: { children: (a: unknown) => React.ReactNode }) =>
      React.createElement(
        React.Fragment,
        null,
        children({
          chartBounds: { left: 0, right: 300, top: 0, bottom: 116 },
          xScale: () => 0,
          yScale: () => 0,
          points: { v: [] },
        }),
      ),
    useChartPressState: () => ({
      state: { isActive: { value: false }, matchedIndex: { value: -1 } },
      isActive: false,
    }),
  };
});

import { RouteCard as RealRouteCard } from '../run/RouteCard';
import { ThemeProvider } from '@/theme/ThemeProvider';

function RouteCard(props: React.ComponentProps<typeof RealRouteCard>) {
  return <ThemeProvider preference="dark"><RealRouteCard {...props} /></ThemeProvider>;
}

// ---- Fixtures --------------------------------------------------------------

/** A small closed-loop route around a point. */
function loopRoute(): [number, number][] {
  const cx = 41.88;
  const cy = -87.62;
  const r = 0.01;
  const pts: [number, number][] = [];
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    pts.push([cx + r * Math.sin(a), cy + r * Math.cos(a) * 1.4]);
  }
  return pts;
}

function collectText(node: ReactTestInstance): string[] {
  const out: string[] = [];
  for (const child of node.children) {
    if (typeof child === 'string') out.push(child);
    else if (typeof child === 'number') out.push(String(child));
    else if (child && typeof child === 'object' && 'children' in child) {
      out.push(...collectText(child as ReactTestInstance));
    }
  }
  return out;
}

function renderOk(node: React.ReactElement): ReactTestRenderer {
  let tree: ReactTestRenderer | undefined;
  expect(() => {
    act(() => {
      tree = create(node);
    });
  }).not.toThrow();
  return tree!;
}

function unmount(tree: ReactTestRenderer) {
  act(() => tree.unmount());
}

test('RouteCard renders a projected loop with a caption', () => {
  const tree = renderOk(
    <RouteCard route={loopRoute()} distanceMeters={3 * METERS_PER_MILE} movingTimeS={1500} sufferScore={42} width={320} />,
  );
  const text = tree.root.findAllByType(Text).flatMap((n) => collectText(n)).join(' ');
  expect(text).toContain('effort');
  unmount(tree);
});
