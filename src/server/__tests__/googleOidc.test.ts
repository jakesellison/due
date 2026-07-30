// jose does the cryptographic verification (signature/issuer/audience/expiry).
// Under the `node` jest project `jose` is mapped to a stub (see jest.config.js
// moduleNameMapper) whose `jwtVerify` is a jest.fn — so these tests exercise
// OUR logic (the email/email_verified claim checks and the never-throws
// contract) in isolation, without minting real Google-signed tokens.
import { jwtVerify } from 'jose';
import { verifyGoogleOidcToken } from '../googleOidc';

const mockJwtVerify = jwtVerify as jest.MockedFunction<typeof jwtVerify>;

const EXPECT = { audience: 'https://api.example/purge', serviceAccountEmail: 'sched@proj.iam.gserviceaccount.com' };

function resolveWith(payload: Record<string, unknown>) {
  mockJwtVerify.mockResolvedValueOnce({ payload } as never);
}

beforeEach(() => mockJwtVerify.mockReset());

describe('verifyGoogleOidcToken', () => {
  it('accepts a token whose email matches the SA and is verified', async () => {
    resolveWith({ email: EXPECT.serviceAccountEmail, email_verified: true });
    await expect(verifyGoogleOidcToken('t', EXPECT)).resolves.toBe(true);
  });

  it('passes issuer + audience constraints to jose', async () => {
    resolveWith({ email: EXPECT.serviceAccountEmail, email_verified: true });
    await verifyGoogleOidcToken('the-token', EXPECT);
    expect(mockJwtVerify).toHaveBeenCalledWith('the-token', 'JWKS_RESOLVER', {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: EXPECT.audience,
    });
  });

  it('rejects a token from a different service account', async () => {
    resolveWith({ email: 'someone-else@proj.iam.gserviceaccount.com', email_verified: true });
    await expect(verifyGoogleOidcToken('t', EXPECT)).resolves.toBe(false);
  });

  it('rejects when email_verified is not true', async () => {
    resolveWith({ email: EXPECT.serviceAccountEmail, email_verified: false });
    await expect(verifyGoogleOidcToken('t', EXPECT)).resolves.toBe(false);
  });

  it('rejects when the email_verified claim is absent', async () => {
    resolveWith({ email: EXPECT.serviceAccountEmail });
    await expect(verifyGoogleOidcToken('t', EXPECT)).resolves.toBe(false);
  });

  it('never throws — a failed jose verification resolves to false', async () => {
    mockJwtVerify.mockRejectedValueOnce(new Error('signature verification failed'));
    await expect(verifyGoogleOidcToken('bad', EXPECT)).resolves.toBe(false);
  });
});
