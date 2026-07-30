/**
 * appEnv.ts — which environment is this build talking to?
 *
 * TODAY THERE IS EXACTLY ONE ENVIRONMENT. `prod` is the only value that
 * resolves to real infrastructure; `dev` is declared here but not provisioned.
 * See `docs/environments.md` for what exists, why there is no dev environment
 * yet, and the trigger for creating one.
 *
 * So why does this file exist at all? Because the dangerous failure is not
 * "there is no dev environment" — it is a build whose DECLARED environment and
 * ACTUAL backend disagree: a TestFlight build quietly pointed at a scratch
 * database, or a tinkering session quietly writing into production. That
 * mistake is silent, and it gets much easier to make the moment a second
 * environment appears. This module makes the pairing explicit and checked, so
 * standing up a dev environment later is a config change rather than a
 * refactor — and so the first mismatched build fails loudly instead of
 * corrupting something.
 *
 * The switch itself is which secret set a build is made with (`doppler run -p
 * due -c <config>`); `APP_ENV` is the build's DECLARATION of which set it
 * expects, and `assertEnvironmentMatches` is what holds the two together.
 */
import Constants from 'expo-constants';

export const APP_ENVIRONMENTS = ['prod', 'dev'] as const;
export type AppEnvironment = (typeof APP_ENVIRONMENTS)[number];

export function isAppEnvironment(value: unknown): value is AppEnvironment {
  return typeof value === 'string' && (APP_ENVIRONMENTS as readonly string[]).includes(value);
}

/**
 * Supabase project refs, by environment.
 *
 * NOT a secret — the ref is the public hostname of the project and is already
 * committed in `infra/terraform/dev.tfvars`. Pinning it is the whole point: it
 * is the only value that can tell us whether the URL a build was handed matches
 * the environment that build claims to be.
 *
 * `dev` is deliberately null: no dev project exists. Adding one means adding
 * its ref here, which is a conscious act rather than an accident.
 */
const PROJECT_REF: Record<AppEnvironment, string | null> = {
  prod: 'divgspozifwxrshdsuqg',
  dev: null,
};

const extra = (Constants.expoConfig?.extra ?? {}) as { appEnv?: string | null };

/**
 * This build's declared environment.
 *
 * Defaults to `prod` because that is the only provisioned environment; a build
 * made with no declaration is therefore correct by default rather than broken.
 * An unrecognised value falls back to `prod` too — but `assertEnvironmentMatches`
 * still checks the backend, so a typo cannot smuggle a build past the guard.
 */
export const APP_ENV: AppEnvironment = isAppEnvironment(process.env.EXPO_PUBLIC_APP_ENV)
  ? process.env.EXPO_PUBLIC_APP_ENV
  : isAppEnvironment(extra.appEnv)
    ? extra.appEnv
    : 'prod';


/** The Supabase project ref inside a project URL, or null if unparseable. */
export function projectRefOf(supabaseUrl: string): string | null {
  const match = /^https?:\/\/([a-z0-9]+)\.supabase\./i.exec(supabaseUrl.trim());
  return match?.[1] ?? null;
}

/**
 * Fail the build's first Supabase call if its declared environment and its
 * actual backend disagree.
 *
 * Throwing is deliberate, and matches how `supabase.ts` already treats a
 * misbuilt config: a wrong-environment build is not something to degrade
 * gracefully through, because every degraded path writes somebody's data into
 * the wrong database. Loud and early beats subtle and later.
 *
 * An environment with no pinned ref (i.e. one that has not been provisioned)
 * cannot be checked, so it is allowed through with a warning rather than a
 * throw — otherwise this guard would block the very first build of a new
 * environment, which is the moment it is least helpful to be strict.
 */
export function assertEnvironmentMatches(supabaseUrl: string, env: AppEnvironment = APP_ENV): void {
  const expected = PROJECT_REF[env];
  const actual = projectRefOf(supabaseUrl);

  if (expected == null) {
    console.warn(
      `[env] APP_ENV=${env} has no pinned Supabase ref yet — cannot verify this build points where it claims. `
        + `Add it to PROJECT_REF in src/app-lib/appEnv.ts once the project exists.`,
    );
    return;
  }

  if (actual !== expected) {
    throw new Error(
      `Environment mismatch: this build declares APP_ENV=${env} (Supabase project ${expected}) `
        + `but was built against project ${actual ?? 'an unparseable URL'}. `
        + `Rebuild with the matching secret set — see docs/environments.md.`,
    );
  }
}
