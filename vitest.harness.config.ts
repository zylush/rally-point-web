import { configDefaults, defineConfig } from 'vitest/config'
import base from './vitest.config.ts'

// Keep the historical base config and its provenance assertion unchanged.
// Private node:test suites run separately using Node's native test runner.
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    exclude: [...configDefaults.exclude, 'docs/release-private/**'],
    // Avoid competing filesystem-heavy frozen-input verification workers.
    fileParallelism: false,
  },
})
