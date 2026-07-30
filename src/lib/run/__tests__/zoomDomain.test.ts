import {
  clampDomain,
  fullDomain,
  isZoomed,
  minZoomSpanMi,
  panDomainBy,
  pinchZoomDomain,
  resetDomain,
  type Domain,
} from '../zoomDomain';

describe('fullDomain', () => {
  test('spans 0..totalMi', () => {
    expect(fullDomain(8)).toEqual({ lo: 0, hi: 8 });
  });

  test('never collapses to a zero-width domain for a ~0mi run', () => {
    const d = fullDomain(0);
    expect(d.hi).toBeGreaterThan(d.lo);
  });
});

describe('minZoomSpanMi', () => {
  test('30s at 6:00/mi pace is 0.083mi (30/360)', () => {
    expect(minZoomSpanMi(360)).toBeCloseTo(30 / 360, 6);
  });

  test('faster pace (smaller sec/mi) yields a LARGER min span — same 30s covers more ground', () => {
    expect(minZoomSpanMi(300)).toBeGreaterThan(minZoomSpanMi(400));
  });

  test('falls back to a small fixed span for non-finite/zero pace', () => {
    expect(minZoomSpanMi(0)).toBeGreaterThan(0);
    expect(minZoomSpanMi(NaN)).toBeGreaterThan(0);
    expect(minZoomSpanMi(-5)).toBeGreaterThan(0);
  });
});

describe('clampDomain', () => {
  const full: Domain = { lo: 0, hi: 10 };

  test('passes through a candidate already inside bounds with a valid span', () => {
    expect(clampDomain({ lo: 2, hi: 5 }, full, 0.1)).toEqual({ lo: 2, hi: 5 });
  });

  test('cannot zoom IN past the min span — span is floored, position preserved as much as possible', () => {
    const out = clampDomain({ lo: 4, hi: 4.01 }, full, 0.5);
    expect(out.hi - out.lo).toBeCloseTo(0.5, 6);
  });

  test('cannot zoom OUT past the full domain — span is capped at fullSpan', () => {
    const out = clampDomain({ lo: -3, hi: 20 }, full, 0.1);
    expect(out.hi - out.lo).toBeCloseTo(10, 6);
    expect(out.lo).toBeGreaterThanOrEqual(0);
    expect(out.hi).toBeLessThanOrEqual(10);
  });

  test('a window that slides past the LEFT edge is pinned there, span preserved', () => {
    const out = clampDomain({ lo: -2, hi: 1 }, full, 0.1);
    expect(out).toEqual({ lo: 0, hi: 3 });
  });

  test('a window that slides past the RIGHT edge is pinned there, span preserved', () => {
    const out = clampDomain({ lo: 9, hi: 12 }, full, 0.1);
    expect(out).toEqual({ lo: 7, hi: 10 });
  });

  test('minSpanMi larger than the full domain is clamped down to fullSpan (never inverts)', () => {
    const out = clampDomain({ lo: 3, hi: 4 }, full, 50);
    expect(out.hi - out.lo).toBeCloseTo(10, 6);
  });
});

describe('pinchZoomDomain', () => {
  const full: Domain = { lo: 0, hi: 10 };
  const base: Domain = { lo: 2, hi: 6 }; // 4mi window

  test('scale 1 is a no-op (identity)', () => {
    expect(pinchZoomDomain(base, 4, 1, full, 0.1)).toEqual({ lo: 2, hi: 6 });
  });

  test('zooming in (scale>1) shrinks the window and keeps the focal point fixed', () => {
    // focal at mi 3 (1mi into the 4mi base window), scale 2 → 2mi window,
    // the focal point stays 0.25 of the way across: lo = 3 - 1/2 = 2.5, hi = 3 + 3/2 = 4.5.
    const out = pinchZoomDomain(base, 3, 2, full, 0.01);
    expect(out.lo).toBeCloseTo(2.5, 6);
    expect(out.hi).toBeCloseTo(4.5, 6);
    // the focal point's fraction across the window is unchanged (0.25 both before/after)
    const fracBefore = (3 - base.lo) / (base.hi - base.lo);
    const fracAfter = (3 - out.lo) / (out.hi - out.lo);
    expect(fracAfter).toBeCloseTo(fracBefore, 6);
  });

  test('zooming out (scale<1) grows the window around the focal point', () => {
    const out = pinchZoomDomain(base, 4, 0.5, full, 0.01);
    expect(out.hi - out.lo).toBeCloseTo(8, 6);
  });

  test('focal point at the window edge stays pinned to that edge', () => {
    const out = pinchZoomDomain(base, base.lo, 2, full, 0.01);
    expect(out.lo).toBeCloseTo(base.lo, 6);
  });

  test('clamps to the min span — cannot pinch in past ~30s-equivalent', () => {
    const out = pinchZoomDomain(base, 4, 1000, full, 0.2);
    expect(out.hi - out.lo).toBeCloseTo(0.2, 6);
  });

  test('clamps to the full domain — cannot pinch out past it', () => {
    const out = pinchZoomDomain(base, 4, 0.01, full, 0.01);
    expect(out).toEqual(full);
  });

  test('non-finite or non-positive scale is treated as a no-op (still clamped)', () => {
    expect(pinchZoomDomain(base, 4, 0, full, 0.01)).toEqual(base);
    expect(pinchZoomDomain(base, 4, NaN, full, 0.01)).toEqual(base);
    expect(pinchZoomDomain(base, 4, -2, full, 0.01)).toEqual(base);
  });
});

describe('panDomainBy', () => {
  const full: Domain = { lo: 0, hi: 10 };
  const base: Domain = { lo: 3, hi: 5 };

  test('shifts the window by deltaMi, preserving span', () => {
    const out = panDomainBy(base, 1.5, full, 0.1);
    expect(out).toEqual({ lo: 4.5, hi: 6.5 });
  });

  test('panning past the right edge stops at the edge, span preserved', () => {
    const out = panDomainBy(base, 100, full, 0.1);
    expect(out).toEqual({ lo: 8, hi: 10 });
  });

  test('panning past the left edge stops at the edge, span preserved', () => {
    const out = panDomainBy(base, -100, full, 0.1);
    expect(out).toEqual({ lo: 0, hi: 2 });
  });

  test('a negative delta pans backward (earlier)', () => {
    const out = panDomainBy(base, -1, full, 0.1);
    expect(out).toEqual({ lo: 2, hi: 4 });
  });
});

describe('resetDomain', () => {
  test('returns the full domain', () => {
    const full: Domain = { lo: 0, hi: 12 };
    expect(resetDomain(full)).toEqual(full);
  });

  test('returns a fresh object, not the same reference (callers can safely mutate)', () => {
    const full: Domain = { lo: 0, hi: 12 };
    expect(resetDomain(full)).not.toBe(full);
  });
});

describe('isZoomed', () => {
  const full: Domain = { lo: 0, hi: 10 };

  test('false when the domain equals full', () => {
    expect(isZoomed({ lo: 0, hi: 10 }, full)).toBe(false);
  });

  test('true when zoomed in on either edge', () => {
    expect(isZoomed({ lo: 2, hi: 10 }, full)).toBe(true);
    expect(isZoomed({ lo: 0, hi: 8 }, full)).toBe(true);
  });

  test('tolerates float noise within eps', () => {
    expect(isZoomed({ lo: 1e-9, hi: 10 }, full)).toBe(false);
  });
});
