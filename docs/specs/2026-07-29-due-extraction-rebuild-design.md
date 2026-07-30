# Due Extraction Rebuild — Design

**Status:** awaiting owner review
**Date:** 2026-07-29
**Decision being made:** rebuild Due in a new `/Users/jse/Projects/due` repo by **extraction under test governance** — not a clean-room rewrite.

## Why now, and why extraction

The 2026-07-29 survey measured the organic-growth drift directly:

- **65k lines of source, 38k lines of tests.** The tests and the hard-won edge-case logic (lap classification took 7 versions; the workout interpreter is on stream-summary v9 with reprocessed history; quality detection's HR floor came from real data) are the app's real asset. A clean-room rewrite discards exactly that.
- **Orphan scan of `src/lib`:** 4 exports referenced nowhere; **45 exports (≈1,760 lines across 8 modules) fully built and tested but wired to no screen**; 313 exports used only inside their own file. The codebase reads far more capable than the app is — that gap is the "half-followed rules" feeling.
- Every consequential bug found this week was a **coordination failure, not an architecture failure**: the same fact modeled at two granularities (per-day vs per-workout resolution), the same value derived twice (Dash says 16mi where planner says 13mi), prose rules with no check behind them (the raised button lip that DESIGN.md already forbade).

The operating principle, from current practice for AI-built codebases: **"Prose tells an agent what you would like; a check decides what it can ship."** The new repo is governed by checks from commit zero. No grandfathered baseline.

## Goal

A new repo at `/Users/jse/Projects/due` containing the **same shipping product** — same bundle id (`run.due.app`), same Supabase project, same Cloud Run API contract, same Strava app, same dark/yellow design system — where every line arrived one of three ways:

1. **Transplanted** deliberately, with its tests, passing.
2. **Rewritten** against the old tests (reserved for genuine structure problems, e.g. the 4.7k-line `SessionView`).
3. **Dropped and ledgered** in `MISSING.md` with a one-line "what this would do for a user."

## What parity means (owner ruling 2026-07-29: nothing is live)

There are no external users, so **the old app is reference, not contract.** That splits parity into two different obligations:

- **Hard contract — the data layer.** The Supabase schema, the owner's real training history, the live Strava webhook, and the Cloud Run API. These are real and stay untouched.
- **Reference only — the app layer.** Routes, deep-link paths, screen structure, and internal names carry **no backward-compatibility obligation**. Where the old shape is a backformation (route names that grew organically, params that exist for removed features), the new repo takes the clean shape and `MISSING.md` records the rename. The bar for a screen is *renders the correct facts and preserves the product intent* — not pixel or route identity.

## Non-goals (during extraction)

- No feature changes, no visual redesign, no dependency upgrades. Correctness parity first; the backlog waits in the ledger.
- No backend changes. Cloud Run, Supabase schema, Strava webhook stay untouched.
- The old repo remains the **only** place product changes land until cutover. Each phase re-syncs from old `main`. The two repos never both move.

## Method — phases, each with a gate

### Phase 0 — Constitution & scaffold
New repo with: `CLAUDE.md` (agent operating rules: spec→plan→subagent execution, progress ledger, no drift fix without leaving a check), `DESIGN.md` ported with **every prose rule triaged** — promoted to a machine check or explicitly kept as judgment-prose, `MISSING.md` ledger, ADRs with scope globs (a hook verifies the governing ADR was consulted when its files change), and the invariant harness:

- **Layer lint** (blocking): `lib ← app-lib ← components ← app`; no upward or skip imports.
- **Orphan ratchet** (blocking): CI fails on any new export with zero production references.
- **Fact registry** (blocking, grows per phase): one deriver per domain fact; screens may not re-derive registered facts from raw fields.
- **UI/header consistency tests** ported, baseline **zero** — nothing grandfathered.

Plus the full **agent governance harness** above (`.claude/` hooks, rules, scoped agents, deny floor). Expo SDK 56 skeleton (same pins as today — rebuild ≠ upgrade) boots to a blank themed screen on the sim. **Gate:** CI green on the empty app; every check and every hook demonstrably able to fail (each one exercised once, on purpose).

**Provenance trailers (repo convention from commit zero):** every transplant commit carries `Extracted-from: mileage@<sha>` so any line in the new repo traces to its full history in one hop. The old repo is archived read-only at cutover, never deleted — `git blame` archaeology survives across the boundary.

### Phase 1 — Pure core (`src/lib`, 21.9k lines)
Mechanical manifest from the orphan scan: Tier A (4 dead) dropped; Tier B (45 test-only exports) dropped to `MISSING.md` unless flagged *keep* in owner triage (Appendix A); Tier C (313 over-exports) demoted to module-private. Node tests transplant with their modules. **Gate:** every shipped export's tests green in the new repo; test-count delta explained line-by-line by the manifest.

### Phase 2 — IO layer (`src/app-lib`, `src/server`, `api/`)
Same treatment. The fact registry gets its first real entries: every query hook that derives a domain fact (week banked mileage, day planned distance, quality miles, days-to-race) registers its deriver. **Gate:** app-suite tests for the layer green; registry populated for every fact the Dash renders.

### Phase 3 — Design system
Tokens, `ui/` primitives, shared components. The consistency ratchet initializes at **zero exceptions** — anything that can't pass gets fixed now, not baselined. **Gate:** ratchet green with an empty baseline file.

### Phase 4 — Screens, one vertical slice at a time (atlas-driven)
Order: Dash → Plan + planner → run detail (**the one planned rewrite**: `SessionView` split into per-section modules against its existing tests) → Routes → You → import flow. Routes and screen structure take the **clean shape** (nothing is live; renames are ledgered, not preserved). Per slice: build, wire to extracted layers, then **two-sim comparison** — old app on the `Due` sim, new app on `mileage-agent`, same account, side by side against the atlas capture, judged on *correct facts + preserved intent*, not pixel identity. Register the slice's facts. **Gate per slice:** correctness comparison + facts registered + slice tests green.

### Phase 5 — Cutover
Parity checklist: full atlas walk, both suites green, fact registry complete, native config ported (share-extension identifiers + App Group via config plugin, Mapbox pod token, EAS). Device build verified. Then the old repo is archived read-only and `/Users/jse/Projects/due` becomes the source of truth.

## Agent governance harness (`.claude/` — built in Phase 0, enforced everywhere)

The CI checks catch drift at review time; this harness catches it **at the moment of action**, inside every agent session. Current Claude Code practice (July 2026) distinguishes instructions from enforcement — *"a CLAUDE.md instruction is not the same as enforcement"* — so each layer below is deterministic, not advisory:

1. **`CLAUDE.md` ≤ 200 lines** — the constitution only: layer map, the three arrival paths, the no-drift-without-a-check rule, pointers. Detail lives in **`.claude/rules/*.md` with `paths:` globs**, loaded only when matching files are touched — an agent editing a screen sees the screen rules, not the server rules.
2. **PreToolUse hooks (blocking — the only event that can stop an action):**
   - *Layer boundary:* an Edit/Write into `src/lib` that imports from `app-lib`/`components` is denied at write time, not caught in CI.
   - *Protected files:* generated files, baselines, `MISSING.md` deletions, and migration files require the governing ADR to have been read this session (scope-glob check against the transcript).
   - *Dependency gate:* `npm install` of a production dependency is denied without an ADR — supply-chain and bloat control in one rule.
   - Paired with `settings.json` **deny rules** as the floor: hooks can tighten permissions, never loosen them, and PreToolUse fires even under `--dangerously-skip-permissions`.
3. **PostToolUse hooks (verify-as-you-go):** typecheck + lint scoped to the edited file after every Edit/Write, so a type error surfaces in the same turn that caused it instead of at the end of a 40-file session.
4. **Stop hook (clean-up-after-yourself, enforced):** when an agent tries to finish, a fast sweep runs — no stray files outside the scratchpad, no orphaned exports introduced, ledger entries present for anything dropped, fast check suite green. Failure **blocks the stop** and bounces the agent back to clean up. This is the mechanical answer to "agents that clean up after themselves."
5. **Subagents with scoped tools** (`.claude/agents/`): reviewers get read-only tool sets; implementers get write access only inside their phase's globs. Parallel work runs in **git worktrees** so agents never collide in one working tree.
6. **Session durability:** progress ledger per phase (survives compaction; a resumed session trusts the ledger + `git log`, never its own memory), and a scheduled **tidying pass** — a recurring cleanup agent that runs the drift metrics (orphan count, duplicate-derivation count, unresolved warnings) and files small PRs, per the cleanup-loop pattern.

Rule of thumb from the research, adopted verbatim: put a behavior in a **hook** when it must happen at a fixed point every time; in a **rule file** when it needs judgment; in **CI** when it needs the whole repo. Anything that has failed twice as prose gets promoted to a hook.

## The three "missing" ledgers (one file, three sections)

`MISSING.md` records everything the tidying surfaces:

1. **Dropped code** — Tier B modules, one line each on user-facing value (Appendix A seeds this).
2. **Capability gaps** — things the mapping shows the app should do and doesn't (e.g. adapt engine computes reflow/doubles proposals nothing consumes).
3. **Rule gaps** — DESIGN.md rules that remain prose-only after Phase 0 triage, each with a reason.

## Consistency, defined precisely

Style consistency is the ratchet's job. The one that bites is **fact consistency: the same domain fact renders the same value on every surface.** The fact registry is the mechanism — one named deriver per fact, an allowlist of rendering surfaces, and a banned-pattern check that fails CI when a screen recomputes a registered fact from raw fields. It's a ratchet, not a proof — but it would have caught both of this week's real bugs (16mi/13mi; per-day vs per-workout).

## Sizing, honestly

Phases 0–2 are largely mechanical: days of agent-sessions. Phase 4 is the long pole (`SessionView` alone is 4.7k lines). Realistic total: **1.5–3 weeks of steady sessions**, with the old app shipping the entire time. Not one heroic session, and priced accordingly.

## Risks

- **Thin screen tests** → the atlas screenshot walk is the net where jest is weak.
- **Two-repo drift** → the "old repo is the only mover" rule plus per-phase re-sync.
- **Native config subtleties** (share extension App Group, Mapbox download token) → ported via config plugins and verified with a real device build *before* cutover, not after.

## Appendix A — Tier B triage (owner marks *keep* or *drop*; default drop-to-ledger)

| Module | Exports | What it would do for a user (inferred from code) |
|---|---|---|
| `routes/shape.ts` | 6 | Label routes loop / out-and-back + terrain class in the Routes library |
| `kpi/dotMatrix.ts` | 4 | Dot-matrix mileage visualization primitive (unused viz experiment) |
| `run/analysis.ts` | 4 | Path smoothing, early-mile stats, elapsed ticks for run charts |
| `kpi/insights/easyHr.ts` | 2 | Easy-run HR trend — aerobic fitness over time |
| `kpi/insights/heat.ts` | 2 | HR vs temperature — heat-adjusted effort |
| `kpi/insights/volume.ts` | 2 | Weekly mileage buckets / daily mileage insight charts |
| `plan/changeLog.ts` | 2 | Per-day/per-week plan-edit history (the `plan_changes` stretch goal) |
| `plan/cover.ts` (partial) | 2 | Plan cover art mode/fingerprint variants |
| `plan/weekEdit.ts` (partial) | 2 | `resolveDrop` drag-to-reorder decision tree; `editSummary` |
| `workout/render.ts` (partial) | 2 | Workout step labels/target detail formatting variants |
| `run/paceCurve.ts` (partial) | 3 | Pace-curve *siblings* (by-distance, best-window) — one variant shipped, three didn't |
| `adapt/reflowStrip.ts` | 1 | Before/after strip cells for the removed realign sheet |
