import type { PlanIdentity } from './identity';

export type PlanCoverMode = 'contour' | 'strata' | 'traverse';
export type PlanCoverTone = 'quiet' | 'balanced' | 'vivid';
type PaletteIndex = 0 | 1 | 2 | 3 | 4;

const MODES: readonly PlanCoverMode[] = ['contour', 'strata', 'traverse'];

/**
 * Stable FNV-1a hash shared by native covers and future web/share renderers.
 * Keep this implementation deliberately boring: changing it changes every
 * existing plan's visual fingerprint.
 */
export function planCoverHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** SkSL floats retain enough precision when the hash is kept in this range. */
export function planCoverSeedValue(value: string): number {
  return 1 + (planCoverHash(value) % 9_973);
}


/**
 * Returns two distinct indices into the three-colour plan-art palette.
 * Violet appears in every ordered pair so generated covers remain related to
 * Due even as the companion hue changes between warm and cool.
 */
export function planCoverPalettePair(value: string): readonly [PaletteIndex, PaletteIndex] {
  const pair = planCoverHash(`${value}|palette`) % 8;
  const pairs = [
    [0, 1],
    [1, 0],
    [1, 2],
    [2, 1],
    [1, 3],
    [3, 1],
    [1, 4],
    [4, 1],
  ] as const;
  return pairs[pair] ?? pairs[0];
}

/** One global tone should be chosen for the canonical renderer, not per crop. */
export function planCoverToneStrength(tone: PlanCoverTone): number {
  if (tone === 'quiet') return 0.5;
  if (tone === 'vivid') return 1;
  return 0.84;
}

