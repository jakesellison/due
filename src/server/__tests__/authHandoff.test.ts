import { claimToken, depositToken, hashHandoff, mintHandoff, HANDOFF_TTL_MS } from '../authHandoff';

/**
 * A tiny in-memory stand-in for the `oauth_handoffs` table that honours the
 * subset of PostgREST filters this module uses. It matters that the conditional
 * filters are actually applied — the single-use guarantee IS the `claimed_at is
 * null` predicate, so a fake that ignored it would test nothing.
 */
interface Row {
  handoff_hash: string;
  provider: string;
  mode: string;
  token_hash: string | null;
  ticket_hash: string | null;
  claimed_at: string | null;
  expires_at: string;
}

function fakeAdmin(rows: Row[] = []) {
  const table = rows;

  const builder = (op: 'select' | 'update' | 'delete', patch?: Partial<Row>) => {
    const preds: Array<(r: Row) => boolean> = [];
    const chain = {
      eq(col: keyof Row, val: unknown) {
        preds.push((r) => r[col] === val);
        return chain;
      },
      is(col: keyof Row, val: null) {
        preds.push((r) => r[col] === val);
        return chain;
      },
      not(col: keyof Row, _op: 'is', val: null) {
        preds.push((r) => r[col] !== val);
        return chain;
      },
      gt(col: keyof Row, val: string) {
        preds.push((r) => String(r[col]) > val);
        return chain;
      },
      lt(col: keyof Row, val: string) {
        preds.push((r) => String(r[col]) < val);
        return chain;
      },
      maybeSingle() {
        const hit = table.filter((r) => preds.every((p) => p(r)))[0] ?? null;
        return Promise.resolve({ data: hit ? { ...hit } : null, error: null });
      },
      select() {
        const matched = table.filter((r) => preds.every((p) => p(r)));
        if (op === 'update' && patch) {
          matched.forEach((r) => Object.assign(r, patch));
          // PostgREST returns the UPDATED row. This detail is essential:
          // returning a pre-update snapshot previously let a broken claim
          // implementation pass tests while production always got null.
          return Promise.resolve({ data: matched.map((r) => ({ ...r })), error: null });
        }
        return Promise.resolve({ data: matched, error: null });
      },
      then(resolve: (v: { data: null; error: null }) => unknown) {
        const matched = table.filter((r) => preds.every((p) => p(r)));
        if (op === 'update' && patch) matched.forEach((r) => Object.assign(r, patch));
        if (op === 'delete') {
          for (const r of matched) table.splice(table.indexOf(r), 1);
        }
        return Promise.resolve(resolve({ data: null, error: null }));
      },
    };
    return chain;
  };

  return {
    table,
    from(_name: string) {
      return {
        insert(row: Row) {
          table.push({
            ...row,
            token_hash: row.token_hash ?? null,
            ticket_hash: row.ticket_hash ?? null,
            claimed_at: row.claimed_at ?? null,
          });
          return Promise.resolve({ error: null });
        },
        select: () => builder('select'),
        update: (patch: Partial<Row>) => builder('update', patch),
        delete: () => builder('delete'),
      };
    },
  } as unknown as Parameters<typeof mintHandoff>[0] & { table: Row[] };
}

const NOW = 1_700_000_000_000;

describe('mintHandoff', () => {
  it('stores only the HASH — the secret itself is never persisted', async () => {
    const admin = fakeAdmin();
    const { handoff, handoffHash } = await mintHandoff(admin, 'signin', NOW);

    expect(handoffHash).toBe(hashHandoff(handoff));
    const stored = (admin as unknown as { table: Row[] }).table[0];
    expect(stored?.handoff_hash).toBe(handoffHash);
    expect(JSON.stringify(stored)).not.toContain(handoff);
  });

  it('produces a distinct secret every time', async () => {
    const admin = fakeAdmin();
    const a = await mintHandoff(admin, 'signin', NOW);
    const b = await mintHandoff(admin, 'signin', NOW);
    expect(a.handoff).not.toBe(b.handoff);
  });
});

describe('claimToken', () => {
  it('returns the deposited token exactly once', async () => {
    const admin = fakeAdmin();
    const { handoff, handoffHash } = await mintHandoff(admin, 'signin', NOW);
    const ticket = await depositToken(admin, handoffHash, 'magic-token', NOW);

    expect(await claimToken(admin, handoff, ticket, NOW)).toEqual({ ok: true, tokenHash: 'magic-token' });
    // Second claim finds the row already claimed — this is what stops a replayed
    // handoff from minting a second session.
    expect(await claimToken(admin, handoff, ticket, NOW)).toEqual({ ok: false, reason: 'not_found' });
  });

  it('clears the token from the row once claimed', async () => {
    const admin = fakeAdmin();
    const { handoff, handoffHash } = await mintHandoff(admin, 'signin', NOW);
    const ticket = await depositToken(admin, handoffHash, 'magic-token', NOW);
    await claimToken(admin, handoff, ticket, NOW);

    const stored = (admin as unknown as { table: Row[] }).table[0];
    expect(stored?.token_hash).toBeNull();
    expect(stored?.claimed_at).not.toBeNull();
  });

  it('returns the token to only one of two racing claims', async () => {
    const admin = fakeAdmin();
    const { handoff, handoffHash } = await mintHandoff(admin, 'signin', NOW);
    const ticket = await depositToken(admin, handoffHash, 'magic-token', NOW);

    const results = await Promise.all([
      claimToken(admin, handoff, ticket, NOW),
      claimToken(admin, handoff, ticket, NOW),
    ]);

    expect(results.filter((result) => result.ok)).toEqual([
      { ok: true, tokenHash: 'magic-token' },
    ]);
    expect(results.filter((result) => !result.ok)).toHaveLength(1);
  });

  it('reports not_ready while the callback has not deposited yet', async () => {
    const admin = fakeAdmin();
    const { handoff } = await mintHandoff(admin, 'signin', NOW);
    expect(await claimToken(admin, handoff, 'any-ticket', NOW)).toEqual({ ok: false, reason: 'not_ready' });
  });

  it('refuses an unknown handoff', async () => {
    const admin = fakeAdmin();
    expect(await claimToken(admin, 'never-issued', 'any-ticket', NOW)).toEqual({
      ok: false,
      reason: 'not_found',
    });
  });

  it('refuses an expired handoff even with a token deposited', async () => {
    const admin = fakeAdmin();
    const { handoff, handoffHash } = await mintHandoff(admin, 'signin', NOW);
    const ticket = await depositToken(admin, handoffHash, 'magic-token', NOW);

    const afterExpiry = NOW + HANDOFF_TTL_MS + 1;
    expect(await claimToken(admin, handoff, ticket, afterExpiry)).toEqual({
      ok: false,
      reason: 'not_found',
    });
  });

  it("does not hand a victim's device a token deposited against a DIFFERENT handoff", async () => {
    // This is the login-CSRF scenario in miniature: the attacker drives a
    // callback that deposits a token, but it lands on THEIR row. The victim's
    // app claims its own handoff and must come away with nothing.
    const admin = fakeAdmin();
    const victim = await mintHandoff(admin, 'signin', NOW);
    const attacker = await mintHandoff(admin, 'signin', NOW);
    const ticket = await depositToken(admin, attacker.handoffHash, 'attacker-session', NOW);

    expect(await claimToken(admin, victim.handoff, ticket, NOW)).toEqual({
      ok: false,
      reason: 'not_ready',
    });
  });
});

describe('the RELAY (attacker starts the flow, victim consents)', () => {
  // The mirror image of the login-CSRF above, and the reason the ticket exists.
  // Binding to the STARTING device is not enough when the attacker IS the
  // starter: they mint a handoff, send the victim the genuine strava.com
  // authUrl, and the callback deposits the VICTIM's session token against the
  // ATTACKER's row. Before the ticket, the attacker simply claimed it.
  it("denies the attacker the victim's session even though the token is on their row", async () => {
    const admin = fakeAdmin();
    const attacker = await mintHandoff(admin, 'signin', NOW);

    // Victim consents; the callback deposits and mints a ticket that goes out
    // on the deep link — to the VICTIM's device, not the attacker's.
    const ticketTheVictimReceives = await depositToken(
      admin,
      attacker.handoffHash,
      'victim-session',
      NOW,
    );

    // The attacker holds the handoff but never saw that ticket.
    expect(await claimToken(admin, attacker.handoff, 'guessed-ticket', NOW)).toEqual({
      ok: false,
      reason: 'not_found',
    });

    // And the token is still unclaimed rather than burned — a failed guess must
    // not consume the row, or guessing would become a denial-of-service.
    const stored = (admin as unknown as { table: Row[] }).table[0];
    expect(stored?.token_hash).toBe('victim-session');
    expect(stored?.claimed_at).toBeNull();

    // Only the pair works, which is the legitimate one-device case.
    expect(await claimToken(admin, attacker.handoff, ticketTheVictimReceives, NOW)).toEqual({
      ok: true,
      tokenHash: 'victim-session',
    });
  });

  it('refuses a claim whose ticket belongs to a DIFFERENT flow', async () => {
    const admin = fakeAdmin();
    const a = await mintHandoff(admin, 'signin', NOW);
    const b = await mintHandoff(admin, 'signin', NOW);
    await depositToken(admin, a.handoffHash, 'session-a', NOW);
    const ticketB = await depositToken(admin, b.handoffHash, 'session-b', NOW);

    expect(await claimToken(admin, a.handoff, ticketB, NOW)).toEqual({
      ok: false,
      reason: 'not_found',
    });
  });

  it('mints a distinct ticket per deposit', async () => {
    const admin = fakeAdmin();
    const a = await mintHandoff(admin, 'signin', NOW);
    const b = await mintHandoff(admin, 'signin', NOW);
    expect(await depositToken(admin, a.handoffHash, 'tok', NOW)).not.toBe(
      await depositToken(admin, b.handoffHash, 'tok', NOW),
    );
  });

  it('stores only the ticket HASH — the secret itself is never persisted', async () => {
    const admin = fakeAdmin();
    const { handoffHash } = await mintHandoff(admin, 'signin', NOW);
    const ticket = await depositToken(admin, handoffHash, 'tok', NOW);

    const stored = (admin as unknown as { table: Row[] }).table[0];
    expect(stored?.ticket_hash).toBe(hashHandoff(ticket));
    expect(JSON.stringify(stored)).not.toContain(ticket);
  });
});

describe('depositToken', () => {
  it('throws when there is no live row for the flow', async () => {
    const admin = fakeAdmin();
    await expect(depositToken(admin, hashHandoff('nope'), 'tok', NOW)).rejects.toThrow(
      /no live handoff row/,
    );
  });

  it('refuses to deposit against a LINK-mode row', async () => {
    // Only sign-in mints a session token; a link flow receiving one would be a
    // bug worth failing loudly on.
    const admin = fakeAdmin();
    const { handoffHash } = await mintHandoff(admin, 'link', NOW);
    await expect(depositToken(admin, handoffHash, 'tok', NOW)).rejects.toThrow(
      /no live handoff row/,
    );
  });

  it('refuses to deposit after expiry', async () => {
    const admin = fakeAdmin();
    const { handoffHash } = await mintHandoff(admin, 'signin', NOW);
    await expect(
      depositToken(admin, handoffHash, 'tok', NOW + HANDOFF_TTL_MS + 1),
    ).rejects.toThrow(/no live handoff row/);
  });
});
