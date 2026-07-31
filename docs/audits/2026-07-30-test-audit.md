# Test audit — 2026-07-30

Three instruments over 208 test files / 1,885 cases: coverage (gap map),
static smell scan (tests that can't fail), and 12 mutation spot-checks
(deliberately broken logic — a useful suite must notice).

## Verdict

The suite is genuinely good: zero tautologies, zero skips, zero snapshot-only
tests, and 10 of 12 mutations killed — including the HR-quality floor, the
adapt gap sign, the dayComposition doubles bug re-introduced verbatim, the
auth ticket bypass, the rate limiter, and Keychain chunking. The two
survivors were both HANDLER-LAYER gaps (logic tested, the wiring that
consumes it untested) and are now closed with pinning tests.

## Mutation results

| # | mutation | result |
|---|---|---|
| M1 | qualityDetect HR-floor comparison flipped | KILLED (3 fail) |
| M2 | adapt gap sign inverted | KILLED (40 fail) |
| M3 | dayComposition banked-only (the old doubles bug) | KILLED (2 fail) |
| M4 | authHandoff ticket check bypassed | KILLED (2 fail) |
| M5 | over-allocation threshold 1→100 | KILLED (1 fail) |
| M6 | **webhook wipe fires while token ACTIVE** | **SURVIVED → fixed** (4 gating tests; re-run kills) |
| M7 | weekEdit move writes wrong date | KILLED (2 fail) |
| M8 | **race-anchor decay eliminated** | **SURVIVED — open** (see gaps) |
| M9 | disabled ActionButton still fires | KILLED (1 fail) |
| M10 | session store drops final Keychain chunk | KILLED (7 fail) |
| M11 | **claim rejection leaks 200** | **SURVIVED → fixed** (5 contract tests; re-run kills) |
| M12 | rate limiter always allows | KILLED (4 fail) |

## Coverage (statements; merged node+app)

lib 86% · components 70% · app 74% · app-lib 62% · server 74% · **api 42%** ·
total 76%. Jest hides never-imported files; the true zero-coverage set is 28
files.

## Gaps, ranked

1. **`app/planner/[id].tsx` — 1,180 lines, ZERO tests.** The whole week
   planner screen (drag placement, save path, the doubles desk). Its pure
   deps are tested (boardSave, weekPlan, dayComposition); the screen isn't.
   Biggest single hole in the suite.
2. **`api/` handlers at 42%** — the pattern behind both mutation survivors:
   logic in `src/server` is tested, the HTTP handlers consuming it mostly
   aren't. Untested handlers: sync, rehydrate, purge-raw, account-delete,
   auth (mint), callback.
3. **M8 open: race-anchor time decay.** `predict/ensemble` anchors never age
   in any test (all fixtures are fresh). A regression pinning predictions to
   a stale race forever would ship silently.
4. **Query layer (app-lib/queries): 9 files at 0%** — planView (91 stmts),
   workoutDetail, activityDetail, planIdentity… Screen tests mock these,
   so the mocks are tested, not the row→view mapping.
5. Untested plumbing: seed.ts (283), backfill.ts (210), pushNotifications
   (196), strava.ts client sync (145), autoStravaSync, sync.ts.
6. `routes/[id].tsx` and `plan/history.tsx` screens: no tests.

## Static smells (near-clean)

- 4 assertion-free flags — all false positives on inspection (RTL `getByText`
  asserts by throwing; describe-block miscounts).
- 23 conditional-expects — sampled: the `expect(kind).toBe(...)` then
  `if (kind === ...)` type-narrowing idiom; the unconditional assert precedes
  the guard. Legitimate.
- 1 calls-only suite (`report.test.ts`) — acceptable for a reporting wrapper.
- 8 heavy-mock screen suites (6–10 `jest.mock`) — inherent to jest-expo
  screen tests; the risk they carry is gap #4, not the mocking itself.

## Fixed in this audit

- `processEvent` exported as a named test seam + 4 gating tests: the history
  wipe fires on an affirmative revocation and on nothing else (M6).
- `authClaimHandler.test.ts`: 404/200/400 response contract pinned (M11).
- Node suite now 1,309 tests (was 1,300).


## Gap-closure status (same day)

| gap | status |
|---|---|
| 1 · planner screen | **CLOSED** — 6-test suite incl. the doubles-desk regression, mutation-verified at the screen level |
| 2 · api handlers | **CLOSED (destructive/auth set)** — account/delete, strava/disconnect, sync/status, auth-claim, webhook gating. Remaining thin: refresh, sync-latest, backfill happy-paths |
| 3 · M8 anchor decay | **CLOSED** — 3 tests (fresh > aged, monotone, stale drops out); mutant re-run killed |
| 4 · query layer | **CLOSED (core)** — planView row→view mapping (6) + planHeaderInfo fact deriver (6). Remaining thin: workoutDetail, activityDetail, planIdentity, recentMileage |
| 5 · plumbing | **PARTIAL** — the security-relevant piece (notification scheme allowlist, 8 tests incl. case-tricked/other-scheme/non-string payloads) is pinned. seed.ts + backfill.ts remain untested by choice: integration-shaped orchestration whose valuable test is against a real database, not a mock pyramid |
| 6 · screens | **CLOSED** — routes/[id] + plan/history render smokes (loaded, empty, populated states) |

Suite after closure: node 1,322 · app 694 (was 1,300 / 664). New named test
seams (checks/orphans.mjs TEST_SEAMS): `processEvent`, `routeFromResponse`.

## Design follow-through (2026-07-31)

Owner ruling on the audit's process findings: **change the design so the
gotchas can't exist, rather than documenting them.** Executed as:

| Finding | Design change (not a doc) |
| --- | --- |
| `test:app` needs `--runInBand --forceExit` (tribal) | Flags baked into `test:app`/`test:all`/`test:ci` scripts; nobody types raw flags |
| Mutation harness lived in `/tmp` | `scripts/mutate.sh`, with the KILLED/SURVIVED contract in its header |
| Provider stack hand-rolled in 18 suites | `src/app-lib/__testsupport__/render.tsx` (`renderScreen`/`screenWrapper`); all 18 refactored, both RTL and legacy `create()` suites |
| TEST_SEAMS registry needed explaining | Registry deleted: 2 entries were redundant (self-consumed exports), and `countHardLaps` was dead code in both repos — dropped + MISSING.md ledger |
| Barrel `requireActual` crash | Root cause was `queries/index.ts` re-exporting `weekStartOf` from `@/lib` (zero consumers) — deleted |
| Handler-wiring blind spot (both mutation survivors) | `checks/apiContracts.mjs`: every `api/` handler must be imported by a test; baseline = `auth.ts`, `refresh.ts` (the documented-thin pair); stale entries fail; pre-write hook denies baseline growth |
| Coverage measured once, nothing holds it | **CI never ran jest at all** (checks+sweep only) — now runs `test:ci`; coverage measured against the whole tree (`collectCoverageFrom`), directory-level line floors ~2pts under jest's group aggregates |

Post-change state: 215 suites / 2,012 tests green in one 20s `test:ci` run,
thresholds pass, sweep clean. Node suite is 1,318 (−4: the deleted
`countHardLaps` tests left with their dead subject).

Not designed away (accepted residue): the react-test-renderer exact pin
(the pin itself is the fix) and RN API-location trivia (`Linking` is
react-native's) — the refactored suites are the living examples.
