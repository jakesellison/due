/**
 * The environment declaration guard.
 *
 * There is only one environment today, so the value of this module is entirely
 * in the failure it prevents LATER: a build whose declared environment and
 * actual backend disagree — a TestFlight build pointed at a scratch database,
 * or a tinkering session writing into production. Both are silent without a
 * check, and both get much easier the moment a second environment exists.
 */
import {
  APP_ENVIRONMENTS,
  assertEnvironmentMatches,
  isAppEnvironment,
  projectRefOf,
} from '../appEnv';

const PROD_URL = 'https://divgspozifwxrshdsuqg.supabase.co';

describe('projectRefOf', () => {
  it('extracts the ref from a project URL', () => {
    expect(projectRefOf(PROD_URL)).toBe('divgspozifwxrshdsuqg');
  });

  it('tolerates surrounding whitespace and casing', () => {
    expect(projectRefOf('  HTTPS://Divgspozifwxrshdsuqg.Supabase.CO  ')).toBe(
      'Divgspozifwxrshdsuqg',
    );
  });

  it('returns null for something that is not a project URL', () => {
    expect(projectRefOf('https://api.due.run')).toBeNull();
    expect(projectRefOf('')).toBeNull();
    expect(projectRefOf('not a url')).toBeNull();
  });
});

describe('assertEnvironmentMatches', () => {
  it('passes when a prod build points at the prod project', () => {
    expect(() => assertEnvironmentMatches(PROD_URL, 'prod')).not.toThrow();
  });

  it('THROWS when a prod build points somewhere else', () => {
    // The case that matters: a TestFlight build silently talking to a scratch
    // database. It must not boot.
    expect(() => assertEnvironmentMatches('https://scratchproject.supabase.co', 'prod'))
      .toThrow(/Environment mismatch/);
  });

  it('names both the expected and the actual project in the error', () => {
    // The error is read by someone who just built the wrong thing; it has to
    // say which is which without a trip to the source.
    expect(() => assertEnvironmentMatches('https://scratchproject.supabase.co', 'prod'))
      .toThrow(/divgspozifwxrshdsuqg[\s\S]*scratchproject/);
  });

  it('throws rather than passing when the URL is unparseable', () => {
    expect(() => assertEnvironmentMatches('garbage', 'prod')).toThrow(/Environment mismatch/);
  });

  it('warns instead of throwing for an environment with no pinned ref yet', () => {
    // `dev` is declared but not provisioned. Being strict here would block the
    // first build of a new environment — the moment strictness helps least.
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => assertEnvironmentMatches('https://anything.supabase.co', 'dev')).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('APP_ENV=dev'));
    warn.mockRestore();
  });
});

describe('isAppEnvironment', () => {
  it('accepts the declared environments and nothing else', () => {
    for (const env of APP_ENVIRONMENTS) expect(isAppEnvironment(env)).toBe(true);
    for (const bad of ['production', 'PROD', 'staging', '', null, undefined, 7]) {
      expect(isAppEnvironment(bad)).toBe(false);
    }
  });
});
