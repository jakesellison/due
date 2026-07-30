/**
 * Heat sensitivity — "what heat costs you RIGHT NOW", a descriptive gauge, NOT
 * an adaptation tracker. Mirrors the settled science in
 * `mileage-ml-proto/heat/phase3_science.py` exactly:
 *
 *  1. Easy-run classification (the REVISED rule): a run is EASY iff its pace is
 *     at or SLOWER than the trailing rolling-90-day MEDIAN pace (the slower half
 *     of runs) AND it carries avg_hr AND it is not a detected race (Strava
 *     workout_type === 1). The median anchor (vs the old p10·1.15) is stable
 *     across years and excludes the fast/quality tail that contaminates EF.
 *
 *  2. Efficiency factor EF = speed(m/min) / avg_hr. The fitness baseline is a
 *     TRAILING rolling-median EF over the last 10 easy runs, EXCLUDING the
 *     current run (causal / deployable online — no look-ahead). residual% =
 *     100·(EF − baseline)/baseline.
 *
 *  3. As of today, fit OLS residual% ~ tempC over the trailing 8-week window →
 *     slope (%/°C). GATE: ≥10 qualifying runs AND temp spread ≥8°C, else null
 *     (gauge hidden).
 *
 *  4. Smooth: recompute the slope at the last 3 bi-weekly as-of points and EMA
 *     them (α=0.5) to tame the ±1pt window jitter the science measured.
 *
 * Pure + deterministic. Distances metres, times seconds, dates civil
 * 'YYYY-MM-DD', temps °C.
 */

/** The minimal activity shape the heat gauge reads. */
export interface HeatRun {
  /** Civil 'YYYY-MM-DD' the run is attributed to. */
  localDate?: string | null;
  /** Run distance in metres. */
  distanceMeters?: number | null;
  /** Moving time in seconds. */
  movingTimeS?: number | null;
  /** Average heart rate (bpm), when known. */
  avgHr?: number | null;
  /** Average temperature (°C), when known. */
  avgTempC?: number | null;
  /** Strava workout_type (1 = race), when known. */
  workoutType?: number | null;
}

/** The heat-sensitivity gauge result (null when the gate isn't met). */
export interface HeatSensitivity {
  /**
   * Slope × 10 → percent EF change per +10 °C. Negative = heat COSTS you
   * efficiency (the common case); positive = you run relatively better when hot.
   */
  pctPer10C: number;
  /** Qualifying easy runs in the trailing 8-week window. */
  nRuns: number;
  /** Temperature spread (°C) across those runs (max − min). */
  spreadC: number;
  /** Whether the EMA smoothing across the last 3 bi-weekly windows applied. */
  smoothed: boolean;
}

/** Window the OLS fit reads over: trailing 8 weeks. */
const WINDOW_DAYS = 56;
/** Bi-weekly step for the smoothing as-of points. */
const STEP_DAYS = 14;
/** Rolling window (days) for the era-relative median easy-pace anchor. */
const ERA_DAYS = 90;
/** Minimum runs in the era window before a median pace is trusted. */
const ERA_MIN_RUNS = 5;
/** EF baseline window: trailing median over the last 10 easy runs. */
const EF_BASE_WINDOW = 10;
/** Minimum easy runs before the EF baseline is trusted. */
const EF_BASE_MIN = 5;
/** Gate: minimum qualifying runs in the 8-week window. */
const MIN_RUNS = 10;
/** Gate: minimum temperature spread (°C) in the 8-week window. */
const MIN_SPREAD_C = 8;
/** Plausible avg-HR band (drops bad sensor rows), matching the science. */
const HR_MIN = 90;
const HR_MAX = 210;
/** EMA smoothing factor across the last 3 bi-weekly windows. */
const EMA_ALPHA = 0.5;
/** Number of as-of points to EMA-smooth (incl. today). */
const SMOOTH_POINTS = 3;

/** A run promoted to an EASY data point with its EF residual%, internal. */
interface EasyPoint {
  date: string;
  tempC: number | null;
  residPct: number;
}



/** OLS slope of residual%~tempC over the trailing 8-week window ending `asOf`. */
function windowSlope(
  easy: EasyPoint[],
  asOf: string,
): { slope: number; n: number; spreadC: number } | null {
  const from = shiftCivil(asOf, -WINDOW_DAYS);
  const xs: number[] = [];
  const ys: number[] = [];
  for (const p of easy) {
    if (p.tempC == null) continue;
    // (from, asOf]: strictly after the window start, on or before the as-of day.
    if (p.date <= from || p.date > asOf) continue;
    xs.push(p.tempC);
    ys.push(p.residPct);
  }
  if (xs.length < MIN_RUNS) return null;
  const spread = Math.max(...xs) - Math.min(...xs);
  if (spread < MIN_SPREAD_C) return null;
  const slope = olsSlope(xs, ys);
  if (slope == null) return null;
  return { slope, n: xs.length, spreadC: spread };
}

/**
 * Classify easy runs and attach the causal EF residual% to each. Mirrors the
 * science: era-relative median-pace easy rule, then trailing rolling-median EF
 * baseline (window 10, current run excluded), then back-fill the baseline.
 */
function buildEasyResiduals(activities: HeatRun[]): EasyPoint[] {
  // 1. Basic metrics + minimal validity (distance ≥1 km, time ≥5 min).
  const runs = activities
    .filter((a) => {
      const d = a.localDate;
      const m = a.distanceMeters;
      const t = a.movingTimeS;
      return (
        !!d &&
        m != null &&
        Number.isFinite(m) &&
        m >= 1000 &&
        t != null &&
        Number.isFinite(t) &&
        t >= 300
      );
    })
    .map((a) => {
      const meters = a.distanceMeters as number;
      const secs = a.movingTimeS as number;
      const minutes = secs / 60;
      return {
        date: a.localDate as string,
        meters,
        secs,
        paceMinPerKm: minutes / (meters / 1000), // lower = faster
        speedMPerMin: meters / minutes,
        avgHr: a.avgHr ?? null,
        tempC: a.avgTempC != null && Number.isFinite(a.avgTempC) ? a.avgTempC : null,
        isRace: a.workoutType === 1,
      };
    })
    .sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));

  // 2. Era-relative median pace over the trailing 90 days (causal: <= current
  //    day, including the current run, matching the science's rolling median).
  const easy: {
    date: string;
    ef: number;
    tempC: number | null;
  }[] = [];
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i]!;
    const from = shiftCivil(r.date, -ERA_DAYS);
    const win: number[] = [];
    for (let j = 0; j <= i; j++) {
      const o = runs[j]!;
      if (o.date > from && o.date <= r.date) win.push(o.paceMinPerKm);
    }
    if (win.length < ERA_MIN_RUNS) continue;
    const eraMed = median(win);
    const hrOk =
      r.avgHr != null &&
      Number.isFinite(r.avgHr) &&
      r.avgHr >= HR_MIN &&
      r.avgHr <= HR_MAX;
    // easy = pace at or slower than the era median, has HR, not a race.
    if (!hrOk || r.isRace) continue;
    if (r.paceMinPerKm < eraMed) continue;
    const ef = r.speedMPerMin / (r.avgHr as number);
    easy.push({ date: r.date, ef, tempC: r.tempC });
  }

  if (easy.length === 0) return [];

  // 3. Trailing rolling-median EF baseline over the last 10 easy runs,
  //    EXCLUDING the current run (shift(1)), then back-fill the leading nulls
  //    with the first computed baseline (pandas bfill).
  const baseRaw: (number | null)[] = easy.map((_, i) => {
    // window ending at the PREVIOUS run (current excluded).
    const end = i - 1;
    if (end < 0) return null;
    const start = Math.max(0, end - EF_BASE_WINDOW + 1);
    const win = easy.slice(start, end + 1).map((e) => e.ef);
    return win.length >= EF_BASE_MIN ? median(win) : null;
  });
  // bfill: replace leading nulls with the first non-null baseline.
  let firstBase: number | null = null;
  for (const b of baseRaw) {
    if (b != null) {
      firstBase = b;
      break;
    }
  }
  if (firstBase == null) return []; // never enough runs for a baseline

  const out: EasyPoint[] = [];
  for (let i = 0; i < easy.length; i++) {
    const base = baseRaw[i] ?? firstBase;
    if (base === 0 || !Number.isFinite(base)) continue;
    const residPct = (100 * (easy[i]!.ef - base)) / base;
    if (!Number.isFinite(residPct)) continue;
    out.push({ date: easy[i]!.date, tempC: easy[i]!.tempC, residPct });
  }
  return out;
}

/** Ordinary least-squares slope of y ~ x, or null when degenerate. */
function olsSlope(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 3) return null;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx;
    num += dx * (ys[i]! - my);
    den += dx * dx;
  }
  if (den === 0) return null;
  return num / den;
}

function mean(xs: number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** Median of a non-empty numeric array (copy-sorted, mean of the middle pair). */
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function round(x: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
}

/** Civil 'YYYY-MM-DD' + day delta → civil 'YYYY-MM-DD' (noon-UTC, tz-agnostic). */
function shiftCivil(localDate: string, days: number): string {
  const base = new Date(`${localDate}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}
