# Rally Point tenancy — developer handoff

Prepared 2026-09-26 for the **Implement Rally Point Tenancy** thread.

## Start here

Continue the existing implementation and finish its verification and rollout. Substantial tenancy code already exists in this working directory, but release readiness is incomplete. **Staging remains reservation-write paused; tenant enforcement is not recorded as applied.**

This document summarizes inspected local source and saved execution reports. No live environment was queried while preparing it. Treat environment state below as the last recorded state and reverify it before acting.

The workspace is on `main`, with HEAD `7c3722e` (`fix: stabilize auth flows and lint checks`). Many implementation files are modified or untracked. A fresh clone at that commit will not contain this work. Also, `.gitignore` excludes the entire `docs/` directory, including release evidence and the draft resume migration. This handoff sits at the repository root so it can be shared separately.

## Scope and agreed direction

- Ship one active club, Rally Point Gensan, with multiple venues. No club switcher or self-service club onboarding in this release.
- Membership belongs to the club and works across its venues. Staff operate only at assigned venues; club admins operate across the club.
- Make the database tenant-ready: explicit club/venue ownership, matching foreign keys, database authorization, scoped commands, and cross-club denial tests.
- Preserve the React/HashRouter app, phone shell, desktop layout, PHP currency, and browser-local demo fallback.
- Defer additional active clubs, platform superadmin/CRM, support sessions, and real payment processing to later work.

The design diagrams in [architecture/tenant-ready/](architecture/tenant-ready/README.md) explain the target. They are proposals, not deployment evidence. Names such as `club_memberships` and `resources` in those diagrams are not the current physical implementation: the SQL still uses `members` and `courts`.

## Last recorded environment state

| Area | Recorded state | Implication |
| --- | --- | --- |
| Staging database | Rally-Point-Database, project `iclrvvsiwypxlwrwgqia` | Verify this exact target before any hosted operation. |
| Reservation pause | Applied on September 26 at approximately 06:22 UTC; ledger contains 14 versions | Two saved read-only postflights passed 66 effective-permission checks. This is not proof of actual hosted denied-write attempts. |
| Enforcement | `20260921111105_tenant_enforcement.sql` remains pending | Do not perform a blanket migration push or bypass ordering with `--include-all`. |
| Resume | Guarded draft exists outside the normal migration directory | Preparation/tests are not authorization or proof that reservation RPCs can safely reopen. |
| Hosted app | Last recorded Pages artifact is r8, build commit `558f2fee0be9ae876960e4913928535cd38242ad` | Saved staff venue browser failure remains unresolved on the hosted artifact. |
| App candidate | r9 is frozen locally | It is not recorded as published; final staging/browser acceptance remains open. |
| Local Gate 2/3 environment | New r2 container and volume were created on September 26 at 15:45 UTC; container left unstarted | No initialization, SQL, migration replay, or concurrency proof resulted from creation. |
| Production | Readiness and release approval remain open | This handoff does not authorize production changes. |

Staging website recorded by the owner: `https://zylush.github.io/rally-point-web/`.

The latest local create-only result is newer than the top-level rollout summary. Its source is [the execution report](docs/release-private/gate23-retained-create-freeze-20260926-r1/EXECUTION-REPORT.md). Earlier service-stop approval blockers are historical: [the shutdown reconciliation](docs/release-private/gate23-shutdown-reconciliation-20260926-r1/REPORT.md) records the prior disposable stack as stopped with orderly PostgreSQL shutdown. Do not resume an old recovery action merely because an older STOP file exists.

## Implementation map

| Concern | Start in | Current implementation |
| --- | --- | --- |
| Club identity and types | `src/lib/tenant.ts`, `src/types.ts` | Fixed live club ID `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`, slug `rally-point-gensan`; distinct demo IDs. Browser inputs do not confer authority. |
| Authentication | `src/context/AuthProvider.tsx` | Loads identity from `profiles`, then derives live role through `get_current_access`. Trusted staff assignments replace `profiles.role` as the live role authority. |
| Routes | `src/App.tsx` | Member/staff/admin guards and new `/admin/venues` route. Database controls must also deny unauthorized access. |
| Data boundary | `src/lib/api.ts` | Fixed-club reads, venue filters, safe read projections, and scoped RPC writes. Inspect both live and demo branches for every change. |
| Demo mode | `src/lib/demoStore.ts`, `src/lib/demo/` | Browser-local state; blank/missing Supabase URL or key must still select demo mode. |
| Venue administration | `src/pages/AdminVenues.tsx` | Venue editing and staff venue-grant management. |
| Staff journeys | `staff.tsx`, `BookingsDesk.tsx`, `ScheduleBoard.tsx`, `OpenPlay.tsx` under `src/pages/` | Assigned-venue operations, selection boundaries, and refresh/race handling. |
| Member journeys | `MemberBook.tsx`, `member.tsx`, `OpenPlay.tsx` under `src/pages/` | Availability and personal activity; live checkout and membership renewal remain unavailable. |
| SQL and access | `supabase/migrations/`, `supabase/tests/database/` | Expand/backfill/enforcement, forward repairs, pause, and eight SQL test suites. |
| Release tools | `scripts/`, `supabase/verification/` | Fingerprints, backups/restores, migration-order checks, pause/resume guards, and artifact verification. Some scripts mutate databases: inspect scope before running. |

The principal ownership tables are `clubs`, `venues`, `club_staff_roles`, and `staff_venue_grants`. Operational rows gain `club_id` and, where appropriate, `venue_id`. `court_allocations` unifies occupied intervals for bookings, rentals, and court-based open play. Enforcement adds the `court_allocations_no_overlap` exclusion constraint and composite ownership constraints.

Read boundaries include `member_self`, `member_roster`, `member_admin`, `staff_accounts`, `public_schedule`, and `open_play_seat_counts`. The roster is intentionally narrower than admin member data. Public schedule and seat counts must not expose private peer records. Some views deliberately use privileged projections with explicit predicates; inspect their definitions and denial tests before changing their security mode.

Important live commands include `create_unpaid_desk_booking`, `create_desk_rental`, `extend_desk_session`, `end_desk_session`, `create_open_play_session`, `join_open_play_session`, `leave_open_play_session`, `check_in_member`, `check_in_qr`, `admin_upsert_venue`, and `set_staff_venue_grant`.

## Migration sequence and release constraints

The baseline is `001` through `004`, followed by the dated authorization and rate-limit migrations. Tenant work adds:

| Migration | Purpose |
| --- | --- |
| `20260921090000_tenant_ready.sql` | Add structures, nullable ownership, read projections, and commands. |
| `20260921110828_tenant_backfill.sql` | Assign legacy ownership and staff access; reject orphan/conflicting records; mark historical charges unverified. |
| `20260921111105_tenant_enforcement.sql` | Require ownership, install composite/exclusion constraints, replace legacy policies, and remove direct client writes. **Deferred on staging.** |
| `20260922011918_tenant_table_grant_repair.sql` | Repair access grants for new tenant tables. |
| `20260922163027_booking_rpc_alias_repair.sql` | Repair the desk-booking command. |
| `20260922163830_booking_cancellation_command.sql` | Add scoped cancellation and allocation release. |
| `20260922164128_rls_member_lookup_repair.sql` | Preserve ownership lookups when direct member-table reads are restricted. |
| `20260923053440_member_privacy_repair.sql` | Restrict peer private records and add safe seat counts. |
| `20260925174111_reservation_write_pause.sql` | Block reservation-changing table privileges and nine RPCs while preserving authenticated reads. |

There are 15 migration files in the current source chain. The saved staging ledger has 14 because enforcement is deferred despite having an earlier timestamp than the forward repairs.

Draft `20260926063659_reservation_rpc_resume.sql` lives under `docs/release-private/reservation-rpc-resume-20260926-r1/candidate/`. It is designed to restore only nine authenticated RPC EXECUTE grants after guarded enforcement/readiness checks. It must never restore legacy direct reservation writes.

Verify both orderings: actual staging order **pause → enforcement → resume**, and clean replay order **enforcement → pause → resume**, with the applicable baseline and repair migrations included. Two independent clean replays remain required. Older replay packages lacking the pause/resume boundary are stale.

Keep the technical reservation pause until enforcement and concurrency checks pass. The pause is narrower than a whole-system freeze; membership, check-in, walk-in, and other activity still require operational control. A maintenance page or closed browser tabs do not prove database writes are blocked.

The privacy repair changes the read contract: old member availability/seat-count clients depend on peer rows that they can no longer read. Coordinate safe-read app publication with a maintenance/reload boundary. Do not roll back to the old peer-row adapter after privacy repair. Preserve applied migrations and use a reviewed forward repair or reconciled restore when needed.

## Immediate next work

1. **Receive the complete working state.** Reconcile modified/untracked source against this handoff and obtain the selected private evidence packages through a secure channel. Confirm package hashes and preserve consumed attempts/STOP records. Do not reset or clean this worktree.
2. **Prepare the next local startup/initialization scope.** A disposable local container and volume were created, but the container was left unstarted. Effective running-port isolation is unproven. Obtain the [bootstrap review](docs/release-private/gate23-isolation-prep-20260926-r2/BOOTSTRAP-REVIEW.md) and verify resource identities afresh before preparing a bounded startup/initialization and shutdown plan. Protect the original database and retained r1 resources.
3. **Complete current local Gates 2/3.** Use a reviewed isolated environment to run both migration orderings, the eight SQL suites, resume negative cases, and independent clean replays. Stock-image initialization is not assumed equivalent to Supabase CLI bootstrap; check roles, attributes, extensions, and managed schemas first.
4. **Refresh the final source/app freeze and checks.** Tie source, migrations, resume draft, verifier versions, and test evidence to the exact candidate. Existing frozen packages do not automatically include later changes.
5. **Plan the remaining staging sequence with the owner.** Reconcile current ledger, schema, grants, data, activity, and backup/restore evidence; finish the reviewed app/enforcement/resume sequence under explicit scope. Keep reservation writes paused throughout the required boundary.
6. **Finish authorization, contention, browser, and production readiness gates.** Record each result and its exact target. Do not equate local tests or artifact creation with release completion.

The create-only manifest is `b65547c453b0bab8a3675ec6b01b64d36c52e9582c8ad5c0b46b645d1254c6dc`. Its real attempt is consumed; do not rerun it. Earlier approvals in saved reports apply to their named operations, not to future execution.

## Verification and acceptance checklist

Local application setup uses `npm ci` and `npm run dev`. Leave both Supabase values blank for demo mode. Use `.env.example`; obtain live browser credentials separately and never put service-role keys or database passwords in frontend variables.

Run these application checks sequentially on the received candidate:

```powershell
npm test
npm run test:coverage
npm run lint
npm run build
node --test --test-concurrency=1 "tests/*.node-test.mjs"
```

`npm test` uses `vitest.harness.config.ts`; private Node-native package tests are excluded and require separate reviewed commands. Keep the existing 80% coverage thresholds. Inspect private tests and their transport mocks before running them; do not substitute package executors for tests. Run `npm audit` before a later commit.

- SQL: run all eight suites under `supabase/tests/database/`, including tenant boundaries, same-club privacy, null-role guards, staff assignment/roster access, table grants, authorization, and rate limits.
- Denials: synthetic second club, forged club/venue IDs, unassigned venue, inactive/missing staff role, member access to peer private records, and public access to private data.
- Allowed paths: own membership/activity, assigned staff operations, club admin management, privacy-safe public schedule and seat counts.
- Concurrency: two independent authenticated connections racing for the same court interval must produce one winner and one conflict. Adjacent intervals and different courts must work; cancellation/release transitions must remain correct.
- Pause/resume: actual denied writes while paused; permitted scoped RPCs only after verified enforcement/resume; direct reservation writes remain denied.
- Browser: member, staff, and admin journeys on phone/desktop, keyboard access, venue switching, stale selection, denied venue access, public TV, and accurate unpaid/unverified labels. Use the repo-local `npx --no-install playwright cli`, not Playwright MCP; close its sessions afterward. Hosted checks need their approved test scope.

Saved resume-preparation evidence reports 435 passing application tests and passing coverage/lint/type/build checks. Later create-only package evidence reports 147 offline tests. These are historical, differently scoped results, not fresh verification of every current file. This documentation task ran no application, SQL, Docker, or browser tests.

Tenancy is ready for handoff completion only when the exact candidate passes the remaining release gates, authorized staging behavior is demonstrated, and the owner accepts the rollout/rollback plan. Real payments, platform tenancy, and production deployment are separate deliverables.

## Documents and private material to transfer

The following links require the original workspace or a separately supplied copy because `docs/` is ignored:

| Record | Why the next developer needs it |
| --- | --- |
| [Tenant rollout](docs/TENANT-READY-ROLLOUT.md) | Migration contracts, write pause, coexistence, cutover and rollback. |
| [Gate evidence](docs/TENANT-READY-GATE-EVIDENCE.md) | Dated evidence for Gates 0–8; read timestamps carefully because older status tables are retained. |
| [Latest local execution](docs/release-private/gate23-retained-create-freeze-20260926-r1/EXECUTION-REPORT.md) | Current recorded local resource identity and create-only limit. Transfer its manifest and pinned dependencies too. |
| [Resume preparation](docs/release-private/reservation-rpc-resume-20260926-r1/) | Resume SQL draft, frozen package, negative checks, and supporting evidence. |
| [Applied pause package](docs/release-private/staging-pause-apply-20260926-r2/) | Consumed staging attempt and postflight evidence. |
| [r9 app candidate](docs/release-private/staging-app-candidate-20260924-r9/) | Exact proposed app artifact and its source/reference pins. |
| [Test harness](tests/test-harness.md) | Sequential application and separate Node test instructions. |

Transfer the modified/untracked `src/`, migrations, verification scripts, tests, package/config changes, and architecture assets after reviewing their scope. Avoid blindly adding the entire working directory. Private release folders can contain backups, credentials, Auth data, or sensitive diagnostics; transfer only the required reviewed packages securely, with credentials handled separately. Do not remove the broad ignore rule merely to share this handoff.

The older `docs/PRD.md`, `docs/ARCHITECTURE.md`, and `docs/ARCHITECTURE-ESSENTIALS.md` describe a pre-tenancy baseline. In particular, current source has safe public schedule reads, scoped QR commands, and an enforcement exclusion constraint, while live checkout is disabled. Use current source plus dated release evidence for implementation/deployment claims.

## Remaining product limits

Live online booking checkout and membership renewal are unavailable. Desk charges and historical transactions are unpaid/unverified until collection is proven; do not present them as collected revenue. Live reminder processing remains a no-op. The QR image uses an external service; current live check-in goes through `check_in_qr`, whose security must be verified through SQL tests. Keep these limits distinct from tenancy completion.

## Handoff review

Documentation-only review: accuracy **4/5** (source and dated reports inspected; runtime state not refreshed), completeness **4/5** (implementation, blockers, tests, and transfer scope covered; private dependencies must accompany the handoff), clarity **4/5** (historical and current recorded states distinguished; release terminology remains detailed), actionability **4/5** (next local step and acceptance checks named; execution scope still needs review), conciseness **4/5** (one document, with linked evidence rather than copied logs). Overall **4.0/5**.

Highest-priority follow-up: securely deliver the referenced packages, then refresh environment state before execution. Self-check: this handoff enables continuation without claiming the release is complete or that old approvals authorize new actions.
