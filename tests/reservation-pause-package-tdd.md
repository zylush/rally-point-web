# Reservation pause package — local TDD evidence

Source: owner-selected technically enforced reservation-write pause. This
package is a local preparation step, not approval to contact or change staging.

Journey: as the release operator, I need a migration directory containing
exactly the 13 staging-applied versions and the pause SQL, so a later reviewed
dry run cannot silently include deferred enforcement.

| Guarantee | Check | Result |
| --- | --- | --- |
| Exact 13-applied-plus-pause inventory accepted | `tests/reservation-pause-package.test.ts` | PASS |
| Missing, duplicate, extra, or enforcement SQL rejected | same, six negative cases | PASS |
| Plan marks database contact and staging application false | same, pure plan assertion | PASS |
| Private package bytes, source hashes, and file inventory match | `node scripts/reservation-pause-package.mjs --verify` | PASS; 18 files |

RED: with an unimplemented inventory helper, the targeted Vitest run executed
eight tests and failed the intended accepted-inventory and plan assertions
(two failures). A later portability regression test failed because
`makePausePlan` was missing (one failure). GREEN: the same targeted suite now
passes 8/8. No TDD checkpoint commits were made because this release goal
forbids commits without separate approval.

Full repository checks after the initial implementation: 254/254 tests,
lint, TypeScript, and build passed. Coverage: 88.71% statements, 81.29%
branches, 85.44% functions, 91.33% lines overall. The package-builder file
itself has lower line coverage because its private-source verification and
copying paths are exercised by the separate local `--prepare`/`--verify`
commands, not by portable unit tests. A clean checkout lacks ignored private
r8 evidence; unit tests therefore exercise pure inventory/plan behavior and
do not depend on that evidence. No staging CLI dry run or hosted check has run.
