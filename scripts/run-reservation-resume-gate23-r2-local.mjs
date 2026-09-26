// One-shot, disposable-local Gate 2/3 rehearsal. No linked-project/remote path.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import pg from 'pg'
import { databases, manifestSha256, localConfig, verifyDockerEndpoint, createFresh,
  parseTap, executeOnce, verifyLoopbackContainer, verifySocketIdentity,
  verifyPostgresIdentity } from './reservation-resume-executor-guards-r2.mjs'
import { authorizationEvidence, concurrency, deniedWrites } from './reservation-resume-local-probes.mjs'
import { baseMigrations, orderNames, reservationRpcs, validateResumeProof,
  verifyResumeDelta } from './reservation-resume-checks.mjs'
import { verifyResumePackage } from './reservation-resume-package.mjs'
import { selectRows } from '../supabase/verification/pg-query-rows.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const frozen = join(root, 'docs/release-private/reservation-rpc-resume-20260926-r1/frozen')
const evidence = join(root, 'docs/release-private/reservation-resume-gate23-20260926-r2')
const platform = join(root, 'docs/release-private/staging-backup-20260921')
const dockerExe = 'C:/Users/ed/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe'
const resumeName = '20260926063659_reservation_rpc_resume.sql'
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const read = path => readFileSync(path, 'utf8').replace(/^\uFEFF/, '')
const frozenFile = path => read(join(frozen, path))
const frozenSql = name => frozenFile('checks/' + name)
const platformFiles = [
  ['managed_before_app.sql', '1362786cb937ae58addd1c41ba135f6f73247f979f2b164df5c698f2a0a7d617'],
  ['history_schema.sql', '18b99fbbb3ec9fbb964bb255a56171329acd99b6977ece2addd89fdf5aa5105b'],
]
const consumedFiles = [
  ['docs/release-private/reservation-resume-gate23-20260926-r1/ATTEMPT.json',
    '199e3964e72d5f0d32cd438c5b97b04c7080bf00b58cfae14771b43cba70bcd9'],
  ['docs/release-private/reservation-resume-gate23-20260926-r1/STOP.json',
    'b7db0a77d199959df7d0d5b537fe307cfe16d4c885f9c26737d598f30104f344'],
  ['docs/release-private/reservation-resume-gate23-diagnostic-20260926-r1/evidence/STOP.json',
    '6afa752f4cdd9baa5ffe0bf081903802082fdbf8eaeaef782a94af95a4848f2d'],
  ['scripts/run-reservation-resume-gate23-local.mjs',
    'c215833f8f28e8165b8a71f5597c58376f5fa9fad08862707b81cbfdf2705a6f'],
  ['scripts/reservation-resume-executor-guards.mjs',
    '58ebe414c3f84f48d6c282fe8bbb577364febf800684358048054fc27a877cf0'],
]
const sequenceSql = `select n.nspname as schema_name,c.relname as sequence_name,
 query_to_xml(format('select last_value,is_called from %I.%I',n.nspname,c.relname),false,true,'')::text as state
 from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='S'
 and n.nspname in ('public','private','auth','storage','supabase_migrations')
 order by n.nspname,c.relname`
const activitySql = `select (select count(*) from pg_stat_activity where datname=current_database()
 and pid<>pg_backend_pid() and backend_type='client backend'
 and state in ('active','idle in transaction')) as other_active_clients,
 (select jsonb_agg(jsonb_build_object('schema',schemaname,'table',relname,'inserted',n_tup_ins,
 'updated',n_tup_upd,'deleted',n_tup_del) order by schemaname,relname)
 from pg_stat_user_tables where schemaname in ('public','private','auth','storage','supabase_migrations')) as writes`
const historySql = 'select version, statements, name from supabase_migrations.schema_migrations order by version'

function checkedFiles() {
  for (const [path, digest] of consumedFiles)
    assert.equal(sha(readFileSync(join(root, path))), digest, 'Consumed rehearsal evidence/source changed')
  const result = verifyResumePackage(frozen)
  assert.equal(result.manifestSha256, manifestSha256, 'Frozen resume package changed')
  for (const [name, digest] of platformFiles)
    assert.equal(sha(readFileSync(join(platform, name))), digest, 'Pinned platform bootstrap changed')
  const manifest = JSON.parse(frozenFile('manifest.json'))
  const plan = JSON.parse(frozenSql('run-plan.json'))
  assert.deepEqual(plan.localDatabases, databases, 'Frozen database list changed')
  assert.deepEqual(manifest.orders.map(o => o.order), orderNames, 'Frozen order plan changed')
  assert.equal(manifest.migrationCount, 16)
  assert.equal(manifest.sqlSuiteCount, 8)
  assert.equal(manifest.files.length, 38)
  assert.ok(!manifest.readyProofIncluded && !manifest.productionOrStagingExecutable)
  const suiteNames = manifest.gate3.allSqlSuites
  assert.equal(suiteNames.length, 8)
  return { manifest, plan, suiteNames }
}

function save(name, object) {
  assert.match(name, /^[a-zA-Z0-9_.-]+$/)
  const path = join(evidence, name)
  writeFileSync(path, typeof object === 'string' ? object : JSON.stringify(object, null, 2) + '\n', { flag: 'wx' })
  return sha(readFileSync(path))
}

let contextName
function docker(args, input = '') {
  const out = spawnSync(dockerExe, contextName ? ['--context', contextName, ...args] : args, { input, encoding: 'utf8', shell: false,
    timeout: 120000, maxBuffer: 16 * 1024 * 1024, stdio: ['pipe','pipe','pipe'] })
  if (out.status !== 0) {
    const name = `failure-${String(phase).replaceAll(/[^a-z0-9-]/g,'-')}.private.txt`
    if (!existsSync(join(evidence,name))) save(name, { status: out.status, signal: out.signal,
      errorCode: out.error?.code ?? null })
    throw new Error('Local Docker/psql command failed; private diagnostic retained')
  }
  return out.stdout.trim()
}

function psql(database, sql) {
  assert.ok(databases.includes(database), 'Unapproved psql target')
  return docker(['exec','-i','supabase_db_rally-point-web','psql','-X','-q','-A','-t',
    '-v','ON_ERROR_STOP=1','-U','postgres','-d',database], sql)
}

function connect(database, password) {
  const client = new pg.Client(localConfig(database, password))
  return client.connect().then(() => client)
}

function socketIdentity() {
  const sql = `begin read only;
    select jsonb_build_object('db',current_database(),'role',current_user,
      'version',current_setting('server_version'),'address',inet_server_addr()::text,
      'port',inet_server_port(),'cluster_id',s.system_identifier::text,
      'data_directory',current_setting('data_directory'),
      'postmaster_started',pg_postmaster_start_time()::text)::text
    from pg_control_system() as s;
    rollback;`
  const lines = docker(['exec','-i','supabase_db_rally-point-web','psql','-X','-q','-A','-t','-w',
    '-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'], sql).split(/\r?\n/).filter(Boolean)
  assert.equal(lines.length, 1, 'Unexpected Docker-socket identity response')
  return verifySocketIdentity(JSON.parse(lines[0]))
}

async function identity(client, database, addresses, socket) {
  const { rows: [row] } = await client.query(`select current_database() as db,
    current_user as role, current_setting('server_version') as version,
    inet_server_addr()::text as address, inet_server_port() as port,
    s.system_identifier::text as cluster_id,
    current_setting('data_directory') as data_directory,
    pg_postmaster_start_time()::text as postmaster_started,
    (select count(*)::int from pg_stat_activity where datname=current_database()
      and pid<>pg_backend_pid() and backend_type='client backend') as other_clients
    from pg_control_system() as s`)
  verifyPostgresIdentity(row, database, addresses, socket)
}

async function snapshot(client) {
  const query = async (sql, label) => selectRows(await client.query(sql), label)
  const result = {
    fingerprint: await query(frozenSql('schema_fingerprint.sql'),'fingerprint'),
    catalog: await query(frozenSql('restore_catalog_snapshot.sql'),'catalog'),
    inventory: await query(frozenSql('backup_content_inventory.sql'),'inventory'),
    grants: await query(frozenSql('tenant_grant_snapshot.sql'),'grants'),
    sequences: await query(sequenceSql,'sequences'),
    activity: await query(activitySql,'activity'),
    history: await query(historySql,'history'),
  }
  assert.equal(result.fingerprint.filter(r=>r.category==='!fingerprint').length,1)
  assert.equal(result.catalog.length,1)
  assert.equal(result.grants.length,1)
  assert.equal(Number(result.activity[0].other_active_clients),0)
  return result
}

function stateWithoutActivity(state) {
  const { activity: _activity, ...rest } = state
  return rest
}

function invariantState(before, after, label) {
  assert.ok(isDeepStrictEqual(stateWithoutActivity(before), stateWithoutActivity(after)),
    `${label}: database state did not return to the paused baseline`)
}

async function audit(client, name) {
  const rows = selectRows(await client.query(frozenSql(name)), name)
  assert.equal(rows.length,66, 'Permission audit row count differs')
  assert.ok(rows.every(r=>r.violation===false), 'Reservation permission audit failed')
  return rows
}

async function sqlSuites(database, suiteNames, section) {
  const results = [], raw = []
  for (const name of suiteNames) {
    const lines = psql(database, frozenFile('database/supabase/tests/database/'+name)).split(/\r?\n/)
    raw.push({ name, lines })
    // Save the complete, observed TAP result before trusting its parser.
    save(`${section}-${name}.json`, { name, lines })
    results.push(parseTap(lines,name))
  }
  return { results, raw }
}

async function applyMigration(client, database, name) {
  assert.ok(baseMigrations.includes(name), 'Only the 15 frozen historical migrations replay here')
  const sql = frozenFile('database/supabase/migrations/'+name)
  const version = name.split('_')[0]
  psql(database, `set search_path=public,extensions;\n${sql}`)
  const title = name.slice(version.length+1,-4)
  await client.query('insert into supabase_migrations.schema_migrations(version,statements,name) values ($1,$2,$3)',
    [version,[sql],title])
  const versions = (await client.query('select version from supabase_migrations.schema_migrations order by version')).rows.map(r=>r.version)
  assert.equal(versions.length, new Set(versions).size, 'Duplicate migration ledger entry')
  record({ phase:'migration', database, version, sha256:sha(sql), versions:versions.length })
}

async function bootstrap(client, database) {
  const check = (await client.query(`select count(*)::int as n from pg_class c join pg_namespace n
    on n.oid=c.relnamespace where n.nspname not in ('pg_catalog','information_schema')
    and n.nspname not like 'pg_toast%' and c.relkind in ('r','p')`)).rows[0].n
  assert.equal(check,0,'Fresh database is not empty')
  const sql = [
    'begin;',
    'create schema private authorization postgres;',
    'create schema extensions authorization postgres;',
    'grant usage on schema extensions to public;',
    'create extension pgcrypto with schema extensions;',
    'create publication supabase_realtime;',
    read(join(platform,'managed_before_app.sql')),
    read(join(platform,'history_schema.sql')),
    'commit;',
    'create extension if not exists pgtap with schema extensions;',
  ].join('\n')
  psql(database,sql)
  assert.equal((await client.query('select count(*)::int as n from supabase_migrations.schema_migrations')).rows[0].n,0)
  record({ phase:'bootstrap',database, platformHashes:platformFiles.map(([name,digest])=>({name,digest})) })
}

async function pausedRehearsal(client, database, order, suiteNames, password) {
  const migrationNames = order.migrations.filter(n=>n!==resumeName)
  assert.equal(migrationNames.length,15)
  for (const name of migrationNames) await applyMigration(client,database,name)
  psql(database,frozenFile('database/supabase/seed.sql'))
  const baseline = await snapshot(client)
  assert.deepEqual(baseline.history.map(r=>r.version),baseMigrations.map(n=>n.split('_')[0]))
  await audit(client,'reservation_write_pause_readonly.sql')
  const denied = await deniedWrites(client,true)
  const negative = parseTap(psql(database,frozenSql('reservation_resume_negative.sql')).split(/\r?\n/),'reservation_resume_negative')
  assert.equal(negative.planned,14)
  record({phase:'paused-negative',database,negative,denied})
  const afterNegative = await snapshot(client)
  invariantState(baseline,afterNegative,'Negative pause tests')

  // Only local probes temporarily receive the nine existing scoped RPCs.
  for (const rpc of reservationRpcs) await client.query(`grant execute on function public.${rpc} to authenticated`)
  const {results,raw} = await sqlSuites(database,suiteNames,`${database}-paused`)
  const effective = await deniedWrites(client,false)
  const cases = authorizationEvidence(raw,effective)
  const events = []
  const makeConnection = () => connect(database,password)
  const contention = await concurrency(client,makeConnection,event=>{
    events.push(event)
    save(`${database}-concurrency-event-${events.length}.json`,event)
  })
  save(`${database}-concurrency.json`,events)
  for (const rpc of reservationRpcs) await client.query(`revoke execute on function public.${rpc} from authenticated`)
  await audit(client,'reservation_write_pause_readonly.sql')
  const restored = await snapshot(client)
  invariantState(baseline,restored,'Scoped probe cleanup')
  contention.cases['pause-restored-after-probe']=true
  const proof = { order:order.order,result:'PASS',environment:'disposable-local',syntheticOnly:true,
    baselineRestored:true,packageSha256:manifestSha256,
    schemaSha256:sha(JSON.stringify(baseline.fingerprint)),independentConnections:contention.independentConnections,
    authorization:cases,concurrency:contention.cases,sqlSuites:results }
  const rawEvidenceSha256 = save(`${database}-order-report.json`,{proof,negative,denied,effective,events,raw})
  return { ...proof,rawEvidenceSha256,baseline }
}

function proofBytes(database, baseline, orders, suiteNames, snapshotMd5) {
  const { baseline: _one, ...first } = orders[0]
  const { baseline: _two, ...second } = orders[1]
  const schemaSha256 = sha(JSON.stringify(baseline.fingerprint))
  assert.equal(first.schemaSha256,schemaSha256)
  assert.equal(second.schemaSha256,schemaSha256)
  const baselineSha256 = sha(JSON.stringify(stateWithoutActivity(baseline)))
  const expected = { database,target:`local:${database}`,packageSha256:manifestSha256,
    schemaSha256,baselineSha256,snapshotMd5,sqlSuites:suiteNames }
  const raw = JSON.stringify({ kind:'reservation-rpc-resume-proof-v1',
    approval:'scoped-reservation-rpc-resume-approved',
    ...expected,stagingPaused:true,enforced:true,paused:true,unrelatedStateUnchanged:true,
    orders:[first,second] })
  return { raw,expected:{...expected,proofSha256:sha(raw)} }
}

async function resume(client,database,orders,suiteNames,password) {
  const before = await snapshot(client)
  await audit(client,'reservation_write_pause_readonly.sql')
  await client.query('BEGIN')
  let inTransaction = true
  try {
    await client.query("SET LOCAL search_path=pg_catalog,public,extensions")
    const {rows:[identity]} = await client.query(`select current_database() as database,
      pg_backend_pid() as pid,pg_current_xact_id()::text as xid`)
    assert.equal(identity.database,database)
    const snapshotMd5 = selectRows(await client.query(frozenSql('reservation_resume_state.sql')),'resume catalog signature')[0].snapshot_md5
    const {raw,expected} = proofBytes(database,before,orders,suiteNames,snapshotMd5)
    expected.backendPid=identity.pid; expected.transactionId=identity.xid
    const attestation = validateResumeProof(raw,expected)
    save(`${database}-proof.json`,JSON.parse(raw))
    await client.query("select set_config('rally.reservation_resume_evidence',$1,true)",[JSON.stringify(attestation)])
    const sql = frozenFile('database/supabase/migrations/'+resumeName)
    await client.query(sql)
    await client.query('insert into supabase_migrations.schema_migrations(version,statements,name) values($1,$2,$3)',
      [resumeName.slice(0,14),[sql],'reservation_rpc_resume'])
    const consumed = await client.query("select current_setting('rally.reservation_resume_evidence',true) as value")
    assert.equal(consumed.rows[0].value,'','Evidence was not consumed')
    await client.query('SAVEPOINT repeat_denied')
    await assert.rejects(client.query(sql),e=>e.code==='P0001' && e.message==='verified reservation resume evidence missing or not bound to this transaction')
    await client.query('ROLLBACK TO SAVEPOINT repeat_denied')
    await client.query('RELEASE SAVEPOINT repeat_denied')
    const after = await snapshot(client)
    after.audit = await audit(client,'reservation_resume_readonly.sql')
    const delta = verifyResumeDelta(before,after,resumeName.slice(0,14))
    await client.query('COMMIT'); inTransaction=false
    record({ phase:'resume-committed',database,delta,proofSha256:expected.proofSha256 })
  } finally { if (inTransaction) await client.query('ROLLBACK').catch(()=>{}) }
  const persisted = await snapshot(client)
  assert.equal(persisted.history.length,16)
  await audit(client,'reservation_resume_readonly.sql')
  const {results,raw} = await sqlSuites(database,suiteNames,`${database}-resumed`)
  const direct = await deniedWrites(client,false)
  const cases = authorizationEvidence(raw,direct)
  const events=[]
  const contention=await concurrency(client,()=>connect(database,password),event=>events.push(event))
  save(`${database}-resumed-concurrency.json`,events)
  const final=await snapshot(client)
  invariantState(persisted,final,'Post-resume probes')
  save(`${database}-resumed-result.json`,{results,direct,cases,concurrency:contention, fingerprint:final.fingerprint.find(r=>r.category==='!fingerprint')})
  return final
}

let phase='local-preflight', password
const journal=[]
function record(value) { journal.push({ ...value,at:new Date().toISOString() }) }

async function main() {
  assert.equal(process.argv.length,3,'One explicit mode required')
  const mode=process.argv[2]
  assert.ok(['--verify-local','--execute-approved'].includes(mode),'Unsupported mode')
  const {manifest,suiteNames}=checkedFiles()
  if (mode==='--verify-local') {
    console.log(JSON.stringify({result:'LOCAL_FILES_VERIFIED_NOT_REHEARSED',manifestSha256,
      databases,sqlSuites:suiteNames.length,databaseContacted:false}))
    return
  }
  assert.ok(!existsSync(evidence),'Existing rehearsal evidence is terminal; no retry')
  mkdirSync(evidence)
  save('ATTEMPT.json',{kind:'one-shot-disposable-local-rehearsal',manifestSha256,databases,
    startedAt:new Date().toISOString(),executorSha256:sha(readFileSync(fileURLToPath(import.meta.url))),
    guardsSha256:sha(readFileSync(join(root,'scripts/reservation-resume-executor-guards-r2.mjs'))),
    legacyGuardsSha256:sha(readFileSync(join(root,'scripts/reservation-resume-executor-guards.mjs'))),
    probesSha256:sha(readFileSync(join(root,'scripts/reservation-resume-local-probes.mjs')))})
  await executeOnce(true,()=>{},async()=>{
    phase='docker-identity'
    assert.ok(!process.env.DOCKER_HOST && !process.env.DOCKER_CONTEXT && !process.env.DOCKER_TLS_VERIFY,
      'Docker target override is not allowed')
    const contexts=JSON.parse(docker(['context','inspect']))
    verifyDockerEndpoint(contexts)
    contextName=contexts[0].Name
    assert.ok(['default','desktop-linux'].includes(contextName), 'Unexpected local Docker context name')
    const inspected=JSON.parse(docker(['inspect','supabase_db_rally-point-web']))
    const local=verifyLoopbackContainer(inspected)
    password=local.password
    const socket=socketIdentity()
    record({phase:'docker-identity',image:inspected[0].Config.Image,clusterId:socket.cluster_id})
    phase='maintenance-identity'
    const admin=new pg.Client({host:'127.0.0.1',port:54322,database:'postgres',user:'postgres',
      password,ssl:false,application_name:'rally_resume_gate23_local',connectionTimeoutMillis:10000,
      query_timeout:45000})
    await admin.connect()
    try {
      await identity(admin,'postgres',local.addresses,socket)
      const roles=(await admin.query("select rolname from pg_roles where rolname=any($1::text[]) order by rolname",
        [['anon','authenticated','service_role','supabase_admin','supabase_auth_admin','supabase_storage_admin']])).rows.map(r=>r.rolname)
      assert.deepEqual(roles,['anon','authenticated','service_role','supabase_admin','supabase_auth_admin','supabase_storage_admin'].sort())
      phase='fresh-replays'
      const orderReports=[]
      let firstFinal
      await createFresh((sql,params)=>admin.query(sql,params),async database=>{
        phase=`replay-${database}`
        const client=await connect(database,password)
        try {
          await identity(client,database,local.addresses,socket)
          await bootstrap(client,database)
          const order=database===databases[0]?manifest.orders[0]:manifest.orders[1]
          if (database===databases[2]) {
            for (const name of order.migrations.filter(n=>n!==resumeName)) await applyMigration(client,database,name)
            psql(database,frozenFile('database/supabase/seed.sql'))
            await audit(client,'reservation_write_pause_readonly.sql')
            const negative=parseTap(psql(database,frozenSql('reservation_resume_negative.sql')).split(/\r?\n/),'reservation_resume_negative')
            assert.equal(negative.planned,14)
            const baseline=await snapshot(client)
            assert.equal(sha(JSON.stringify(baseline.fingerprint)),orderReports[0].schemaSha256)
            const final=await resume(client,database,orderReports,suiteNames,password)
            assert.ok(isDeepStrictEqual(final.fingerprint,firstFinal.fingerprint),'Clean replay fingerprint differs')
            record({phase:'clean-repeat-converged',database,marker:final.fingerprint.find(r=>r.category==='!fingerprint')?.details})
            return
          }
          orderReports.push(await pausedRehearsal(client,database,order,suiteNames,password))
          if (orderReports.length===2) {
            assert.ok(isDeepStrictEqual(orderReports[0].baseline.fingerprint,orderReports[1].baseline.fingerprint),
              'Two migration orders have different paused schema fingerprints')
            assert.ok(isDeepStrictEqual(orderReports[0].baseline.catalog,orderReports[1].baseline.catalog),
              'Two migration orders have different portable catalogs')
            // Only after both order reports pass may either disposable DB resume.
            const stage=await connect(databases[0],password)
            try { firstFinal=await resume(stage,databases[0],orderReports,suiteNames,password) }
            finally { await stage.end() }
            const cleanFinal=await resume(client,database,orderReports,suiteNames,password)
            assert.ok(isDeepStrictEqual(cleanFinal.fingerprint,firstFinal.fingerprint),
              'Order-dependent resumed schema fingerprint')
          }
        } finally { await client.end() }
      })
      phase='complete'
      save('RESULT.json',{result:'PASS',scope:'three new disposable local databases only',
        manifestSha256,databases,orders:orderReports.map(({baseline:_baseline,...r})=>r),
        fingerprint:firstFinal.fingerprint.find(r=>r.category==='!fingerprint'),journal,
        stagingContacted:false,productionContacted:false,stagingResumed:false})
      console.log(JSON.stringify({result:'PASS',evidence,databases,stagingContacted:false}))
    } finally { await admin.end() }
  })
}

main().catch(error=>{
  if (existsSync(evidence)) {
    const reason=String(error?.message || 'Unknown failure').replaceAll(password || '\0','[redacted]').slice(0,2048)
    if (!existsSync(join(evidence,'STOP.json'))) save('STOP.json',{result:'STOP',phase,reason,
      code:error?.code ?? null,journal,automaticRetry:false,stagingContacted:false})
    console.error(JSON.stringify({result:'STOP',phase,evidence,reason}))
  } else console.error(JSON.stringify({result:'LOCAL_PRECHECK_FAILED',reason:String(error?.message || error)}))
  process.exitCode=1
})
