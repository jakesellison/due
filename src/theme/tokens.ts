/**
 * tokens.ts — the app's design tokens (dark + light, both first-class).
 *
 * Pure: NO React Native imports, so screens, pure logic, and node tests can all
 * import it. Source of truth for the Due brand system (yellow-on-ink): surfaces
 * are neutral near-black charcoal (NO colour cast), yellow marks what is
 * due/done/primary. Weekly mileage uses that primary yellow; supporting quality
 * and long goals use violet / cyan. Light is a true peer of dark, not a tint.
 */
export type ThemeName = 'dark' | 'light';

export interface Tokens {
  bg: string; card: string; panel: string; slate: string; tabbar: string; fill: string; line: string;
  /** A surface that reads as RECESSED below the card — a clear step in the
   *  recess direction (darker in both themes), distinct from `bg`. The Dash
   *  calendar de-dent (selected tab + day panel) sits on this. */
  recess: string;
  ink: string; mute: string; faint: string;
  yellow: string; accentInk: string; cyan: string; pink: string; elev: string; easy: string;
  /** A neutral blue quantitative ramp for pace charts and route heat. Unlike
   *  `cyan` (long-run type), these endpoints carry magnitude only. */
  paceSlow: string; paceFast: string;
  /** Text/icon-safe semantic accents. The vivid primitives above remain useful
   *  for fills and washes; these variants meet WCAG AA for small text on every
   *  standard app surface in their theme. */
  yellowText: string; cyanText: string; qualText: string; easyText: string; positiveText: string; warningText: string; dangerText: string;
  /** Heart-rate red — a true red, distinct from the magenta-pink `z5`/`pink`
   *  danger primitive and the violet quality accent. */
  red: string;
  /** Quality workout-TYPE accent — a vivid violet, decoupled from the danger pink
   *  (`z5`/`pink`) so "quality" reads as earned effort, not an alert, and from the
   *  cyan `cyan` (long) so the trio stays legible. Reads as a clean ACCENT on the
   *  neutral ink surfaces (the old objection was purple SURFACES, not the accent).
   *  Used by the tone→colour mapping (stripToneColor) + the week gauges. */
  qual: string;
  /** Brand ground — the near-black ink tile behind the app mark (icon/splash/hero
   *  chrome), with `brandInk` the yellow mark that sits on it. A DARK ground in
   *  both themes on purpose: it reads as a deliberate brand surface. */
  brand: string; brandInk: string; brandText: string; brandMute: string;
  /** Non-semantic plan-identity art palette. These colours belong only to
   *  generated plan covers; they never encode contract state or workout type. */
  planWarm: string; planViolet: string; planBlue: string; planGreen: string; planRose: string;
  z1: string; z2: string; z3: string; z4: string; z5: string;
}

export const THEMES: Record<ThemeName, Tokens> = {
  dark: {
    // Yellow on ink: surfaces are NEUTRAL near-black charcoal — NO colour cast
    // (a violet undertone reads as "purple" on raised surfaces, so it's stripped).
    // Yellow stays rationed to primary progress, including the weekly mileage
    // contract. Supporting goals: quality = violet, long = cyan.
    bg: '#0F0F12', card: '#17171B', panel: '#1F1F24', slate: '#2A2A30', tabbar: '#0C0C0F',
    recess: '#0A0A0D',
    fill: 'rgba(255,255,255,0.05)', line: 'rgba(255,255,255,0.08)',
    // `faint` is still the tertiary text tier, but it must remain readable when
    // it carries labels/placeholders. Lines/fills own truly decorative chrome.
    ink: '#F2F1F7', mute: '#A6A5AD', faint: '#909099',
    yellow: '#FFC93C', accentInk: '#171122', cyan: '#22D3EE', pink: '#FF5C7A', elev: '#869A93', easy: '#8FA7C5',
    paceSlow: '#48617B', paceFast: '#B8D1E8',
    red: '#FF4B3E', qual: '#A855F7',
    yellowText: '#FFC93C', cyanText: '#22D3EE', qualText: '#B86FFA', easyText: '#8FA7C5', positiveText: '#4FB477', warningText: '#F0883E', dangerText: '#FF6B60',
    brand: '#12101F', brandInk: '#FFC93C', brandText: '#F2F1F7', brandMute: '#E2DEE8',
    planWarm: '#C96B52', planViolet: '#6F3CA8', planBlue: '#315E8A', planGreen: '#2F8F73', planRose: '#B84F78',
    z1: '#3B82C4', z2: '#4FB477', z3: '#FFC93C', z4: '#F0883E', z5: '#FF5C7A',
  },
  light: {
    // A cool grouped canvas keeps white content surfaces legible without
    // needing shadows or heavy outlines. Card remains true white so section
    // hierarchy comes from the surface relationship, not decoration.
    bg: '#F3F3F5', card: '#FFFFFF', panel: '#EFEFF1', slate: '#E0E0E4', tabbar: '#F1F1F3',
    recess: '#EEEEF0',
    fill: 'rgba(18,18,22,0.06)', line: 'rgba(18,18,22,0.11)',
    ink: '#191920', mute: '#565660', faint: '#62626B',
    yellow: '#F0B41E', accentInk: '#171122', cyan: '#22D3EE', pink: '#D62F54', elev: '#5E726A', easy: '#8FA7C5',
    paceSlow: '#B9C8D8', paceFast: '#365A78',
    red: '#D92D20', qual: '#9333EA',
    yellowText: '#7A5700', cyanText: '#2565A5', qualText: '#8626D8', easyText: '#4B6484', positiveText: '#196F3D', warningText: '#974200', dangerText: '#A6261A',
    brand: '#12101F', brandInk: '#FFC93C', brandText: '#F2F1F7', brandMute: '#E2DEE8',
    planWarm: '#C96B52', planViolet: '#6F3CA8', planBlue: '#315E8A', planGreen: '#2F8F73', planRose: '#B84F78',
    z1: '#2C6FB3', z2: '#2E9E5E', z3: '#F0B41E', z4: '#D9690F', z5: '#D62F54',
  },
};

/**
 * Spacing — a 2pt scale, theme-independent. The double-letter steps are the
 * canonical 4pt rhythm (screen padding, card padding, section gaps); the
 * single-letter steps are the half-rung BELOW their pair (s=6 under sm=8,
 * m=10 under md=12, l=14 under lg=16) for deliberate tightening. Prefer a token
 * over a raw number for any layout gap/padding/margin so the rhythm stays
 * intentional; sub-grid nudges of 1–2px may stay literal (3 is `nudge`).
 */
export const space = {
  xxs: 2,
  /** The optical micro-nudge between xxs and xs — the audit found 12+
   *  hand-written 3s doing exactly this job. */
  nudge: 3,
  xs: 4,
  s: 6,
  sm: 8,
  m: 10,
  md: 12,
  l: 14,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

/** Corner radii — theme-independent. `xs` for chips/bars, up to `pill` for fully round. */
export const radius = { xs: 4, sm: 8, md: 12, lg: 16, pill: 999 } as const;

/** Native/custom sheet geometry. Height is semantic: compact for a short
 *  decision or editor, detail for a scrollable object/instrument. Full-screen
 *  creation flows remain a separate presentation rather than another detent. */
export const sheetPresentation = {
  compact: 0.64,
  detail: 0.94,
  cornerRadius: 22,
} as const;

/**
 * SCRIM — the dim behind a top-level overlay (sheet backdrop, centered
 * acknowledgement card, full-screen picker). Theme-independent: the page goes
 * back behind black in both themes, so this is a module constant rather than a
 * per-theme token.
 *
 * This existed as five different hand-written values across six surfaces
 * (0.72, 0.72, 0.62, 0.62, 0.5, 0.45) — each defensible alone, collectively a
 * drift. One value now, because "how far back does the page go" is a single
 * product decision, not a per-screen one.
 *
 * NAMED EXCEPTION: `WorkoutBuilder`'s pace-step scrim stays lighter. It is a
 * NESTED scrim inside an already-scrimmed modal, and stacking two of these
 * would compound to near-black.
 */
export const SCRIM = 'rgba(0,0,0,0.62)';

/**
 * A token colour at partial opacity — `alpha(C.red, 0.07)` for a wash, a tint,
 * or a hairline derived from a semantic colour.
 *
 * Lives here rather than in a component because the alternative is what the
 * codebase actually had: this function private to `DueGlyphTile`, and every
 * other wash hand-written as an `rgba()` literal whose relationship to its
 * token was invisible (`rgba(255,59,48,0.07)` is a tint of a red that is not
 * in the palette at all). A wash should track its token through a theme change.
 *
 * Returns `hex` unchanged if it is not a 6-digit hex — `rgba()` strings and
 * named colours pass through rather than producing garbage.
 */
export function alpha(hex: string, opacity: number): string {
  const value = hex.replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(value)) return hex;
  const number = Number.parseInt(value, 16);
  return `rgba(${(number >> 16) & 255}, ${(number >> 8) & 255}, ${number & 255}, ${opacity})`;
}

/**
 * The DISPLAY face — the brand voice (Space Grotesk) reserved for hero numerals
 * and screen titles: gauge centres, race verdicts, the big MILES figure, screen
 * headers. Everything else (labels, body, structure) stays on the system UI face
 * (SF Pro). Two voices, one system. The 700 weight is the only one loaded, so
 * `display` styles should NOT also set fontWeight (it would be ignored/odd).
 */
export const display = 'SpaceGrotesk_700Bold';
/** Contract numerals and terse deltas — the data voice, never paragraph copy. */
export const data = 'SpaceMono_700Bold';
/** Supporting tabular data where bold would create a false primary metric. */
export const dataRegular = 'SpaceMono_400Regular';

/**
 * The type SIZE scale — every font size in the app resolves to one of these.
 *
 * Why this exists separately from `typeRole` below: `typeRole` models a
 * document (page title → sheet title → section title → body → metadata), but
 * Due is a dense data instrument. An audit found 767 numeric `fontSize`
 * declarations across 38 distinct values, of which 650 (85%) sat between 9 and
 * 14.5 — a band where `typeRole` had exactly ONE entry (`metadata`). 223 of
 * them used half-point sizes across nine phantom values (7.5, 8.5, 9.5, 10.5,
 * 11.5, 12.5, 13.5, 14.5, 15.5). That is not a scale; it is per-screen optical
 * tuning that no two screens agreed on.
 *
 * The steps below were chosen to MINIMISE displacement from what the app
 * already rendered: each phantom size folds onto the nearest step, so almost
 * every element moved by 0.5pt or less. The exception is the sub-10 tier
 * (7.5-9.5, 52 declarations) which folds up to `micro` — text that small was a
 * legibility problem, not a design decision.
 *
 * Use these for `fontSize`. Use `typeRole` when you want a size AND its
 * matching line height as one decision.
 */
export const fontSizes = {
  /** Smallest legible tier — axis ticks, dense table sub-labels. */
  micro: 10,
  /** Eyebrows, chip labels, captions. */
  labelSm: 11,
  /** The default metadata tier — the app's single most common size. */
  metadata: 12,
  /** Emphasised labels and compact row titles. */
  label: 13,
  /** The largest label tier, just under body. */
  labelLg: 14,
  /** Running text and standard control labels. */
  body: 15,
  sectionTitle: 18,
  /** Titles between sectionTitle and sheetTitle — card/screen-section
   *  headlines, empty-state titles, route names. The 2026-08-01 audit found
   *  ~10 screens improvising 19/20/21 for this register. */
  cardTitle: 20,
  sheetTitle: 22,
  pageTitle: 29,
  /** The DISPLAY NUMERAL register — stat values, gauges, hero figures — which
   *  the document-shaped tiers above never named. `numeralSm` matching
   *  `cardTitle` is deliberate: different intent, same size. Hero one-offs
   *  above `numeralXl` stay bespoke. */
  numeralSm: 20,
  numeralMd: 24,
  numeralLg: 34,
  numeralXl: 40,
} as const;

/** Reused type roles. Page and sheet titles intentionally remain different
 *  presentation levels; screens should choose a role instead of inventing a
 *  near-duplicate size. Sizes come from `fontSizes` so a role and a bare
 *  `fontSize` can never drift apart. */
export const typeRole = {
  // The FACE is part of the role, not something each call site remembers.
  // An audit of every named style found the app already 100% consistent —
  // pageTitle and sheetTitle on `display`, sectionTitle/body/metadata on the
  // system face — but that consistency was maintained by hand across a dozen
  // sites, so a single forgotten `fontFamily` would have silently broken it
  // (exactly what had happened in AppErrorBoundary). Now it cannot.
  //
  // Titles carrying `display` deliberately set NO fontWeight: only the 700
  // weight of Space Grotesk is loaded, so a weight here is either ignored or
  // synthesised into a fake bold.
  pageTitle: { fontFamily: display, fontSize: fontSizes.pageTitle, lineHeight: 34, letterSpacing: -0.5 },
  sheetTitle: { fontFamily: display, fontSize: fontSizes.sheetTitle, lineHeight: 28, letterSpacing: -0.4 },
  // Section headers stay on the system face on purpose: they are structure
  // inside a page, not the page's own voice.
  sectionTitle: { fontSize: fontSizes.sectionTitle, lineHeight: 23, letterSpacing: -0.2 },
  body: { fontSize: fontSizes.body, lineHeight: 21 },
  metadata: { fontSize: fontSizes.metadata, lineHeight: 16 },
} as const;

/**
 * The ACTION voice — the legend on a solid primary button (`ActionButton`).
 *
 * Buttons in Due carry no depth: no lip, no shadow, no gradient. DESIGN.md
 * already said so ("matte fill plus a hairline is enough — do not stack a strong
 * border, tint, and shadow to manufacture hierarchy"), and the old raised lip was
 * the one thing in the app breaking it.
 *
 * What replaces it is typographic. Every OTHER solid yellow in the app is a
 * MEASUREMENT — a gauge arc, a contract bar, a blueprint vessel, the tab pill —
 * and none of them carries words. A field of accent with tracked-uppercase
 * `accentInk` type on it is a control legend and can be nothing else. That reads
 * as an instrument's switch label, which is what this product is.
 *
 * Tracked and one step DOWN from body: uppercase at 13 has close to the optical
 * weight of mixed-case at 15, and the tracking is what makes it read precise
 * rather than shouted. It is the same register as `Eyebrow` (uppercase, tracked,
 * "this is a label, not prose"), at action scale and in the action's ink.
 */
export const actionLabel = {
  fontSize: fontSizes.label,
  fontWeight: '800',
  letterSpacing: 0.9,
  textTransform: 'uppercase',
} as const;

/** Structural breakpoint for Dynamic Type. At this scale, compact horizontal
 *  compositions must reflow rather than merely shrinking or truncating text. */
export const usesAccessibilityTextLayout = (fontScale: number): boolean => fontScale >= 1.6;

/** Motion — theme-independent press/transition feel. */
export const motion = {
  /** Strong ease-out for entering/responding UI (cubic-bezier(0.23,1,0.32,1)). */
  easeOut: [0.23, 1, 0.32, 1] as const,
  /**
   * A value TRAVELLING to a new one — a gauge filling, a bar advancing
   * (cubic-bezier(0.4,0,0.7,1)).
   *
   * Distinct from `easeOut`, which starts at full speed because the UI is
   * RESPONDING to a tap the user just made. A fill is not a response; it is a
   * quantity moving, and it reads better departing from rest: brief
   * acceleration, most of the distance at speed, then deceleration over the
   * last stretch as it lands. The late `x2` is what keeps the settle short —
   * pulling it toward 0 would start the glide-out almost immediately and read
   * as sluggish.
   */
  fill: [0.4, 0, 0.7, 1] as const,
  /** Press-in feedback (fast, the user is watching). */
  pressMs: 120,
  /** Release (snappy). */
  releaseMs: 140,
  /** Subtle press scale for tactile feedback. */
  pressScale: 0.97,
} as const;

/** Semantic roles — every one resolves to a palette colour, never a new hex. */
export function semantic(C: Tokens) {
  return { pace: C.paceFast, hr: C.red, elevation: C.elev, positive: C.positiveText, danger: C.dangerText, warning: C.warningText, quality: C.qual };
}
