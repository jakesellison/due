import {
  renderStructure,
} from '../workout/render';
import type { WorkoutStructure } from '../workout/types';

const threshold: WorkoutStructure = [
  { kind: 'warmup', target: { by: 'distance', distance_m: 3219 } },
  { kind: 'repeat', sets: 4, children: [
    { kind: 'interval', target: { by: ['distance', 'pace'], distance_m: 1609, pace: { kind: 'absolute', band: { fast_s_per_km: 226, slow_s_per_km: 226 } } }, note: 'threshold' },
    { kind: 'recovery', target: { by: 'time', duration_s: 90 }, note: 'jog' },
  ]},
  { kind: 'cooldown', target: { by: 'distance', distance_m: 3219 } },
];

describe('renderStructure', () => {
  test('renders the canonical threshold session in miles', () => {
    expect(renderStructure(threshold, 'mi'))
      .toBe('2mi WU + 4×1mi @ threshold (90s jog) + 2mi CD');
  });

  test('renders a plain easy run', () => {
    const easy: WorkoutStructure = [
      { kind: 'steady', target: { by: 'distance', distance_m: 12875 } },
    ];
    expect(renderStructure(easy, 'mi')).toBe('8mi easy');
  });

  test('a nested repeat (repeat whose first child is a repeat) does not throw', () => {
    const nested: WorkoutStructure = [
      { kind: 'repeat', sets: 2, children: [
        { kind: 'repeat', sets: 3, children: [
          { kind: 'interval', target: { by: 'distance', distance_m: 400 }, note: 'rep' },
          { kind: 'recovery', target: { by: 'time', duration_s: 60 }, note: 'jog' },
        ]},
        { kind: 'recovery', target: { by: 'time', duration_s: 180 }, note: 'jog' },
      ]},
    ];
    let rendered = '';
    expect(() => { rendered = renderStructure(nested, 'mi'); }).not.toThrow();
    expect(typeof rendered).toBe('string');
    expect(rendered.length).toBeGreaterThan(0);
    // contains the inner work distance (400m -> 0.2mi)
    expect(rendered).toContain('0.2mi');
  });
});
