/**
 * PRINT dot-matrix layout — the approved chart language for volume data
 * ("punched dot columns": 1 dot = a fixed quantum of miles, stacked from a
 * heavy baseline; the satisfying read is COUNTING what you stacked).
 *
 * Pure layout maths, no React/Skia imports, so the node jest project can pin
 * the quantisation rules. MINI-DOT strategy for partial quanta (true
 * halftone: less ink = a SMALLER full circle — never a clipped shape, never
 * an opacity fade):
 *  - a remainder at/above ROUND_UP_FRAC rounds UP to a full dot;
 *  - a remainder between MIN_FRAC and ROUND_UP_FRAC prints as a MINI dot
 *    whose radius scales with the remainder (area-true, clamped so it never
 *    reads as dust or as a full dot);
 *  - a remainder under MIN_FRAC drops — so 58 mi at 10 mi/dot reads as
 *    5 dots and a small 6th, 49 mi as 5 dots, 51 mi as 5 dots;
 *  - tiny non-zero values still print one minimum-size mini dot — a 2 mi
 *    jog never renders as an empty column.
 */

/** Remainder at or above this fraction of a quantum rounds UP to a full dot. */
export const ROUND_UP_FRAC = 0.85;
/** Remainder below this fraction drops (unless it is the column's only mark). */
export const MIN_FRAC = 0.1;


export interface DotColumn {
  /** Number of fully solid dots (whole quanta, after rounding). */
  full: number;
  /**
   * Remainder fraction (0..1) printed as a trailing MINI dot above the solid
   * stack, or null when the column has no partial mark.
   */
  frac: number | null;
  /** Total marks drawn (full + the mini dot if present). */
  count: number;
}




