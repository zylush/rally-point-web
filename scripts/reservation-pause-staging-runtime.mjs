import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { runPauseApplication } from './reservation-pause-staging-flow.mjs'
import { pauseApplyArguments, pauseApplyMode } from './reservation-pause-staging-apply-checks.mjs'
import { verifyStagingTarget } from './r9-readonly-compare.mjs'
import { normalizeLocalActivity, normalizeLocalInventory, unwrapCapturedReadOnly } from './reservation-pause-local-rehearsal-checks.mjs'
import { verifyReservationPausePostflight } from './reservation-pause-postflight-checks.mjs'
import { artifactFiles, capturePath, checkedPath, cli, cliHash, frozenPauseInputs, linkedCachePath, migrationPath,
  preparePauseRunner, project, runnerPaths, shaBytes, snapshotNames, verifyPauseRunner } from './reservation-pause-runner-files.mjs'
export { preparePauseRunner, verifyPauseRunner }

// Retain credentials only in the child environment. Do not inherit alternate
// target, loader, debug, profile, or proxy settings from the parent process.
export function pauseCliEnvironment(env) {
  const credentials = new Set(['SUPABASE_ACCESS_TOKEN', 'SUPABASE_DB_PASSWORD'])
  for (const key of Object.keys(env)) assert.ok(!(/^SUPABASE_|^PG|^DATABASE_URL$/i.test(key) &&
    !credentials.has(key.toUpperCase())), 'CLI target/environment override is forbidden')
  const system = new Set(['PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP',
    'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'HOMEDRIVE', 'HOMEPATH'])
  return Object.fromEntries(Object.entries(env).filter(([key, value]) => typeof value === 'string' &&
    (system.has(key.toUpperCase()) || credentials.has(key.toUpperCase()))))
}

// One child per command, no shell and no retry. Timeout during push is ambiguous.
export function executePauseCli(program, args, options) {
  return new Promise(resolve => {
    const child = spawn(program, args, { ...options, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const chunks = { stdout: [], stderr: [] }
    let bytes = 0
    let failed = false
    const timer = setTimeout(() => { failed = true; child.kill() }, 60000)
    for (const stream of ['stdout', 'stderr']) child[stream].on('data', data => {
      bytes += data.length
      if (bytes > 32 * 1024 * 1024) { failed = true; child.kill() }
      else chunks[stream].push(data)
    })
    child.on('error', () => { failed = true })
    child.on('close', status => {
      clearTimeout(timer)
      resolve({ status: failed ? null : status,
        stdout: Buffer.concat(chunks.stdout).toString('utf8'), stderr: Buffer.concat(chunks.stderr).toString('utf8') })
    })
  })
}

export function createPauseRuntime(options = {}) {
  const { root, packet } = runnerPaths(options)
  const run = options.run || executePauseCli
  const now = options.now || (() => new Date().toISOString())
  const approvalEnv = options.env || process.env
  const env = pauseCliEnvironment(approvalEnv)
  let evidence
  let operator
  let queryHashes
  let migrationHashes
  let commandIndex = 0
  let applied = false
  const save = (name, value) => {
    assert.ok(evidence, 'Evidence directory not initialized')
    const path = checkedPath(evidence, name, true)
    writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
  }
  const verifyIsolated = () => {
    assert.ok(operator && queryHashes && migrationHashes, 'Isolated operator not ready')
    const supabase = join(operator, 'supabase')
    const paths = artifactFiles(supabase)
    // Include only the cache already observed in the verified CLI dry run.
    assert.ok(isDeepStrictEqual(paths, [...Object.keys(migrationHashes), '.temp/project-ref', '.temp/linked-project.json'].sort()),
      'Isolated operator file inventory changed')
    assert.equal(readFileSync(checkedPath(supabase, '.temp/project-ref'), 'utf8'), project + '\n', 'Target ref drift')
    assert.ok(isDeepStrictEqual(JSON.parse(readFileSync(checkedPath(supabase, '.temp/linked-project.json'), 'utf8')),
      JSON.parse(readFileSync(checkedPath(root, linkedCachePath), 'utf8'))), 'Linked project cache drift')
    for (const [path, hash] of Object.entries(migrationHashes)) assert.ok(
      shaBytes(readFileSync(checkedPath(supabase, path))) === hash, 'Isolated migration bytes changed')
    assert.ok(isDeepStrictEqual(artifactFiles(join(evidence, 'queries')), Object.keys(queryHashes).sort()), 'Query inventory changed')
    for (const [path, hash] of Object.entries(queryHashes)) assert.ok(
      shaBytes(readFileSync(checkedPath(join(evidence, 'queries'), path))) === hash, 'Read-only query bytes changed')
    assert.ok(shaBytes(readFileSync(cli)) === cliHash, 'CLI binary drift')
  }
  const command = async (label, args) => {
    verifyIsolated()
    const prefix = `${String(++commandIndex).padStart(3, '0')}-${label}`
    save(prefix + '.command.json', { program: cli, args, at: now() })
    const result = await run(cli, args, { cwd: operator, env })
    save(prefix + '.stdout.private', result.stdout || '')
    save(prefix + '.stderr.private', result.stderr || '')
    save(prefix + '.exit.json', { status: result.status, at: now() })
    assert.equal(result.status, 0, 'CLI command failed; see private evidence')
    return result
  }
  const query = async (phase, name) => {
    const result = await command(phase + '-' + name, ['db', 'query', '--linked', '--workdir', operator,
      '--file', join(evidence, 'queries', name + '.sql'), '--output-format', 'json'])
    const parsed = JSON.parse(result.stdout)
    assert.ok(parsed && Array.isArray(parsed.rows), 'CLI query rows missing')
    save(phase + '-' + name + '.json', parsed.rows)
    return parsed.rows
  }
  return {
    now, evidence: () => evidence,
    verifyFiles: async () => {
      verifyPauseRunner(options)
      if (operator) verifyIsolated()
      return frozenPauseInputs(root)
    },
    begin: async () => {
      pauseApplyMode('--apply-approved', approvalEnv.RALLY_STAGING_PAUSE_APPLY_APPROVED)
      assert.equal(approvalEnv.RALLY_STAGING_PAUSED_CONFIRMED, 'testers-closed-staging-paused', 'Fresh paused-staging confirmation required')
      assert.match(options.manifestSha256 || '', /^[a-f0-9]{64}$/, 'Approved manifest digest required')
      verifyPauseRunner(options)
      assert.ok(!evidence && !existsSync(join(packet, 'ATTEMPT.json')), 'One-shot attempt already consumed')
      const name = `evidence-${now().replace(/[-:.TZ]/g, '')}-${randomBytes(4).toString('hex')}`
      // Exclusive claim persists even on interruption. Never remove it to retry.
      writeFileSync(join(packet, 'ATTEMPT.json'), JSON.stringify({ project, name, at: now(), retryAuthorized: false }), { flag: 'wx' })
      evidence = join(packet, name)
      mkdirSync(evidence)
      try {
        save('scope.json', { project, manifestSha256: options.manifestSha256, migration: '20260925174111_reservation_write_pause.sql',
          enforcementAuthorized: false, stagingActivityResumeAuthorized: false, at: now() })
        const proof = frozenPauseInputs(root)
        operator = join(evidence, 'operator')
        migrationHashes = {}
        for (const row of proof.migrations.files.filter(row => row.path.startsWith('database/supabase/'))) {
          const path = row.path.slice('database/supabase/'.length)
          const destination = join(operator, 'supabase', path)
          mkdirSync(dirname(destination), { recursive: true })
          writeFileSync(destination, readFileSync(checkedPath(root, migrationPath + '/' + row.path)), { flag: 'wx' })
          migrationHashes[path] = row.sha256
        }
        mkdirSync(join(operator, 'supabase/.temp'))
        writeFileSync(join(operator, 'supabase/.temp/project-ref'), project + '\n', { flag: 'wx' })
        writeFileSync(join(operator, 'supabase/.temp/linked-project.json'), readFileSync(checkedPath(root, linkedCachePath)), { flag: 'wx' })
        mkdirSync(join(evidence, 'queries'))
        const sql = Object.fromEntries(snapshotNames.map(name => [name,
          readFileSync(checkedPath(root, `${capturePath}/before_${name}.sql`), 'utf8')]))
        sql.history = 'begin read only;\nselect version, name, statements from supabase_migrations.schema_migrations order by version;\ncommit;\n'
        sql.audit = 'begin read only;\n' + readFileSync(checkedPath(root,
          migrationPath + '/checks/reservation_write_pause_readonly.sql'), 'utf8') + '\ncommit;\n'
        queryHashes = {}
        for (const [name, text] of Object.entries(sql)) {
          unwrapCapturedReadOnly(text)
          writeFileSync(join(evidence, 'queries', name + '.sql'), text, { flag: 'wx' })
          queryHashes[name + '.sql'] = shaBytes(text)
        }
        verifyIsolated()
      } catch {
        save('STOP.json', { result: 'STOP', phase: 'isolate-package', project, at: now(), applyMayHaveCommitted: false, retryAuthorized: false })
        throw new Error('Local isolation failed; no retry authorized')
      }
    },
    record: async (name, value) => save(name, value),
    target: async () => {
      const version = await command('version', ['--version'])
      assert.equal(version.stdout.trim(), '2.110.0', 'CLI version drift')
      const response = JSON.parse((await command('target', ['projects', 'list', '--workdir', operator, '--output-format', 'json'])).stdout)
      verifyStagingTarget(response)
      assert.equal(response.projects.find(row => row.id === project).database?.version, '17.6.1.147', 'PostgreSQL version drift')
    },
    snapshot: async phase => {
      assert.ok(['before', 'before-apply', 'after', 'after-end'].includes(phase), 'Unexpected snapshot phase')
      const result = {}
      for (const name of [...snapshotNames, 'history', ...(phase.startsWith('after') ? ['audit'] : [])]) result[name] = await query(phase, name)
      return result
    },
    dryRun: () => command('dry-run', ['db', 'push', '--linked', '--dry-run', '--workdir', operator, '--output-format', 'json']),
    apply: async () => {
      assert.ok(!applied && evidence && existsSync(join(evidence, 'APPLY-ATTEMPT.json')), 'Apply requires a single recorded attempt')
      applied = true
      await command('apply', pauseApplyArguments(operator))
    },
    postflight: async (before, after) => verifyReservationPausePostflight({
      beforeInventory: normalizeLocalInventory(before.inventory), afterInventory: normalizeLocalInventory(after.inventory),
      beforeGrants: before.grants, afterGrants: after.grants, beforeCatalog: before.catalog, afterCatalog: after.catalog,
      beforeSequences: before.sequences, afterSequences: after.sequences,
      beforeActivity: normalizeLocalActivity(before.activity), afterActivity: normalizeLocalActivity(after.activity), audit: after.audit,
    }),
  }
}

export async function runPauseCommand(args, env = process.env, options = {}) {
  assert.equal(args.length, 1, 'Exactly one explicit mode is required')
  if (args[0] === '--prepare-local') return preparePauseRunner(options)
  if (args[0] === '--verify-local') return verifyPauseRunner(options)
  pauseApplyMode(args[0], env.RALLY_STAGING_PAUSE_APPLY_APPROVED)
  assert.equal(env.RALLY_STAGING_PAUSED_CONFIRMED, 'testers-closed-staging-paused', 'Fresh paused-staging confirmation required')
  assert.match(env.RALLY_STAGING_PAUSE_MANIFEST_SHA256 || '', /^[a-f0-9]{64}$/, 'Approved manifest digest required')
  const runtimeOptions = { ...options, env, manifestSha256: env.RALLY_STAGING_PAUSE_MANIFEST_SHA256 }
  const io = createPauseRuntime(runtimeOptions)
  const result = await runPauseApplication(io, { approval: env.RALLY_STAGING_PAUSE_APPLY_APPROVED, paused: env.RALLY_STAGING_PAUSED_CONFIRMED })
  return { ...result, evidence: io.evidence() }
}
