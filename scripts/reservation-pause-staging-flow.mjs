// Dependency-injected orchestration. Importing this module performs no I/O.
import assert from 'node:assert/strict'
import { isDeepStrictEqual } from 'node:util'
import { pauseApplyMode, verifyPauseApplyReadiness } from './reservation-pause-staging-apply-checks.mjs'
import { verifyReservationPauseDryRun } from './reservation-pause-dry-run-checks.mjs'
import { normalizeLocalActivity, normalizeLocalInventory } from './reservation-pause-local-rehearsal-checks.mjs'

const project = 'iclrvvsiwypxlwrwgqia'
const migration = '20260925174111_reservation_write_pause.sql'
const stable = ['fingerprint', 'inventory', 'catalog', 'grants', 'sequences', 'preflight']
const same = (a, b, message) => assert.ok(isDeepStrictEqual(a, b), message)

export function verifyPauseBaseline(saved, observed) {
  for (const key of stable) {
    assert.ok(Array.isArray(saved?.[key]) && saved[key].length > 0 &&
      Array.isArray(observed?.[key]), `Missing baseline ${key}`)
    const normalize = key === 'inventory' ? normalizeLocalInventory : value => value
    same(normalize(saved[key]), normalize(observed[key]), `Baseline ${key} drift`)
  }
  const activity = normalizeLocalActivity(observed.activity)
  assert.equal(activity[0].other_active_clients, 0, 'Another active staging client observed')
  same(normalizeLocalActivity(saved.activity)[0].writes, activity[0].writes,
    'Baseline operational write counters changed')
  same(observed.history?.map(row => row.version), saved.grants[0].snapshot.versions,
    'Baseline ledger versions differ')
  return { result: 'PASS', project, appliedVersions: observed.grants[0].snapshot.versions,
    fingerprintRows: observed.fingerprint.length,
    marker: observed.fingerprint.find(row => row.category === '!fingerprint' && row.identity === 'md5')?.details,
    baselineAndPostflightExact: true, noOtherClientsObserved: true, noStagingWrites: true }
}

export function verifyPauseHistory(before, after) {
  assert.ok(Array.isArray(before) && before.length === 13 &&
    Array.isArray(after) && after.length === 14, 'Unexpected migration ledger size')
  same(after.slice(0, 13), before, 'Historical migration ledger rows changed')
  const added = after[13]
  assert.equal(added.version, '20260925174111', 'Unexpected new migration version')
  assert.equal(added.name, 'reservation_write_pause', 'Unexpected new migration name')
  assert.ok(Array.isArray(added.statements) && added.statements.length > 0 &&
    added.statements.every(value => typeof value === 'string' && value.trim().length > 0),
  'Pause migration statement history missing')
  return true
}

export async function runPauseApplication(io, request) {
  pauseApplyMode('--apply-approved', request?.approval)
  assert.equal(request?.paused, 'testers-closed-staging-paused',
    'Fresh owner confirmation of paused staging and closed tester sessions is required')
  let phase = 'local-pins'
  let started = false
  let attempted = false
  try {
    const proof = await io.verifyFiles()
    phase = 'begin-evidence'
    await io.begin()
    started = true
    phase = 'target'
    await io.target()
    phase = 'baseline'
    const before = await io.snapshot('before')
    verifyPauseBaseline(proof.saved, before)
    phase = 'dry-run'
    const cli = await io.dryRun()
    const parsed = verifyReservationPauseDryRun(cli.stdout, cli.stderr, cli.status)
    const dryRun = { ...parsed, project, at: io.now(), noMigrationApplied: true,
      stagingActivityResumed: false }
    await io.record('dry-run.json', dryRun)
    phase = 'pre-apply-target'
    await io.target()
    phase = 'pre-apply-baseline'
    const latest = await io.snapshot('before-apply')
    const baseline = { ...verifyPauseBaseline(proof.saved, latest), at: io.now() }
    same(latest.history, before.history, 'Migration history changed during dry run')
    phase = 'pre-apply-pins'
    await io.verifyFiles()
    verifyPauseApplyReadiness({ ...proof, baseline, dryRun, now: io.now() })
    phase = 'apply-attempt-record'
    await io.record('APPLY-ATTEMPT.json', { project, migration, at: io.now(),
      retryAuthorized: false, enforcementAuthorized: false })
    phase = 'apply'
    attempted = true
    await io.apply() // Exactly one call. A failure/timeout is ambiguous, never retried.
    phase = 'postflight-target'
    await io.target()
    phase = 'postflight'
    const after = await io.snapshot('after')
    verifyPauseHistory(before.history, after.history)
    const postflight = await io.postflight(before, after)
    phase = 'postflight-end'
    const end = await io.snapshot('after-end')
    verifyPauseHistory(before.history, end.history)
    for (const key of [...stable, 'history', 'audit']) same(after[key], end[key], `Postflight ${key} changed`)
    await io.postflight(before, end)
    const result = { result: 'PASS', project, migration, at: io.now(), postflight,
      migrationApplied: true, enforcementApplied: false, stagingActivityResumed: false }
    await io.record('RESULT.json', result)
    return result
  } catch {
    if (started) await io.record('STOP.json', { result: 'STOP', project, phase, at: io.now(),
      applyMayHaveCommitted: attempted, retryAuthorized: false,
      enforcementAuthorized: false, stagingActivityResumed: false })
    // Do not echo query results, CLI diagnostics, or AssertionError diffs.
    throw new Error(`Staging pause stopped in ${phase}; no retry authorized`)
  }
}
