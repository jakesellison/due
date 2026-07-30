---
paths: ["src/lib/**"]
---
# src/lib — the pure core

- NO react-native, expo, @/app-lib, @/components, or app/ imports. Node-tested.
- Every export needs a production consumer (orphan ratchet) — if you are
  extracting a module whose consumer lands later THIS phase, add the export to
  checks/orphans.baseline.json WITH a MISSING.md ledger line, and remove it the
  moment the consumer lands.
- Transplants keep their tests and carry `Extracted-from: mileage@<sha>`.
- Constants used only inside a module stay unexported (the old repo grew 313
  over-exports this way).
