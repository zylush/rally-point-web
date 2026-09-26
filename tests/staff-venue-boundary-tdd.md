# Staff venue boundary — local diagnostic and fix (2026-09-24)

Source: Gate 5 browser STOP at 09:29:02 UTC, `Staff sees another venue`. The saved venues GET returned only the assigned fixture venue, but the combined UI assertion did not record whether it saw `Court A` or an extra venue option. The preserved STOP SHA-256 is `335ea14df0261efc4d3c35b747b6b545d0401b1842b7491a198b4bc3bea8b823`.

Journey: a staff member must see and operate only assigned-venue courts and sessions. If venue discovery is pending, empty, or fails, operational reads and writes must not fall back to an unscoped venue. Switching venues must not display a delayed response from the previous selection.

Local trace: `StaffCourts` and `StaffHome` previously called `api.listCourts()`, `api.playingSessions()`, or `api.recentCheckins()` with no venue while `useStaffVenues` was pending. The live adapter omits the venue filter in that case. The compatibility-phase legacy `courts_read_auth` policy permits authenticated court reads, so that initial request can expose another venue in the UI. `StaffCheckIn` likewise permitted a command without a venue. This is a reproducible local defect that can explain the STOP; the saved browser evidence does not prove which assertion operand fired.

| Guarantee | RED evidence | GREEN evidence |
| --- | --- | --- |
| No court/session read before assignment | New `staff-venue-boundary.test.tsx`: `listCourts()` called once without args | Six boundary tests pass; reads use assigned venue ID |
| No home session/check-in read before assignment | New test: `playingSessions()` called once without args | Home reads wait for venue ID |
| No check-in without venue | New test: QR button enabled while venue unresolved | Button disabled until venue; command includes venue ID |
| Old venue response cannot replace new venue | Added delayed-response test | Stale result ignored after venue switch |
| No assignment or venue-load failure fails closed | Added tests | No operational read or command fallback; visible status |

Validation: `npm test` 213/213 passed; `npm run test:coverage` 213/213 passed (90.68% statements, 81.85% branches, 87.34% functions, 93.52% lines); `npm run lint`, `npx --no-install tsc --noEmit`, `npm run build`, and `npm audit --audit-level=high` passed (0 vulnerabilities). `git diff --check` passed with only CRLF conversion warnings.

Not verified: no authorized hosted/browser rerun was performed. The staging-mode build was attempted into a separate candidate directory but stopped at Vite validation because this shell lacks `VITE_SUPABASE_ANON_KEY`; no candidate staging artifact was written. The previously frozen r8 artifact remains the hosted build and does not include this local fix. Gate 5 stays STOP; Gate 6 denial/concurrency and Gate 7 browser acceptance are not passed by these unit tests. No commits, pushes, database writes, or deployment were made.

## Follow-up: limited staff roster and read failures

The staff member directory still called `api.listMembers()`, which selects the admin-only `member_admin` view. The database's `member_roster` view instead projects member code, name, membership type, status, and dates without contact or QR fields. The staff page now calls `api.memberRoster()` exclusively, searches name/code only, and shows a failure instead of an indefinite loader. Check-in and court operations no longer have an admin-view fallback. Failed live-floor, court, and check-in roster reads now show an error; failed court reads clear operational data and disable rental.

RED: the new limited-roster test failed because `Roster Member` was absent; the new roster-error test failed because the error was absent. Three additional read-failure tests failed, with unhandled rejections for court and check-in roster reads. GREEN: `npm test -- src/pages/staff.test.tsx src/pages/staff-venue-boundary.test.tsx` passed 33/33 tests.

Local verification after this follow-up: `npm test` passed 218/218; `npm run test:coverage` passed with 90.78% statements, 81.54% branches, 87.78% functions, and 93.6% lines; `npm run lint`, `npx --no-install tsc --noEmit`, `npm run build`, and `git diff --check` passed. `npm audit` was not rerun because dependencies did not change. No staging-mode candidate or browser check ran; frozen r8 and all STOP evidence remain unchanged. These local results do not clear Gate 5.

The database test `supabase/tests/database/tenant_boundary.test.sql` now asserts the roster's exact eight-column projection, denies the admin member view to staff, and excludes a foreign-club member from the roster. It passed 38/38 pgTAP assertions in each independent disposable replay, `rally_gate3_replay7_20260923` and `rally_gate3_replay3_20260923`. Both runs ended in `ROLLBACK`; post-run checks showed zero persisted staff-role/grant fixture rows and the original 13 migration-history entries. `git diff --check` passed for the edited SQL file. This is local post-enforcement evidence, not staging pre-enforcement or browser evidence.

The new rollback-only `supabase/tests/database/staff_roster_coexistence.test.sql` covers the compatibility phase directly: authenticated view grant, exact approved columns, same-club staff lookup, foreign-club denial, admin-view denial, member denial, and anonymous denial. It passed 7/7 assertions on the local expanded-and-backfilled `postgres` database (eight migrations, no enforcement) and 7/7 on both 13-migration enforced replays. The pre-enforcement postflight showed zero persisted synthetic Auth users, staff roles, or venue grants and unchanged migration count. This does not substitute for staging verification or a complete rerun of every database suite after a new release candidate is frozen.
