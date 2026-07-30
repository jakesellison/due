# Progress ledger

Compaction-durable record. A resumed session trusts THIS file + `git log`, never
its own memory. One line per completed gate, appended, never rewritten.

- Phase 0 started 2026-07-30 (scaffold + constitution + harness).
- Phase 0 GATE PASSED 2026-07-30: checks+tsc green on empty app; all 4 checks + 3 blocking hooks exercised to fail once each; skeleton boots on sim via existing dev client.
