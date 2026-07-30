#!/usr/bin/env node
/**
 * PostToolUse on Edit/Write: verify-as-you-go. A type error surfaces in the
 * turn that caused it, not forty files later. Whole-project tsc is fine at this
 * repo's size; if it ever exceeds ~5s, scope it per-project reference and note
 * the change here. Exit 2 feeds the error back to the agent (non-blocking of
 * the already-applied write, but impossible to miss).
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const input = JSON.parse(readFileSync(0, 'utf8'));
const file = input.tool_input?.file_path ?? '';
if (!/\.(ts|tsx)$/.test(file)) process.exit(0);

const r = spawnSync('npx', ['tsc', '--noEmit'], { encoding: 'utf8', cwd: input.cwd ?? process.cwd() });
if (r.status !== 0) {
  const out = (r.stdout || r.stderr).trim().split('\n').slice(0, 20).join('\n');
  console.error(`typecheck failed after editing ${file}:\n${out}`);
  process.exit(2);
}
process.exit(0);
