# Local same-club privacy repair — 2026-09-23

Scope: the owner approved local policy repair, same-club regression tests, and both migration orders only. No shared database changes, deployment, commits, or pushes. Applied migrations stay immutable; new forward migration `20260923053440_member_privacy_repair.sql` and the deferred enforcement file carry the fix.

## Guarantees and evidence

| Guarantee | Test | RED → GREEN |
| --- | --- | --- |
| Two ordinary same-club members cannot read each other's bookings, sessions, signups, check-ins, or charges; guest/contact and allocation internals remain operator-only | `supabase/tests/database/same_club_privacy.test.sql` | 15 privacy failures before the fix → 68 assertions pass, before and after enforcement |
| Own records across venues, assigned staff, admins, revocation, cross-club and anonymous boundaries remain correct | Same SQL suite plus `verify_populated_authorization.mjs` | Populated local checks pass; exact original financial leak probe now passes |
| Safe discovery still exposes occupied intervals and aggregate seats, never signup identities | Same SQL suite; `src/lib/api.live.test.ts` | Adapter had 3 failing tests → all 10 adapter tests pass |
| Failed safe reads do not silently display free courts or zero seats | Adapter error-path regression | Availability, signup, and aggregate failures are surfaced |
| Both migration orders have identical schema, effective grants, views, private functions; local schema/ledger/data restored | `verify_tenant_migration_orders.mjs` | 311 assertions in each order; 68 additional pre-enforcement assertions; unchanged inventories |

Run local scripts with `node supabase/verification/verify_tenant_migration_orders.mjs` and `node supabase/verification/verify_populated_authorization.mjs`. They accept only a fixed loopback host; `RALLY_VERIFY_DB_PORT` changes the local port, not the target host/database. This run used the existing local Docker database's network namespace with port 5432, the existing `node:24-bookworm-slim` image, a read-only repository mount, and a writable ignored evidence-directory mount only for the order report. No image download or hosted database connection was used.

## Application checks

`npm test` and `npm run test:coverage`: 159 tests / 21 files pass. Coverage: statements 89.86%, branches 80.31%, functions 85.80%, lines 92.70%. `npm run lint`, `npx --no-install tsc --noEmit`, `npm run build`, `git diff --check` pass. Dependency audit retry outside the blocked sandbox: zero vulnerabilities.

Blank-env demo smoke used the repository Playwright CLI, local port 5187, phone booking (390x844), desktop open play (1440x1000), demo login, and Tab focus. No console errors; phone document had no horizontal overflow. Screenshots were visually inspected; no baseline comparison or complete accessibility audit is claimed. The demo branch was not changed. Live browser acceptance remains gated on the separately approved repair/build rollout.

## Rollout caveat and remaining gates

The new live adapter depends on `open_play_seat_counts`. The privacy repair preserves legacy table-write grants but deliberately removes peer-private read access. Old member availability and seat counting cannot remain authoritative after that restriction. Apply neither half to staging without a coordinated owner-approved window, fresh backup/drift checks, and a reload/maintenance plan. No enforcement approval is implied. A read-only fallback/forward repair is safer than reverting to the old peer-row adapter.

No checkpoint commits were made: the explicit no-commit boundary overrides the TDD skill's checkpoint suggestion. Migration/security guidance drove the immutable forward repair and restrictive policy tests; TDD preserved real failing evidence before implementation; browser QA was limited to the local demo. The overall release is not Gate-8 complete.

## Self-review

Overall 4.0/5. Accuracy 4: actual SQL, adapter, and rollback evidence supports the local claims; live PostgREST/browser acceptance is still missing. Completeness 4: all requested local cases and orders pass; whole-release gates remain deliberately open. Clarity 4: sequencing caveat is explicit, but the historical release log is lengthy. Actionability 4: reproducible local scripts and named forward migration are ready; shared rollout needs its own reviewed package/approval. Conciseness 4: evidence is centralized here, with some deliberate duplication in the gate checkpoint. Improvement priority: prepare the coordinated staging repair/build package only after the owner authorizes the next stage. The owner should agree that this is a verified local fix, not a deployed or production-ready release.
