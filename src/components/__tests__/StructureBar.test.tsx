import { render } from '@testing-library/react-native';
import { View } from 'react-native';

import { StructureBar, ActualBar, PrescriptionBar, toneAccent } from '@/components/StructureBar';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { THEMES } from '@/theme/tokens';
import type { BarSeg } from '@/lib';

const rtl = (node: React.ReactElement) => render(<ThemeProvider preference="dark">{node}</ThemeProvider>);

// A quality session shape: warm-up, one work rep, cool-down.
const SEGS: BarSeg[] = [
  { kind: 'wu', meters: 3219 },
  { kind: 'work', meters: 3219 },
  { kind: 'cd', meters: 1609 },
];

// Flatten a segment vessel's children into [track, fillOrNull].
function vessels(r: ReturnType<typeof rtl>): { bg: unknown; fillBg: unknown | null }[] {
  // The bar renders one View per segment (with a nested fill View when filled).
  const all = r.UNSAFE_getAllByType(View);
  // The segment vessels are the Views with borderRadius 3 + a backgroundColor.
  return all
    .filter((n) => {
      const s = n.props.style;
      return s && typeof s === 'object' && s.borderRadius === 3 && s.overflow === 'hidden';
    })
    .map((n) => {
      const children = Array.isArray(n.props.children) ? n.props.children : [n.props.children];
      const fill = children.find((c: unknown) => c && typeof c === 'object');
      return { bg: n.props.style.backgroundColor, fillBg: fill ? fill.props?.style?.backgroundColor : null };
    });
}

describe('StructureBar — work reps light only when actually done', () => {
  test('workDone=false: the work rep is a hollow tone outline, no solid fill; warm-up still fills', () => {
    const r = rtl(<StructureBar segments={SEGS} tone="quality" fillFraction={1} workDone={false} />);
    const v = vessels(r);
    expect(v).toHaveLength(3);
    // Warm-up (index 0) fills by distance even when the reps weren't done.
    expect(v[0]!.fillBg).not.toBeNull();
    // Work rep (index 1): no solid fill, and its track is the tone-tinted hollow
    // (not the neutral ghost) — reads as "prescribed, not completed".
    expect(v[1]!.fillBg).toBeNull();
    expect(v[1]!.bg).not.toBe(v[0]!.bg); // distinct from the neutral ghost track
  });

  test('workDone=true (detected quality / easy): the work rep fills solid with the tone colour', () => {
    const r = rtl(<StructureBar segments={SEGS} tone="quality" fillFraction={1} workDone />);
    const v = vessels(r);
    expect(v[1]!.fillBg).toBe(toneAccent(THEMES.dark, 'quality')); // solid violet fill
  });

  test('default workDone is true (back-compat for easy/long/detected)', () => {
    const r = rtl(<StructureBar segments={SEGS} tone="easy" fillFraction={1} />);
    const v = vessels(r);
    expect(v[1]!.fillBg).toBe(toneAccent(THEMES.dark, 'easy')); // steel-blue fill
  });
});

// The ActualBar paints each segment SOLID at its own effort colour (no ghost
// track, no fill sweep) — violet work reps on a steel-blue base.
function solidSegs(r: ReturnType<typeof rtl>): unknown[] {
  const all = r.UNSAFE_getAllByType(View);
  return all
    .filter((n) => {
      const s = n.props.style;
      return s && typeof s === 'object' && s.borderRadius === 3 && s.flexBasis === 0;
    })
    .map((n) => n.props.style.backgroundColor);
}

describe('ActualBar — what was actually run, solid per-segment', () => {
  const D = THEMES.dark;

  test('an interval run: work segs violet, warm-up/cool-down steel blue, rest fainter', () => {
    const segs: BarSeg[] = [
      { kind: 'wu', meters: 1000 },
      { kind: 'work', meters: 1000 },
      { kind: 'rest', meters: 500 },
      { kind: 'work', meters: 1000 },
      { kind: 'cd', meters: 1000 },
    ];
    const bg = solidSegs(rtl(<ActualBar segments={segs} />));
    expect(bg).toHaveLength(5);
    expect(bg[0]).toBe(D.easyText);
    expect(bg[1]).toBe(D.qualText);
    expect(bg[2]).toBe('rgba(143, 167, 197, 0.48)');
    expect(bg[2]).not.toBe(D.qualText);
    expect(bg[3]).toBe(D.qualText);
    expect(bg[4]).toBe(D.easyText);
  });

  test('an easy run: one flat steel-blue steady bar, no violet', () => {
    const bg = solidSegs(rtl(<ActualBar segments={[{ kind: 'steady', meters: 5000 }]} />));
    expect(bg).toEqual([D.easyText]);
    expect(bg).not.toContain(D.qualText);
  });

  test('empty segments render nothing', () => {
    const r = rtl(<ActualBar segments={[]} />);
    expect(r.UNSAFE_queryAllByType(View)).toHaveLength(0);
  });
});

describe('PrescriptionBar — a subdued shape, never a progress remainder', () => {
  test('a single steady prescription still renders one quiet segment', () => {
    const r = rtl(<PrescriptionBar testID="plan-shape" segments={[{ kind: 'steady', meters: 5000 }]} />);
    expect(r.getByTestId('plan-shape', { includeHiddenElements: true })).toBeTruthy();
    expect(solidSegs(r)).toEqual(['rgba(143, 167, 197, 0.3)']);
  });
});
