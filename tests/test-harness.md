# Local test runners

`npm test` and `npm run test:coverage` select `vitest.harness.config.ts`.
It extends the historical, byte-preserved `vitest.config.ts`, retains its
80% thresholds and default timeout, and runs files sequentially. Do not update
the historical config hash assertion to accommodate harness changes.

Private release packages contain Node-native tests, not Vitest suites. They
are excluded only from Vitest discovery and must be run independently:

```powershell
node --test --test-concurrency=1 "tests/*.node-test.mjs"
node --test --test-concurrency=1 "docs/release-private/*/*.test.mjs"
```

Review the selected private suites and their transport mocks before running
them under a local-only approval. These globs do not authorize Docker, database,
network or deployment actions. Do not run package executors in place of tests.
Run each verification command to completion before starting the next.

The fake-CLI status/version cases remain independent tests with the existing
five-second per-case timeout; complete frozen-input hashing and safety checks
remain enabled. The longer existing end-to-end filesystem journeys retain
their original bounded budgets.

On Windows, pass expanded explicit file paths to focused oxlint rather than
a wildcard that the executable may not expand. A no-files result is not a
lint pass. Preserve earlier STOP records; store subsequent results separately.
