# Progress ledger

Compaction-durable record. A resumed session trusts THIS file + `git log`, never
its own memory. One line per completed gate, appended, never rewritten.

- Phase 0 started 2026-07-30 (scaffold + constitution + harness).
- Phase 0 GATE PASSED 2026-07-30: checks+tsc green on empty app; all 4 checks + 3 blocking hooks exercised to fail once each; skeleton boots on sim via existing dev client.
- Phase 1 GATE PASSED 2026-07-30: pure core transplanted from mileage@d68be50 — 90 suites / 1004 tests green, tsc green, all checks green. Dropped 5 whole files + 44 partial exports (MISSING.md), demoted 39 over-exports, baseline 83 (all with old-repo consumer evidence; drains in Phases 2-4).
- Phase 2 GATE PASSED 2026-07-30: IO layer transplanted (src/server, api, src/theme, src/app-lib + secrets tooling + app.config). node 118 suites/1300 tests, app 30 suites/216 tests, tsc + checks green. 4 Dash facts registered. Parked: preferences.reactivity.test (needs WeekGauges, restore Phase 3). Deps = verbatim mileage pins (ADR 0003).
- Phase 3 GATE PASSED 2026-07-30: design system + all shared components transplanted, RATCHET-CLEAN AT ZERO BASELINE (empty uiConsistency baseline; the two consistency suites parked as *.phase4-pending.ts — their sanity guards need the screens). app 71 suites/515 tests (wait: current run 515), node 118/1300. Dropped 7 IO-layer orphans + 3 cascades to ledger; countHardLaps documented as a named test seam; layer check now rank-resolves relative imports; baseline 59.
