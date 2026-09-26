import assert from 'node:assert/strict'
import { isDeepStrictEqual } from 'node:util'

function uniqueCatalog(rows, label) {
  const result = new Map()
  for (const row of rows) {
    assert.ok(typeof row.kind === 'string' && typeof row.identity === 'string', 'Invalid catalog identity')
    const key = `${row.kind}\0${row.identity}`
    assert.ok(!result.has(key), `Duplicate ${label} catalog identity: ${row.kind} ${row.identity}`)
    result.set(key, row)
  }
  return result
}

export function compareCatalog(expected, actual) {
  const before = uniqueCatalog(expected, 'expected')
  const after = uniqueCatalog(actual, 'actual')
  return [...new Set([...before.keys(), ...after.keys()])].filter(name => !isDeepStrictEqual(before.get(name), after.get(name)))
}

// Reproduce only the three omitted groups from this capture. This does not
// grant anything by itself, alter existing-object ACLs, or repair arbitrary roles.
export function defaultAclSupplement(catalog) {
  const groups = catalog.filter(row => row.kind === 'default_acl' && row.identity.startsWith('supabase_admin:public:'))
  uniqueCatalog(groups, 'default ACL')
  assert.equal(groups.length, 3, 'Expected three captured default ACL groups')
  const types = { r: 'TABLES', S: 'SEQUENCES', f: 'FUNCTIONS' }
  const privileges = { r: ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'], S: ['SELECT', 'UPDATE', 'USAGE'], f: ['EXECUTE'] }
  const statements = []
  for (const row of groups) {
    const type = row.identity.split(':')[2]
    assert.ok(Object.hasOwn(types, type), 'Unexpected default ACL object type')
    assert.ok(Array.isArray(row.details) && row.details.length > 0, 'Missing captured ACL entries')
    const seen = new Set()
    for (const entry of row.details) {
      assert.ok(Array.isArray(entry) && entry.length === 4, 'Invalid captured ACL entry')
      const [grantor, grantee, privilege, grantable] = entry
      assert.equal(grantor, 'supabase_admin', 'Unexpected grantor')
      assert.ok(['PUBLIC', 'postgres', 'anon', 'authenticated', 'service_role', 'supabase_admin'].includes(grantee), 'Unexpected grantee')
      assert.ok(privileges[type].includes(privilege), 'Unexpected privilege')
      assert.equal(typeof grantable, 'boolean', 'Invalid grant option')
      const key = `${grantee}:${privilege}`
      assert.ok(!seen.has(key), 'Duplicate captured grant')
      seen.add(key)
      const role = grantee === 'PUBLIC' ? 'PUBLIC' : `"${grantee}"`
      statements.push(`ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ${privilege} ON ${types[type]} TO ${role}${grantable ? ' WITH GRANT OPTION' : ''};`)
    }
  }
  return statements.sort().join('\n') + '\n'
}
