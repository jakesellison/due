/**
 * Render test for the fused GlassTabBar under the `app` Jest project
 * (jest-expo). Confirms the primary shell renders exactly three tabs in order —
 * Week · Plan · You. The retired Progress route is gone from the app entirely,
 * so the `not.toContain` guards below keep it (and the other retired tabs) from
 * creeping back into the bar.
 */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from 'expo-router/build/react-navigation/bottom-tabs';

import { GlassTabBar } from '@/components/GlassTabBar';
import { ThemeProvider } from '@/theme/ThemeProvider';

/** A minimal BottomTabBarProps for the three tab routes, in order. */
function makeProps(): BottomTabBarProps {
  const names = ['index', 'plan', 'you'];
  const titles: Record<string, string> = {
    index: 'Week',
    plan: 'Plan',
    you: 'You',
  };
  const routes = names.map((name) => ({ key: `${name}-key`, name }));
  const descriptors = Object.fromEntries(
    routes.map((r) => [r.key, { options: { title: titles[r.name] } }]),
  );
  return {
    state: { index: 0, routes },
    descriptors,
    navigation: { emit: () => ({ defaultPrevented: false }), navigate: () => {} },
  } as unknown as BottomTabBarProps;
}

function render(node: React.ReactElement): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 47, left: 0, right: 0, bottom: 34 },
        }}
      >
        <ThemeProvider preference="dark">{node}</ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return tree;
}

describe('GlassTabBar', () => {
  it('renders exactly three primary tabs with Routes removed', () => {
    const tree = render(<GlassTabBar {...makeProps()} />);
    const labels = Array.from(new Set(
      tree.root
        .findAll((node) => node.props.accessibilityRole === 'button')
        .map((node) => node.props.accessibilityLabel)
        .filter((label): label is string => typeof label === 'string'),
    ));

    // Accessibility labels are the durable tab identity: at very large Dynamic
    // Type sizes the visible words intentionally yield to icon-only navigation.
    expect(labels).toEqual(['Week', 'Plan', 'You']);
    expect(labels).not.toContain('Progress');
    expect(labels).not.toContain('Routes');
    expect(labels).not.toContain('Coach');
    expect(labels).not.toContain('Light');
    expect(labels).not.toContain('Dark');

    act(() => tree.unmount());
  });
});
