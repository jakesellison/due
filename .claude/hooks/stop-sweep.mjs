#!/usr/bin/env node
/**
 * Stop hook: an agent may not finish with a mess. Runs checks/sweep.mjs; a
 * failure blocks the stop (exit 2) and the sweep's report tells the agent what
 * to clean. `stop_hook_active` guards against a block loop — if the sweep
 * itself already bounced this stop once, let it through rather than trapping
 * the session (the CI run still catches whatever remained).
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const input = JSON.parse(readFileSync(0, 'utf8'));
if (input.stop_hook_active) process.exit(0);

const r = spawnSync('node', ['checks/sweep.mjs'], { encoding: 'utf8', cwd: input.cwd ?? process.cwd() });
if (r.status !== 0) {
  console.error(`Clean up before finishing:\n${(r.stderr || r.stdout).trim()}`);
  process.exit(2);
}
process.exit(0);
