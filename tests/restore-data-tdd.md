# Restore data preflight: RED/GREEN evidence

2026-09-23. Derived from Gate 5's failed fresh-backup restore. The default dump included Auth/Storage rows, and the managed dump loaded them again. Preserve the capture and original failed script; prepare a corrected local retry without connecting to a database.

User guarantee: each captured table is restored once, overlapping evidence agrees, and omissions/conflicts fail before CREATE DATABASE.

- RED: `npm test -- tests/restore-data-checks.test.ts`, 10/10 failed against the extracted old four-file input plan (which included both default and managed data).
- GREEN: same command, 10/10 passed after adding `scripts/restore-data-checks.mjs` validation and selecting default data, CLI history, and managed migration supplement only.
- Regressions cover duplicate COPY blocks, overlapping history inputs, conflicting managed values/column order without row disclosure, missing managed data, missing table coverage, row-count mismatch, truncated/unsupported dumps, duplicate/missing managed history, and equivalent line endings/row order.
- `npm run test:coverage`: 199/199 tests in 24 files pass; statements 90.34%, branches 81.07%, functions 86.66%, lines 92.95%. All configured thresholds pass.
- Lint, TypeScript, and whitespace checks pass. R8's frozen package verifier still passes. No UI/build input changed; no browser replay or replacement app build was needed.
- Actual captured files: `restore_retry.mjs --prepare-only` passed all 65 capture hashes, the pinned capture-manifest hash, overlapping COPY columns/row digests, complete 54-table coverage/counts, and managed-history SQL equality. It returned exactly `data.sql`, `history_data.sql`, `managed_migration_data.sql` and `databaseConnected: false`.

The parser intentionally accepts only this dump's simple schema/table identifiers and COPY format. It is not a general SQL parser. The actual restore, catalog/ACL/data comparison, and signup probe remain unexecuted pending renewed retry direction after the owner's stop-on-failure instruction. No commit was made: the owner's prohibition takes precedence over the skill's checkpoint-commit guidance.
