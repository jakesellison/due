/**
 * Header consistency — enforced, not remembered.
 *
 * Due has exactly two header primitives:
 *   SheetHeader  page and sheet headers: a solid row, action then title
 *   OverlayNav   immersive headers: circular overlay controls on full-bleed
 *                content, no title in the row
 * plus SheetGrabberHeader, the titleless grabber variant for resizable sheets.
 *
 * Every one of those was hand-rolled somewhere at some point, and the copies
 * drifted in ways nobody could see until screens were compared side by side:
 * four different vertical offsets, two different back glyphs at two different
 * sizes, centered titles in two screens and leading titles everywhere else,
 * and a `Math.max(42, insets.top + 4)` that existed in exactly one file.
 *
 * A code review will not catch the next one. These tests will.
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

// Both the `**` and the bare `*` forms: git's `**` requires a directory
// segment, so 'app/**/*.tsx' alone silently skips top-level screens like
// app/dash.tsx — a hole the uiConsistency scanner found and pinned.
const SCREENS = execSync(
  "git ls-files 'app/*.tsx' 'app/**/*.tsx' 'src/components/*.tsx' 'src/components/**/*.tsx' | sort -u | grep -v __tests__",
  { encoding: 'utf8' },
).trim().split('\n');

/** The primitives themselves, plus the buttons they are built from. */
const PRIMITIVES = [
  'src/components/SheetHeader.tsx',
  'src/components/OverlayNav.tsx',
  'src/components/SheetGrabberHeader.tsx',
  'src/components/CloseButton.tsx',
  'src/components/RoundIconButton.tsx',
];

const read = (f: string) => readFileSync(f, 'utf8');
const isPrimitive = (f: string) => PRIMITIVES.includes(f);
const isLab = (f: string) => f.startsWith('app/lab/');

test('a back or close affordance only appears inside a header primitive', () => {
  const offenders: string[] = [];
  for (const f of SCREENS) {
    if (isPrimitive(f) || isLab(f)) continue;
    const src = read(f);
    // A dismiss affordance: the back chevron, or the shared close button.
    const hasAffordance = /icon="chevron\.left"|<CloseButton\b/.test(src);
    if (!hasAffordance) continue;
    const usesPrimitive = /<SheetHeader\b|<OverlayNav\b|<SheetGrabberHeader\b/.test(src);
    if (!usesPrimitive) offenders.push(f);
  }
  expect(offenders).toEqual([]);
});

test('no screen invents its own header top offset', () => {
  // The inset belongs to the primitives: SheetHeader's `topInset` prop and
  // OverlayNav's OVERLAY_NAV_TOP. A screen computing its own is how the
  // offsets drifted 10-20pt apart in the first place.
  const offenders: string[] = [];
  for (const f of SCREENS) {
    if (isPrimitive(f) || isLab(f)) continue;
    const src = read(f);
    for (const line of src.split('\n')) {
      // A top-inset formula applied to padding/position, i.e. clearing the notch.
      if (/(paddingTop|top):\s*[^,\n]*(insets\.top|topInset)\s*\+/.test(line)) {
        offenders.push(`${f} :: ${line.trim().slice(0, 80)}`);
      }
    }
  }
  expect(offenders).toEqual([]);
});

test('no screen renders a text back button — the glyph is the affordance', () => {
  const offenders: string[] = [];
  for (const f of SCREENS) {
    if (isPrimitive(f) || isLab(f)) continue;
    const src = read(f);
    // Visible "Back" as element content, as opposed to an accessibilityLabel.
    if (/>\s*Back\s*</.test(src)) offenders.push(f);
  }
  expect(offenders).toEqual([]);
});

test('the two header families share one vertical rule', () => {
  // If these ever diverge the app gets two "correct" offsets again, which is
  // precisely the state this suite exists to prevent.
  const sheet = read('src/components/SheetHeader.tsx');
  const overlay = read('src/components/OverlayNav.tsx');
  expect(sheet).toMatch(/paddingTop: topInset \+ space\.sm/);
  expect(overlay).toMatch(/OVERLAY_NAV_TOP = space\.sm/);
  expect(sheet).toMatch(/paddingTop: space\.sm/);
});

test('a chevron used as BACK never appears outside a header primitive or overlay row', () => {
  // The hole the "< Plans" button exposed: the affordance test above is
  // per-FILE, so a screen that uses SheetHeader somewhere could still
  // hand-roll a second, labelled back beside it (PlanLibraryList did — a
  // 12pt chevron + the parent's name, a third grammar no other screen used).
  // Per-OCCURRENCE instead: any `chevron.left` whose surrounding 260 chars
  // mention "Back" must sit in the overlay family — an <OverlayNav> wrapper
  // or an overlay-variant control — because every page-family back renders
  // through SheetHeader, whose internals are excluded. "Previous day"
  // steppers and other non-back chevrons pass untouched.
  const offenders: string[] = [];
  for (const f of SCREENS) {
    if (isPrimitive(f) || isLab(f)) continue;
    const src = read(f);
    for (const m of src.matchAll(/chevron\.left/g)) {
      const at = m.index ?? 0;
      const window = src.slice(Math.max(0, at - 260), at + 260);
      const inOverlay = window.includes('<OverlayNav') || window.includes('variant="overlay"');
      if (/[Bb]ack/.test(window) && !inOverlay) {
        offenders.push(`${f} @${at}`);
      }
    }
  }
  expect(offenders).toEqual([]);
});

test("a modal-presented screen's SheetHeader uses the sheet variant", () => {
  // A native modal has no status bar above it, so the page rule (space.sm
  // below the safe area) parks the close button 8pt from the sheet's rounded
  // edge — four screens were flagged by eye in one review. The presentation
  // is declared in app/_layout.tsx, so the rule is checkable: every modal
  // route whose screen renders a SheetHeader must pass variant="sheet".
  const layout = read('app/_layout.tsx');
  const modals: string[] = [];
  for (const m of layout.matchAll(/name="([^"]+)"[^>]*presentation: '(?:modal|pageSheet)'/g)) {
    modals.push(`app/${m[1]}.tsx`);
  }
  expect(modals.length).toBeGreaterThan(2); // the sweep itself must not go vacuous
  const offenders: string[] = [];
  for (const f of modals) {
    let src = '';
    try { src = read(f); } catch { continue; }
    if (/<SheetHeader\b/.test(src) && !/variant="sheet"/.test(src)) offenders.push(f);
  }
  expect(offenders).toEqual([]);
});

test('every sheet primitive derives its close clearance from SHEET_CLOSE_TOP', () => {
  // The Add-shoe X sat 8pt higher than the Plans X because SheetHeader and
  // SheetGrabberHeader each computed their own top. One constant now; this
  // pins that neither drifts back to private arithmetic.
  const sheet = read('src/components/SheetHeader.tsx');
  const grabber = read('src/components/SheetGrabberHeader.tsx');
  expect(sheet).toMatch(/paddingTop: SHEET_CLOSE_TOP/);
  expect(grabber).toMatch(/top: SHEET_CLOSE_TOP - space\.xs/);
  expect(grabber).not.toMatch(/top: space\.\w+,/); // no private slot offset
});
