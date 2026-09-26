// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { compareCatalog, defaultAclSupplement } from '../scripts/restore-catalog-checks.mjs'

const object = (identity: string, details: unknown = {}) => ({ kind: 'constraint', identity, details })
const defaults = () => ['r', 'S', 'f'].map(type => ({
  kind: 'default_acl', identity: `supabase_admin:public:${type}`,
  details: [['supabase_admin', 'authenticated', type === 'f' ? 'EXECUTE' : 'SELECT', false]],
}))

describe('catalog comparison does not silently discard objects', () => {
  it('rejects duplicate expected keys even when a Map would hide the changed object', () => {
    const a = object('truncated', { definition: 'CHECK (a)' })
    const b = object('truncated', { definition: 'CHECK (b)' })
    expect(() => compareCatalog([a, b], [b])).toThrow(/Duplicate expected catalog identity/)
  })
  it('rejects duplicate actual keys, including identical duplicates', () => {
    const a = object('same')
    expect(() => compareCatalog([a], [a, a])).toThrow(/Duplicate actual catalog identity/)
  })
  it('keeps long constraint identities distinct and detects either change', () => {
    const prefix = 'auth.custom_oauth_providers.custom_oauth_providers_authorization_url_'
    const a = object(prefix + 'https', { definition: 'CHECK (https)' })
    const b = object(prefix + 'length', { definition: 'CHECK (length)' })
    expect(compareCatalog([a, b], [b, a])).toEqual([])
    expect(compareCatalog([a, b], [a, { ...b, details: {} }])).toEqual([`constraint\0${b.identity}`])
  })
  it('does not ignore changes in column order, ACLs, nullability or constraints', () => {
    const column = { kind: 'column', identity: 'auth.users.id', details: { position: 1, nullable: false, acl: null } }
    for (const details of [{ ...column.details, position: 2 }, { ...column.details, nullable: true }, { ...column.details, acl: 'changed' }]) {
      expect(compareCatalog([column], [{ ...column, details }])).toHaveLength(1)
    }
    expect(compareCatalog([object('constraint')], [])).toEqual(['constraint\0constraint'])
  })
})

describe('captured default ACL supplement', () => {
  it('restores the three captured default ACL groups under the exact owner and schema', () => {
    const sql = defaultAclSupplement(defaults())
    expect(sql).toContain('ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT SELECT ON TABLES TO "authenticated";')
    expect(sql).toContain('GRANT SELECT ON SEQUENCES')
    expect(sql).toContain('GRANT EXECUTE ON FUNCTIONS')
    expect(sql).not.toContain('GRANT ALL')
  })
  it('preserves grant options and the PUBLIC grantee', () => {
    const rows = defaults(); rows[2].details = [['supabase_admin', 'PUBLIC', 'EXECUTE', true]]
    expect(defaultAclSupplement(rows)).toContain('GRANT EXECUTE ON FUNCTIONS TO PUBLIC WITH GRANT OPTION;')
  })
  it('rejects missing/duplicate groups and unexpected grantors, roles or privileges', () => {
    expect(() => defaultAclSupplement(defaults().slice(1))).toThrow(/Expected three/)
    expect(() => defaultAclSupplement([...defaults(), defaults()[0]])).toThrow(/Duplicate/)
    const grantor = defaults(); grantor[0].details[0][0] = 'postgres'
    expect(() => defaultAclSupplement(grantor)).toThrow(/Unexpected grantor/)
    const role = defaults(); role[0].details[0][1] = 'injected"; DROP TABLE x; --'
    expect(() => defaultAclSupplement(role)).toThrow(/Unexpected grantee/)
    const privilege = defaults(); privilege[2].details[0][2] = 'DELETE'
    expect(() => defaultAclSupplement(privilege)).toThrow(/Unexpected privilege/)
  })
  it('does not add unrelated captured ACLs to the supplement', () => {
    const rows = [...defaults(), { ...defaults()[0], identity: 'postgres:public:r' }]
    expect(defaultAclSupplement(rows)).not.toContain('FOR ROLE "postgres"')
  })
})
