// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { configDefaults } from 'vitest/config'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import config from '../vitest.harness.config'

describe('test runner isolation', () => {
  it('preserves the historical config bytes and explicitly selects the harness in npm', () => {
    const bytes = readFileSync('vitest.config.ts')
    expect(createHash('sha256').update(bytes).digest('hex')).toBe('983104b3b91a265c4b641c5c7e71d69bcead4571379073adf5a960f7f0189512')
    const { scripts } = JSON.parse(readFileSync('package.json', 'utf8'))
    expect(scripts.test).toBe('vitest run --config vitest.harness.config.ts')
    expect(scripts['test:coverage']).toBe('vitest run --config vitest.harness.config.ts --coverage')
  })
  it('retains default discovery but routes private Node suites away from Vitest', () => {
    expect(config.test?.exclude).toEqual(expect.arrayContaining(configDefaults.exclude))
    expect(config.test?.exclude).toContain('docs/release-private/**')
    expect(config.test?.include).toBeUndefined()
  })
  it('runs files sequentially without increasing global timeout or dropping coverage thresholds', () => {
    expect(config.test?.fileParallelism).toBe(false)
    expect(config.test?.testTimeout).toBeUndefined()
    expect(config.test?.coverage?.thresholds).toEqual({ statements: 80, branches: 80, functions: 80, lines: 80 })
  })
})
