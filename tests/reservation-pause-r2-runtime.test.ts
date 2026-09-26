// @vitest-environment node
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPauseRuntime, preparePauseRunner, verifyPauseRunner, pauseCliEnvironment, runPauseCommand, executePauseCli } from '../docs/release-private/staging-pause-apply-20260926-r2/source/reservation-pause-staging-runtime.mjs'

const root = resolve('.')
const folders: string[] = []
// These two integration journeys retain real backup and 122 MB CLI hashing.
// The saved coverage STOP measured 12.7s; keep a bounded I/O-test budget,
// without changing production command timeouts or any verification assertion.
const filesystemJourneyTimeoutMs = 20000
const sha = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex')
const env = { RALLY_STAGING_PAUSE_APPLY_APPROVED: 'staging-pause-only-approved',
  RALLY_STAGING_PAUSED_CONFIRMED: 'testers-closed-staging-paused' }
const capture = join(root, 'docs/release-private/staging-pause-backup-20260926-r1')
function fixture() {
  const parent = mkdtempSync(join(root, 'docs/release-private/pause-r2-runtime-test-'))
  folders.push(parent)
  return { root, packet: join(parent, 'packet') }
}
afterEach(() => {
  for (const folder of folders.splice(0)) {
    if (!folder.startsWith(join(root, 'docs/release-private/pause-r2-runtime-test-'))) throw new Error('Unsafe test cleanup')
    rmSync(folder, { recursive: true, force: true })
  }
})
function prepared() {
  const paths = fixture()
  preparePauseRunner(paths)
  const manifestSha256 = sha(join(paths.packet, 'manifest.json'))
  const run = vi.fn(async (_program: string, args: string[]) => {
    if (args[0] === '--version') return { status: 0, stdout: '2.110.0\n', stderr: '' }
    if (args[0] === 'projects') return { status: 0, stdout: JSON.stringify({ message: '', projects: [{
      id: 'iclrvvsiwypxlwrwgqia', name: 'Rally-Point-Database', status: 'ACTIVE_HEALTHY', linked: true,
      region: 'ap-northeast-1', database: { version: '17.6.1.147' },
    }] }), stderr: '' }
    if (args[1] === 'query') {
      const file = args[args.indexOf('--file') + 1]
      const name = file.split(/[\\/]/).at(-1)!.replace('.sql', '')
      const rows = name === 'history' ? [{ version: '001' }] : JSON.parse(readFileSync(join(capture, `before_${name}.json`), 'utf8'))
      return { status: 0, stdout: JSON.stringify(rows), stderr: '' }
    }
    return { status: 0, stdout: '{}', stderr: '' }
  })
  const options = { ...paths, manifestSha256, run, env }
  return { ...paths, run, options, io: createPauseRuntime(options) }
}

describe.sequential('r2 staging pause filesystem/CLI adapter (fake CLI only)', () => {
  it('prepares and verifies immutable local pins without spawning a CLI', async () => {
    const { options, run, packet } = prepared()
    expect(verifyPauseRunner(options)).toMatchObject({ result: 'LOCAL_READY_APPROVAL_REQUIRED',
      databaseContacted: false, captureFiles: 67, migrationFiles: 14 })
    expect(await runPauseCommand(['--verify-local'], {}, options)).toMatchObject({ databaseContacted: false })
    expect(run).not.toHaveBeenCalled()
    expect(readdirSync(packet)).toEqual(['manifest.json'])
    expect(() => preparePauseRunner(options)).toThrow()
  })

  it('refuses unapproved execution, unknown modes, extra args, or an unapproved manifest before network I/O', async () => {
    const { options, run } = prepared()
    for (const [args, vars] of [
      [['--apply-approved'], {}], [['--apply-approved'], env],
      [['--apply-approved'], { ...env, RALLY_STAGING_PAUSE_MANIFEST_SHA256: '0'.repeat(64) }],
      [['--verify-local', '--apply-approved'], env], [['--include-all'], env],
    ] as [string[], Record<string, string>][]) {
      await expect(runPauseCommand(args, vars, options)).rejects.toThrow()
    }
    expect(run).not.toHaveBeenCalled()
    const direct = createPauseRuntime({ ...options, env: {} })
    await expect(direct.begin()).rejects.toThrow()
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects modified source-pin manifests and unsafe injected paths', () => {
    const { options, packet } = prepared()
    const path = join(packet, 'manifest.json')
    const manifest = JSON.parse(readFileSync(path, 'utf8'))
    manifest.sources[0].sha256 = '0'.repeat(64)
    writeFileSync(path, JSON.stringify(manifest))
    expect(() => verifyPauseRunner({ ...options, manifestSha256: sha(path) })).toThrow()
    manifest.sources[0].path = '../private-token'
    writeFileSync(path, JSON.stringify(manifest))
    expect(() => verifyPauseRunner({ ...options, manifestSha256: sha(path) })).toThrow()
  })

  it('isolates exactly the frozen migrations and pins each query and target before invoking the CLI', async () => {
    const { io, run } = prepared()
    await io.verifyFiles()
    await io.begin()
    await io.target()
    const snapshot = await io.snapshot('before')
    expect(snapshot.inventory).toHaveLength(54)
    expect(snapshot.fingerprint).toHaveLength(617)
    const evidence = io.evidence()
    expect(readdirSync(join(evidence, 'operator/supabase/migrations'))).toHaveLength(14)
    expect(existsSync(join(evidence, 'operator/supabase/seed.sql'))).toBe(false)
    const queries = run.mock.calls.filter(([, args]) => args[1] === 'query')
    expect(queries).toHaveLength(8)
    for (const [, args] of queries) {
      expect(args).toContain('--linked')
      expect(args).not.toContain('--db-url')
      const sql = readFileSync(args[args.indexOf('--file') + 1], 'utf8')
      expect(sql).toMatch(/^begin read only;/i)
      expect(sql).toMatch(/commit;\s*$/i)
    }
    await io.dryRun()
    expect(run.mock.calls.at(-1)![1]).toContain('--dry-run')
    await expect(io.apply()).rejects.toThrow() // durable attempt marker is mandatory
    await io.record('APPLY-ATTEMPT.json', { project: 'iclrvvsiwypxlwrwgqia' })
    await io.apply()
    expect(run.mock.calls.at(-1)![1]).toEqual(['db', 'push', '--linked', '--workdir', join(evidence, 'operator'), '--output-format', 'json', '--yes'])
    await expect(io.apply()).rejects.toThrow()
  }, filesystemJourneyTimeoutMs)

  it('prevents reuse and never overwrites the one-attempt marker or earlier evidence', async () => {
    const { io, options } = prepared()
    await io.begin()
    const before = sha(join(options.packet, 'ATTEMPT.json'))
    await io.record('STOP.json', { result: 'STOP' })
    await expect(io.record('STOP.json', { result: 'PASS' })).rejects.toThrow()
    await expect(createPauseRuntime(options).begin()).rejects.toThrow()
    expect(sha(join(options.packet, 'ATTEMPT.json'))).toBe(before)
  })

  it.each(['migration', 'query', 'target'])('blocks %s tampering before the next command', async kind => {
    const { io, run } = prepared()
    await io.begin()
    const evidence = io.evidence()
    if (kind === 'migration') writeFileSync(join(evidence, 'operator/supabase/migrations/unapproved.sql'), 'select 1;')
    if (kind === 'query') writeFileSync(join(evidence, 'queries/inventory.sql'), 'delete from public.members;')
    if (kind === 'target') writeFileSync(join(evidence, 'operator/supabase/.temp/project-ref'), 'other-project')
    await expect(io.target()).rejects.toThrow()
    expect(run).not.toHaveBeenCalled()
  })

  it('accepts only the already-captured linked-project cache, including its ownership metadata', async () => {
    const { io, run } = prepared()
    await io.begin()
    const cache = join(io.evidence(), 'operator/supabase/.temp/linked-project.json')
    const frozen = readFileSync(join(root, 'docs/release-private/staging-reservation-pause-dryrun-20260925184439-da84a4c6/operator/supabase/.temp/linked-project.json'))
    writeFileSync(cache, frozen)
    await io.target()
    const calls = run.mock.calls.length
    const wrong = JSON.parse(frozen.toString())
    wrong.ref = 'other-project'
    writeFileSync(cache, JSON.stringify(wrong))
    await expect(io.target()).rejects.toThrow()
    expect(run).toHaveBeenCalledTimes(calls)
  })

  it('captures a local child process without a shell and handles a missing executable', async () => {
    const response = await executePauseCli(process.execPath, ['-e', 'process.stdout.write("local-only"); process.stderr.write("diagnostic")'],
      { cwd: root, env: pauseCliEnvironment(process.env) })
    expect(response).toEqual({ status: 0, stdout: 'local-only', stderr: 'diagnostic' })
    expect(await executePauseCli(join(root, 'does-not-exist.exe'), [], { cwd: root, env: {} })).toMatchObject({ status: null })
  })

  it('bounds command time and output without retrying the child', async () => {
    vi.useFakeTimers()
    try {
      const pending = executePauseCli(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { cwd: root, env: {} })
      vi.advanceTimersByTime(60000)
      expect(await pending).toMatchObject({ status: null })
    } finally { vi.useRealTimers() }
    const oversized = await executePauseCli(process.execPath, ['-e', 'process.stdout.write("x".repeat(33 * 1024 * 1024))'], { cwd: root, env: {} })
    expect(oversized.status).toBeNull()
    expect(oversized.stdout.length).toBeLessThanOrEqual(32 * 1024 * 1024)
  })

  it('runs the whole approved orchestration with a fake CLI and real catalog/grant postflight', async () => {
    const { options, run } = prepared()
    const fallback = run.getMockImplementation()!
    const names = ['fingerprint', 'inventory', 'catalog', 'grants', 'sequences', 'activity', 'preflight']
    const before = Object.fromEntries(names.map(name => [name, JSON.parse(readFileSync(join(capture, `before_${name}.json`), 'utf8'))]))
    before.history = before.grants[0].snapshot.versions.map((version: string) => ({ version, name: version, statements: ['historical SQL'] }))
    const after = structuredClone(before)
    const migration = '20260925174111_reservation_write_pause.sql'
    // Independent modeled result of the reviewed SQL, not an actual DB execution.
    const sql = readFileSync('supabase/migrations/' + migration, 'utf8')
    const tables = [...sql.matchAll(/revoke insert[^;]+on table public\.(\w+) from/g)].map(match => match[1])
    const functions = [...sql.matchAll(/revoke execute on function public\.(.+?) from/g)].map(match => match[1])
    expect(tables).toHaveLength(6)
    expect(functions).toHaveLength(9)
    const roles = ['PUBLIC', 'anon', 'authenticated', 'service_role']
    const writes = ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']
    after.history.push({ version: '20260925174111', name: 'reservation_write_pause', statements: [sql] })
    after.grants[0].snapshot.versions.push('20260925174111')
    const ledger = after.inventory.find((row: { schema_name: string }) => row.schema_name === 'supabase_migrations')
    ledger.row_count = 14
    ledger.content_md5 = 'modeled-new-ledger'
    after.grants[0].snapshot.acl = after.grants[0].snapshot.acl.filter((row: { relname: string; grantee: string; privilege_type: string }) =>
      !(tables.includes(row.relname) && roles.includes(row.grantee) && writes.includes(row.privilege_type)))
    for (const row of after.grants[0].snapshot.effective) {
      if (tables.includes(row.relname) && roles.includes(row.role_name) && writes.includes(row.privilege)) row.allowed = false
    }
    for (const row of after.catalog[0].objects) {
      const table = row.kind === 'relation' && tables.some(name => row.identity === 'public.' + name)
      const rpc = row.kind === 'function' && functions.some(signature => row.identity.startsWith('public.' + signature.split('(')[0] + '('))
      if (table || rpc) row.details.acl = row.details.acl.filter((acl: string[]) =>
        !(roles.includes(acl[1]) && (table ? writes.includes(acl[2]) : acl[2] === 'EXECUTE')))
    }
    after.audit = [
      ...roles.map(role => role.toLowerCase()).flatMap(role_name => tables.map(target => ({ kind: 'table write', role_name, target, violation: false }))),
      ...roles.map(role => role.toLowerCase()).flatMap(role_name => functions.map(target => ({ kind: 'RPC execute', role_name, target, violation: false }))),
      ...tables.map(target => ({ kind: 'authenticated read', role_name: 'authenticated', target, violation: false })),
    ]
    let applied = false
    run.mockImplementation(async (program, args) => {
      if (args[1] === 'query') {
        const name = args[args.indexOf('--file') + 1].split(/[\\/]/).at(-1)!.replace('.sql', '')
        return { status: 0, stdout: JSON.stringify((applied ? after : before)[name]), stderr: '' }
      }
      if (args[1] === 'push') {
        if (args.includes('--dry-run')) return { status: 0, stdout: JSON.stringify({ dryRun: true, upToDate: false,
          migrations: [migration], seeds: [], roles: [], message: 'Finished supabase db push.' }),
        stderr: `DRY RUN: migrations will *not* be pushed to the database.\nWould push these migrations:\n${migration}` }
        applied = true
        return { status: 0, stdout: '{}', stderr: '' }
      }
      return fallback(program, args)
    })
    const vars = { ...env, RALLY_STAGING_PAUSE_MANIFEST_SHA256: options.manifestSha256 }
    const result = await runPauseCommand(['--apply-approved'], vars, options)
    expect(result).toMatchObject({ result: 'PASS', postflight: { inventoryTables: 54, catalogObjects: 1304,
      auditRows: 66, unchangedSequences: 2 }, enforcementApplied: false, stagingActivityResumed: false })
    expect(run.mock.calls.filter(([, args]) => args[1] === 'push' && !args.includes('--dry-run'))).toHaveLength(1)
    expect(existsSync(join(result.evidence, 'RESULT.json'))).toBe(true)
    const count = run.mock.calls.length
    await expect(runPauseCommand(['--apply-approved'], vars, options)).rejects.toThrow()
    expect(run).toHaveBeenCalledTimes(count)
  }, filesystemJourneyTimeoutMs)

  // Each case retains complete frozen-input hashing and its own timeout budget.
  it.each([
    { status: 1, stdout: '', stderr: 'sensitive diagnostic' },
    { status: 0, stdout: '2.111.0', stderr: '' },
  ])('rejects CLI status $status / version "$stdout" and keeps raw output private', async response => {
    const { io, run } = prepared()
    await io.begin()
    run.mockResolvedValueOnce(response)
    await expect(io.target()).rejects.toThrow()
    expect(run).toHaveBeenCalledTimes(1)
    expect(readdirSync(io.evidence()).some(file => file.endsWith('.stderr.private'))).toBe(true)
  })

  it('requires a real complete permission postflight rather than accepting a summary', async () => {
    const { io } = prepared()
    await expect(io.postflight({}, { audit: [] })).rejects.toThrow()
  })

  it('passes only necessary in-memory credentials and OS variables, never target/debug overrides', () => {
    expect(pauseCliEnvironment({ PATH: 'path', USERPROFILE: 'profile', SUPABASE_ACCESS_TOKEN: 'private',
      UNRELATED_SECRET: 'omit', NODE_OPTIONS: 'omit' })).toEqual({ PATH: 'path', USERPROFILE: 'profile', SUPABASE_ACCESS_TOKEN: 'private' })
    for (const key of ['SUPABASE_DB_URL', 'SUPABASE_WORKDIR', 'SUPABASE_PROJECT_REF', 'PGHOST', 'DATABASE_URL']) {
      expect(() => pauseCliEnvironment({ [key]: 'override' })).toThrow()
    }
  })
})
