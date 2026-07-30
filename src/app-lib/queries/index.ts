/**
 * React-query data hooks for the Dash / Plan screens.
 *
 * The hooks only fetch rows; ALL derivation (per-week actual vs target, banding,
 * KPI tile values, heatmap cells) happens in the pure, node-tested
 * `summarizeBlock` function — these hooks just feed DB rows into it.
 *
 * This barrel re-exports the focused modules so consumers keep importing from
 * `@/app-lib/queries` (or `./queries` inside src/app-lib) unchanged.
 */

export * from './rows';
export * from './activePlan';
export * from './activities';
export * from './weeklyMileage';
export * from './planChanges';
export * from './planView';
export * from './weekDetail';
export * from './workoutDetail';
export * from './activityDetail';
export * from './qualityOverride';
export * from './insightsView';
export * from './prediction';
export * from './planHeader';
export * from './planSwitcher';
export * from './planIdentity';
export * from './recentMileage';
export * from './planInstall';
export * from './planExport';
export * from './shoes';
export * from './cache';

// Re-export so screens can reference weekStartOf if needed without a deep import.
export { weekStartOf } from '@/lib';
