#!/usr/bin/env node
/**
 * regen-ui-baseline — rewrite `src/components/__tests__/uiConsistency.baseline.json`
 * from the current tree.
 *
 *     node scripts/regen-ui-baseline.mjs
 *
 * Run it after MIGRATING call sites onto the primitives, so the ratchet drops
 * to the new floor and the removed hand-rolling can never come back. It shares
 * its pattern definitions with the test (`src/components/__tests__/uiPatterns.js`),
 * so the two cannot disagree about what is being counted.
 *
 * `--check` regenerates in memory and exits non-zero if the checked-in baseline
 * is stale in the LOOSE direction (a file whose real count is now below its
 * baseline), which is a reminder to lower the ratchet — not a failure of the
 * test itself, which stays green while counts fall.
 */
import { writeFileSync } from 'node:fs';

import patterns from '../src/components/__tests__/uiPatterns.js';

const { BASELINE_PATH, PATTERNS, scan, readBaseline, totals } = patterns;

const scanned = scan();
const check = process.argv.includes('--check');

if (check) {
  const baseline = readBaseline();
  const slack = [];
  for (const [file, counts] of Object.entries(baseline)) {
    for (const [key, allowed] of Object.entries(counts)) {
      const actual = scanned[file]?.[key] ?? 0;
      if (actual < allowed) slack.push(`${file} :: ${key} ${allowed} -> ${actual}`);
    }
  }
  if (slack.length > 0) {
    console.error(`Baseline is above the tree by ${slack.length} entr${slack.length === 1 ? 'y' : 'ies'}:`);
    for (const line of slack) console.error(`  ${line}`);
    console.error('\nRun `node scripts/regen-ui-baseline.mjs` to lower the ratchet.');
    process.exit(1);
  }
  console.log('Baseline matches the tree — nothing to lower.');
  process.exit(0);
}

// Sorted keys so a regenerated baseline diffs as the counts that changed, not
// as a whole-file reshuffle.
const ordered = Object.fromEntries(
  Object.keys(scanned)
    .sort()
    .map((file) => [
      file,
      Object.fromEntries(
        PATTERNS.map((p) => p.key)
          .filter((key) => scanned[file][key])
          .map((key) => [key, scanned[file][key]]),
      ),
    ]),
);

writeFileSync(BASELINE_PATH, `${JSON.stringify(ordered, null, 2)}\n`);

const sums = totals(scanned);
console.log(`Wrote ${BASELINE_PATH}`);
console.log(`${Object.keys(ordered).length} files carrying hand-rolled primitives:`);
for (const pattern of PATTERNS) console.log(`  ${pattern.key.padEnd(12)} ${sums[pattern.key]}`);
