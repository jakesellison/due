---
scope: ["**"]
status: accepted
date: 2026-07-30
---
# ADR 0001 — Extraction method and provenance

**Context.** This repo rebuilds `~/Projects/mileage` (65k source / 38k test
lines) whose drift was measured, not felt: 45 tested-but-unshipped exports,
duplicate fact derivations, prose rules without checks. Nothing is live.

**Decision.** Every line arrives by transplant (with tests), rewrite (against
old tests; planned only for SessionView), or drop + MISSING.md ledger line.
Transplant commits carry `Extracted-from: mileage@<sha>`. The old repo is the
only mover for product behavior until cutover; the data layer is a hard
contract, the app layer is reference only.

**Consequences.** History archaeology needs one hop through the trailer. The
ledger, not memory, is the record of what was left behind.
