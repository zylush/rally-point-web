# Staging capture restore preparation — local-only TDD evidence

Source: the approved fresh staging capture manifest, not a new staging call.
Journey: a release operator can verify the exact captured backup and prepare a
disposable-local restore while an unapproved invocation cannot connect to or
change a database.

| Guarantee | Test/evidence | Result |
| --- | --- | --- |
| Completed capture is immutable and cannot be reused | `tests/staging-pause-backup.test.ts` | 3 PASS |
| Wrong target/version, nonempty Storage, activity, forged history or filenames fail before execution | `tests/staging-pause-restore.test.ts` | PASS |
| All 67 capture hashes are verified without exposing captured rows | `tests/staging-pause-restore.test.ts` and `restore.mjs --verify-local` | PASS |
| Execution without separate approval fails before Docker or DB access | `tests/staging-pause-restore.test.ts` and manual `--execute-approved` without guard | PASS (expected refusal) |
| Disposable restore actually reproduces the logical database | Approved `restore.mjs --execute-approved`; private `result.json` | PASS on 2026-09-25 19:30 UTC |

The pre-existing capture tests were RED (2/2) after the successful capture
because they expected an unused backup folder. They were updated to assert the
terminal captured state, without editing the captured script or manifest.
The restore suite then had a compile-time RED for the missing validator module;
after implementation, targeted tests passed 14/14, then 15/15 after adding
the execution-refusal check. Full `npm test` and `npm run test:coverage`
passed 287/287 after that final refusal test; the final targeted suite
passed 15/15. Coverage was 89% statements, 81.69% branches, 85.71% functions,
and 91.62% lines. `npm run lint`, `npx --no-install tsc --noEmit`, and
`npm run build` passed. No test invoked an approved restore or touched staging.

After this TDD preparation, the owner separately approved one disposable-local
restore. The pinned runner passed 617-row fingerprint, 54-table data, 1,304-
entry catalog, 13-version migration/grants, two-sequence, 16-check ownership,
and rollback-only signup comparisons. Private result SHA-256:
`E9C1717958F20899FF4DCD4D2D773B56061A57C94FDC974CE2BBA4F7F9172FA4`.
The first post-restore targeted run was RED (1/15) only because an old test
asserted that `result.json` must not exist. The test now verifies a refused
unauthorized execution leaves the existing PASS result hash unchanged;
targeted tests passed 15/15, then full `npm test` passed 287/287. Lint,
typecheck, and build also passed after the test correction.
Hosted service recovery and off-machine retention remain unverified. No Git
checkpoint commits were made because the release owner explicitly prohibited
commits.
