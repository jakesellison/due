---
scope: ["package.json"]
status: accepted
date: 2026-07-30
---
# ADR 0003 — Wholesale dependency transplant, verbatim pins

**Context.** The extraction runs against the EXISTING dev client (bundle id
`run.due.app`, built from mileage@main). A JS bundle only loads if its native
modules match that client's ABI.

**Decision.** `dependencies` and `devDependencies` are copied verbatim from
`mileage@d68be50` — every pin, no additions, no upgrades. New dependencies
still require their own ADR (the PreToolUse gate enforces it); UPGRADES are a
post-cutover project, never part of extraction.

**Consequences.** Some deps arrive before their consumers (mapbox before the
Routes slice). The orphan ratchet does not cover node_modules; the unused-dep
window closes as Phase 4 lands. Known-vulnerable transitive advisories carry
over knowingly — same posture as the old repo, fixed after cutover.
