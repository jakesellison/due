# Design System — Due

Ported from `mileage/DESIGN.md` under the Phase 0 rule: **every rule is tagged**.

- `[CHECK:<name>]` — machine-enforced; the named check/hook/test decides.
- `[CHECK-P<n>]` — will be enforced by the named phase; prose until then is a
  Phase gate item, not an option.
- `[PROSE]` — deliberately judgment-only; the reason is stated and the rule is
  mirrored in `MISSING.md §3`.

Component vocabulary arrives with the design system in Phase 3 and the screens
in Phase 4; this file starts with the laws.

## Product grammar

- The thesis: show up most days, hit the weekly mileage contract, one quality
  day. Primary KPI = weekly mileage; secondary = quality completed. `[PROSE]` —
  product intent, not lintable.
- Quality banks as **hard miles**, never binary session tags. `[CHECK-P1]` —
  the transplanted quality-credit tests pin this.
- A warning and an invitation are not the same state: behind = orange
  (something must change), ahead/over-allocated = green (only the plan is out
  of date). Orange is reserved for work the runner still owes. `[CHECK-P3]` —
  contract-status test transplants with the state enum.

## Color law

- Yellow = action / progress / selection only. Text on yellow is always
  `accentInk`. No translucent yellow washes. `[CHECK-P3]` — uiConsistency port.
- Green (`z2`) = consistency/"hit" and ONLY that. `[PROSE]` — semantic intent;
  reviewed, not greppable without false positives.
- Violet = Quality, cyan = Long Run, orange = attention, on contract surfaces.
  `[CHECK-P3]` — stripToneColor is the single mapping; screens may not inline
  these hexes (banned-pattern check).
- Chart-local grammars (pace blue, HR red, elevation sage) never leak into
  contract chrome. `[PROSE]` — needs judgment about what "contract chrome" is.
- Vivid primitives (`yellow`, `pink`) are fills; `*Text` variants are the only
  ink-safe forms for small text. `[CHECK-P3]` — contrast test in tokens suite.

## Depth law

- **Buttons are flat. Depth is not a material.** No lip, shadow, gradient, or
  bevel on controls; the accent field + tracked-uppercase legend is the whole
  affordance. The only shadows allowed are functional (a control floating over
  a map). `[CHECK]` — `ActionButton` test bans border/shadow/elevation in the
  button tree; transplants in Phase 3 with baseline zero.

## Type law

- Every font size resolves to the `fontSizes` scale; no phantom half-points.
  `[CHECK-P3]` — uiConsistency port, empty baseline.
- Display face (Space Grotesk 700) for hero numerals + titles only; data face
  (Space Mono) for contract numerals; system face for everything else.
  `[CHECK-P3]` — typeRole carries the face; a forgotten fontFamily cannot drift.
- **The title ladder**: metadata 12 · label 13/14 · body 15 · sectionTitle 18 ·
  cardTitle 20 · sheetTitle 22 · pageTitle 29. **The numeral register** (display
  numerals — stat values, gauges, hero figures — a different intent than titles
  even where sizes coincide): numeralSm 20 · numeralMd 24 · numeralLg 34 ·
  numeralXl 40; hero one-offs above 40 stay bespoke. **The weight ladder**:
  500 soft · 600 · 700 · 800 top. 900 is banned — the display face loads only
  700, so 900 synthesizes a fake bold. Micro-spacing: `space.nudge` (3) is the
  named optical nudge between xxs and xs. `[PROSE]` — which register a piece of
  text belongs to is a judgment call; the sizes themselves are tokens.

## Copy law

- Labels + numbers, never narrated status sentences ("Quality met, you can
  still…"). Verbs live on buttons only. `[PROSE]` — genuinely editorial; the
  reason it stays prose is that narration is a semantic property no regex
  catches. Mirrored in MISSING.md §3.
- Data-derived UI text must fit its FULL value range (bounded derivation,
  `numberOfLines`, or full-width layout). `[PROSE]` — property of each
  derivation site; enforced by review + the fact registry's surface list.

## Structure law

- One state gets one mark — never outline + fill + dot + badge for the same
  fact. `[PROSE]` — compositional judgment.
- Primitives are used, not re-implemented: primary = `ActionButton`, secondary
  = `GhostButton`, pick-one = `Segmented`, etc. `[CHECK-P3]` — the ratchet, at
  **zero baseline**: nothing grandfathered in this repo.
- Headers come from the header primitives; no hand-rolled back buttons or
  offsets. `[CHECK-P3]` — headerConsistency port, empty baseline.

## Fact law (new in this repo)

- Every domain fact (a day's planned distance, week banked mileage, quality
  miles, days-to-race…) has **one deriver**, registered in
  `checks/facts.registry.json` with the surfaces allowed to render it. Screens
  re-deriving a registered fact from raw fields fail CI. `[CHECK]` —
  `checks/facts.mjs`, live now (registry fills in Phases 2 and 4).
