# Gate 2 client-coexistence verifier — local preparation, 2026-09-25

Source: the tenant-ready release goal, Gate 2's requirement that the legacy app
work after expansion and the r9 app work before enforcement. This preparation
does not itself pass Gate 2 or authorize database execution.

| Journey | Prepared SQL contract | Status |
| --- | --- | --- |
| A legacy member books and staff/admin continue direct operations after expand/backfill | `supabase/verification/gate2_legacy_client.sql`: 12 planned assertions for grants, direct booking/rental/charge/court/member paths, and the nullable ownership/allocation gap requiring final backfill and old-writer drain | Prepared; not run against PostgreSQL |
| r9 staff/member/admin use repaired pre-enforcement surfaces | `supabase/verification/gate2_r9_client.sql`: 13 planned assertions for role and limited roster, unpaid desk reservation, allocation/safe schedule, seat-count projection, cancellation/release, member self-view, venue management and provisioned-staff grant | Prepared; not run against PostgreSQL |

The runner is pinned to `127.0.0.1:54322/postgres`, requires an explicit
`RALLY_GATE2_LOCAL_COMPATIBILITY=rollback-only-approved` guard, a new private
report name, and a local password supplied at execution time. It checks the
exact eight-version ledger, no other client backends, no enforcement constraint,
the previously verified 604-row fingerprint marker
`84b7d8e1718ce03e130af200b62def46`, and 52-row content inventory. The
forward repairs must match their frozen SHA-256 values. Each suite runs in its
own transaction with rollback; postflight compares schema, effective grants,
metadata, migration history, and application/Auth/Storage inventory before
writing a report exclusively. `--prepare` only reads local source files and
never connects to a database.

RED/GREEN: the first Node run failed because the guard module did not exist;
after its implementation, four tests passed. The prepare-mode test then failed
because the runner did not exist; after the runner and SQL suites were added,
the suite passed. A third compile-time RED for the pinned-fingerprint check
became GREEN after adding that guard. Final offline command
`node --test tests/gate2-client-coexistence.node-test.mjs` passed 7/7,
including refusal of `--run` without the approval guard.

Offline verification: `node --check` on both JavaScript modules passed;
`node supabase/verification/verify_gate2_client_coexistence.mjs --prepare`
reported two suites and five pinned repairs without database contact.
`npm test` passed 240/240, `npm run test:coverage` passed its configured
thresholds (91.04% statements, 81.55% branches, 87.8% functions, 93.82%
lines), and lint, TypeScript check, build, frozen r9 verifier, isolated Gate 3
package guard, and `git diff --check` passed. Node's focused coverage reported
100% line and 80% branch coverage for the guard helper; the overall new
verifier is only 63.38% line coverage because the database-backed `--run`
branch is deliberately unexecuted. No checkpoint commit was made because the
owner prohibited commits.

Pinned local preparation SHA-256: legacy SQL
`0CA9434C85FDB8A651E8EDEE1B044DD8125A64F0CBDAD1ADE545C2F7669A22F6`,
r9 SQL `E46AED6384D81F7449DD644F7710F57A70381A34B349DFA39079572FCC260D67`,
runner `2F0B89CF43A37DD8882DC14A1F041A8E86FF3C26780885582972C2A03A599240`,
guard module `D02DE7FE632426DFC314B27ACDE8B96EA369EF552F35EA8A9805D290E2ABF14C`.
The prior Gate 2 retry report and 09:16 STOP retained their recorded hashes.

Known gaps: SQL syntax and behavior inside PostgreSQL are unverified until the
separate local rollback-only approval is granted. These representative SQL
contracts are not an actual old-client or r9 browser journey; app-level and
staging acceptance remain open. No Gate 3 replay, staging/Pages call, new Auth
account, migration, deployment, enforcement, commit, push, or production work
occurred in this preparation.

## Handoff self-evaluation

Overall 4.0/5. Accuracy 4/5: offline guards and app checks passed, but neither
SQL suite has been parsed or exercised by PostgreSQL; the next approved run
must supply that evidence. Completeness 4/5: representative legacy and r9
contracts are prepared, but they cannot substitute for full client/browser
acceptance. Clarity 4/5: the report separates preparation from gate passage;
the gate ledger's older timestamped STOP entries require reading the latest
entry first. Actionability 4/5: fixed-target `--prepare` and guarded `--run`
exist, but owner approval is still required before transactions. Conciseness
4/5: the detailed evidence is useful for audit but longer than the user-facing
handoff. No critical axis. Highest-impact improvements: run and reconcile the
two SQL suites after approval, then test the actual client journeys. Self-check:
the owner should agree because no unexecuted database or hosted behavior is
reported as passing. Verdict: deliver local preparation, keep Gate 2 open.
