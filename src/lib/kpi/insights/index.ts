/**
 * Pure, node-tested derivations for the upgraded Trends screen.
 *
 * Every function here is a deterministic transform over plain arrays — no
 * Supabase, no React. The query/hook layer maps DB rows into these plain input
 * shapes and feeds them in; the UI renders the outputs.
 *
 * Conventions: distances in meters, durations in seconds, temperatures in °C,
 * dates are civil 'YYYY-MM-DD' or UTC ISO instants as noted per field.
 *
 * This is the public barrel for the insights package — consumers import from
 * `../kpi/insights`. The shared statistics helpers in `./stats` are package-
 * internal (imported by sibling modules, not re-exported) so the public surface
 * stays exactly the named insight functions and their types.
 */

export * from './inputs';
export * from './volume';
export * from './comparableMile';
export * from './heat';
export * from './bounds';
export * from './records';
export * from './timeOfDay';
export * from './trainingLoad';
