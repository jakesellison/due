/**
 * suggestTier — map a runner's recent weekly mileage onto the nearest starter
 * mileage tier so the picker can pre-select a sensible volume.
 *
 * Pure. No IO. Node-tested.
 */

/** The three recent-volume bands used to match a runner to a starter block. */
const STARTER_TIERS = [30, 45, 60] as const;
export type StarterTier = (typeof STARTER_TIERS)[number];

/**
 * Snap `recentWeeklyMiles` to the closest of [30, 45, 60] by absolute distance,
 * breaking exact ties UPWARD (37.5 → 45, 52.5 → 60). Returns `null` when recent
 * mileage is unknown (no activity history to base a suggestion on).
 */
export function suggestTier(recentWeeklyMiles: number | null): StarterTier | null {
  if (recentWeeklyMiles == null) return null;
  let best: StarterTier = STARTER_TIERS[0];
  let bestDist = Math.abs(recentWeeklyMiles - best);
  for (const tier of STARTER_TIERS) {
    const dist = Math.abs(recentWeeklyMiles - tier);
    // Strictly-less keeps the lower tier on a real win; `<=` on a tie lets the
    // higher tier (iterated later) take over → ties resolve upward.
    if (dist <= bestDist) {
      best = tier;
      bestDist = dist;
    }
  }
  return best;
}
