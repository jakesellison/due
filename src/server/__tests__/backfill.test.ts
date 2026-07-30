import {
  afterUnixSeconds,
  BACKFILL_WEEKS,
  ENRICH_SELECT_FILTER,
  enrichOffsetFromCursor,
  isRunActivity,
  mapStravaSummary,
  nextSummariesCursor,
  PURGED_STALE_VERSION_FILTER,
  SUMMARY_PER_PAGE,
  summariesPageFromCursor,
  type StravaSummaryActivity,
} from '../backfill';
import { STREAM_SUMMARY_VERSION } from '../../lib/kpi/ingestVerdict';

describe('isRunActivity', () => {
  it('accepts runs by sport_type and type, case-insensitively', () => {
    expect(isRunActivity({ sport_type: 'Run' })).toBe(true);
    expect(isRunActivity({ type: 'run' })).toBe(true);
    expect(isRunActivity({ sport_type: 'TrailRun' })).toBe(true);
    expect(isRunActivity({ sport_type: 'VirtualRun' })).toBe(true);
  });
  it('prefers sport_type over type when both present', () => {
    // Strava back-fills `type: 'Workout'` on some run sport_types; sport_type wins.
    expect(isRunActivity({ sport_type: 'Run', type: 'Workout' })).toBe(true);
  });
  it('rejects non-runs and empties', () => {
    expect(isRunActivity({ sport_type: 'Ride' })).toBe(false);
    expect(isRunActivity({ sport_type: 'EBikeRide' })).toBe(false); // the webhook-ingested e-bike
    expect(isRunActivity({ sport_type: 'MountainBikeRide' })).toBe(false);
    expect(isRunActivity({ sport_type: 'Swim' })).toBe(false);
    expect(isRunActivity({ type: 'Walk' })).toBe(false);
    expect(isRunActivity({ sport_type: 'Hike' })).toBe(false);
    expect(isRunActivity({})).toBe(false);
    expect(isRunActivity(null)).toBe(false);
    expect(isRunActivity(undefined)).toBe(false);
  });
});

describe('afterUnixSeconds', () => {
  it('computes the unix-seconds bound BACKFILL_WEEKS back from now', () => {
    const now = new Date('2026-06-04T00:00:00Z');
    const got = afterUnixSeconds(now);
    const expected = Math.floor(now.getTime() / 1000) - BACKFILL_WEEKS * 7 * 24 * 60 * 60;
    expect(got).toBe(expected);
  });
  it('honors a custom window', () => {
    const now = new Date('2026-06-04T00:00:00Z');
    expect(afterUnixSeconds(now, 1)).toBe(Math.floor(now.getTime() / 1000) - 7 * 86400);
  });
});

describe('nextSummariesCursor', () => {
  it('advances on a full page', () => {
    expect(nextSummariesCursor(1, SUMMARY_PER_PAGE)).toEqual({ page: 2 });
    expect(nextSummariesCursor(3, SUMMARY_PER_PAGE)).toEqual({ page: 4 });
  });
  it('stops on a short or empty page', () => {
    expect(nextSummariesCursor(2, SUMMARY_PER_PAGE - 1)).toBeNull();
    expect(nextSummariesCursor(2, 0)).toBeNull();
  });
});

describe('cursor coercion', () => {
  it('summariesPageFromCursor defaults to 1 and floors valid pages', () => {
    expect(summariesPageFromCursor(undefined)).toBe(1);
    expect(summariesPageFromCursor(null)).toBe(1);
    expect(summariesPageFromCursor({})).toBe(1);
    expect(summariesPageFromCursor({ page: 0 })).toBe(1);
    expect(summariesPageFromCursor({ page: 3 })).toBe(3);
    expect(summariesPageFromCursor({ page: 3.9 })).toBe(3);
    expect(summariesPageFromCursor({ page: 'x' })).toBe(1);
  });
  it('enrichOffsetFromCursor defaults to 0 and floors valid offsets', () => {
    expect(enrichOffsetFromCursor(undefined)).toBe(0);
    expect(enrichOffsetFromCursor({})).toBe(0);
    expect(enrichOffsetFromCursor({ offset: -1 })).toBe(0);
    expect(enrichOffsetFromCursor({ offset: 8 })).toBe(8);
    expect(enrichOffsetFromCursor({ offset: 8.7 })).toBe(8);
  });
});

describe('ENRICH_SELECT_FILTER', () => {
  // Locks the exact PostgREST `.or()` argument used by the 'enrich' phase
  // select (api/strava/backfill.ts runEnrich). Regression guard for the
  // confirmed-live bug where the old predicate
  // (`streams.is.null,best_efforts.is.null,stream_summary.is.null,stream_summary->quality.is.null`)
  // never terminated for streamless/no-best_efforts rows — every enrich pass
  // refetched the same rows forever. The fixed predicate only re-picks a row
  // that was never attempted (`enriched_at.is.null`), or one that DOES have
  // streams but carries a quality verdict older than the current detector
  // policy (`quality->>v` absent or ≠ '8'). The two version or-legs are required
  // by SQL null semantics (NULL ≠ '8' is UNKNOWN, so `.neq.8` alone misses the
  // never-versioned rows); the current code always writes the current
  // STREAM_SUMMARY_VERSION so re-enrich terminates in one pass. The neq leg also
  // re-picks older rows for each policy bump (v4 regime-detection, v5 actualBar,
  // v6 lap↔regime reconciliation, v7 lap classification: tempo/progression +
  // coverage, v8 plan-conditioned change-point interpreter, v9 honest-read
  // precision floor).
  it('is exactly the never-attempted-OR-streams-with-stale-verdict nested filter', () => {
    expect(ENRICH_SELECT_FILTER).toBe(
      `enriched_at.is.null,and(streams.not.is.null,or(stream_summary->quality->>v.is.null,stream_summary->quality->>v.neq.${STREAM_SUMMARY_VERSION}))`,
    );
  });

  it('does not resurrect the old non-terminating streams/best_efforts clauses', () => {
    expect(ENRICH_SELECT_FILTER).not.toMatch(/best_efforts/);
    expect(ENRICH_SELECT_FILTER).not.toContain('streams.is.null');
  });
});

describe('PURGED_STALE_VERSION_FILTER', () => {
  // The 7-day raw-data cache (api/strava/purge-raw.ts) nulls `streams` on old
  // rows. A purged row can carry a stale/absent stream_summary.quality.v — it
  // was enriched before purge — but ENRICH_SELECT_FILTER's `streams.not.is.null`
  // guard deliberately excludes it (computeStreamSummaryFromStored has nothing
  // to recompute from). PURGED_STALE_VERSION_FILTER isolates exactly that
  // "stale version" leg, shared with ENRICH_SELECT_FILTER via the same
  // constant, so the two can never drift on what counts as stale. It's used
  // only for a best-effort observability count in the backfill handler
  // (gated on streams IS NULL there, the opposite of ENRICH_SELECT_FILTER),
  // never to select rows for enrich work.
  it('is exactly the stale-verdict leg, matching ENRICH_SELECT_FILTER word-for-word', () => {
    expect(PURGED_STALE_VERSION_FILTER).toBe(
      `stream_summary->quality->>v.is.null,stream_summary->quality->>v.neq.${STREAM_SUMMARY_VERSION}`,
    );
    expect(ENRICH_SELECT_FILTER).toContain(PURGED_STALE_VERSION_FILTER);
  });
});

describe('mapStravaSummary', () => {
  const summary: StravaSummaryActivity = {
    id: 555,
    name: 'Morning Run',
    start_date: '2024-01-15T13:30:00Z', // 07:30 America/Chicago (CST)
    distance: 10234.7,
    moving_time: 3000,
    elapsed_time: 3120,
    average_heartrate: 152.4,
    max_heartrate: 174,
    suffer_score: 88,
    sport_type: 'Run',
    type: 'Run',
    average_temp: 9,
    map: { summary_polyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@' },
  };

  it('maps core fields, rounding distance and computing local_date', () => {
    const row = mapStravaSummary(summary, 'America/Chicago');
    expect(row.source).toBe('strava');
    expect(row.source_id).toBe('555');
    expect(row.distance_meters).toBe(10235);
    expect(row.local_date).toBe('2024-01-15');
    expect(row.moving_time_s).toBe(3000);
    expect(row.elapsed_time_s).toBe(3120);
    expect(row.avg_hr).toBe(152);
    expect(row.max_hr).toBe(174);
    expect(row.suffer_score).toBe(88);
    expect(row.name).toBe('Morning Run');
    expect(row.sport_type).toBe('Run');
  });

  it('leaves enrichment fields null but decodes the route from the summary polyline', () => {
    const row = mapStravaSummary(summary, 'America/Chicago');
    expect(row.best_efforts).toBeNull();
    expect(row.laps).toBeNull();
    expect(row.streams).toBeNull();
    expect(row.avg_temp_c).toBe(9);
    expect(row.route).not.toBeNull();
    expect(row.route!.length).toBeGreaterThan(0);
    expect(row.route![0]).toEqual([38.5, -120.2]);
  });

  it('computes durable route_simplified + hr_load alongside route/avg_hr', () => {
    const row = mapStravaSummary(summary, 'America/Chicago');
    expect(row.route_simplified).not.toBeNull();
    expect(row.route_simplified![0]).toEqual(row.route![0]);
    expect(row.route_simplified!.length).toBeLessThanOrEqual(50);
    expect(row.hr_load).not.toBeNull();
    expect(typeof row.hr_load).toBe('number');
  });

  it('defaults name and route when absent', () => {
    const bare: StravaSummaryActivity = {
      id: 1,
      start_date: '2024-06-01T12:00:00Z',
      distance: 5000,
      moving_time: 1500,
      elapsed_time: 1500,
      sport_type: 'Run',
    };
    const row = mapStravaSummary(bare, 'America/Chicago');
    expect(row.name).toBe('Run');
    expect(row.route).toBeNull();
    expect(row.avg_temp_c).toBeNull();
    expect(row.avg_hr).toBeNull();
    expect(row.route_simplified).toBeNull();
    expect(row.hr_load).toBeNull();
  });
});

describe('real-world float fields (Strava returns decimals)', () => {
  test('mapStravaSummary rounds avg/max HR and suffer score to integers', () => {
    const row = mapStravaSummary(
      {
        id: 17390274293,
        type: 'Run',
        sport_type: 'Run',
        name: 'NY Running',
        distance: 23109.4,
        moving_time: 7654,
        elapsed_time: 7700,
        start_date: '2026-06-03T19:36:00Z',
        average_heartrate: 151.5,
        max_heartrate: 178.4,
        suffer_score: 55.2,
        map: { summary_polyline: null },
      } as never,
      'America/Chicago',
    );
    expect(row.avg_hr).toBe(152);
    expect(row.max_hr).toBe(178);
    expect(row.suffer_score).toBe(55);
    expect(Number.isInteger(row.distance_meters)).toBe(true);
  });
});
