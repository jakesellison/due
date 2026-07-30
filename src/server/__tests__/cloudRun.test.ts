import http, { type IncomingMessage } from 'node:http';
import { Readable } from 'node:stream';

import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { BodyTooLargeError, MAX_BODY_BYTES, parseBody, readBody, routes } from '../cloudRun';

/** Build a fake IncomingMessage that streams `body` with the given method/headers. */
function fakeRequest(body: Buffer, contentType = 'application/octet-stream'): IncomingMessage {
  const req = Readable.from([body]) as unknown as IncomingMessage;
  req.method = 'POST';
  req.headers = { 'content-type': contentType };
  return req;
}

describe('cloudRun adapter surface', () => {
  it('keeps healthz outside authenticated API handlers', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true }));
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    expect(address).toEqual(expect.objectContaining({ port: expect.any(Number) }));
    server.close();
  });

  it('registers every handler that exists under api/ — no unreachable endpoints', () => {
    // A handler file with no entry in the routes map is dead code that reads as
    // shipped. Walk the directory rather than restating the list, so adding a
    // file without wiring it up fails here instead of at runtime.
    const apiDir = join(__dirname, '..', '..', '..', 'api');
    const found: string[] = [];
    for (const group of readdirSync(apiDir, { withFileTypes: true })) {
      if (!group.isDirectory()) continue;
      for (const file of readdirSync(join(apiDir, group.name))) {
        if (file.endsWith('.ts')) found.push(`${group.name}/${file.replace(/\.ts$/, '')}`);
      }
    }
    expect(found.length).toBeGreaterThan(0);

    // `auth-claim.ts` is served at the nested path /api/strava/auth/claim — the
    // filename can't contain a slash, so map it explicitly.
    const pathFor = (entry: string) =>
      entry === 'strava/auth-claim' ? '/api/strava/auth/claim' : `/api/${entry}`;

    const unregistered = found.filter((entry) => !routes.has(pathFor(entry)));
    expect(unregistered).toEqual([]);
  });

  it('routes every registered path to a callable handler', () => {
    for (const [path, handler] of routes) {
      expect(typeof handler).toBe('function');
      expect(path.startsWith('/api/')).toBe(true);
    }
  });
});

describe('readBody size cap (#18)', () => {
  it('accepts a normal-size body and parses it', async () => {
    const payload = JSON.stringify({ phase: 'summaries' });
    const body = await readBody(fakeRequest(Buffer.from(payload), 'application/json'));
    expect(body).toEqual({ phase: 'summaries' });
  });

  it('returns undefined for an empty body', async () => {
    const body = await readBody(fakeRequest(Buffer.alloc(0), 'application/json'));
    expect(body).toBeUndefined();
  });

  it('rejects a body that exceeds MAX_BODY_BYTES with BodyTooLargeError', async () => {
    const oversized = Buffer.alloc(MAX_BODY_BYTES + 1, 0x61);
    await expect(readBody(fakeRequest(oversized))).rejects.toBeInstanceOf(BodyTooLargeError);
  });

  it('accepts a body exactly at the limit', async () => {
    const atLimit = Buffer.alloc(MAX_BODY_BYTES, 0x61);
    const body = await readBody(fakeRequest(atLimit));
    expect(typeof body).toBe('string');
    expect((body as string).length).toBe(MAX_BODY_BYTES);
  });
});

describe('parseBody', () => {
  it('parses JSON, form-urlencoded, and falls back to raw text', () => {
    expect(parseBody(Buffer.from('{"a":1}'), 'application/json')).toEqual({ a: 1 });
    expect(parseBody(Buffer.from('a=1&b=2'), 'application/x-www-form-urlencoded')).toEqual({
      a: '1',
      b: '2',
    });
    expect(parseBody(Buffer.from('hello'), 'text/plain')).toBe('hello');
    expect(parseBody(Buffer.from('   '), 'application/json')).toBeUndefined();
  });
});
