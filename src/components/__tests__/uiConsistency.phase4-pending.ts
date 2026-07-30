/**
 * UI consistency — a RATCHET, not a ban.
 *
 * Due's design system now has primitives for the five shapes the app had been
 * re-deriving by hand: `Eyebrow` (70 copies), `Stat` (187), `Divider` (172),
 * `Chip` (46 pill containers), and `cardSurface` (67 card fills). None of those
 * copies can be migrated in one pass without touching most of the app, and a
 * hard `expect(offenders).toEqual([])` would therefore have to be deleted
 * rather than satisfied — which is how a lint rule dies.
 *
 * So this compares per-file counts against a checked-in baseline
 * (`uiConsistency.baseline.json`) and only fails when a count GOES UP. Existing
 * hand-rolling is grandfathered; new hand-rolling is not. Migrating a file
 * lowers its real count below the baseline and the test stays green — the
 * ratchet is then tightened by regenerating:
 *
 *     node scripts/regen-ui-baseline.mjs
 *
 * The patterns and the scanner live in `uiPatterns.js`, which that script
 * imports too, so the measurement and the baseline can never describe different
 * things.
 *
 * Excluded: `__tests__` (describes the app rather than being it), `app/lab`
 * (where a shape is tried before it earns a primitive), and
 * `src/components/ui/` (where these declarations are SUPPOSED to live).
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const patterns = require('./uiPatterns.js');

const { PATTERNS, scan, readBaseline, totals, scannedFiles } = patterns as {
  PATTERNS: { key: string; source: string; hint: string }[];
  scan: () => Record<string, Record<string, number>>;
  readBaseline: () => Record<string, Record<string, number>>;
  totals: (scanned: Record<string, Record<string, number>>) => Record<string, number>;
  scannedFiles: () => string[];
};

const scanned = scan();
const baseline = readBaseline();
const hintFor = (key: string) => PATTERNS.find((p) => p.key === key)?.hint ?? key;

test('no file hand-rolls a primitive more times than its baseline allows', () => {
  const regressions: string[] = [];
  for (const [file, counts] of Object.entries(scanned)) {
    for (const [key, actual] of Object.entries(counts)) {
      const allowed = baseline[file]?.[key] ?? 0;
      if (actual > allowed) {
        regressions.push(
          `${file}\n    ${key}: ${actual} (baseline ${allowed})\n    → ${hintFor(key)}`,
        );
      }
    }
  }
  // A single readable block: the failure has to tell the author which
  // primitive to reach for, or they will just raise the baseline.
  expect(regressions.join('\n\n')).toBe('');
});

test('the baseline only describes files that still exist and are scanned', () => {
  // A stale entry is a hole: the file it pinned could be re-added carrying any
  // number of hand-rolled shapes and this suite would call it grandfathered.
  const live = new Set(scannedFiles());
  const stale = Object.keys(baseline).filter((file) => !live.has(file));
  expect(stale).toEqual([]);
});

test('every baseline pattern key is one this suite still measures', () => {
  // Renaming a pattern without regenerating would silently retire the ratchet
  // for it — the counts would move to a new key with a zero baseline, or the
  // old key would linger unenforced.
  const known = new Set(PATTERNS.map((p) => p.key));
  const unknown = new Set<string>();
  for (const counts of Object.values(baseline)) {
    for (const key of Object.keys(counts)) if (!known.has(key)) unknown.add(key);
  }
  expect([...unknown]).toEqual([]);
});

test('the primitives are excluded from their own ratchet', () => {
  // If `src/components/ui/` were ever scanned, the primitives would count as
  // offenders for containing the exact declarations they exist to own — and
  // the first fix would be to weaken the pattern.
  const files = scannedFiles();
  expect(files.filter((f) => f.startsWith('src/components/ui/'))).toEqual([]);
  expect(files.filter((f) => f.includes('__tests__/'))).toEqual([]);
  expect(files.filter((f) => f.startsWith('app/lab/'))).toEqual([]);
});

test('the ratchet is actually watching the app, not an empty file list', () => {
  // A pathspec typo (git's `**` needs a directory segment, so `app/**/*.tsx`
  // alone drops `app/dash.tsx`) would turn every assertion above into a
  // vacuous pass. Pin the shape of the scan instead of trusting it.
  //
  // The floor is an anti-vacuity tripwire, not a size target: a dead-code sweep
  // legitimately shrinks the tree, so it sits below the current count rather
  // than at it. The named-file assertions below are what actually catch a
  // pathspec that silently stops matching a whole directory.
  const files = scannedFiles();
  expect(files.length).toBeGreaterThan(80);
  expect(files).toContain('app/dash.tsx');
  expect(files).toContain('app/(tabs)/index.tsx');
  expect(files).toContain('src/components/Card.tsx');

  const sums = totals(scanned);
  for (const pattern of PATTERNS) expect(sums[pattern.key]).toBeGreaterThan(0);
});
