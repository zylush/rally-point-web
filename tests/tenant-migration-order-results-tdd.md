# Gate 2 verifier result-shape correction — local TDD evidence

Source: tenant-ready Gate 2 goal and the preserved
`docs/release-private/gate2-rehearsal-stop-20260925.md` (STOP SHA-256
`EEA06DA3B7FE340DAF8B79AC7AED9AB8E3719B0FE940D9FF7B0BF98A19226CAC`).
The operator needs the rollback-only migration-order verifier to compare a
real schema fingerprint and content inventory, not silently compare
`undefined` after a multi-statement `SET; SELECT` query.

RED: `node --test tests/tenant-migration-order-results.node-test.mjs`
exited 1 with `ERR_MODULE_NOT_FOUND` for the new result-shape helper.
The prior approved runtime rehearsal had already reproduced the actual
`state.schema.find` TypeError. No database-changing test was rerun in this
correction.

GREEN: `node --experimental-test-coverage --test
tests/tenant-migration-order-results.node-test.mjs` passed 6/6 tests with
100% line, branch, and function coverage for `pg-query-rows.mjs`.
The helper accepts one SELECT or SET followed by SELECT, requires exactly
one fingerprint marker for a snapshot, and rejects missing rows, wrong final
commands, and unexpected leading SELECTs. The verifier now uses this helper
for schema, grants, metadata, and both content-inventory comparisons.

A separate **read-only** local `pg` query against `127.0.0.1:54322` confirmed
that `schema_fingerprint.sql` returns an array, that the helper extracts
604 canonical rows with marker `84b7d8e1718ce03e130af200b62def46`,
and that `backup_content_inventory.sql` returns 52 inventory rows. The
transaction ended with `ROLLBACK`; it applied no migrations.

Wider checks: `npm test` passed 240/240; `npm run lint`,
`npx --no-install tsc --noEmit`, `npm run build`, both script syntax checks,
and `git diff --check` passed. `prepare-r9-app-candidate.mjs --verify`
still passes for 20 frozen app files and 105 source/reference hashes.
No dependencies or publishable app bytes changed. No commit or push was made
because the owner has not authorized either.

The corrected verifier script SHA-256 is
`B8E03A5F2FD2025AA4F8E3B3B3EDF53CE315E0A6DF91808E2B72B7A5CBE00710`.
This validates the local code path, **not** the two SQL migration orders or
the full postflight content comparison. Gate 2 remains STOP/incomplete;
Gate 3 remains unrun. A new explicit approval is required before another
rollback-only database rehearsal or disposable reset.
