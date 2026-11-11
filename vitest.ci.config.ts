import { defineConfig } from 'vitest/config'
import harness from './vitest.harness.config.ts'

// Config for GitHub Actions (.github/workflows/ci.yml). It runs the same suites
// as `npm test` except the ones below, which cannot pass on a fresh clone.
// They still run locally, where the private files exist (pre-push runs `npm test`).
const localOnly = [
  // Read or write the owner's local-only release evidence in docs/release-private/.
  'tests/club-platform-package.test.ts',
  'tests/r9-app-candidate.test.ts',
  'tests/r9-readonly-compare.test.ts',
  'tests/reservation-pause-r2-parser.test.ts',
  'tests/reservation-pause-r2-runtime.test.ts',
  'tests/reservation-pause-staging-runner.test.ts',
  'tests/reservation-pause-staging-runtime.test.ts',
  'tests/reservation-resume-package.test.ts',
  'tests/reservation-resume.test.ts',
  'tests/staging-pause-backup.test.ts',
  'tests/staging-pause-restore.test.ts',
  // Pins the hash of vitest.config.ts as stored in the owner's working copy,
  // whose line endings differ from what a fresh checkout produces.
  'tests/test-harness.test.ts',
]

export default defineConfig({
  ...harness,
  test: {
    ...harness.test,
    exclude: [...(harness.test?.exclude ?? []), ...localOnly],
  },
})
