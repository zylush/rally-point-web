import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import {
  assertLocalRunIntent,
  assertLegacyBaseline,
  assertFrozenBaseline,
  assertSqlSuite,
  parseTapResults,
} from '../supabase/verification/gate2-client-coexistence-guards.mjs'

const versions = ['001', '002', '003', '004', '20260803125450',
  '20260805094557', '20260921090000', '20260921110828']

test('requires explicit local rollback-only intent and a new private report name', () => {
  assert.equal(assertLocalRunIntent({
    RALLY_GATE2_LOCAL_COMPATIBILITY: 'rollback-only-approved',
    RALLY_GATE2_COMPATIBILITY_REPORT: 'gate2-client-coexistence-20260925-a.json',
  }, false), 'gate2-client-coexistence-20260925-a.json')
  assert.throws(() => assertLocalRunIntent({}, false), /explicit local approval guard/)
  assert.throws(() => assertLocalRunIntent({
    RALLY_GATE2_LOCAL_COMPATIBILITY: 'rollback-only-approved',
    RALLY_GATE2_COMPATIBILITY_REPORT: '../outside.json',
  }, false), /private report name/)
  assert.throws(() => assertLocalRunIntent({
    RALLY_GATE2_LOCAL_COMPATIBILITY: 'rollback-only-approved',
    RALLY_GATE2_COMPATIBILITY_REPORT: 'gate2-client-coexistence-20260925-a.json',
  }, true), /overwrite/)
})

test('rejects drifted or partially enforced baseline', () => {
  assert.doesNotThrow(() => assertLegacyBaseline(versions, 0, 0))
  assert.throws(() => assertLegacyBaseline(versions.slice(0, -1), 0, 0), /migration ledger/)
  assert.throws(() => assertLegacyBaseline(versions, 1, 0), /another client/)
  assert.throws(() => assertLegacyBaseline(versions, 0, 1), /enforcement/)
})

test('requires the previously verified local fingerprint and inventory shape', () => {
  const marker = '84b7d8e1718ce03e130af200b62def46'
  assert.doesNotThrow(() => assertFrozenBaseline(marker, 604, 52))
  assert.throws(() => assertFrozenBaseline('00000000000000000000000000000000', 604, 52), /fingerprint/)
  assert.throws(() => assertFrozenBaseline(marker, 603, 52), /fingerprint rows/)
  assert.throws(() => assertFrozenBaseline(marker, 604, 51), /inventory rows/)
})

test('SQL suites must be transaction-owned by the runner and emit one TAP plan', () => {
  assert.doesNotThrow(() => assertSqlSuite('select extensions.plan(2); select * from extensions.finish();'))
  assert.throws(() => assertSqlSuite('begin; select extensions.plan(1); select * from extensions.finish();'), /transaction control/)
  assert.throws(() => assertSqlSuite('select extensions.plan(1); commit; select * from extensions.finish();'), /transaction control/)
  assert.throws(() => assertSqlSuite('select extensions.plan(1);'), /TAP finish/)
  assert.throws(() => assertSqlSuite('select * from extensions.finish();'), /TAP plan/)
})

test('TAP parser counts exact successes and rejects a failed or mismatched test', () => {
  const result = [
    { command: 'SET', rows: [] },
    { command: 'SELECT', rows: [{ plan: '1..2' }] },
    { command: 'SELECT', rows: [{ ok: 'ok 1 - legacy booking' }] },
    { command: 'SELECT', rows: [{ ok: 'ok 2 - legacy charge' }] },
    { command: 'SELECT', rows: [{ finish: '# Looks like you passed 2 tests' }] },
  ]
  assert.equal(parseTapResults(result, 'legacy'), 2)
  assert.throws(() => parseTapResults(result.slice(0, -2).concat({ command: 'SELECT', rows: [{ ok: 'not ok 2 - broken' }] }), 'legacy'), /failed TAP/)
  assert.throws(() => parseTapResults(result.slice(0, -2), 'legacy'), /TAP count/)
})

test('prepare mode checks both local suites without connecting to a database', () => {
  const result = spawnSync(process.execPath,
    ['supabase/verification/verify_gate2_client_coexistence.mjs', '--prepare'],
    { cwd: new URL('../', import.meta.url), encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.equal(report.mode, 'prepare')
  assert.equal(report.databaseContacted, false)
  assert.deepEqual(report.suites.map((row) => row.name), ['legacy-expanded-backfilled', 'r9-repaired-pre-enforcement'])
})

test('run mode refuses to contact the database without the approval guard', () => {
  const result = spawnSync(process.execPath,
    ['supabase/verification/verify_gate2_client_coexistence.mjs', '--run'],
    { cwd: new URL('../', import.meta.url), encoding: 'utf8', env: {
      ...process.env,
      RALLY_GATE2_LOCAL_COMPATIBILITY: '',
      RALLY_GATE2_COMPATIBILITY_REPORT: '',
      RALLY_GATE2_DB_PASSWORD: '',
    } })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /explicit local approval guard/)
  assert.doesNotMatch(result.stdout, /PASS|legacy-expanded-backfilled/)
})
