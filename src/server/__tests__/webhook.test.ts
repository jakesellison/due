import {
  coerceQueryParam,
  parseStravaEvent,
  shouldProcessEvent,
  verifyTokenMatches,
} from '../../../api/strava/webhook';
import { deleteAllStravaActivities } from '../ingest';

describe('parseStravaEvent', () => {
  it('parses activity lifecycle events', () => {
    for (const aspect of ['create', 'update', 'delete'] as const) {
      const e = parseStravaEvent({ object_type: 'activity', aspect_type: aspect, object_id: 99, owner_id: 7 });
      expect(e).toMatchObject({ object_type: 'activity', aspect_type: aspect, object_id: 99, owner_id: 7 });
    }
  });

  it('recognises an athlete DEAUTHORIZATION event and carries its updates', () => {
    const e = parseStravaEvent({
      object_type: 'athlete',
      aspect_type: 'update',
      object_id: 7,
      owner_id: 7,
      updates: { authorized: 'false' },
    });
    expect(e).toMatchObject({ object_type: 'athlete', aspect_type: 'update', owner_id: 7 });
    expect(e?.updates).toEqual({ authorized: 'false' });
  });

  it('rejects malformed bodies and non-update athlete events', () => {
    expect(parseStravaEvent(null)).toBeNull();
    expect(parseStravaEvent({})).toBeNull(); // no owner_id
    expect(parseStravaEvent({ object_type: 'activity', aspect_type: 'create', owner_id: 7 })).toBeNull(); // no object_id
    expect(parseStravaEvent({ object_type: 'segment', aspect_type: 'create', object_id: 1, owner_id: 7 })).toBeNull();
    expect(parseStravaEvent({ object_type: 'athlete', aspect_type: 'create', owner_id: 7 })).toBeNull();
  });
});

// audit-ops L2: cloudRun's query-object collapsing can hand a GET handshake
// hub.* param as a string[] on a duplicate key; it must collapse to a single
// string before being compared/echoed.
describe('coerceQueryParam', () => {
  it('passes through a single string unchanged', () => {
    expect(coerceQueryParam('subscribe')).toBe('subscribe');
  });
  it('collapses an array to its first element', () => {
    expect(coerceQueryParam(['subscribe', 'again'])).toBe('subscribe');
  });
  it('passes through undefined', () => {
    expect(coerceQueryParam(undefined)).toBeUndefined();
  });
  it('collapses an empty array to undefined', () => {
    expect(coerceQueryParam([])).toBeUndefined();
  });
});

// audit-code Lane 1 Low: the verify-token compare must be constant-time (this
// replaces a `===` compare of the subscription verify token).
describe('verifyTokenMatches', () => {
  it('matches identical tokens', () => {
    expect(verifyTokenMatches('shh-secret', 'shh-secret')).toBe(true);
  });
  it('rejects a mismatched token of the same length', () => {
    expect(verifyTokenMatches('shh-secret', 'shh-decoy!')).toBe(false);
  });
  it('rejects a mismatched-length token without throwing', () => {
    expect(verifyTokenMatches('short', 'a-much-longer-secret')).toBe(false);
  });
  it('rejects undefined without throwing', () => {
    expect(verifyTokenMatches(undefined, 'shh-secret')).toBe(false);
  });
  it('rejects an empty string against a non-empty secret', () => {
    expect(verifyTokenMatches('', 'shh-secret')).toBe(false);
  });
});

// audit-code Lane 1 Medium: this predicate is the hard gate for the webhook's
// early-exit — no Strava API call / DB write happens for any event whose
// owner_id doesn't resolve to a real, active connection.
describe('shouldProcessEvent', () => {
  it('is false for null/undefined connections', () => {
    expect(shouldProcessEvent(null)).toBe(false);
    expect(shouldProcessEvent(undefined)).toBe(false);
  });
  it('is true for a resolved connection', () => {
    expect(shouldProcessEvent({ user_id: 'u1' })).toBe(true);
  });
});

describe('deleteAllStravaActivities', () => {
  it('deletes only the user’s strava-sourced rows', async () => {
    const eqFilters: Record<string, unknown> = {};
    const builder: { delete: jest.Mock; eq: jest.Mock; error: null } = {
      delete: jest.fn().mockReturnThis(),
      eq: jest.fn((col: string, val: unknown) => {
        eqFilters[col] = val;
        return builder;
      }),
      error: null,
    };
    const admin = { from: jest.fn(() => builder) };

    await deleteAllStravaActivities(admin as never, 'user-1');

    expect(admin.from).toHaveBeenCalledWith('activities');
    expect(builder.delete).toHaveBeenCalled();
    expect(eqFilters.user_id).toBe('user-1');
    expect(eqFilters.source).toBe('strava');
  });
});
