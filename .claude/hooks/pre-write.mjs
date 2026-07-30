#!/usr/bin/env node
/**
 * PreToolUse gate for Edit/Write — the at-the-moment-of-action half of the
 * layer law, plus ledger protection. Exit 2 blocks the write; stderr tells the
 * agent why and what to do instead. checks/layers.mjs remains the whole-repo net.
 */
import { readFileSync } from 'node:fs';

const input = JSON.parse(readFileSync(0, 'utf8'));
const { tool_input: t = {} } = input;
const file = t.file_path ?? '';
const content = `${t.content ?? ''}\n${t.new_string ?? ''}`;

const deny = (msg) => { console.error(msg); process.exit(2); };

// Repo-relative view of the path.
const rel = file.replace(/^.*\/Projects\/due\//, '');

// 1. Layer law at write time.
const LAYER_BANS = [
  { layer: 'src/lib/', bans: [/from\s+['"]react-native/, /from\s+['"]expo/, /from\s+['"]@\/app-lib/, /from\s+['"]@\/components/], law: 'src/lib is pure: no react-native, expo, @/app-lib, @/components' },
  { layer: 'src/app-lib/', bans: [/from\s+['"]@\/components/], law: 'src/app-lib may not import @/components' },
];
for (const { layer, bans, law } of LAYER_BANS) {
  if (rel.startsWith(layer) && bans.some((b) => b.test(content))) {
    deny(`LAYER LAW: ${law} (CLAUDE.md "Layer law"). Move the code to the right layer instead of importing across.`);
  }
}

// 2. Baselines stay empty by hand-edit only with justification in the same
//    change; agents may not grow them silently.
if (rel === 'checks/orphans.baseline.json' && (t.new_string ?? t.content ?? '').includes('#')) {
  deny('BASELINE GATE: adding an orphan exception requires a MISSING.md ledger line in the same change and a stated same-phase consumer. Do that first, then retry with the ledger line written.');
}

// 3. MISSING.md is append-mostly: an Edit that deletes a ledger bullet without
//    replacing it is how drops go silent.
if (rel === 'MISSING.md' && t.old_string && /^- /m.test(t.old_string) && !/^- /m.test(t.new_string ?? '')) {
  deny('LEDGER GATE: MISSING.md entries are resolved by moving them (e.g. to a "resurrected" note), never deleted. Rewrite the entry instead of removing it.');
}

process.exit(0);
