import {
  bandFor,
  bandForRange,
  paceLineMeters,
  paceStatus,
  type Band,
} from '../kpi/band';

describe('bandFor', () => {
  const target = 100000;
  test('green at or above target', () => {
    expect(bandFor(100000, target)).toBe<Band>('green');
    expect(bandFor(101000, target)).toBe<Band>('green');
  });
  test('amber within threshold band (default 0.9)', () => {
    expect(bandFor(95000, target)).toBe<Band>('amber');
    expect(bandFor(90000, target)).toBe<Band>('amber');
  });
  test('red below threshold', () => {
    expect(bandFor(89999, target)).toBe<Band>('red');
    expect(bandFor(40000, target)).toBe<Band>('red');
  });
  test('amber threshold is tunable', () => {
    expect(bandFor(80000, target, { amber: 0.8 })).toBe<Band>('amber');
    expect(bandFor(79999, target, { amber: 0.8 })).toBe<Band>('red');
  });
  test('no goal set (target <= 0) is green by design', () => {
    expect(bandFor(0, 0)).toBe<Band>('green');
  });
});

describe('bandForRange', () => {
  test('green inside [low,high], amber just under low, red far below', () => {
    expect(bandForRange(64000, 60000, 66000)).toBe<Band>('green');
    expect(bandForRange(58000, 60000, 66000)).toBe<Band>('amber');
    expect(bandForRange(50000, 60000, 66000)).toBe<Band>('red');
  });
  test('over the top of the band is green', () => {
    expect(bandForRange(70000, 60000, 66000)).toBe<Band>('green');
  });
});

describe('paceLineMeters', () => {
  test('prorates the target by elapsed fraction', () => {
    expect(paceLineMeters(70000, 3 / 7)).toBeCloseTo(30000, 6);
  });
});

describe('paceStatus', () => {
  const target = 70000; // full-week target
  const frac = 3 / 7; // Wednesday: pace line = 30000

  test('ahead of pace -> green', () => {
    const s = paceStatus(35000, target, frac);
    expect(s.paceLineMeters).toBeCloseTo(30000, 6);
    expect(s.band).toBe<Band>('green');
  });

  test('exactly on the pace line -> green', () => {
    expect(paceStatus(30000, target, frac).band).toBe<Band>('green');
  });

  test('slightly under the pace line (within amber) -> amber', () => {
    // amber floor 0.9 of 30000 = 27000
    expect(paceStatus(28000, target, frac).band).toBe<Band>('amber');
    expect(paceStatus(27000, target, frac).band).toBe<Band>('amber');
  });

  test('far under the pace line -> red', () => {
    expect(paceStatus(26999, target, frac).band).toBe<Band>('red');
    expect(paceStatus(5000, target, frac).band).toBe<Band>('red');
  });

  test('full-week fraction = 1 equals bandFor against the full target', () => {
    for (const actual of [70000, 65000, 63000, 62999, 40000]) {
      expect(paceStatus(actual, target, 1).band).toBe(bandFor(actual, target));
    }
  });

  test('no goal (target <= 0) is green', () => {
    expect(paceStatus(0, 0, frac).band).toBe<Band>('green');
  });

  test('clamps elapsedFraction into [0,1]', () => {
    expect(paceStatus(target, target, 5).band).toBe<Band>('green');
    expect(paceStatus(0, target, -1).paceLineMeters).toBe(0);
  });
});
