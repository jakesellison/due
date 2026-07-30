#!/usr/bin/env node
/**
 * Orphan ratchet: every export in src/ must have at least one PRODUCTION
 * consumer outside its own file (the barrel does not count; tests do not
 * count — a tested function nothing ships is still dead).
 *
 * This is the check the old repo never had: its lib accumulated 45 exports
 * (~1,760 lines) that were built, tested, and wired to nothing. Here that
 * state fails CI the day it appears.
 *
 * `checks/orphans.baseline.json` lists temporary exceptions — an export may sit
 * there ONLY while its consumer lands later in the same phase, with a ledger
 * line. The target state is an empty baseline, and CI prints the count.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const isTest = (f) => f.includes('__tests__') || f.includes('__sim__');
const BARRELS = new Set(['src/lib/index.ts']);

// Named test seams that don't follow the __/ForTests convention: exported so
// the node suite can drive internals directly. A prod consumer would be a bug.
const TEST_SEAMS = new Set(['src/server/ingest.ts#countHardLaps', 'api/strava/webhook.ts#processEvent', 'src/app-lib/pushNotifications.ts#routeFromResponse']);

const baseline = new Set(JSON.parse(readFileSync('checks/orphans.baseline.json', 'utf8')));

const srcFiles = execSync("git ls-files 'src/**/*.ts' 'src/**/*.tsx'", { encoding: 'utf8' })
  .split('\n').filter(Boolean).filter((f) => !isTest(f) && !BARRELS.has(f));

const allProd = execSync("git ls-files '*.ts' '*.tsx'", { encoding: 'utf8' })
  .split('\n').filter(Boolean).filter((f) => !isTest(f) && !BARRELS.has(f))
  .map((f) => ({ f, s: readFileSync(f, 'utf8') }));

const EXPORT_RE = /^export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z0-9_]+)/gm;

const orphans = [];
for (const file of srcFiles) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(EXPORT_RE)) {
    const name = m[1];
    // Deliberate test seams (reset hooks, __testing handles) exist FOR tests;
    // a prod consumer would be a bug, not a goal.
    if (/^__|ForTests$/.test(name)) continue;
    if (TEST_SEAMS.has(`${file}#${name}`)) continue;
    const key = `${file}#${name}`;
    if (baseline.has(key)) continue;
    // Used inside its own file (beyond the declaration) → should be private,
    // but that is Tier C noise, not an orphan; the declaration line plus one
    // more mention counts as self-use.
    const selfUses = (src.match(new RegExp(`\\b${name}\\b`, 'g')) ?? []).length;
    if (selfUses > 1) continue;
    const w = new RegExp(`\\b${name}\\b`);
    if (allProd.some((p) => p.f !== file && w.test(p.s))) continue;
    orphans.push(key);
  }
}

if (orphans.length) {
  console.error(
    `ORPHANED EXPORTS (${orphans.length}) — no production consumer:\n  ${orphans.join('\n  ')}\n` +
    'Wire it up, delete it (ledger in MISSING.md), or — only if its consumer lands\n' +
    'later in this same phase — add it to checks/orphans.baseline.json with a ledger line.',
  );
  process.exit(1);
}
console.log(`orphans: ok (baseline ${baseline.size} — target 0)`);
