# Staging pause-apply guard — local TDD evidence

The release-gate objective requires the reservation-write pause to be the sole
pending staging migration, applied only after exact target, backup, and baseline
checks. This checkpoint implements a pure local readiness guard. It does not
provide an executable staging apply runner or authorize hosted contact.

User journey: as the release operator, I want stale, mismatched, or expanded
migration evidence rejected before an apply command can be constructed.

| Guarantee | Test | Result |
| --- | --- | --- |
| A distinct staging-pause approval guard is required | `tests/reservation-pause-staging-apply.test.ts` | PASS |
| Capture, verified restore, sole dry run, exact 13-version baseline, and pinned package are required | Same file | PASS |
| Wrong project, migrated history, Storage objects, active clients, writes, and mismatched hashes are rejected | Same file | PASS |
| Evidence must be ordered and the dry run/baseline no older than 15 minutes | Same file | PASS |
| Built CLI arguments target the linked isolated workdir without `--include-all`, seed, or roles | Same file | PASS |

RED: `npm test -- tests/reservation-pause-staging-apply.test.ts` failed because
the guard module was absent. A second RED run failed on newly required backup
reference/package pins. GREEN: the same target passed 5/5 after each fix.
No TDD commits were made because the owner prohibited commits.

After the final change, `npm test` and `npm run test:coverage` passed 307/307.
Overall measured coverage: 89.84% statements, 82.44% branches, 86.43%
functions, 92.35% lines. The new guard measured 100% on all four axes.
`npm run lint`, `npx --no-install tsc --noEmit`, and `npm run build` passed.

Known gap: the guard does not read evidence files, compare full current
snapshots, execute `db push`, or run hosted postflight. A separately tested
operator runner and explicit staging approval are still required. No staging,
Pages, or local database call was made for this guard.
