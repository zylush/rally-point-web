# Restored-local reservation-pause rehearsal preparation — TDD evidence

Source: tenant-ready Gate 2 contract in the owner-provided release goal and `docs/TENANT-READY-ROLLOUT.md`. This checkpoint prepares a rollback-only local test of the frozen pause; it does not apply a migration.

Journey: As the release operator, I need to prove the pause denies reservation writers on the verified disposable restore and leaves it unchanged after rollback, before requesting any staging write.

| Guarantee | RED evidence | GREEN evidence |
| --- | --- | --- |
| Postflight allows only an expected migration-ledger INSERT counter while rejecting operational writes | `npx vitest run tests/reservation-pause-postflight.test.ts`: 2 failures from the old exact-counter comparison | Same command: 7/7 pass |
| A local rehearsal requires an exact approval guard, target, read-only query wrapper, and unchanged rollback state | `npx vitest run tests/reservation-pause-local-rehearsal.test.ts`: import failed because the new guard module did not exist | Both targeted files: 13/13 pass |
| Local credential handoff refuses absent or malformed passwords without echoing them | Targeted test failed because the validator was not implemented | Targeted test passed; container variable presence checked without reading its value |
| PostgreSQL `bigint` inventory counts normalize only when safe nonnegative integers | Targeted test failed because the normalizer was not implemented | Targeted test passed; no database query was needed |
| Read-only local active-client count accepts node-postgres string `"0"` but rejects malformed counts | First read-only local run STOP: strict numeric assertion received string `"0"`; new targeted test failed before the normalizer existed | Targeted tests 15/15 pass; no database retry after the STOP |
| Preparation never connects to a database | New runner `--verify-local` returned `LOCAL_READY_APPROVAL_REQUIRED`, `databaseContacted:false`, `stagingContacted:false` | No database action in this checkpoint |
| Unauthorized execution is refused | Runner `--execute-approved` without the guard exited 1 before creating evidence or connecting | Expected refusal, not an execution pass |

Serial `npm test` and `npm run test:coverage` passed 302/302. Coverage: 89.65% statements, 82.26% branches, 86.49% functions, 92.14% lines. Lint, TypeScript, and build passed. A parallel test-and-coverage run had UI timeouts and an input assertion failure under load; the serial reruns passed without changing those UI tests. No commit checkpoint was made because owner authorization forbids commits and pushes.

Known gap: the corrected read-only mode has not been rerun after its preserved STOP. The guarded execution path has not run against the restored database. Its actual SQL, denied-write attempts, in-transaction postflight, and rollback integrity remain to be verified under a separate local-only approval. No staging conclusion follows from these unit tests.
