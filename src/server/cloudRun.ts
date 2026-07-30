import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { URL } from 'node:url';

import type { ApiRequest, ApiResponse } from './httpTypes';
import { getEnv } from './env';
import { captureError, initServerSentry } from './report';

import accountDelete from '../../api/account/delete';
import stravaAuth from '../../api/strava/auth';
import stravaAuthClaim from '../../api/strava/auth-claim';
import stravaBackfill from '../../api/strava/backfill';
import stravaCallback from '../../api/strava/callback';
import stravaDisconnect from '../../api/strava/disconnect';
import stravaPurgeRaw from '../../api/strava/purge-raw';
import stravaRefresh from '../../api/strava/refresh';
import stravaRehydrate from '../../api/strava/rehydrate';
import stravaStatus from '../../api/strava/status';
import stravaSyncLatest from '../../api/strava/sync-latest';
import stravaWebhook from '../../api/strava/webhook';
import syncStatus from '../../api/sync/status';

type Handler = (req: ApiRequest, res: ApiResponse) => void | Promise<void>;

/**
 * Path → handler. Exported so a test can assert every handler in `api/` is
 * actually REACHABLE — a handler that exists but was never registered here is
 * silently dead, which is exactly the kind of wiring gap that survives review.
 */
export const routes = new Map<string, Handler>([
  ['/api/account/delete', accountDelete],
  ['/api/strava/auth', stravaAuth],
  ['/api/strava/auth/claim', stravaAuthClaim],
  ['/api/strava/backfill', stravaBackfill],
  ['/api/strava/callback', stravaCallback],
  ['/api/strava/disconnect', stravaDisconnect],
  ['/api/strava/purge-raw', stravaPurgeRaw],
  ['/api/strava/refresh', stravaRefresh],
  ['/api/strava/rehydrate', stravaRehydrate],
  ['/api/strava/status', stravaStatus],
  ['/api/strava/sync-latest', stravaSyncLatest],
  ['/api/strava/webhook', stravaWebhook],
  ['/api/sync/status', syncStatus],
]);

const port = Number(process.env.PORT ?? 8080);

/**
 * Cap the request body we will buffer — bounds memory so a never-ending stream
 * can't OOM the process (#18). 6MB leaves ample headroom for the Strava/sync
 * JSON payloads this server now handles.
 */
export const MAX_BODY_BYTES = 6 * 1024 * 1024;

/** Thrown by `readBody` when the request body exceeds {@link MAX_BODY_BYTES}. */
export class BodyTooLargeError extends Error {
  constructor() {
    super('Request body too large');
    this.name = 'BodyTooLargeError';
  }
}

const server = http.createServer(async (nodeReq, nodeRes) => {
  try {
    await handle(nodeReq, nodeRes);
  } catch (err) {
    if (err instanceof BodyTooLargeError) {
      if (!nodeRes.headersSent) {
        nodeRes.writeHead(413, { 'content-type': 'application/json; charset=utf-8' });
      }
      nodeRes.end(JSON.stringify({ error: 'Request body too large' }));
      return;
    }
    console.error('Unhandled API error:', err);
    await captureError(err, { route: nodeReq.url });
    if (!nodeRes.headersSent) {
      nodeRes.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
    }
    nodeRes.end(JSON.stringify({ error: 'Internal server error' }));
  }
});

/**
 * Starts the HTTP server. Validates required env up front so the process fails
 * fast with a clear message instead of erroring per-request (#46). Guarded
 * behind `require.main` below so importing this module (e.g. in tests) never
 * boots the server or trips the env check.
 */
/** Exported for the boot-fatal-path test (`cloudRunBoot.test.ts`); not otherwise called directly. */
export async function start(): Promise<void> {
  initServerSentry();
  try {
    getEnv();
  } catch (err) {
    console.error(
      'FATAL: refusing to start — required environment is missing.',
      err instanceof Error ? err.message : err,
    );
    // A misconfigured deploy (missing env) never gets a second chance to
    // report itself — the process exits immediately after. Capture + await
    // the bounded flush so the event has actually left the process before
    // `process.exit` tears it down (same rationale as `captureError`'s
    // per-request flush: Cloud Run doesn't guarantee CPU after this point).
    await captureError(err, { boot: 'env-validation' });
    process.exit(1);
    return;
  }

  server.listen(port, () => {
    console.log(`Due API listening on :${port}`);
  });
}

if (require.main === module) {
  void start();
}

async function handle(nodeReq: IncomingMessage, nodeRes: ServerResponse): Promise<void> {
  const url = new URL(nodeReq.url ?? '/', `http://${nodeReq.headers.host ?? 'localhost'}`);

  if (url.pathname === '/healthz' || url.pathname === '/api/healthz') {
    nodeRes.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    nodeRes.end(JSON.stringify({ ok: true }));
    return;
  }

  const handler = routes.get(url.pathname);
  if (!handler) {
    nodeRes.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    nodeRes.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  const req = nodeReq as unknown as ApiRequest;
  req.query = queryObject(url.searchParams);
  req.body = await readBody(nodeReq);

  const res = createApiResponse(nodeRes);
  await handler(req, res);
  if (!nodeRes.writableEnded) nodeRes.end();
}

function queryObject(params: URLSearchParams): ApiRequest['query'] {
  const query: ApiRequest['query'] = {};
  for (const [key, value] of params) {
    const existing = query[key];
    if (existing == null) {
      query[key] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      query[key] = [existing, value];
    }
  }
  return query;
}

export async function readBody(req: IncomingMessage): Promise<unknown> {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;

  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > MAX_BODY_BYTES) {
      // Stop draining the (potentially unbounded) stream; the caller maps this
      // to a 413 instead of buffering the whole request into memory (#18).
      req.destroy();
      throw new BodyTooLargeError();
    }
    chunks.push(buf);
  }
  if (chunks.length === 0) return undefined;

  return parseBody(Buffer.concat(chunks), req.headers['content-type']);
}

/**
 * Pure body decoder, split out so the size cap and content-type handling are
 * testable without a live socket. Returns `undefined` for an empty/blank body.
 */
export function parseBody(buffer: Buffer, contentTypeHeader: unknown): unknown {
  const raw = buffer.toString('utf8');
  const contentType = String(contentTypeHeader ?? '').toLowerCase();
  if (contentType.includes('application/json')) {
    if (raw.trim() === '') return undefined;
    return JSON.parse(raw);
  }
  if (contentType.includes('application/x-www-form-urlencoded')) {
    return queryObject(new URLSearchParams(raw));
  }
  return raw;
}

function createApiResponse(nodeRes: ServerResponse): ApiResponse {
  const res = nodeRes as unknown as ApiResponse;
  const setHeader = nodeRes.setHeader.bind(nodeRes);

  res.status = (statusCode: number) => {
    nodeRes.statusCode = statusCode;
    return res;
  };

  res.setHeader = (name: string, value: number | string | readonly string[]) => {
    setHeader(name, value);
    return res;
  };

  res.json = (body: unknown) => {
    if (!nodeRes.hasHeader('content-type')) {
      setHeader('content-type', 'application/json; charset=utf-8');
    }
    nodeRes.end(JSON.stringify(body));
    return res;
  };

  res.send = (body: unknown) => {
    if (Buffer.isBuffer(body) || typeof body === 'string') {
      nodeRes.end(body);
    } else if (body == null) {
      nodeRes.end();
    } else {
      res.json(body);
    }
    return res;
  };

  res.redirect = (statusOrUrl: number | string, maybeUrl?: string) => {
    const statusCode = typeof statusOrUrl === 'number' ? statusOrUrl : 307;
    const location = typeof statusOrUrl === 'number' ? maybeUrl : statusOrUrl;
    if (!location) throw new Error('redirect location is required');
    nodeRes.statusCode = statusCode;
    setHeader('location', location);
    nodeRes.end();
    return res;
  };

  return res;
}
