// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const parents: string[] = []
const load = () => import('../scripts/reservation-resume-package.mjs')
afterEach(() => {
  for (const path of parents.splice(0)) {
    if (!path.startsWith(join(resolve('.'), 'docs/release-private/resume-package-test-'))) throw new Error('Unsafe cleanup')
    rmSync(path, { recursive: true, force: true })
  }
})

describe.sequential('local-only resume verification package', () => {
  it('freezes all 16 SQL files, every existing suite, seed and guard checks without a DB transport', async () => {
    const { prepareResumePackage, verifyResumePackage } = await load()
    const parent = mkdtempSync(join(resolve('.'), 'docs/release-private/resume-package-test-'))
    parents.push(parent)
    const directory = join(parent, 'frozen')
    const result = prepareResumePackage(directory)
    expect(result.databaseContacted).toBe(false)
    expect(result.migrationCount).toBe(16)
    expect(result.sqlSuiteCount).toBe(8)
    expect(result.rehearsalExecuted).toBe(false)
    expect(verifyResumePackage(directory)).toEqual(result)
    const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'))
    expect(manifest.productionOrStagingExecutable).toBe(false)
    expect(manifest.readyProofIncluded).toBe(false)
    expect(manifest.orders).toHaveLength(2)
    expect(manifest.gate3.cleanReplaysRequired).toBe(2)
    expect(manifest.files.filter((r: { path: string }) => r.path.startsWith('database/supabase/migrations/'))).toHaveLength(16)
    expect(manifest.files.filter((r: { path: string }) => /\.test\.[cm]?[jt]sx?$/.test(r.path))).toEqual([])
    expect(() => prepareResumePackage(directory)).toThrow(/overwrite/)
    writeFileSync(join(directory, 'unexpected.txt'), 'not authorized')
    expect(() => verifyResumePackage(directory)).toThrow()
  }, 20000)

  it('rejects changed package files and unsafe output locations', async () => {
    const { prepareResumePackage, verifyResumePackage } = await load()
    expect(() => prepareResumePackage(resolve('dist'))).toThrow()
    const parent = mkdtempSync(join(resolve('.'), 'docs/release-private/resume-package-test-'))
    parents.push(parent)
    const directory = join(parent, 'frozen')
    prepareResumePackage(directory)
    writeFileSync(join(directory, 'checks/reservation_resume_state.sql'), 'select true;')
    expect(() => verifyResumePackage(directory)).toThrow()
  }, 20000)

  it('prepares negative tests for missing proof, wrong role, stale binding and absent enforcement', async () => {
    const { resumeNegativeSql, resumeRunPlan } = await load()
    const sql = resumeNegativeSql('do $draft$ begin raise exception \'dummy\'; end $draft$;')
    expect(sql).toContain('extensions.is(pg_temp.resume_attempt(')
    expect(sql).toContain('exception when others then')
    expect(sql).not.toContain('rollback to savepoint')
    expect(sql).toContain('rollback;')
    const plan = resumeRunPlan()
    expect(plan.probeTargetsAreDisposableOnly).toBe(true)
    expect(plan.targetWritesUntilProof).toBe('blocked')
    expect(plan.requiredNegativeCases).toContain('wrong-exclusion-definition')
    expect(plan.requiredNegativeCases).toContain('direct-column-grant')
    expect(plan.requiredNegativeCases).toContain('stale-transaction')
    expect(plan.requiredNegativeCases).toContain('missing-enforcement')
    expect(plan.requiredPostflight).toContain('only-nine-authenticated-execute-grants-and-ledger-entry')
    expect(plan.requiredPostflight).toContain('both-sequences-and-unrelated-data-unchanged')
    expect(plan.stagingResumeAuthorized).toBe(false)
  })
})
