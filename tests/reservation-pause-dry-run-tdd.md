# Reservation pause dry-run output check

Source: the owner-selected write-pause release path and the saved successful
Supabase CLI privacy-repair dry run. This parser examines captured output only;
it neither invokes the CLI nor contacts a database.

Journey: as the release operator, I need the next approved staging dry run to
list exactly the pause migration, with no enforcement, seed, or role change.

RED: the targeted suite executed 14 tests and failed the intended successful
single-pause case while the verifier was unimplemented. The first
implementation still failed that case because CLI ANSI styling prevented the
filename match. GREEN: after stripping ANSI styling for comparison, the
targeted suite passed 14/14.

| Guarantee | Test | Result |
| --- | --- | --- |
| JSON and human CLI output agree on the sole pause migration | `tests/reservation-pause-dry-run.test.ts` | PASS |
| Nonzero exit, absent/duplicate/extra migrations, seeds, roles, and non-dry-run output fail | same, 12 negative cases | PASS |
| Malformed output errors do not echo raw content | same | PASS |

The fixture shape was adapted from the private Sep 23 CLI output; no new
hosted call was made. This check does not establish the project target, CLI
arguments/version, staging migration history, baseline/backup integrity,
active-client state, or postflight immutability. Those remain independent
read-only gates. No checkpoint commit was made because this release goal
requires separate commit approval.

The initial full-suite attempt ran ordinary tests and coverage together and
failed in unrelated UI timeouts/assertions. Re-running the two suites serially
passed 268/268 each; coverage was 88.84% statements, 81.50% branches,
85.75% functions, and 91.44% lines. This does not erase the failed attempt.
