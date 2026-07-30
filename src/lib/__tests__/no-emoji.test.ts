/**
 * Guardrail: NO emoji / pictographs anywhere in the app or component source.
 * Per the design system, status and iconography are carried by SF Symbols
 * (expo-symbols) or plain text — never emoji. Typographic glyphs (✓ › – × → ↑ ↓
 * · °) are ALLOWED and explicitly whitelisted below.
 *
 * This walks `app/` + `src/` (TS/TSX) and fails if any pictographic codepoint in
 * the emoji ranges survives. It mirrors the manual grep in the task spec:
 *   grep -rnP "[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}\x{FE0F}]" app src
 * but tolerates the small set of allowed typographic marks that happen to live
 * inside the U+2600-U+27BF block (e.g. the checkmark U+2713).
 */
import {
  readdirSync,
  readFileSync,
  statSync,
} from 'fs';
import {
  join,
} from 'path';

// Repo root is two levels up from src/lib/__tests__.
const ROOT = join(__dirname, '..', '..', '..');
const SCAN_DIRS = ['app', 'src'];

// Emoji / pictograph ranges (the task's grep set).
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;

// Typographic glyphs that fall in the scanned ranges but are explicitly allowed.
const ALLOWED = new Set(['✓', '✗', '✔', '✘']); // ✓ ✗ ✔ ✘

// Files that legitimately hold emoji because they build EXTERNAL text — the
// Strava run-description block, which is posted to Strava and rendered by
// Strava (where white/purple/blue emoji are the medium). This is NOT app UI, so
// the SF-Symbols rule doesn't apply. Scoped to exact files so the guardrail
// still covers every screen + component.
const EXCLUDED = new Set(['src/lib/strava/description.ts', 'src/lib/strava/description.test.ts']);

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue;
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
}

function emojiHits(text: string): string[] {
  const hits: string[] = [];
  for (const ch of text) {
    if (EMOJI.test(ch) && !ALLOWED.has(ch)) hits.push(ch);
  }
  return hits;
}

test('no emoji / pictographs remain in app + src source', () => {
  const files: string[] = [];
  for (const d of SCAN_DIRS) walk(join(ROOT, d), files);
  expect(files.length).toBeGreaterThan(0);

  const offenders: { file: string; line: number; chars: string }[] = [];
  for (const file of files) {
    if (EXCLUDED.has(file.slice(ROOT.length + 1))) continue;
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      const hits = emojiHits(line);
      if (hits.length > 0) {
        offenders.push({ file: file.slice(ROOT.length + 1), line: i + 1, chars: hits.join('') });
      }
    });
  }

  expect(offenders).toEqual([]);
});
