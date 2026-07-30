#!/usr/bin/env node
/**
 * Fact law: one deriver per domain fact; screens never re-derive a registered
 * fact from raw fields (DESIGN.md "Fact law").
 *
 * This is the check that would have caught the old repo's worst class of bug —
 * the Dash and the planner disagreeing about the same day's mileage because
 * each derived it independently.
 *
 * Registry shape (checks/facts.registry.json):
 *   facts: {
 *     "day_planned_distance": {
 *       "deriver": "src/lib/planner/dayComposition.ts#dayComposition",
 *       "surfaces": ["app/(tabs)/index.tsx", "app/planner/[id].tsx"],
 *       "bannedPatterns": ["planned_distance_meters\\s*\\?\\?\\s*0\\s*\\).*reduce"]
 *     }
 *   }
 * A bannedPattern matching in app/ or src/components/ outside the deriver's own
 * file fails the check. It is a ratchet, not a proof — every incident adds a
 * pattern, and patterns never come back out.
 */
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const registry = JSON.parse(readFileSync('checks/facts.registry.json', 'utf8'));
const facts = Object.entries(registry.facts ?? {});

const uiFiles = execSync("git ls-files 'app/**/*.tsx' 'app/*.tsx' 'src/components/**/*.tsx'", { encoding: 'utf8' })
  .split('\n').filter(Boolean).filter((f) => !f.includes('__tests__'))
  .map((f) => ({ f, s: readFileSync(f, 'utf8') }));

const failures = [];
for (const [name, spec] of facts) {
  const deriverFile = spec.deriver.split('#')[0];
  if (!existsSync(deriverFile)) {
    failures.push(`fact '${name}': deriver file ${deriverFile} does not exist`);
    continue;
  }
  for (const pattern of spec.bannedPatterns ?? []) {
    const re = new RegExp(pattern);
    for (const { f, s } of uiFiles) {
      if (f === deriverFile) continue;
      if (re.test(s)) failures.push(`fact '${name}': ${f} re-derives it (pattern /${pattern}/) — call ${spec.deriver} instead`);
    }
  }
}

if (failures.length) {
  console.error(`FACT VIOLATIONS (${failures.length}):\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log(`facts: ok (${facts.length} registered)`);
