import { createRemoteJWKSet, jwtVerify } from 'jose';

/**
 * Google's OIDC signing keys (JWKS). `createRemoteJWKSet` returns a key-resolver
 * that fetches + caches the keys and transparently refetches on rotation/miss,
 * so we build it once per process and reuse it across requests.
 */
const GOOGLE_JWKS_URL = new URL('https://www.googleapis.com/oauth2/v3/certs');
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function getJwks(): ReturnType<typeof createRemoteJWKSet> {
  if (!jwks) jwks = createRemoteJWKSet(GOOGLE_JWKS_URL);
  return jwks;
}

/** Google issues its OIDC tokens under either of these two `iss` spellings. */
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

export interface OidcExpectation {
  /** Expected `aud` claim — the audience Cloud Scheduler was told to mint for. */
  audience: string;
  /** Expected `email` claim — the service account the scheduler runs as. */
  serviceAccountEmail: string;
}

/**
 * Verify a Google-signed OIDC identity token (as minted by Cloud Scheduler for
 * its service account when the job has an `oidc_token`). Checks, via `jose`:
 * the RS256 signature against Google's JWKS, the issuer, the audience, and
 * expiry; then that the token was issued for the EXACT service account we
 * expect (`email` claim) and that Google marked that address verified.
 *
 * Never throws — any failure (bad/absent signature, wrong `aud`/`email`,
 * expired, JWKS network error, malformed token) resolves to `false` so the
 * caller can respond 401 uniformly. This is the no-shared-secret replacement
 * for the CRON_SECRET bearer on the purge cron.
 */
export async function verifyGoogleOidcToken(
  token: string,
  expect: OidcExpectation,
): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, getJwks(), {
      issuer: GOOGLE_ISSUERS,
      audience: expect.audience,
    });
    return (
      payload.email === expect.serviceAccountEmail &&
      (payload as { email_verified?: unknown }).email_verified === true
    );
  } catch {
    return false;
  }
}
