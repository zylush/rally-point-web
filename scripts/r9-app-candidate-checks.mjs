import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

export const sha256 = (value) => createHash('sha256').update(value).digest('hex')

export function extractPinnedPublishableKey({ priorBundle, frozenBundle, priorHash, frozenHash, project }) {
  assert.equal(sha256(priorBundle), priorHash, 'Prior browser bundle hash drift')
  assert.equal(sha256(frozenBundle), frozenHash, 'Frozen browser bundle hash drift')
  const keys = [priorBundle, frozenBundle].map((bundle) => {
    const hosts = [...new Set(bundle.match(/https:\/\/[a-z0-9]+\.supabase\.co/g) ?? [])]
    assert.deepEqual(hosts, [`https://${project}.supabase.co`], 'Browser bundle target drift')
    assert.ok(!/sb_secret_[A-Za-z0-9_-]+|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|postgres(?:ql)?:\/\//i.test(bundle), 'Privileged browser material')
    const found = [...new Set(bundle.match(/sb_publishable_[A-Za-z0-9_-]+/g) ?? [])]
    assert.equal(found.length, 1, 'Expected exactly one browser-safe key')
    return found[0]
  })
  assert.ok(keys[0] === keys[1], 'Prior and frozen browser keys differ')
  return keys[0]
}

export function verifyFileInventory(expected, actual) {
  for (const row of [...expected, ...actual]) {
    assert.match(row.path, /^(?!\/)(?!.*(?:^|\/)\.\.?\/)[A-Za-z0-9_./-]+$/, 'Unsafe package path')
    assert.match(row.sha256, /^[a-f0-9]{64}$/, 'Invalid SHA-256 inventory')
  }
  const paths = expected.map((row) => row.path)
  assert.equal(new Set(paths).size, paths.length, 'Duplicate package path')
  assert.deepEqual([...actual].sort((a, b) => a.path.localeCompare(b.path)),
    [...expected].sort((a, b) => a.path.localeCompare(b.path)), 'Package inventory changed')
}
