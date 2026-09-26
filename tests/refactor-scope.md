# Recent-code refactor scope

Status: implemented and locally verified; DemoStore refactor separately scoped below. Baseline: 2026-09-20. Revision: 3.

## Goal

Make the recent coverage expansion easier to maintain while increasing meaningful branch coverage, without changing member, staff, admin, demo, or live behavior.

## Evidence and boundaries

- The recent worktree changes are primarily tests in `src/context/AuthContext.security.test.tsx`, `src/pages/{OpenPlay,member,staff}.test.tsx`, new `src/lib/{api.demo.full,api.live,demoStore,payments}.test.ts`, `src/pages/remaining-pages.test.tsx`, and `src/types.test.ts`. The only recent production edit is the first-active-member selection in `src/pages/staff.tsx`.
- Baseline `npm run test:coverage`: 119/119 tests pass; 89.84% statements, 80.54% branches, 87.92% functions, 93.76% lines. Vitest enforces 80% on each global metric. `OpenPlay.tsx` is 79.71% branch coverage, `staff.tsx` 81.30%, and `api.ts` 76.73%.
- Keep route, adapter, demo/live, authorization, and database-policy contracts unchanged. Do not edit migrations or live data. No production cleanup merely to raise the coverage number.

## In scope

1. Consolidate repeated test fixtures and mock setup within the recent test files where doing so makes scenarios clearer. Keep fixtures typed and scenario-specific; avoid a shared helper that hides the action or expected state.
2. Split broad tests only when an assertion can otherwise pass because an unrelated operation ran. Preserve the existing success, failure, empty, cancelled, waitlist, and fallback assertions.
3. Add focused tests for uncovered branches in the recently exercised staff/open-play pages; inspect demo/live API paths where a page scenario crosses that boundary. Prioritize failure/retry and alternate-state branches that a user can reach, not incidental implementation branches.
4. Preserve the first-active-member regression test and production fix in `StaffCheckIn`.

## Out of scope

- Redesigns, route or role changes, payment completion, migrations, RLS changes, live credentials/data, broad `api.ts` or `demoStore.ts` rewrites, and speculative open-play timer fixes.
- Rewriting older tests solely for a uniform style. No commit, push, or deployment is part of this scope.

## Acceptance criteria

- AC-001 (required): Given the existing recent test scenarios, after fixture/mock refactoring each scenario still asserts its own observable result and all 119 baseline tests remain present and passing. Verify with focused Vitest runs and full `npm test`.
- AC-002 (required): Given an alternate staff/open-play state or API failure not covered by the baseline, the new test triggers the state through the page or adapter and asserts the resulting action, message, or absence of mutation. No test may pass on a mock call alone when a visible result exists. Verify with focused tests and a diff review.
- AC-003 (required): After refactoring, global statements/functions/lines stay at or above their baseline percentages and global branch coverage increases from 80.54% to at least 81.5%. `OpenPlay.tsx` reaches at least 80% branch coverage. Verify with `npm run test:coverage` and its per-file report.
- AC-004 (required): No existing public signup, trusted-role, demo/live, or staff check-in behavior changes; no database or external service is mutated. Verify with the auth/adapter/staff tests, `npm run lint`, `npm run build`, and review of the production diff.
- AC-005 (important, revised): CodeScene is configured for this project without a committed token. Verify the server starts and the repo/CLI checks pass. Code Health is authenticated for baseline scoring. No production file is refactored in this pass.

## Sequence and stop condition

Refactor test setup in small file-local steps, run focused tests after each, add branch tests against the baseline, then run full coverage, lint, build, and diff checks. Stop and revise this scope if a proposed cleanup changes production behavior or fails a protected assertion. A coverage increase by deleting code or weakening tests does not satisfy AC-003.

## Result (2026-09-20)

- Consolidated repeated open-play signup and staff member fixtures without weakening existing assertions. Added eight scenario tests for missing data, pending join, staff check-in and add-member failures, available-court selection, empty floor, and missing linked players/members.
- `npm run test:coverage`: 127/127 tests pass; 90.05% statements, 81.51% branches, 88.11% functions, 93.89% lines. `OpenPlay.tsx` branches: 88.40%; `staff.tsx`: 87.85%.
- `npm run lint`, `npm run build`, and `git diff --check` pass. CodeScene installation verification is 5/5, and baseline scores are available for production files. No token is committed.

## DemoStore refactor scope

Status: implemented and verified (2026-09-20). Target: `src/lib/demoStore.ts` (the request's `demostore.tc` is interpreted as this TypeScript module).

### Goal

Reduce the DemoStore's structural complexity by separating seed data, persistence/migration, and domain operations into cohesive modules while preserving the existing browser-demo contract used by `src/lib/api.ts` and the UI.

### CodeScene baseline

`demoStore.ts` scored **4.93/10**. CodeScene reported approximately 1,100 non-comment lines in one file, a 269-line `seed` method, and these high-complexity methods: `daySchedule` (CC 23), `joinOpenPlay` (CC 17), `load` (CC 17), `createBooking` (CC 14), `isSlotFree` (CC 14), `checkInByQr` (CC 10), `cancelBooking` (CC 9), and `confirmBookingPayment` (CC 9). It also flagged five arguments on `isSlotFree`, complex conditionals in `load`, and heavy primitive/string arguments.

### Discovered contracts to preserve

- `src/lib/api.ts` calls the exported `demoStore` methods directly when Supabase env values are blank.
- Browser state is persisted under `rally_point_demo_v3`; seeded demo passwords remain in memory and must never be serialized.
- Existing tests cover booking/payment, QR check-in, open-play join/waitlist/promotion, schedules/reminders, staff operations, membership payment, malformed legacy storage, and API delegation.
- Demo behavior is intentionally simulated and must not be presented as live payment, concurrency protection, or production QR verification.

### In scope

1. Add characterization tests for any currently implicit invariant before moving code: localStorage round-trip and malformed-state repair, password non-persistence, booking slot checks and payment side effects, QR fallback behavior, open-play waitlist promotion, schedule ordering, reminder idempotency, and staff session/court updates.
2. Extract pure/shared helpers first: time-range overlap and slot predicates, record hydration, ID/date helpers, and safe persisted-state normalization. Keep their inputs/outputs typed and side-effect free where possible.
3. Move the large seed fixture builder into a seed module, retaining the same IDs, roles, statuses, dates-as-relative-to-now behavior, and demo catalog shape.
4. Separate persistence/auth concerns from domain operations: load/save/reset, legacy-key cleanup, password-memory reset, and storage sanitization must remain behind the existing `demoStore` facade.
5. Extract domain groups in small phases: booking/payment, QR/check-in, open play/schedule/reminders, and staff/member operations. The public `demoStore` method names and return shapes remain stable so `api.ts` does not need a contract change.
6. Run CodeScene review before each production edit and a score after each extraction. Use the score to stop or narrow a phase rather than performing a broad rewrite.

### Out of scope

- Changes to `src/lib/api.ts` live Supabase behavior, migrations, RLS, payment providers, QR security, routes, UI copy, or real-time/concurrency guarantees.
- Changing the `rally_point_demo_v3` key, existing seeded IDs/statuses, error messages relied on by tests, or the in-memory-only password boundary.
- Replacing localStorage with IndexedDB/server storage, introducing a new state-management library, or optimizing for production-scale data.
- A single-pass rewrite of all 1,194 lines. Each extraction must be independently testable and reversible.

### Assumptions

- The demo store remains a browser-local fixture and is not a source of production authorization or payment truth.
- Existing direct tests and `api.demo.full.test.ts` are the compatibility contract; additional tests may be added, but existing behavior is not silently redefined.
- Product/business decisions about demo data realism were not supplied; this scope preserves current fixtures rather than inventing new rules.

### Acceptance criteria

- **DS-001 (required):** Given the current 127-test suite, after each extraction `npm test` remains green and the focused DemoStore/API tests cover the same success, failure, empty, malformed-storage, cancelled, waitlist, and fallback states. No test is weakened to make the refactor pass.
- **DS-002 (required):** Given a stored `rally_point_demo_v3` payload, load/save/reset preserve the current schema and repair behavior; legacy `passwords` are removed from persisted JSON and user-entered demo passwords remain memory-only. Verify with `demoStore.test.ts` and a localStorage inspection assertion.
- **DS-003 (required):** Given booking, payment, QR, open-play, reminder, staff-session, and membership operations, the refactored modules produce the same returned records, error messages, transaction/notification/reminder side effects, and court/session statuses as the baseline. Verify with focused unit tests plus `api.demo.full.test.ts`.
- **DS-004 (required):** Given an import through `src/lib/api.ts`, no screen-facing method signature or return shape changes in demo mode. Verify with API delegation tests and TypeScript build.
- **DS-005 (required):** CodeScene reports no regression from the 4.93 baseline for the retained facade; target the retained facade at **7.0+** and keep each extracted module at **7.0+** when CodeScene can score it. If a module is too small to score, record that limitation rather than inventing a score.
- **DS-006 (required):** Global coverage remains at least 90.05% statements, 81.51% branches, 88.11% functions, and 93.89% lines, with branch coverage not falling below the enforced 80% threshold. Verify with `npm run test:coverage`.
- **DS-007 (required):** `npm run lint`, `npm run build`, and `git diff --check` pass; no migration, live database, external payment, or committed credential changes occur.

### Execution sequence and stop condition

1. Capture CodeScene review and current focused-test/coverage baselines.
2. Add characterization tests (RED only where a missing invariant is exposed).
3. Extract pure helpers and seed data; run focused tests and CodeScene score.
4. Extract persistence/auth; repeat checks.
5. Extract one domain group at a time, starting with the highest-complexity method cluster (`daySchedule`/open play, then booking, then load/persistence).
6. Run the full verification set and review the diff.

Stop and revise the scope if an extraction changes a public method contract, persisted data semantics, demo error behavior, or CodeScene score regresses. Do not continue to the next phase until the current phase is green.

### Implementation result (2026-09-20)

- Retained `demoStore.ts` as the public facade and kept its auth-facing methods there. Extracted typed helpers, seed fixture, memory-only credentials, storage normalization/load/save, and booking, check-in, open-play, schedule, staff, member, and ledger operations under `src/lib/demo/`. No `api.ts`, UI, migration, or live-data behavior was changed.
- Added focused characterization tests for slot occupancy, legacy-state normalization without input mutation, storage round-trip/reset, QR code fallback, paid waitlist side effects, booking payment records, and multi-session court status. Existing scenarios were not removed.
- `npm test`: 131/131 passed. `npm run test:coverage`: 90.40% statements, 82.33% branches, 88.62% functions, 93.94% lines, all above DS-006 floors. `npm run lint`, `npm run build`, and `git diff --check` passed. Git emitted only line-ending conversion notices.
- CodeScene: facade **4.93 → 10.00**. Extracted modules score `common` 9.60, `seed` 8.58, `credentials` 10.00, `persistence` 9.58, `booking` 9.13, `checkIn` 9.68, `openPlay` 9.52, `schedule` 9.36, `staff` 10.00, `member` 10.00, and `ledger` 10.00. The interface-only `model.ts` was too small for CodeScene to score.
- Security boundary: `rally_point_demo_v3` remains the storage key, legacy `passwords` are stripped, and demo passwords remain memory-only. No credentials, migrations, remote resources, commits, pushes, or deployments were changed by this refactor.
