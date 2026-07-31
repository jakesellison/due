#!/usr/bin/env node
/**
 * Layer law, machine-enforced (CLAUDE.md "Layer law"):
 *
 *   src/lib        NO react-native, NO @/app-lib, NO @/components, NO app/
 *   src/app-lib    NO @/components, NO app/
 *   src/components NO app/
 *
 * Relative imports are RESOLVED and judged by where they land: importing DOWN
 * (app-lib -> lib) is the architecture working; importing UP is the violation.
 * Static data/assets (.json, images) are not code layers. The PreToolUse hook
 * applies the same aliases at write time; this is the whole-repo net.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { posix as path } from 'node:path';

const SPEC = /(?:from\s+|require\()\s*['"]([^'"]+)['"]/g;
const DATA = /\.(json|png|jpg|jpeg|gif|svg|ttf|otf)$/;

// Rank: higher may import lower, never the reverse.
const rank = (p) =>
  p.startsWith('src/lib/') ? 0
  : p.startsWith('src/app-lib/') ? 1
  : p.startsWith('src/components/') ? 2
  : p.startsWith('app/') ? 3
  : null;

const MODULE_BANS = [
  { layer: 'src/lib/', banned: [/^react-native$|^react-native\//, /^expo/, /^@\/app-lib/, /^@\/components/] },
  { layer: 'src/app-lib/', banned: [/^@\/components/] },
  { layer: 'src/components/', banned: [] },
];
const ALIAS = { '@/': 'src/' };

const files = execSync("git ls-files 'src/**/*.ts' 'src/**/*.tsx'", { encoding: 'utf8' })
  .split('\n').filter(Boolean).filter((f) => !f.includes('__tests__') && !f.includes('__sim__') && !f.includes('__testsupport__'));

const violations = [];
for (const file of files) {
  const myRank = rank(file);
  if (myRank == null) continue;
  const rules = MODULE_BANS.find((r) => file.startsWith(r.layer));
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(SPEC)) {
    const spec = m[1];
    if (DATA.test(spec)) continue;
    if (rules && rules.banned.some((b) => b.test(spec))) {
      violations.push(`${file}: imports '${spec}'`);
      continue;
    }
    // Resolve relative + aliased specifiers to a repo path and compare ranks.
    let target = null;
    if (spec.startsWith('.')) target = path.normalize(path.join(path.dirname(file), spec));
    else for (const [a, r] of Object.entries(ALIAS)) if (spec.startsWith(a)) target = r + spec.slice(a.length);
    if (target == null) continue;
    const targetRank = rank(target + '/') ?? rank(target);
    if (targetRank != null && targetRank > myRank) {
      violations.push(`${file}: imports '${spec}' (rank ${targetRank} from rank ${myRank})`);
    }
  }
}

if (violations.length) {
  console.error(`LAYER VIOLATIONS (${violations.length}):\n  ${violations.join('\n  ')}`);
  process.exit(1);
}
console.log(`layers: ok (${files.length} files)`);
