/**
 * uiPatterns — ONE definition of "what counts as hand-rolling a primitive",
 * shared by the ratchet test (`uiConsistency.test.ts`) and the baseline
 * regenerator (`scripts/regen-ui-baseline.mjs`).
 *
 * It lives in one file for the obvious reason: a test and a generator that each
 * carried their own copy of these regexes would drift the first time one of
 * them was tightened, and the baseline would silently stop describing what the
 * test measures.
 *
 * Plain CommonJS on purpose — the test runs under jest-expo (babel, CJS) and
 * the script runs as a Node ESM `.mjs`. CJS is the one module format both can
 * load without a transform.
 */
const { execSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const path = require('node:path');

/** Repo root — this file sits at src/components/__tests__/. */
const ROOT = path.resolve(__dirname, '..', '..', '..');

const BASELINE_PATH = path.join(ROOT, 'src/components/__tests__/uiConsistency.baseline.json');

/**
 * The patterns. Each is a shape that now has a primitive, so a NEW occurrence
 * is a regression — an author re-deriving something the design system already
 * decided. `hint` is what the failure prints; it has to name the replacement,
 * because "you added an uppercase style" is not actionable and "use
 * <Eyebrow>/eyebrowText(C)" is.
 *
 * `source` is stored as a string rather than a RegExp so every consumer builds
 * its own `/g` instance — a shared global regex carries `lastIndex` between
 * files and silently under-counts.
 */
const PATTERNS = [
  {
    key: 'uppercase',
    source: "textTransform:\\s*'uppercase'",
    hint: "hand-rolled eyebrow — use <Eyebrow> or spread eyebrowText(C, size) from '@/components/ui/Eyebrow'",
  },
  {
    key: 'tabularNums',
    source: "fontVariant:\\s*\\['tabular-nums'\\]",
    hint: "hand-rolled stat numeral — use <Stat> or spread statValueText(C, size) from '@/components/ui/Stat'",
  },
  {
    key: 'hairline',
    // Every side, not only top/bottom: the vertical column rule between two
    // gauge goals is the same decision drawn sideways.
    source: 'border(?:Top|Bottom|Left|Right)?Width:\\s*StyleSheet\\.hairlineWidth',
    hint: "hand-rolled hairline — spread hairlineTop(C)/hairlineBottom(C), or render <Divider>, from '@/components/ui/Divider'",
  },
  {
    key: 'eyebrowOverride',
    // The convergence loophole: `textTransform` comes from the factory, so a
    // weight or tracking re-declared AFTER an eyebrowText spread escapes the
    // `uppercase` pattern entirely. The app converged to 700/0.5 deliberately
    // (the only exceptions are the run-detail hero lockup's wide 1.0s and the
    // scorecard badge's 1.2, all baselined here); a NEW override is the old
    // drift sneaking back in through the side door.
    source: "\\.\\.\\.eyebrowText\\([^)]*\\)[^{}]*?(?:fontWeight|letterSpacing):",
    hint: "eyebrow weight/tracking override — the system is 700/0.5; if this render truly needs a wide hero tracking, document it like SessionView's heroEy",
  },
  {
    key: 'pillRadius',
    // Counts dots and progress tracks too, which are legitimate. The baseline
    // absorbs those; what this catches is the count GOING UP.
    source: 'borderRadius:\\s*radius\\.pill',
    hint: "hand-rolled pill — if it carries a label it is a <Chip> from '@/components/ui/Chip'",
  },
  {
    key: 'cardFill',
    source: 'backgroundColor:\\s*C\\.card',
    hint: "hand-rolled card surface — spread cardSurface(C) from '@/components/Card', or use a control fill (C.fill/C.panel) if it is not a card",
  },
];

/**
 * The files under the ratchet: every production screen and component.
 *
 * `app/*.tsx` is listed separately from `app/**\/*.tsx` because git's pathspec
 * `**` requires at least one directory segment, so the second pattern alone
 * silently skips `app/dash.tsx`, `app/realign.tsx`, and `app/week-calendar.tsx`.
 */
function scannedFiles() {
  const listed = execSync(
    "git ls-files 'app/*.tsx' 'app/**/*.tsx' 'src/components/*.tsx' 'src/components/**/*.tsx'",
    { encoding: 'utf8', cwd: ROOT },
  )
    .trim()
    .split('\n')
    .filter(Boolean);
  return [...new Set(listed)].filter(isScanned).sort();
}

function isScanned(file) {
  // Tests describe the app rather than being it; `app/lab` is the scratch
  // space where a shape is TRIED before it earns a primitive; and the
  // primitives themselves are where these declarations are supposed to live.
  if (file.includes('__tests__/')) return false;
  if (file.startsWith('app/lab/')) return false;
  if (file.startsWith('src/components/ui/')) return false;
  return true;
}

/** Counts every pattern in one file's source. Returns only non-zero keys. */
function countSource(source) {
  const counts = {};
  for (const pattern of PATTERNS) {
    const matches = source.match(new RegExp(pattern.source, 'g'));
    if (matches && matches.length > 0) counts[pattern.key] = matches.length;
  }
  return counts;
}

/** Scans the whole repo. Returns `{ "<file>": { "<pattern>": count } }`, files
 *  with no hand-rolling omitted so the baseline stays readable. */
function scan() {
  const result = {};
  for (const file of scannedFiles()) {
    const counts = countSource(readFileSync(path.join(ROOT, file), 'utf8'));
    if (Object.keys(counts).length > 0) result[file] = counts;
  }
  return result;
}

function readBaseline() {
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
}

/** Per-pattern totals, for the report line the regenerator prints. */
function totals(scanned) {
  const sums = Object.fromEntries(PATTERNS.map((p) => [p.key, 0]));
  for (const counts of Object.values(scanned)) {
    for (const [key, n] of Object.entries(counts)) sums[key] += n;
  }
  return sums;
}

module.exports = { ROOT, BASELINE_PATH, PATTERNS, scan, scannedFiles, countSource, readBaseline, totals };
