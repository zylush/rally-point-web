# Staging pause runner preparation — STOP, local only

Date: 2026-09-26. Source: Gates 0–8 objective and approved technical
reservation-write-pause path. No new staging authority was inferred.

## Implemented scope

The entry point is `scripts/run-reservation-pause-staging-apply.mjs`.
Filesystem provenance is in `reservation-pause-runner-files.mjs`, execution
in `reservation-pause-staging-runtime.mjs`, and sequencing in
`reservation-pause-staging-flow.mjs`.

The intended operator journey is: verify immutable inputs; exclusively claim
one attempt in a new private evidence folder; isolate exactly 13 applied
migrations plus the pause; recheck target/version/baseline; require a
pause-only dry run; recheck baseline and local pins; record the application
attempt; apply once; run two read-only postflight snapshots. No automatic
retry, permission restoration, enforcement, sign-in, or deployment exists.
Approval and closed-session confirmation are checked at both the command
entry and internal begin method. A separately approved manifest digest is
required. An ambiguous push failure stops without subsequent queries.

The capture's 67 files, restored-backup result, successful rollback rehearsal,
prior STOP, pause package, imported source closure, and CLI binary are pinned.
Only the captured linked-project cache is allowed alongside project-ref;
changed ownership metadata or extra operator/query files stop execution.
Raw CLI output stays in private evidence and is not printed by the entry point.

## TDD evidence

| Behavior | RED evidence | GREEN evidence |
| --- | --- | --- |
| Filesystem/CLI adapter | Runtime test import failed because implementation was missing | Initial 11 tests passed |
| Captured CLI cache compatibility | Cache regression failed with `Isolated operator file inventory changed` | 13 tests passed after exact captured-cache allowance |
| Internal start requires approval | Direct begin with empty approval env unexpectedly resolved | Focused approval test passed after guard |
| Full modeled application sequence | Prior flow tests cover no-approval, phase failure, drift, ambiguous application, and postflight failure | 15 runtime tests passed, including fake CLI with the real 54-table/1304-object/66-audit postflight |

Tests are in `reservation-pause-staging-runtime.test.ts` and
`reservation-pause-staging-runner.test.ts`; the existing pure readiness and
postflight tests remain relevant. No checkpoint commits were made because
commits are prohibited.

## Commands and results

- `npm test`: **PASS**, 336 tests / 40 files, 32.29 seconds.
- `npm run lint`: **PASS** after removing one unused import.
- `npx --no-install tsc --noEmit`: **PASS**.
- `npm run build`: **PASS**. Ordinary local `dist` only; no publication.
- `git diff --check`: **PASS** for tracked changes at the checked checkpoint;
  existing line-ending warnings remained. It does not cover untracked files.
- Earlier four-file focused coverage: 37 tests passed but the command failed
  aggregate coverage thresholds (78.62% statements, 71.11% functions). It
  included unexercised existing helper entry points; this was not a passing
  coverage result. Further local tests were added before the full run.
- Final `npm run test:coverage`: **STOP**, 335 passed / 1 failed. The isolation
  integration test at runtime test line 85 exceeded its 5000ms timeout; the
  reporter recorded 12748ms for that test. No final coverage pass is claimed.

Private STOP and output excerpt:
`docs/release-private/staging-pause-runner-preparation-20260926-r1/`.
The default runner package was **not prepared or frozen**, and coverage was
not retried after the STOP. Earlier STOPs and frozen r8/r9 packages were not
edited. No staging, Pages, database, deployment, enforcement, or Git write ran.
Only local CLI version/help commands ran with the required telemetry-file
permission after an initial sandbox permission error; version was 2.110.0.

## Limits and next action

The fake CLI proves sequencing and parser integration, not hosted behavior.
The modeled postflight is not a database migration rehearsal. The separately
recorded successful rollback-only rehearsal remains the actual local SQL
evidence. New history rows are checked for version/name/nonempty statements;
older rows must be identical. The runner does not byte-compare CLI-split new
statements, but pins the input SQL and checks the resulting catalog delta.
Activity snapshots cannot exclude every transient or idle client. Owner
confirmation remains required, and staging stays paused.

Obtain local-only recovery approval to investigate file-hashing and test
scheduling costs, correct the integration test budget/isolation without
weakening production pins, then rerun tests and coverage sequentially. Do not
freeze or request staging application until every local check passes.
Any later staging operation requires a new explicit approval.

CLI behavior was checked against local 2.110.0 `db query --help` and
`db push --help`, plus the official
[db push reference](https://supabase.com/docs/reference/cli/supabase-db-push).
Only public documentation was browsed; staging and Pages were not contacted.
