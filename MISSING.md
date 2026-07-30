# MISSING.md — the extraction ledger

Everything the tidying surfaced but did not carry. Three sections. An entry is
one line: what it is, what it would do for a user, why it isn't here. Nothing
is dropped silently; nothing here is forgotten — this file IS the backlog's
front door.

## 1 · Dropped code (built + tested in `mileage`, not extracted)

Seeded from the 2026-07-29 orphan scan (Tier B: tested, never shipped). Default
ruling: drop-to-ledger. Revisit any of these by extracting the module from
`mileage` with its tests (provenance trailer as usual).

- `lib/routes/shape.ts` — loop/out-and-back + terrain classification for the Routes library. Never wired to a screen.
- `lib/kpi/dotMatrix.ts` — dot-matrix mileage viz primitive. Unused experiment.
- `lib/run/analysis.ts` — path smoothing, early-mile stats, elapsed ticks. Superseded variants; shipped siblings live in the run charts.
- `lib/kpi/insights/easyHr.ts` — easy-run HR trend (aerobic fitness over time). Built for Trends, never wired. Likely first to resurrect.
- `lib/kpi/insights/heat.ts` — HR vs temperature, heat-adjusted effort. Same story.
- `lib/kpi/insights/volume.ts` — weekly mileage buckets / daily mileage charts. Same story.
- `lib/plan/changeLog.ts` — per-day/per-week plan-edit history readers (the `plan_changes` stretch). Table exists; UI never built.
- `lib/plan/cover.ts` (partial) — cover-art mode/fingerprint variants beyond the shipped one.
- `lib/plan/weekEdit.ts` (partial) — `resolveDrop` drag decision tree (planner uses its own inline logic), `editSummary`.
- `lib/workout/render.ts` (partial) — step-label/target-detail formatting variants.
- `lib/run/paceCurve.ts` (partial) — by-distance + best-window pace-curve siblings; only the duration curve shipped.
- `lib/adapt/reflowStrip.ts` — before/after strip cells for the removed realign sheet.
- `lib/sync/providers.ts`, `lib/routes/elevation.ts` (`fetchElevationProfile`), `lib/workout/pace.ts` (`portableTarget`) — Tier A, referenced nowhere.

## 2 · Capability gaps (the app should do this and doesn't)

- Adapt engine computes reflow / lower-target / add-double proposals that no
  surface consumes; the Dash reads only the deficit number. Decide: surface
  them in the planner, or shrink the engine to what's read.
- `plan_changes` is written but never rendered (pairs with `changeLog.ts` above).
- Strava description write-back (push Due results onto the activity) — noted
  2026-07-17, still unbuilt.

## 3 · Rule gaps (prose without a check, carried knowingly)

Populated during the Phase 0 DESIGN.md triage — see the PROSE-tagged rules
there. Each entry names the rule and why it stays judgment-only.

## 4 · Renames (clean shape taken; old shape recorded)

_None yet — populated as screens are rebuilt in Phase 4._
