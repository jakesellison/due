// Grade-adjusted pace from the altitude stream (Minetti 2002 energy-cost curve).
// GAP = flat-equivalent pace: uphill effort is credited as the faster flat pace it
// equals. We compute per-sample grade → per-sample cost factor → "grade-adjusted
// distance", then a per-lap factor = gradeAdjDist/actualDist applied to the lap's
// stop-corrected moving pace. Rolling/altitude terrain reads honestly.
//
// Port of docs/superpowers/specs/interpreter-prototype/gap.mjs — validated on real
// data. Algorithm is verbatim; only TS types were added.
const MI = 1609.34;

export interface Gap {
  d: number[];
  gaCum: number[];
}

// Minetti et al. 2002 — metabolic cost of running Cr(i) (J·kg⁻¹·m⁻¹), i = grade
// (rise/run). Flat Cr(0)=3.6. factor(i)=Cr(i)/Cr(0); ratio>1 uphill, <1 gentle down.
const CR0 = 3.6;
function costFactor(i: number): number {
  const g = Math.max(-0.45, Math.min(0.45, i));
  const cr = 155.4 * g ** 5 - 30.4 * g ** 4 - 43.3 * g ** 3 + 46.3 * g ** 2 + 19.5 * g + 3.6;
  return Math.max(0.5, cr / CR0); // floor: never credit a descent as "rest"
}

// Smooth altitude over ~SMOOTH_M meters to tame GPS-elevation noise before grading.
const SMOOTH_M = 25;
function smoothAlt(d: number[], alt: number[]): number[] {
  const n = alt.length;
  const out = new Array(n);
  let lo = 0;
  let hi = 0;
  for (let k = 0; k < n; k++) {
    while (lo < k && d[k]! - d[lo]! > SMOOTH_M) lo++;
    while (hi < n - 1 && d[hi]! - d[k]! < SMOOTH_M) hi++;
    let s = 0;
    let c = 0;
    for (let j = lo; j <= hi; j++) {
      s += alt[j]!;
      c++;
    }
    out[k] = s / c;
  }
  return out;
}

/** Precompute cumulative grade-adjusted distance along the stream. */
export function buildGap(stream: { d: number[]; alt: number[] }): Gap | null {
  const { d, alt } = stream;
  const n = d.length;
  if (!Array.isArray(alt) || alt.length !== n || n < 2) return null;
  const a = smoothAlt(d, alt);
  const gaCum = new Array(n).fill(0);
  for (let k = 1; k < n; k++) {
    const dd = d[k]! - d[k - 1]!;
    if (dd <= 0) {
      gaCum[k] = gaCum[k - 1];
      continue;
    }
    const grade = (a[k]! - a[k - 1]!) / dd;
    gaCum[k] = gaCum[k - 1] + dd * costFactor(grade);
  }
  return { d, gaCum };
}

function idxAtDistance(d: number[], target: number): number {
  let lo = 0;
  let hi = d.length - 1;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (d[m]! < target) lo = m + 1;
    else hi = m;
  }
  return lo;
}

/**
 * Grade-adjust a lap's moving pace. `startD`/`endD` are the lap's cumulative-distance
 * bounds. Returns { gapPace, ratio } — gapPace is the flat-equivalent of the
 * lap's stop-corrected moving pace.
 */
export function lapGap(
  gap: Gap | null,
  startD: number,
  endD: number,
  movingPace: number
): { gapPace: number; ratio: number } {
  if (!gap) return { gapPace: movingPace, ratio: 1 };
  const i0 = idxAtDistance(gap.d, startD);
  const i1 = idxAtDistance(gap.d, endD);
  const actual = gap.d[i1]! - gap.d[i0]!;
  const adj = gap.gaCum[i1]! - gap.gaCum[i0]!;
  const ratio = actual > 0 ? adj / actual : 1;
  return { gapPace: movingPace / ratio, ratio };
}
