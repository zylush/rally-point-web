// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { runPauseApplication, verifyPauseBaseline, verifyPauseHistory } from '../scripts/reservation-pause-staging-flow.mjs'

const capture = 'docs/release-private/staging-pause-backup-20260926-r1/'
const read = (name: string) => JSON.parse(readFileSync(capture + name, 'utf8'))
const project = 'iclrvvsiwypxlwrwgqia'
const migration = '20260925174111_reservation_write_pause.sql'
const approval = { approval: 'staging-pause-only-approved', paused: 'testers-closed-staging-paused' }
const names = ['fingerprint', 'inventory', 'catalog', 'grants', 'sequences', 'activity', 'preflight']

function harness() {
  const saved = Object.fromEntries(names.map(name => [name, read(`before_${name}.json`)]))
  const history = saved.grants[0].snapshot.versions.map((version: string) =>
    ({ version, name: version, statements: ['historical statement'] }))
  const before = { ...structuredClone(saved), history }
  const after = structuredClone(before)
  after.history.push({ version: '20260925174111', name: 'reservation_write_pause', statements: ['DO $reservation_pause$ ...'] })
  const io = {
    now: () => '2026-09-26T02:40:00.000Z',
    verifyFiles: vi.fn(async () => ({ saved, backup: read('capture_manifest.json'),
      backupSha256: 'a5cb6805b281f356bbc31ca857dd2e55fdf473eb33ebe0c0282701a1a2651d0d',
      restore: JSON.parse(readFileSync('docs/release-private/staging-pause-restore-20260926-r1/result.json', 'utf8')),
      packageManifestSha256: '7f8c7f5193c2484b8d6a9b751e120524f67ce27b09c4558ef3b062e695ecd902' })),
    begin: vi.fn(async () => {}),
    target: vi.fn(async () => {}),
    snapshot: vi.fn(async (phase: string) => structuredClone(phase.startsWith('after') ? after : before)),
    dryRun: vi.fn(async () => ({ stdout: JSON.stringify({ dryRun: true, upToDate: false,
      migrations: [migration], seeds: [], roles: [], message: 'Finished supabase db push.' }),
    stderr: `DRY RUN: migrations will *not* be pushed to the database.\nWould push these migrations:\n${migration}`, status: 0 })),
    record: vi.fn(async (_name: string, _data: unknown) => {}),
    apply: vi.fn(async () => {}),
    // Postflight permission checking is independently exercised in reservation-pause-postflight.test.ts.
    postflight: vi.fn(async () => ({ result: 'PASS', auditRows: 66 })),
  }
  return { io, saved, before, after }
}

describe('pause application one-shot orchestration (all remote operations mocked)', () => {
  it('contacts nothing without both explicit approval and paused-client confirmation', async () => {
    for (const request of [{}, { ...approval, approval: 'rollback-only-local-approved' }, { ...approval, paused: '' }]) {
      const { io } = harness()
      await expect(runPauseApplication(io, request)).rejects.toThrow()
      expect(io.begin).not.toHaveBeenCalled()
      expect(io.target).not.toHaveBeenCalled()
      expect(io.apply).not.toHaveBeenCalled()
    }
  })

  it('orders baseline, dry run, fresh baseline, attempt marker, single apply, and postflight', async () => {
    const { io } = harness()
    expect(await runPauseApplication(io, approval)).toMatchObject({ result: 'PASS', project,
      migration, enforcementApplied: false, stagingActivityResumed: false })
    expect(io.snapshot.mock.calls.map(row => row[0])).toEqual(['before', 'before-apply', 'after', 'after-end'])
    expect(io.apply).toHaveBeenCalledTimes(1)
    expect(io.postflight).toHaveBeenCalledTimes(2)
    expect(io.verifyFiles).toHaveBeenCalledTimes(2)
    const index = io.record.mock.calls.findIndex(row => row[0] === 'APPLY-ATTEMPT.json')
    expect(index).toBeGreaterThanOrEqual(0)
    expect(io.record.mock.invocationCallOrder[index]).toBeLessThan(io.apply.mock.invocationCallOrder[0])
  })

  it.each(['begin', 'target', 'snapshot', 'dryRun', 'verifyFiles'] as const)(
    'stops before apply when %s fails', async name => {
      const { io } = harness()
      io[name].mockRejectedValueOnce(new Error('sensitive raw diagnostic'))
      await expect(runPauseApplication(io, approval)).rejects.toThrow()
      expect(io.apply).not.toHaveBeenCalled()
      const stops = io.record.mock.calls.filter(row => row[0] === 'STOP.json')
      if (stops.length) {
        expect(JSON.stringify(stops)).not.toContain('sensitive raw diagnostic')
        expect(stops[0][1]).toMatchObject({ applyMayHaveCommitted: false })
      }
    })

  it('stops when dry run includes enforcement', async () => {
    const { io } = harness()
    io.dryRun.mockResolvedValueOnce({ status: 0, stdout: '{}', stderr: 'unexpected migration' })
    await expect(runPauseApplication(io, approval)).rejects.toThrow()
    expect(io.apply).not.toHaveBeenCalled()
  })

  it('stops on last-moment baseline drift or changed package bytes', async () => {
    for (const kind of ['baseline', 'package']) {
      const { io, before } = harness()
      if (kind === 'package') io.verifyFiles.mockImplementationOnce(async () => (await harness().io.verifyFiles()))
        .mockRejectedValueOnce(new Error('changed file'))
      else { const changed = structuredClone(before); changed.inventory[0].content_md5 = 'changed';
        io.snapshot.mockResolvedValueOnce(before).mockResolvedValueOnce(changed) }
      await expect(runPauseApplication(io, approval)).rejects.toThrow()
      expect(io.apply).not.toHaveBeenCalled()
    }
  })

  it('does not apply if the attempt record cannot be preserved', async () => {
    const { io } = harness()
    io.record.mockImplementation(async name => { if (name === 'APPLY-ATTEMPT.json') throw new Error('disk full') })
    await expect(runPauseApplication(io, approval)).rejects.toThrow()
    expect(io.apply).not.toHaveBeenCalled()
  })

  it('never retries an ambiguous apply failure or queries afterward', async () => {
    const { io } = harness()
    io.apply.mockRejectedValueOnce(new Error('timeout with private connection information'))
    await expect(runPauseApplication(io, approval)).rejects.toThrow()
    expect(io.apply).toHaveBeenCalledTimes(1)
    expect(io.snapshot).toHaveBeenCalledTimes(2)
    expect(io.postflight).not.toHaveBeenCalled()
    expect(io.record.mock.calls.find(row => row[0] === 'STOP.json')?.[1]).toMatchObject({
      applyMayHaveCommitted: true, retryAuthorized: false, stagingActivityResumed: false,
    })
  })

  it('stops after postflight failure without undoing protections or reporting PASS', async () => {
    const { io } = harness()
    io.postflight.mockRejectedValueOnce(new Error('permission drift'))
    await expect(runPauseApplication(io, approval)).rejects.toThrow()
    expect(io.apply).toHaveBeenCalledTimes(1)
    expect(io.record.mock.calls.some(row => row[0] === 'RESULT.json')).toBe(false)
    expect(io.record.mock.calls.find(row => row[0] === 'STOP.json')?.[1]).toMatchObject({ applyMayHaveCommitted: true })
  })
})

describe('baseline and ledger proofs', () => {
  it('requires every captured snapshot and unchanged activity, without echoing private data', () => {
    const { saved, before } = harness()
    const redactionMarker = ['must-not', 'be-printed'].join('-')
    expect(verifyPauseBaseline(saved, before)).toMatchObject({ result: 'PASS' })
    for (const key of names) {
      const changed = structuredClone(before)
      changed[key] = [{ marker: redactionMarker }]
      expect(() => verifyPauseBaseline(saved, changed)).toThrow()
      try { verifyPauseBaseline(saved, changed) } catch (error) { expect(String(error)).not.toContain(redactionMarker) }
    }
  })

  it('requires unchanged historical ledger rows and exactly one new pause row', () => {
    const { before, after } = harness()
    expect(verifyPauseHistory(before.history, after.history)).toBe(true)
    for (const key of ['name', 'statements']) {
      const changed = structuredClone(after.history)
      changed[0][key] = key === 'name' ? 'different' : ['different']
      expect(() => verifyPauseHistory(before.history, changed)).toThrow()
    }
    expect(() => verifyPauseHistory(before.history, after.history.slice(1))).toThrow()
    const wrong = structuredClone(after.history)
    wrong[13].version = '20260921111105'
    expect(() => verifyPauseHistory(before.history, wrong)).toThrow()
  })
})
