/**
 * Test stub for `jose` (ESM-only; ts-jest under the `node` project can't
 * transform it). Wired in via `moduleNameMapper` in jest.config.js so any
 * server test that transitively imports `jose` (e.g. through the Cloud Run
 * router → purge-raw → googleOidc) resolves to these jest.fn()s instead of the
 * real ESM module. Tests that exercise OIDC logic (`googleOidc.test.ts`) import
 * and drive `jwtVerify` directly. Production bundles the real `jose`.
 */
export const createRemoteJWKSet = jest.fn(() => 'JWKS_RESOLVER');
export const jwtVerify = jest.fn();
