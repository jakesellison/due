import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Text } from 'react-native';

import type { PlanIdentity } from '@/lib';
import { ThemeProvider } from '@/theme/ThemeProvider';

import { PlanIdentityCard } from '../PlanIdentityCard';

const identity: PlanIdentity = {
  name: 'Chicago Marathon Build',
  distanceLabel: 'Marathon',
  numWeeks: 4,
  averageWeeklyMeters: 80_467,
  peakWeeklyMeters: 96_561,
  qualityShare: 0.16,
  weeks: [
    { weekIndex: 1, targetMeters: 64_374 },
    { weekIndex: 2, targetMeters: 80_467 },
    { weekIndex: 3, targetMeters: 96_561 },
    { weekIndex: 4, targetMeters: 80_467 },
  ],
  phases: [
    { label: 'Base', weeks: 1 },
    { label: 'Build', weeks: 2 },
    { label: 'Taper', weeks: 1 },
  ],
};

function renderCard(state?: { label: string; detail?: string; currentWeekIndex?: number }): ReactTestRenderer {
  let tree: ReactTestRenderer | undefined;
  act(() => {
    tree = create(
      <ThemeProvider preference="dark">
        <PlanIdentityCard identity={identity} state={state} />
      </ThemeProvider>,
    );
  });
  return tree!;
}

function text(tree: ReactTestRenderer): string {
  return tree.root.findAllByType(Text).map((node) => {
    const children = node.props.children;
    return Array.isArray(children) ? children.join('') : String(children ?? '');
  }).join('|');
}

describe('PlanIdentityCard', () => {
  it('keeps a template cold while rendering the fixed identity fields', () => {
    const tree = renderCard();
    expect(text(tree)).toContain('Chicago Marathon Build');
    expect(text(tree)).toContain('MI PLAN');
    expect(tree.root.findAllByProps({ testID: 'plan-total-mileage' }).length).toBeGreaterThan(0);
    expect(tree.root.findAllByProps({ testID: 'plan-identity-strata-feature' })).toHaveLength(0);
    expect(tree.root.findAllByProps({ testID: 'plan-current-week-marker' })).toHaveLength(0);
  });

  it('adds exactly one semantic live marker to an installed instance', () => {
    const tree = renderCard({ label: 'Current plan', detail: 'Build · Week 2', currentWeekIndex: 2 });
    expect(text(tree)).toContain('Current plan');
    expect(text(tree)).toContain('Build · Week 2');
    expect(tree.root.findAllByProps({ testID: 'plan-current-week-marker' }).length).toBeGreaterThan(0);
  });

  it('renders compact saved plans as three aligned facts rather than a dot string', () => {
    let tree: ReactTestRenderer | undefined;
    act(() => {
      tree = create(
        <ThemeProvider preference="dark">
          <PlanIdentityCard identity={identity} variant="compact" />
        </ThemeProvider>,
      );
    });
    expect(text(tree!)).toContain('200');
    expect(text(tree!)).toContain('plan mi');
    expect(text(tree!)).toContain('50');
    expect(text(tree!)).toContain('mi/wk avg');
    expect(text(tree!)).toContain('60');
    expect(text(tree!)).toContain('mi peak');
    expect(text(tree!)).not.toContain('Base 1');
    expect(text(tree!)).not.toContain('quality');
    expect(tree!.root.findAllByProps({ testID: 'plan-identity-strata-compact' })).toHaveLength(0);
  });
});
