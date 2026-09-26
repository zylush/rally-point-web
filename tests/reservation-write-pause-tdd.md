# Reservation-write pause: local TDD evidence (2026-09-25)

Scope: owner chose a technically enforced reservation-write pause through
verified enforcement. This work prepared only local files. No database SQL was
applied, no staging/hosted call was made, and no commit or push was made.

| Guarantee | RED evidence | GREEN evidence | Limit |
| --- | --- | --- | --- |
| Pause migration covers six reservation/availability tables without revoking SELECT | Focused Vitest run failed 3/3 when the migration did not exist; later failed when broader table privileges were absent | `npm test -- tests/reservation-write-pause.test.ts`: 3/3 | Static source contract, not a database denied-write test |
| Pause migration covers nine reservation-changing RPC signatures | Initial missing-file RED; later focused run failed when service-role revocation was absent | Same focused run: 3/3 | Function grant effectiveness still needs rollback-only SQL and a hosted postflight |
| Missing objects or inherited/column privileges stop the pause | Initial missing-file RED; read-only local audit exposed existing direct/RPC rights, then broader table rights | Static test: 3/3; SELECT-only `reservation_write_pause_readonly.sql` ran without SQL errors | Migration `DO` statement has not been executed |

The SELECT-only local audit ran against `supabase_db_rally-point-web` at its
eight-version expanded/backfilled state. It reported authenticated reservation
DML/RPC access still present, and `cancel_booking_reservation(uuid)` missing
there because the forward repair is not applied outside rollback-only tests.
This is expected pre-pause evidence, not a failed applied pause. The audit must
show zero `violation=true` rows after any authorized pause and after enforcement.

The guarded verifier's `--prepare` path passed without a database connection;
three additional tests prove prepare-only output and refusal of unapproved or
invalid `--run` input. The verifier's two rollback-only SQL orders have not run.

`npm test`: 246/246. `npm run test:coverage`: 246/246, 91.08% statements,
81.55% branches, 87.95% functions, 93.82% lines. Lint and build passed.
No checkpoint commits were made because the goal forbids commits without
explicit approval.

Remaining: test the migration in a disposable/rollback-only local database
with all forward repairs present; prove actual denied table/RPC calls and
preserved reads; verify both pause-before-enforcement and
enforcement-before-pause orders, final data/ACL fingerprints, and a later
scoped-RPC-only resume migration. Refresh Gate 0/3 packages. Staging application
requires a separate exact-target, backup, dry-run, and mutation approval.
