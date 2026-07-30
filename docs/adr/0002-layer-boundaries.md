---
scope: ["src/**", "app/**"]
status: accepted
date: 2026-07-30
---
# ADR 0002 — Layer boundaries

**Context.** The old repo's worst bugs came from derivation logic living in
screens (per-day vs per-workout resolution; Dash/planner disagreeing on one
day's mileage).

**Decision.** `src/lib` (pure, node-tested, no RN/expo) ← `src/app-lib` (IO)
← `src/components` (UI) ← `app/` (screens). Enforced twice: at write time by
the PreToolUse hook, and repo-wide by checks/layers.mjs. Domain facts get one
deriver, registered in checks/facts.registry.json.

**Consequences.** Some conveniences (importing a component's type into a hook)
are forbidden even when harmless — the boundary is worth the friction.
