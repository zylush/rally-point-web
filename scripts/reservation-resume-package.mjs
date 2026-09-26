// Filesystem-only candidate packager. No database/network transport is present.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { authorizationCases, concurrencyCases, makeResumeOrders } from './reservation-resume-checks.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const draftRoot = 'docs/release-private/reservation-rpc-resume-20260926-r1'
const defaultPacket = resolve(root, draftRoot, 'frozen')
const draftPath = draftRoot + '/candidate/supabase/migrations/20260926063659_reservation_rpc_resume.sql'
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const read = path => readFileSync(join(root, path))
const text = path => read(path).toString('utf8')
const equal = (a, b, message) => assert.ok(isDeepStrictEqual(a, b), message)
const references = [
  ['docs/release-private/staging-pause-apply-20260926-r1/manifest.json', '4569007c5c0a53b5e0b741caae72f2568724ae083a6b8ac11662143f625e6873'],
  ['docs/release-private/staging-pause-apply-20260926-r1/ATTEMPT.json', '4a8dd9e66e4612f24e0fda9c2a9204b6683cdcfb3ce9734c633b560b50f8c4ff'],
  ['docs/release-private/staging-pause-apply-20260926-r1/evidence-20260926055238597-3b2fe725/STOP.json', '8194538df293baa4c2be69d3bda7e560e2fa03aa28fda8a638fa0d75825393d0'],
  ['docs/release-private/staging-pause-apply-20260926-r2/frozen/manifest.json', '9908a527d40d5979559a844ab5e4a687aa3ee76f6003f48b3064394d35ef574f'],
  ['docs/release-private/staging-pause-apply-20260926-r2/frozen/ATTEMPT.json', 'e8cb9a289e783c00e5dcdf672b96ca013ee2378b9cd05da91f280a06ab6778b6'],
  ['docs/release-private/staging-pause-apply-20260926-r2/frozen/evidence-20260926062023502-ab3905a2/RESULT.json', 'f0f532a746404149d926c6252ad5888a7a0f54e49ee0a99f207ae1cf36e074e2'],
]

export function resumeRunPlan() {
  return { kind: 'prepared-resume-gate23-v1', probeTargetsAreDisposableOnly: true,
    targetWritesUntilProof: 'blocked', stagingResumeAuthorized: false,
    localDatabases: ['rally_resume_gate23_20260926_stage', 'rally_resume_gate23_20260926_clean1', 'rally_resume_gate23_20260926_clean2'],
    requiredNegativeCases: ['missing-proof', 'wrong-role', 'wrong-database', 'wrong-backend',
      'stale-transaction', 'malformed-digest', 'authorization-not-verified', 'concurrency-not-verified',
      'missing-enforcement', 'wrong-exclusion-definition', 'direct-column-grant', 'catalog-drift',
      'already-callable-rpc', 'missing-read'],
    authorizationCases, concurrencyCases,
    stages: [
      'verify-explicit-disposable-target-and-approved-manifest-before-any-connection',
      'replay-each-order-through-enforced-pause-on-isolated-clones-with-seed',
      'run-negative-guard-tests-and-66-row-pause-audit-before-probes',
      'temporarily-grant-only-nine-authenticated-rpcs-on-disposable-probe-clones',
      'run-every-sql-suite-and-independent-connection-concurrency-scenarios',
      'restore-pause-and-synthetic-data-baseline-on-probe-clones-and-verify',
      'review-and-pin-raw-evidence-for-both-orders-and-convergent-schema',
      'bind-approved-proof-to-current-target-baseline-catalog-session-and-transaction',
      'execute-resume-and-ledger-entry-in-one-transaction-with-postflight-before-commit',
      'repeat-allowed-denied-and-concurrency-tests-on-resumed-disposable-clones',
      'complete-two-independent-clean-replays-and-compare-final-fingerprints',
    ],
    requiredPostflight: ['only-nine-authenticated-execute-grants-and-ledger-entry',
      'both-sequences-and-unrelated-data-unchanged', 'all-existing-ledger-rows-unchanged',
      'all-direct-writes-still-denied', 'all-unrelated-catalog-and-grants-unchanged',
      '66-resume-permission-checks-pass', 'attestation-consumed-and-repeat-denied'],
    holds: 'No payment holds are introduced; cancellation and completion release are required. Expiring-payment-hold tests remain out of scope.',
    transportIncluded: false, rehearsalApprovalRequired: true }
}

export function resumeNegativeSql(draft) {
  assert.ok(typeof draft === 'string' && draft.includes('do $') && !draft.includes('$resume_candidate$'), 'Unsafe draft text')
  const state = text('supabase/verification/reservation_resume_state.sql').trim()
    .replace(' as snapshot_md5\n', ' into v_snapshot\n')
  const evidence = `create function pg_temp.resume_test_evidence() returns jsonb language plpgsql as $test_evidence$
declare v_snapshot text;
begin
${state}
return jsonb_build_object('database', current_database(), 'backend_pid', pg_backend_pid(),
  'transaction_id', pg_current_xact_id()::text, 'proof_sha256', repeat('0',64),
  'package_sha256', repeat('0',64), 'snapshot_md5', v_snapshot,
  'enforcement_verified', true, 'authorization_verified', true, 'concurrency_verified', true, 'orders_verified', 2);
end $test_evidence$;`
  const missing = 'verified reservation resume evidence missing or not bound to this transaction'
  const cases = [
    ['missing-proof', '', "select set_config('rally.reservation_resume_evidence', '', true);", missing],
    ['wrong-role', '', 'set local role authenticated;', 'reservation resume requires the postgres migration session'],
    ...[['wrong-database', 'database', 'wrong'], ['wrong-backend', 'backend_pid', '-1'],
      ['stale-transaction', 'transaction_id', '0'], ['malformed-digest', 'proof_sha256', 'x'],
      ['authorization-not-verified', 'authorization_verified', 'false'],
      ['concurrency-not-verified', 'concurrency_verified', 'false']].map(([name, key, value]) =>
      [name, '', `select set_config('rally.reservation_resume_evidence',
        jsonb_set(pg_temp.resume_test_evidence(), '{${key}}', to_jsonb('${value}'::text))::text, true);`, missing]),
    ['missing-enforcement', "delete from supabase_migrations.schema_migrations where version = '20260921111105';", '',
      'reservation resume requires the exact enforced and paused migration history'],
    ['wrong-exclusion-definition', `alter table public.court_allocations drop constraint court_allocations_no_overlap;
      alter table public.court_allocations add constraint court_allocations_no_overlap
        exclude using gist (court_id with =, interval with &&) where (false);`, '', 'validated court overlap enforcement is required'],
    ['direct-column-grant', 'grant update (status) on public.bookings to authenticated;', '', 'reservation direct-write permission is not paused'],
    ['catalog-drift', '', 'alter function public.cancel_booking_reservation(uuid) cost 999;', 'reservation resume catalog drift'],
    ['already-callable-rpc', 'grant execute on function public.cancel_booking_reservation(uuid) to authenticated;', '', 'reservation RPC is not paused'],
    ['missing-read', 'revoke select on public.courts from authenticated;', '', 'reservation resume read/RLS prerequisite missing'],
  ]
  return `-- DISPOSABLE-LOCAL ONLY. Owner test attestations below are intentionally synthetic.
-- Never use them as real readiness proof. Every operation rolls back.
begin;
do $local_only$ begin
  if current_database() not in ('rally_resume_gate23_20260926_stage',
    'rally_resume_gate23_20260926_clean1', 'rally_resume_gate23_20260926_clean2') then
    raise exception 'Disposable resume rehearsal database required';
  end if;
end $local_only$;
create extension if not exists pgtap with schema extensions;
set local search_path = pg_catalog, public, extensions;
${evidence}
create function pg_temp.resume_attempt(before_sql text, after_sql text) returns text
language plpgsql as $negative_attempt$
declare failure_state text; failure_message text;
begin
  -- The exception subtransaction rolls back setup AND candidate effects before
  -- TAP records its assertion. Even unexpected success is rolled back.
  begin
    if before_sql <> '' then execute before_sql; end if;
    perform set_config('rally.reservation_resume_evidence', pg_temp.resume_test_evidence()::text, true);
    if after_sql <> '' then execute after_sql; end if;
    execute $resume_candidate$${draft}$resume_candidate$;
    raise exception using errcode = 'P9999', message = 'candidate unexpectedly succeeded';
  exception when others then
    get stacked diagnostics failure_state = returned_sqlstate, failure_message = message_text;
  end;
  return failure_state || ':' || failure_message;
end $negative_attempt$;
select extensions.plan(${cases.length});
${cases.map(([name, before, after, error]) => `select extensions.is(pg_temp.resume_attempt(
  $before$${before}$before$, $after$${after}$after$), 'P0001:${error}', '${name}');`).join('\n')}
select * from extensions.finish();
rollback;
`
}

function packetPath(value) {
  const path = resolve(value)
  const rel = relative(root, path).replaceAll('\\', '/')
  assert.ok(/^docs\/release-private\/[a-zA-Z0-9_/-]+$/.test(rel), 'Package must stay private and repository-local')
  let partPath = root
  for (const part of rel.split('/')) {
    partPath = join(partPath, part)
    if (existsSync(partPath)) assert.ok(!lstatSync(partPath).isSymbolicLink(), 'Package links forbidden')
  }
  return path
}

function inventory(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    assert.ok(!entry.isSymbolicLink(), 'Artifact links forbidden')
    const path = prefix + entry.name
    return entry.isDirectory() ? inventory(join(directory, entry.name), path + '/') : [path]
  }).sort()
}

function material() {
  for (const [path, digest] of references) assert.equal(sha(read(path)), digest, 'Preserved reference changed')
  // Also verify every source/reference pinned by the consumed r2 manifest.
  const frozen = JSON.parse(text(references[3][0]))
  for (const row of [...frozen.sources, ...frozen.references]) assert.equal(sha(read(row.path)), row.sha256, 'Frozen source/reference changed')
  const names = readdirSync(join(root, 'supabase/migrations')).filter(n => n.endsWith('.sql')).sort()
  const orders = makeResumeOrders(names, draftPath.split('/').at(-1))
  const suites = readdirSync(join(root, 'supabase/tests/database')).filter(n => n.endsWith('.test.sql')).sort()
  assert.equal(suites.length, 8, 'SQL suite inventory changed; review required')
  const files = new Map()
  for (const name of names) files.set('database/supabase/migrations/' + name, read('supabase/migrations/' + name))
  files.set('database/supabase/migrations/' + draftPath.split('/').at(-1), read(draftPath))
  files.set('database/supabase/seed.sql', read('supabase/seed.sql'))
  for (const name of suites) files.set('database/supabase/tests/database/' + name, read('supabase/tests/database/' + name))
  for (const name of ['reservation_resume_state.sql', 'reservation_write_pause_readonly.sql',
    'schema_fingerprint.sql', 'restore_catalog_snapshot.sql', 'backup_content_inventory.sql', 'tenant_grant_snapshot.sql']) {
    files.set('checks/' + name, read('supabase/verification/' + name))
  }
  files.set('checks/reservation_resume_negative.sql', Buffer.from(resumeNegativeSql(text(draftPath))))
  const pauseAudit = text('supabase/verification/reservation_write_pause_readonly.sql')
  const pausedCheck = "or coalesce(has_function_privilege(r.name, to_regprocedure('public.' || f.signature), 'EXECUTE'), true)"
  assert.equal(pauseAudit.split(pausedCheck).length, 2, 'Pause audit format changed')
  files.set('checks/reservation_resume_readonly.sql', Buffer.from(pauseAudit
    .replace(/--[^\n]*\n/g, '')
    .replace(pausedCheck, "or (has_function_privilege(r.name, to_regprocedure('public.' || f.signature), 'EXECUTE') is distinct from (r.name = 'authenticated'))")))
  files.set('checks/run-plan.json', Buffer.from(JSON.stringify(resumeRunPlan(), null, 2) + '\n'))
  for (const name of ['reservation-resume-checks.mjs', 'reservation-resume-package.mjs']) files.set('source/' + name, read('scripts/' + name))
  // Provenance copies must not become a second discoverable Vitest suite.
  for (const name of ['reservation-resume.test.ts', 'reservation-resume-package.test.ts']) files.set('regression/' + name + '.txt', read('tests/' + name))
  const manifest = { kind: 'local-reservation-resume-candidate-v1', productionOrStagingExecutable: false,
    readyProofIncluded: false, migrationCount: names.length + 1, sqlSuiteCount: suites.length,
    orders, gate3: { cleanReplaysRequired: 2, loadSeed: true, allSqlSuites: suites },
    references: references.map(([path, sha256]) => ({ path, sha256 })),
    files: [...files].map(([path, bytes]) => ({ path, sha256: sha(bytes) })).sort((a, b) => a.path.localeCompare(b.path)) }
  return { files, manifest }
}

export function verifyResumePackage(directory = defaultPacket) {
  const packet = packetPath(directory)
  const { files, manifest } = material()
  equal(JSON.parse(readFileSync(join(packet, 'manifest.json'), 'utf8')), manifest, 'Candidate manifest differs')
  equal(inventory(packet), [...files.keys(), 'manifest.json'].sort(), 'Candidate inventory differs')
  for (const [path, bytes] of files) assert.equal(sha(readFileSync(join(packet, path))), sha(bytes), 'Candidate bytes differ')
  return { result: 'LOCAL_PREPARED_NOT_REHEARSED', migrationCount: manifest.migrationCount,
    sqlSuiteCount: manifest.sqlSuiteCount, files: files.size, manifestSha256: sha(readFileSync(join(packet, 'manifest.json'))),
    databaseContacted: false, rehearsalExecuted: false, stagingResumeAuthorized: false }
}

export function prepareResumePackage(directory = defaultPacket) {
  const packet = packetPath(directory)
  assert.ok(!existsSync(packet), 'Never overwrite a candidate package')
  const { files, manifest } = material()
  mkdirSync(packet)
  for (const [path, bytes] of files) {
    const target = join(packet, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, bytes, { flag: 'wx' })
  }
  writeFileSync(join(packet, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' })
  return verifyResumePackage(packet)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.ok(process.argv.length === 3 && ['--prepare-local', '--verify-local'].includes(process.argv[2]),
    'Only --prepare-local or --verify-local is supported; no database execution mode')
  console.log(JSON.stringify(process.argv[2] === '--prepare-local' ? prepareResumePackage() : verifyResumePackage(), null, 2))
}
