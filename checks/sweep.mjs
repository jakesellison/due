#!/usr/bin/env node
/**
 * The clean-up-after-yourself sweep. Wired to the Stop hook: an agent that
 * tries to finish with a mess is bounced back to tidy (exit 2 blocks the stop).
 * Also runs in CI (--ci: exit 1) as the same net at review time.
 *
 * Checks, in order of cheapness:
 *   1. No stray entries in the repo root beyond the allowlist — scratch goes in
 *      the session scratchpad, never the repo.
 *   2. No orphaned exports (checks/orphans.mjs).
 *   3. No layer violations (checks/layers.mjs).
 *
 * Deliberately NOT here: typecheck and tests — too slow for a stop gate; they
 * run in `npm run check` and CI.
 */
import { execSync, spawnSync } from 'node:child_process';

const CI = process.argv.includes('--ci');
const FAIL = CI ? 1 : 2;

const ROOT_ALLOWLIST = new Set([
  '.claude', '.expo', '.git', '.github', '.gitignore', 'CLAUDE.md', 'DESIGN.md',
  'MISSING.md', 'README.md', 'app', 'app.json', 'assets', 'babel.config.js',
  'checks', 'docs', 'jest.config.js', 'metro.config.js', 'node_modules', 'package-lock.json',
  'package.json', 'src', 'tsconfig.json', 'expo-env.d.ts',
]);

const problems = [];

const rootEntries = execSync('ls -A1', { encoding: 'utf8' }).split('\n').filter(Boolean);
for (const entry of rootEntries) {
  if (!ROOT_ALLOWLIST.has(entry)) problems.push(`stray root entry: ${entry} (scratch belongs in the session scratchpad)`);
}

for (const check of ['checks/orphans.mjs', 'checks/layers.mjs']) {
  const r = spawnSync('node', [check], { encoding: 'utf8' });
  if (r.status !== 0) problems.push(`${check} failed:\n${(r.stderr || r.stdout).trim()}`);
}

if (problems.length) {
  console.error(`SWEEP FAILED (${problems.length}):\n  ${problems.join('\n  ')}`);
  process.exit(FAIL);
}
console.log('sweep: clean');
