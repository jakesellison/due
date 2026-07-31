#!/usr/bin/env node
/**
 * Handler-contract ratchet: every file in api/ is wire contract — the HTTP
 * surface the app and Strava actually call. The 2026-07-30 mutation audit
 * found both of its real coverage holes in handler WIRING (logic tested at
 * src/server, the consuming handler untested): a deleted deauthorization
 * guard and a 404→200 flip both survived the full suite. This check makes
 * that class structural: a handler may only ship when at least one test
 * imports it directly and pins its contract (method gate, auth gate, success
 * shape, error posture — see apiHandlerContracts.test.ts for the template).
 *
 * `checks/apiContracts.baseline.json` lists handlers carried thin on purpose
 * (documented in docs/audits/2026-07-30-test-audit.md). Target: empty. A
 * baseline entry whose handler gains a test must be removed (stale-entry
 * failure), so the ratchet only ever tightens.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { posix as path } from 'node:path';

const baseline = new Set(JSON.parse(readFileSync('checks/apiContracts.baseline.json', 'utf8')));

const handlers = execSync("git ls-files 'api/**/*.ts'", { encoding: 'utf8' })
  .split('\n').filter(Boolean).filter((f) => !f.includes('__tests__'));

const testFiles = execSync("git ls-files '*.test.ts' '*.test.tsx'", { encoding: 'utf8' })
  .split('\n').filter(Boolean);

const SPEC = /(?:from\s+|require\()\s*['"]([^'"]+)['"]/g;
const imported = new Set();
for (const t of testFiles) {
  const src = readFileSync(t, 'utf8');
  for (const m of src.matchAll(SPEC)) {
    const spec = m[1];
    if (!spec.startsWith('.')) continue;
    const resolved = path.normalize(path.join(path.dirname(t), spec));
    if (resolved.startsWith('api/')) imported.add(`${resolved}.ts`);
  }
}

const missing = handlers.filter((h) => !imported.has(h) && !baseline.has(h));
const stale = [...baseline].filter((b) => imported.has(b) || !handlers.includes(b));

if (missing.length || stale.length) {
  if (missing.length) {
    console.error(
      `HANDLERS WITHOUT A CONTRACT TEST (${missing.length}):\n  ${missing.join('\n  ')}\n` +
      'Write a contract test that imports the handler (template:\n' +
      'src/server/__tests__/apiHandlerContracts.test.ts) — method gate, auth\n' +
      'gate, success shape, generic error posture.',
    );
  }
  if (stale.length) {
    console.error(
      `STALE BASELINE ENTRIES (${stale.length}):\n  ${stale.join('\n  ')}\n` +
      'The handler is now tested (or gone) — remove it from\n' +
      'checks/apiContracts.baseline.json so the ratchet tightens.',
    );
  }
  process.exit(1);
}
console.log(`apiContracts: ok (${handlers.length - baseline.size}/${handlers.length} handlers under contract, baseline ${baseline.size} — target 0)`);
