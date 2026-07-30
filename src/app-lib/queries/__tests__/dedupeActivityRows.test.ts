/**
 * Unit tests for `dedupeActivityRows` — the single canonical-run collapse that
 * feeds the prediction derivations. Two behaviours: (1) dedupe by
 * activity id; (2) when ANY real activity exists, drop every `manual` seed row.
 * Runs under the `app` Jest project (module pulls RN/Supabase transitively).
 */
// The module transitively imports the real Supabase client (which throws when
// config isn't baked into the test build), so stub it out.
jest.mock('../../supabase', () => ({ supabase: {} }));

import { dedupeActivityRows } from '../insightsView';
import type { ActivityRow } from '../rows';

function row(partial: Partial<ActivityRow> & { id: string; source: string }): ActivityRow {
  return {
    source_id: partial.id,
    name: null,
    local_date: '2026-06-01',
    distance_meters: 10000,
    moving_time_s: 3000,
    elapsed_time_s: null,
    avg_hr: null,
    user_note: null,
    start_date: null,
    avg_temp_c: null,
    best_efforts: null,
    workout_type: null,
    stream_summary: null,
    streams: null,
    route: null,
    laps: null,
    max_hr: null,
    suffer_score: null,
    shoe_id: null,
    ...partial,
  };
}

describe('dedupeActivityRows', () => {
  it('dedupes rows sharing an activity id (keeps one per id)', () => {
    const rows = [
      row({ id: 'a', source: 'strava' }),
      row({ id: 'a', source: 'strava' }),
      row({ id: 'b', source: 'strava' }),
    ];
    const out = dedupeActivityRows(rows);
    expect(out.map((r) => r.id).sort()).toEqual(['a', 'b']);
  });

  it('drops every manual seed row once any real (non-manual) activity exists', () => {
    const rows = [
      row({ id: 'real', source: 'strava' }),
      row({ id: 'seed1', source: 'manual' }),
      row({ id: 'seed2', source: 'manual' }),
    ];
    const out = dedupeActivityRows(rows);
    expect(out.map((r) => r.id)).toEqual(['real']);
    expect(out.every((r) => r.source !== 'manual')).toBe(true);
  });

  it('keeps manual rows when there is NO real data (pure-seed dev account)', () => {
    const rows = [
      row({ id: 'seed1', source: 'manual' }),
      row({ id: 'seed2', source: 'manual' }),
    ];
    const out = dedupeActivityRows(rows);
    expect(out.map((r) => r.id).sort()).toEqual(['seed1', 'seed2']);
  });

  it('dedupes by id AND drops seeds in the same pass', () => {
    const rows = [
      row({ id: 'real', source: 'strava' }),
      row({ id: 'real', source: 'strava' }), // duplicate id
      row({ id: 'seed', source: 'manual' }),
    ];
    const out = dedupeActivityRows(rows);
    expect(out.map((r) => r.id)).toEqual(['real']);
  });

  it('returns an empty array for no input', () => {
    expect(dedupeActivityRows([])).toEqual([]);
  });

  it('collapses the SAME provider activity ingested twice (same source_id, different id), keeping the most complete', () => {
    const rows = [
      row({ id: 'x1', source: 'strava', source_id: 'S99' }), // bare re-ingest
      row({
        id: 'x2',
        source: 'strava',
        source_id: 'S99',
        stream_summary: {} as ActivityRow['stream_summary'],
        best_efforts: [] as unknown as ActivityRow['best_efforts'],
      }), // carries stream_summary + best_efforts → kept
    ];
    const out = dedupeActivityRows(rows);
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe('x2');
  });

  it('keeps rows with distinct source_ids', () => {
    const rows = [
      row({ id: 'a', source: 'strava', source_id: 'S1' }),
      row({ id: 'b', source: 'strava', source_id: 'S2' }),
    ];
    expect(dedupeActivityRows(rows).map((r) => r.id).sort()).toEqual(['a', 'b']);
  });
});
