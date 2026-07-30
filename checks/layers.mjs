#!/usr/bin/env node
/**
 * Layer law, machine-enforced (CLAUDE.md "Layer law"):
 *
 *   src/lib        NO react-native, NO @/app-lib, NO @/components, NO app/
 *   src/app-lib    NO @/components, NO app/
 *   src/components NO app/
 *
 * The PreToolUse hook applies the same rules at write time; this is the
 * whole-repo net that also catches files created outside the hook's view.
 * Exit 1 with a per-violation report.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// import/require/export-from specifiers, cheap and dependency-free.
const SPEC = /(?:from\s+|require\()\s*['"]([^'"]+)['"]/g;

const RULES = [
  { layer: 'src/lib/', banned: [/^react-native$|^react-native\//, /^@\/app-lib/, /^@\/components/, /^expo/, /app\//] },
  { layer: 'src/app-lib/', banned: [/^@\/components/, /app\//] },
  { layer: 'src/components/', banned: [/app\//] },
];

const files = execSync("git ls-files 'src/**/*.ts' 'src/**/*.tsx'", { encoding: 'utf8' })
  .split('\n').filter(Boolean).filter((f) => !f.includes('__tests__'));

const violations = [];
for (const file of files) {
  const rule = RULES.find((r) => file.startsWith(r.layer));
  if (!rule) continue;
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(SPEC)) {
    const spec = m[1];
    // Relative imports cannot cross layers upward without an alias, except by
    // climbing out of src/ entirely — flag any '../..' escape from the layer.
    const climbsOut = spec.startsWith('..') && spec.split('../').length - 1 >= file.slice(rule.layer.length).split('/').length;
    if (climbsOut || rule.banned.some((b) => b.test(spec))) {
      violations.push(`${file}: imports '${spec}' (layer ${rule.layer} forbids it)`);
    }
  }
}

if (violations.length) {
  console.error(`LAYER VIOLATIONS (${violations.length}):\n  ${violations.join('\n  ')}`);
  process.exit(1);
}
console.log(`layers: ok (${files.length} files)`);
