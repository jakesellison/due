# Due — agent constitution

Due is a consistency-first marathon training app (Expo / expo-router, Supabase,
Cloud Run API, Strava ingest). This repo is the **extraction rebuild** of
`~/Projects/mileage`, governed by `docs/specs/2026-07-29-due-extraction-rebuild-design.md`.
Read that spec before any extraction work. Nothing here is live yet.

## The three arrival paths (every line of code)

1. **Transplant** — copied deliberately from `mileage`, with its tests, passing.
2. **Rewrite** — against the old tests. Planned only for `SessionView`.
3. **Drop + ledger** — one line in `MISSING.md`. Never silently.

Transplant commits carry the trailer `Extracted-from: mileage@<sha>`.

## Layer law (machine-enforced; see checks/layers.mjs + PreToolUse hook)

```
src/lib        pure domain. NO react-native, NO @/app-lib, NO @/components, NO app/
src/app-lib    IO + hooks.  may use src/lib. NO @/components, NO app/
src/components UI.          may use lib + app-lib. NO app/
app/           screens.     may use everything below
```

## Operating rules

- **Prose tells you what we'd like; a check decides what ships.** No drift is
  fixed without leaving a check behind. Anything that fails twice as prose gets
  promoted to a hook or a CI check.
- **The old repo (`~/Projects/mileage`) is the only mover** for product behavior
  until cutover. This repo re-syncs from its `main` at each phase start.
- **Data layer is a hard contract** (Supabase schema, real training data, Strava
  webhook, Cloud Run API, `duerunning` scheme — the server hardcodes it).
  **App layer is reference only** — clean route/screen shapes win; renames are
  ledgered in MISSING.md, never preserved for compatibility.
- Progress is recorded in `docs/PROGRESS.md` (append-only). A resumed session
  trusts that file + `git log` over its own memory.
- Scoped rules live in `.claude/rules/*.md` — read the one matching the files
  you touch. ADRs in `docs/adr/` govern their scoped paths; consult before
  editing governed files (a hook checks).
- Temporary/scratch files go in the session scratchpad, never the repo. The
  Stop-hook sweep blocks finishing with strays, new orphans, or unledgered drops.

## Commands

- `npm run check` — layer lint, orphan ratchet, fact registry, typecheck
- `npm run sweep` — the Stop-hook cleanliness sweep, runnable by hand
- `npm start` — Metro on port 8082 (8081 belongs to the old repo)

## Phase state

See `docs/PROGRESS.md`. Current: **Phase 0** (constitution + harness).
