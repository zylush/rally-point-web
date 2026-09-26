// @vitest-environment node
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { extractPinnedPublishableKey, verifyFileInventory } from '../scripts/r9-app-candidate-checks.mjs'

const project = 'iclrvvsiwypxlwrwgqia'
const key = 'sb_publishable_test-only'
const bundle = `https://${project}.supabase.co ${key}`
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

describe('r9 candidate local-only guards', () => {
  it('verifies the frozen candidate after the source tree gains a later pause migration', () => {
    const root = fileURLToPath(new URL('../', import.meta.url))
    const run = spawnSync(process.execPath,
      ['scripts/prepare-r9-app-candidate.mjs', '--verify-frozen'],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    expect(run.status, run.stderr).toBe(0)
    const result = JSON.parse(run.stdout)
    expect(result).toMatchObject({
      result: 'PASS', currentSourceCompared: false,
      databasePayload: false, applied: false, deployed: false,
    })
    expect(run.stdout).not.toContain('sb_publishable_')

    const strict = spawnSync(process.execPath,
      ['scripts/prepare-r9-app-candidate.mjs', '--verify'],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    expect(strict.status).not.toBe(0)
    expect(strict.stderr).toContain('Package inventory changed')
  })

  it('lets the staging read-only local gate validate the frozen r9 artifact', () => {
    const root = fileURLToPath(new URL('../', import.meta.url))
    const run = spawnSync(process.execPath, ['scripts/verify-r9-readonly-local.mjs'],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    expect(run.status, run.stderr).toBe(0)
    expect(JSON.parse(run.stdout)).toMatchObject({ result: 'LOCAL_PASS', remoteChecked: false })
  })

  it('accepts only matching, hash-pinned r8 local and frozen browser keys', () => {
    expect(extractPinnedPublishableKey({
      priorBundle: bundle, frozenBundle: bundle,
      priorHash: sha256(bundle), frozenHash: sha256(bundle), project,
    })).toBe(key)
  })

  it.each([
    { priorBundle: bundle + ' ', frozenBundle: bundle, priorHash: sha256(bundle), frozenHash: sha256(bundle) },
    { priorBundle: bundle, frozenBundle: bundle + ' ', priorHash: sha256(bundle), frozenHash: sha256(bundle) },
    { priorBundle: bundle.replace(project, 'wrongproject'), frozenBundle: bundle, priorHash: sha256(bundle.replace(project, 'wrongproject')), frozenHash: sha256(bundle) },
    { priorBundle: bundle + ' sb_publishable_second', frozenBundle: bundle, priorHash: sha256(bundle + ' sb_publishable_second'), frozenHash: sha256(bundle) },
    { priorBundle: bundle, frozenBundle: bundle.replace(key, 'sb_publishable_other'), priorHash: sha256(bundle), frozenHash: sha256(bundle.replace(key, 'sb_publishable_other')) },
    { priorBundle: bundle + ' sb_secret_test', frozenBundle: bundle, priorHash: sha256(bundle + ' sb_secret_test'), frozenHash: sha256(bundle) },
  ])('rejects drift, wrong target, second key, mismatch and privileged material without echoing key', (input) => {
    try {
      extractPinnedPublishableKey({ ...input, project })
      throw new Error('Expected rejection')
    } catch (error) {
      expect(String(error)).not.toContain(key)
      expect(String(error)).not.toContain('sb_secret_test')
      expect(String(error)).not.toBe('Error: Expected rejection')
    }
  })

  it('requires exact path and hash inventory, with no unlisted file', () => {
    const expected = [{ path: 'app/index.html', sha256: 'a'.repeat(64) }]
    expect(() => verifyFileInventory(expected, expected)).not.toThrow()
    expect(() => verifyFileInventory(expected, [])).toThrow()
    expect(() => verifyFileInventory(expected, [...expected, { path: 'app/extra', sha256: 'b'.repeat(64) }])).toThrow()
    expect(() => verifyFileInventory(expected, [{ path: 'app/index.html', sha256: 'b'.repeat(64) }])).toThrow()
    expect(() => verifyFileInventory(expected, [{ path: '../escape', sha256: 'a'.repeat(64) }])).toThrow()
  })
})
