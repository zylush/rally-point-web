// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { assertExactSnapshot, assertStableActivity, verifyPagesMetadata,
  verifyStagingTarget, verifyPublicProjectionResponse,
  verifyCanonicalFingerprint } from '../scripts/r9-readonly-compare.mjs'

const project = 'iclrvvsiwypxlwrwgqia'
const commit = '558f2fee0be9ae876960e4913928535cd38242ad'

describe('read-only r9 pre-deployment comparisons', () => {
  it('pins the saved 617-row staging fingerprint before any remote request', () => {
    const root = fileURLToPath(new URL('../', import.meta.url))
    const run = spawnSync(process.execPath,
      ['scripts/run-gate1-fingerprint-readonly.mjs', '--verify-local'],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    expect(run.status, run.stderr).toBe(0)
    expect(JSON.parse(run.stdout)).toMatchObject({ result: 'PASS', localOnly: true,
      project, appliedVersions: 13 })
  })

  it('requires the entire saved schema fingerprint and its pinned marker', () => {
    const reference = [
      { category: '!fingerprint', identity: 'md5', details: 'a'.repeat(32) },
      { category: 'function', identity: 'safe_read()', details: 'private-definition' },
    ]
    expect(() => verifyCanonicalFingerprint(reference, reference, 'a'.repeat(32), 2)).not.toThrow()
    expect(() => verifyCanonicalFingerprint(reference,
      [{ ...reference[0], details: 'b'.repeat(32) }, reference[1]], 'a'.repeat(32), 2)).toThrow()
    expect(() => verifyCanonicalFingerprint(reference,
      [reference[0], { ...reference[1], details: 'changed-definition' }], 'a'.repeat(32), 2)).toThrow()
    expect(() => verifyCanonicalFingerprint(reference, [reference[0]], 'a'.repeat(32), 2)).toThrow()
    expect(() => verifyCanonicalFingerprint(reference, reference, 'b'.repeat(32), 2)).toThrow()
    try {
      verifyCanonicalFingerprint(reference,
        [reference[0], { ...reference[1], details: 'changed-definition' }], 'a'.repeat(32), 2)
    } catch (error) {
      expect(String(error)).not.toContain('private-definition')
      expect(String(error)).not.toContain('changed-definition')
    }
  })

  it('requires exact baseline snapshots without echoing private values on failure', () => {
    const before = [{ id: 'private-id', row_count: 2 }]
    expect(() => assertExactSnapshot('Auth', before, [{ row_count: 2, id: 'private-id' }])).not.toThrow()
    try { assertExactSnapshot('Auth', before, [{ id: 'other-private-id', row_count: 2 }]) } catch (error) {
      expect(String(error)).toContain('Auth drift')
      expect(String(error)).not.toContain('private-id')
      return
    }
    throw new Error('Expected drift rejection')
  })

  it('requires no other clients and exact write counters against reference and across the check', () => {
    const reference = { other_active_clients: 0, writes: [{ schema: 'public', table: 'bookings', inserted: 3 }] }
    expect(() => assertStableActivity(reference, reference, reference)).not.toThrow()
    expect(() => assertStableActivity(reference, { ...reference, other_active_clients: 1 }, reference)).toThrow()
    expect(() => assertStableActivity(reference, reference, { ...reference, writes: [{ schema: 'public', table: 'bookings', inserted: 4 }] })).toThrow()
  })

  it('pins the healthy linked target and exact existing Pages build', () => {
    const projects = { projects: [{ id: project, name: 'Rally-Point-Database', region: 'ap-northeast-1', status: 'ACTIVE_HEALTHY', linked: true }], message: '' }
    const pages = { html_url: 'https://zylush.github.io/rally-point-web/', source: { branch: 'gh-pages', path: '/' }, build_type: 'legacy' }
    const branch = { object: { sha: commit } }
    const build = { commit, status: 'built' }
    expect(() => verifyStagingTarget(projects)).not.toThrow()
    expect(() => verifyPagesMetadata(pages, branch, build)).not.toThrow()
    expect(() => verifyStagingTarget({ ...projects, projects: [{ ...projects.projects[0], id: 'wrong' }] })).toThrow()
    expect(() => verifyPagesMetadata(pages, { object: { sha: 'wrong' } }, build)).toThrow()
    expect(() => verifyPagesMetadata(pages, branch, { ...build, status: 'building' })).toThrow()
  })

  it('accepts the CLI 2.110.0 projects envelope and rejects malformed or unexpected envelopes', () => {
    const target = { id: project, name: 'Rally-Point-Database', region: 'ap-northeast-1',
      status: 'ACTIVE_HEALTHY', linked: true }
    const response = { projects: [target, { id: 'unrelated-project' }], message: '' }
    expect(() => verifyStagingTarget(response)).not.toThrow()
    expect(() => verifyStagingTarget({ ...response, message: 'private-error-detail' })).toThrow()
    expect(() => verifyStagingTarget([target])).toThrow()
    expect(() => verifyStagingTarget({ projects: target, message: '' })).toThrow()
    expect(() => verifyStagingTarget({ projects: [target, target], message: '' })).toThrow()
    expect(() => verifyStagingTarget({ projects: [target], message: '', surprise: true })).toThrow()
    try { verifyStagingTarget({ ...response, message: 'private-error-detail' }) } catch (error) {
      expect(String(error)).not.toContain('private-error-detail')
    }
  })

  it('requires an anonymous projection success, not just a reachable API', () => {
    expect(() => verifyPublicProjectionResponse(200, [], 'application/json')).not.toThrow()
    expect(() => verifyPublicProjectionResponse(401, [], 'application/json')).toThrow()
    expect(() => verifyPublicProjectionResponse(200, [{ name: 'private' }], 'application/json')).toThrow()
    expect(() => verifyPublicProjectionResponse(200, [], 'text/html')).toThrow()
  })
})
