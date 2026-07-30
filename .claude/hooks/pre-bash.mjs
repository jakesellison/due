#!/usr/bin/env node
/**
 * PreToolUse gate for Bash — the dependency gate. A new production dependency
 * is an architecture decision: it needs an ADR (docs/adr/), not an impulse.
 * Dev dependencies and bare installs (lockfile sync) pass. Exit 2 blocks.
 */
import { readFileSync } from 'node:fs';

const input = JSON.parse(readFileSync(0, 'utf8'));
const cmd = input.tool_input?.command ?? '';

const INSTALL = /\b(?:npm\s+(?:install|i|add)|yarn\s+add|pnpm\s+add|npx\s+expo\s+install)\s+(.+)/;
const m = cmd.match(INSTALL);
if (m) {
  const args = m[1];
  const bareSync = args.trim().startsWith('-') && !/\S+@|[a-z]/.test(args.replace(/--?[\w-]+/g, '').trim());
  const isDev = /(^|\s)(-D|--save-dev)(\s|$)/.test(args);
  const hasPackages = args.replace(/--?[\w-]+(=\S+)?/g, '').trim().length > 0;
  if (hasPackages && !isDev && !bareSync) {
    console.error(
      'DEPENDENCY GATE: adding a production dependency requires an ADR in docs/adr/ '
      + '(what it is, why no existing dep covers it, bundle cost). Write the ADR, then '
      + 'add the pin to package.json by hand and run a bare `npm install`.',
    );
    process.exit(2);
  }
}
process.exit(0);
