# Restore catalog verifier regression evidence

Scope: local verifier preparation after the approved restore stopped. No database repair or second retry was executed.

## RED

`tests/restore-catalog-checks.test.ts` initially produced five failures and three passes against the Map-based comparator and absent default-ACL generator. Failures reproduced discarded duplicate catalog keys and missing permission recovery.

The read-only `check_catalog_query_readonly.mjs --old` probe against `rally_r8_backup_retry_20260923` failed its text-identity assertion. Observed: 1,289 objects, 1,285 unique identifiers, identity type `name`, maximum identifier length 63.

## GREEN

Eight focused regressions pass. They cover duplicate expected and actual keys, distinct long constraint names, changes to column order/nullability/ACLs, missing constraints, three scoped default-ACL groups, grant options/PUBLIC, invalid grantors/grantees/privileges, and exclusion of unrelated owner groups.

The same read-only probe with `--corrected` passes: 1,289 objects and unique identifiers, type `text`, maximum length 317. The new SQL ranks nondropped columns in live order instead of comparing physical slot numbers. The restored local Auth secret column has logical position 2. A corrected source-side snapshot is still needed; this local probe does not establish source/restore equivalence.

File-only generation from the captured catalog accounts for three groups and 48 grants. Proposed SQL SHA-256: `2e519272cb1363ed90bb28f2a44c58c4d829a9653c55573f54a0adf4f940dcd9`. Nothing was applied.

Full verification: 207 tests in 25 files pass; coverage is 90.59% statements, 81.19% branches, 87.08% functions, 93.08% lines. Lint and TypeScript checks pass. The frozen r8 verifier passes 45 package files, 88 source files and 16 historical backup hashes. No app rebuild or browser rerun was needed for these non-app helper/query additions; this is not a new hosted acceptance result.
