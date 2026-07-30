import {
  clampPaceSecPerMi,
  fmtPace,
  secPerMiToKm,
  seedPaceBand,
} from '../paceBands';

describe('seedPaceBand', () => {
  const EASY = 480; // 8:00/mi baseline

  it('easy is centred on the baseline with a wide band', () => {
    expect(seedPaceBand('easy', EASY)).toEqual({ lo: 465, hi: 495 }); // 7:45–8:15
  });

  it('harder zones are faster than easy and progressively so', () => {
    const mp = seedPaceBand('MP', EASY);
    const thr = seedPaceBand('threshold', EASY);
    const k5 = seedPaceBand('5K', EASY);
    // MP faster than easy; threshold faster than MP; 5K faster than threshold.
    expect(mp.hi).toBeLessThan(EASY);
    expect(thr.hi).toBeLessThan(mp.lo);
    expect(k5.hi).toBeLessThan(thr.lo);
  });

  it('recovery is slower (higher sec/mi) than easy', () => {
    expect(seedPaceBand('recovery', EASY).lo).toBeGreaterThan(EASY);
  });

  it('lo is always the faster (smaller) edge', () => {
    const b = seedPaceBand('5K', EASY);
    expect(b.lo).toBeLessThan(b.hi);
  });

  it('clamps absurd baselines into the 4:00–12:00 window', () => {
    expect(seedPaceBand('mile', 300).lo).toBeGreaterThanOrEqual(240); // never faster than 4:00
    expect(seedPaceBand('recovery', 720).hi).toBeLessThanOrEqual(720); // never slower than 12:00
  });
});

describe('fmtPace / secPerMiToKm / clampPaceSecPerMi', () => {
  it('formats seconds as m:ss', () => {
    expect(fmtPace(480)).toBe('8:00');
    expect(fmtPace(405)).toBe('6:45');
    expect(fmtPace(390)).toBe('6:30');
  });

  it('converts sec/mi to sec/km', () => {
    // 8:00/mi (480s) ≈ 4:58/km ≈ 298s/km.
    expect(secPerMiToKm(480)).toBe(298);
  });

  it('clamps pace to the sane window', () => {
    expect(clampPaceSecPerMi(100)).toBe(240);
    expect(clampPaceSecPerMi(900)).toBe(720);
    expect(clampPaceSecPerMi(405.4)).toBe(405);
  });
});
