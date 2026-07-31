/**
 * Render test for the fused GlassTabBar under the `app` Jest project
 * (jest-expo). Confirms the primary shell renders exactly three tabs in order —
 * Week · Plan · You. The retired Progress route is gone from the app entirely,
 * so the `not.toContain` guards below keep it (and the other retired tabs) from
 * creeping back into the bar.
 */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { BottomTabBarProps } from 'expo-router/build/react-navigation/bottom-tabs';

import { screenWrapper } from '@/app-lib/__testsupport__/render';
import { GlassTabBar } from '@/components/GlassTabBar';

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
    tree = create(screenWrapper(node));
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
