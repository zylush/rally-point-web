// @vitest-environment node
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPauseRuntime, preparePauseRunner, runPauseCommand } from '../docs/release-private/staging-pause-apply-20260926-r2/source/reservation-pause-staging-runtime.mjs'
import { parsePauseQueryRows } from '../docs/release-private/staging-pause-apply-20260926-r2/source/pause-query-rows.mjs'

const root = resolve('.')
const r1 = join(root, 'docs/release-private/staging-pause-apply-20260926-r1')
const r2 = join(root, 'docs/release-private/staging-pause-apply-20260926-r2')
const fixtureText = readFileSync(join(r2, 'fixtures/fingerprint-array.json'), 'utf8')
const folders: string[] = []
const sha = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex')
const approval = { RALLY_STAGING_PAUSE_APPLY_APPROVED: 'staging-pause-only-approved',
  RALLY_STAGING_PAUSED_CONFIRMED: 'testers-closed-staging-paused' }

function prepared(stdout = fixtureText) {
  const parent = mkdtempSync(join(root, 'docs/release-private/pause-r2-parser-test-'))
  folders.push(parent)
  const options = { root, packet: join(parent, 'packet') }
  preparePauseRunner(options)
  const run = vi.fn(async (_program: string, args: string[]) => {
    if (args[0] === '--version') return { status: 0, stdout: '2.110.0\n', stderr: '' }
    if (args[0] === 'projects') return { status: 0, stdout: JSON.stringify({ message: '', projects: [{
      id: 'iclrvvsiwypxlwrwgqia', name: 'Rally-Point-Database', status: 'ACTIVE_HEALTHY', linked: true,
      region: 'ap-northeast-1', database: { version: '17.6.1.147' },
    }] }), stderr: '' }
    return { status: 0, stdout, stderr: '' }
  })
  const manifestSha256 = sha(join(options.packet, 'manifest.json'))
  return { options: { ...options, run, env: approval, manifestSha256 }, run,
    io: createPauseRuntime({ ...options, run, env: approval, manifestSha256 }) }
}

afterEach(() => {
  for (const folder of folders.splice(0)) {
    if (!folder.startsWith(join(root, 'docs/release-private/pause-r2-parser-test-'))) throw new Error('Unsafe test cleanup')
    rmSync(folder, { recursive: true, force: true })
  }
})

describe.sequential('r2 CLI row response contract (fake CLI only)', () => {
  it('uses a sanitized fixture with the captured format, without copying captured values', () => {
    const capturedFile = join(r1, 'evidence-20260926055238597-3b2fe725/003-before-fingerprint.stdout.private')
    expect(sha(capturedFile)).toBe('a85424e59bac33ff9c1588e88c46ed912916c6c23a00b1770ad95764ae07283a')
    const captured = JSON.parse(readFileSync(capturedFile, 'utf8'))
    const sanitized = JSON.parse(fixtureText)
    expect(Array.isArray(captured)).toBe(true)
    expect(captured.length).toBe(617)
    expect(Object.keys(sanitized[0]).sort()).toEqual(Object.keys(captured[0]).sort())
    for (const key of Object.keys(sanitized[0])) expect(typeof sanitized[0][key]).toBe(typeof captured[0][key])
    expect(fixtureText).not.toContain('iclrvvsiwypxlwrwgqia')
  })

  it('changes only import routing and row parsing in the runtime; all other safety checks are identical to r1', () => {
    let expected = readFileSync(join(root, 'scripts/reservation-pause-staging-runtime.mjs'), 'utf8').replaceAll('\r\n', '\n')
    for (const name of ['reservation-pause-staging-flow', 'reservation-pause-staging-apply-checks',
      'r9-readonly-compare', 'reservation-pause-local-rehearsal-checks', 'reservation-pause-postflight-checks']) {
      expected = expected.replace(`'./${name}.mjs'`, `'../../../../scripts/${name}.mjs'`)
    }
    expected = expected.replace("import { isDeepStrictEqual } from 'node:util'",
      "import { isDeepStrictEqual } from 'node:util'\nimport { parsePauseQueryRows } from './pause-query-rows.mjs'")
    expected = expected.replace("    const parsed = JSON.parse(result.stdout)\n    assert.ok(parsed && Array.isArray(parsed.rows), 'CLI query rows missing')\n    save(phase + '-' + name + '.json', parsed.rows)\n    return parsed.rows",
      "    const rows = parsePauseQueryRows(result.stdout)\n    save(phase + '-' + name + '.json', rows)\n    return rows")
    expect(readFileSync(join(r2, 'source/reservation-pause-staging-runtime.mjs'), 'utf8').trim()).toBe(expected.trim())
    expect(readdirSync(join(r2, 'source')).sort()).toEqual(['pause-query-rows.mjs',
      'reservation-pause-runner-files.mjs', 'reservation-pause-staging-runtime.mjs', 'run-reservation-pause-staging-apply.mjs'])
  })

  it('parses arrays without modifying row values and accepts an empty SQL result', () => {
    expect(parsePauseQueryRows(fixtureText)).toEqual(JSON.parse(fixtureText))
    expect(parsePauseQueryRows('[]')).toEqual([])
    const rows = [{ count: '0', nested: { values: [null, false, 1] } }]
    expect(parsePauseQueryRows(JSON.stringify(rows))).toEqual(rows)
  })

  it.each(['', '[', '[] trailing-text', 'null', '0', 'true', '"private-marker"', '{}',
    '{"rows":[]}', '{"error":"private-marker"}', '[null]', '[1]', '[true]', '["private-marker"]', '[[]]', '[{},null]'])
  ('rejects malformed response case %# without including response data in its error', text => {
    expect(() => parsePauseQueryRows(text)).toThrow()
    try { parsePauseQueryRows(text) } catch (error) {
      expect(String(error)).not.toContain('private-marker')
    }
  })

  it.each([undefined, null, [], {}, 42])('rejects non-text input case %#', value => {
    expect(() => parsePauseQueryRows(value)).toThrow()
  })

  it('accepts the recorded top-level array format and preserves the raw response bytes', async () => {
    const { io, run } = prepared()
    await io.begin()
    const snapshot = await io.snapshot('before')
    expect(snapshot.fingerprint).toEqual(JSON.parse(fixtureText))
    expect(run).toHaveBeenCalledTimes(8)
    expect(readFileSync(join(io.evidence(), '001-before-fingerprint.stdout.private'), 'utf8')).toBe(fixtureText)
    expect(existsSync(join(io.evidence(), 'APPLY-ATTEMPT.json'))).toBe(false)
  }, 20000)

  it('rejects the unobserved rows wrapper instead of silently accepting a different protocol', async () => {
    const { io, run } = prepared(JSON.stringify({ rows: JSON.parse(fixtureText) }))
    await io.begin()
    await expect(io.snapshot('before')).rejects.toThrow()
    expect(run).toHaveBeenCalledTimes(1)
    expect(readdirSync(io.evidence())).not.toContain('before-fingerprint.json')
  }, 20000)

  it.each(['{malformed-private-marker', '[null]', '[]', fixtureText])
  ('stops the full workflow before dry run or apply for malformed or mismatched baseline case %#', async stdout => {
    const { options, run } = prepared(stdout)
    const vars = { ...approval, RALLY_STAGING_PAUSE_MANIFEST_SHA256: options.manifestSha256 }
    await expect(runPauseCommand(['--apply-approved'], vars, options)).rejects.toThrow('Staging pause stopped in baseline')
    expect(run.mock.calls.some(([, args]) => args[1] === 'push')).toBe(false)
    const claim = JSON.parse(readFileSync(join(options.packet, 'ATTEMPT.json'), 'utf8'))
    const evidence = join(options.packet, claim.name)
    const stop = readFileSync(join(evidence, 'STOP.json'), 'utf8')
    expect(JSON.parse(stop)).toMatchObject({ phase: 'baseline', applyMayHaveCommitted: false, retryAuthorized: false })
    expect(stop).not.toContain('private-marker')
    expect(readFileSync(join(evidence, '003-before-fingerprint.stdout.private'), 'utf8')).toBe(stdout)
    expect(existsSync(join(evidence, 'APPLY-ATTEMPT.json'))).toBe(false)
    const count = run.mock.calls.length
    await expect(runPauseCommand(['--apply-approved'], vars, options)).rejects.toThrow()
    expect(run).toHaveBeenCalledTimes(count)
  }, 20000)

  it('preserves the r1 manifest, all pinned sources, consumed marker, and STOP', () => {
    expect(sha(join(r1, 'manifest.json'))).toBe('4569007c5c0a53b5e0b741caae72f2568724ae083a6b8ac11662143f625e6873')
    const manifest = JSON.parse(readFileSync(join(r1, 'manifest.json'), 'utf8'))
    for (const row of [...manifest.sources, ...manifest.references]) expect(sha(join(root, row.path))).toBe(row.sha256)
    expect(sha(join(r1, 'ATTEMPT.json'))).toBe('4a8dd9e66e4612f24e0fda9c2a9204b6683cdcfb3ce9734c633b560b50f8c4ff')
    expect(sha(join(r1, 'evidence-20260926055238597-3b2fe725/STOP.json'))).toBe('8194538df293baa4c2be69d3bda7e560e2fa03aa28fda8a638fa0d75825393d0')
    expect(sha(join(root, 'vitest.config.ts'))).toBe('983104b3b91a265c4b641c5c7e71d69bcead4571379073adf5a960f7f0189512')
  })
})
