// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const load = () => import('../scripts/club-platform-staging.mjs')
const temps: string[] = []
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'club-platform-staging-test-'))
  temps.push(dir)
  return dir
}
afterEach(() => { for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function linkFiles(ref: string, url: string) {
  const dir = tempDir()
  mkdirSync(join(dir, 'supabase/.temp'), { recursive: true })
  writeFileSync(join(dir, 'supabase/.temp/project-ref'), ref + '\n')
  writeFileSync(join(dir, 'supabase/.temp/pooler-url'), url + '\n')
  return dir
}

async function goodCapture() {
  const { captureFiles, expectedStagingVersions, snapshotNames } = await load()
  const files = [...captureFiles, ...snapshotNames.flatMap((name: string) => [`before_${name}.json`, `after_${name}.json`])]
    .map((file: string) => ({ file, bytes: 10, sha256: 'a'.repeat(64) }))
  return { result: 'CAPTURE_PASS_RESTORE_PENDING', project: 'iclrvvsiwypxlwrwgqia', versions: [...expectedStagingVersions],
    publicFingerprint: 'b'.repeat(32), storageObjects: 0, activeClientsObserved: 0, writeCounterChanges: 0,
    stagingWritesAuthorized: false, startedAt: '2026-10-17T10:00:00Z', endedAt: '2026-10-17T10:05:00Z', tables: 54, files }
}

// A small release on disk: one migration, its checks and the four shared check files.
function releaseFixture() {
  const dir = tempDir()
  const files: Record<string, string> = {
    'supabase/migrations/20261101000000_example.sql': 'create index if not exists example_idx on public.example (id);\n',
    'supabase/verification/state.sql': 'select 1 as check_name;\n',
    'supabase/verification/post.sql': 'select 2 as check_name;\n',
    'supabase/verification/isolation.sql': 'begin;\nselect extensions.plan(3);\nrollback;\n',
    'supabase/verification/schema_fingerprint.sql': 'select 1;\n',
    'supabase/verification/backup_content_inventory.sql': 'select 1;\n',
    'supabase/verification/reservation_write_pause_readonly.sql': 'select 1;\n',
    'supabase/verification/staging_privacy_readonly_preflight.sql': 'select 1;\n',
  }
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  const release = { id: 'example', baseVersions: ['001', '20261017160000'], migrations: ['20261101000000_example.sql'],
    files: Object.keys(files), stateCheck: { file: 'state.sql', kind: 'postflight' },
    postChecks: [{ file: 'post.sql', kind: 'advisor', ignore: [] as string[] }], isolation: { file: 'isolation.sql', plan: 3 },
    dirs: {}, databases: {} }
  return { dir, release }
}

describe('staging target and secrets', () => {
  it('accepts only the staging session pooler from the CLI link files', async () => {
    const { stagingTarget } = await load()
    const pooler = 'postgresql://postgres.iclrvvsiwypxlwrwgqia@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres'
    expect(stagingTarget(linkFiles('iclrvvsiwypxlwrwgqia', pooler))).toEqual({ host: 'aws-0-ap-northeast-1.pooler.supabase.com',
      port: '5432', user: 'postgres.iclrvvsiwypxlwrwgqia', database: 'postgres' })
    expect(() => stagingTarget(linkFiles('otherproject', pooler))).toThrow('not staging')
    expect(() => stagingTarget(linkFiles('iclrvvsiwypxlwrwgqia', pooler.replace('@', ':secret@')))).toThrow('must not contain a password')
    expect(() => stagingTarget(linkFiles('iclrvvsiwypxlwrwgqia', pooler.replace('postgres.iclrv', 'postgres.zzzzv')))).toThrow('pooler user')
    expect(() => stagingTarget(linkFiles('iclrvvsiwypxlwrwgqia', pooler.replace('aws-0-ap-northeast-1.pooler.supabase.com', 'evil.example.com')))).toThrow('pooler host')
    expect(() => stagingTarget(linkFiles('iclrvvsiwypxlwrwgqia', pooler.replace(':5432', ':6543')))).toThrow('session pooler')
  })

  it('reads one password from the file and never echoes it in errors', async () => {
    const { readPassword, redact } = await load()
    const dir = tempDir()
    writeFileSync(join(dir, 'ok.local'), '\uFEFF  correct-horse-battery  \r\n')
    expect(readPassword(join(dir, 'ok.local'))).toBe('correct-horse-battery')
    writeFileSync(join(dir, 'two.local'), 'first-password-line\nsecond-line')
    expect(() => readPassword(join(dir, 'two.local'))).toThrow(/one password on one line/)
    try { readPassword(join(dir, 'two.local')) } catch (error) { expect(String(error)).not.toContain('first-password-line') }
    writeFileSync(join(dir, 'short.local'), 'short')
    expect(() => readPassword(join(dir, 'short.local'))).toThrow()
    expect(() => readPassword(join(dir, 'missing.local'))).toThrow('Password file not found')
    expect(redact('url p@ss/word and p%40ss%2Fword', 'p@ss/word')).toBe('url [redacted] and [redacted]')
  })

  it('gives child processes only system variables and named credentials, and refuses target overrides', async () => {
    const { childEnv } = await load()
    const env = childEnv({ PGPASSWORD: 'x'.repeat(10) }, { PATH: 'C:/bin', USERPROFILE: 'C:/u', SUPABASE_ACCESS_TOKEN: 'tok', RANDOM: '1' })
    expect(env).toEqual({ PATH: 'C:/bin', USERPROFILE: 'C:/u', PGPASSWORD: 'x'.repeat(10) })
    expect(() => childEnv({}, { PATH: 'C:/bin', PGHOST: 'elsewhere' })).toThrow('PGHOST')
    expect(() => childEnv({}, { DOCKER_HOST: 'tcp://remote' })).toThrow('DOCKER_HOST')
  })

  it('passes the password to psql only through the environment', async () => {
    const { stagingPsqlArgs } = await load()
    const target = { host: 'aws-0-ap-northeast-1.pooler.supabase.com', port: '5432', user: 'postgres.iclrvvsiwypxlwrwgqia', database: 'postgres' }
    const args = stagingPsqlArgs(target, { singleTransaction: true })
    expect(args.slice(0, 3)).toEqual(['exec', '-i', '-e'])
    expect(args).toContain('PGPASSWORD')
    expect(args).toContain('--single-transaction')
    expect(args).toContain('ON_ERROR_STOP=1')
    expect(args.join(' ')).not.toMatch(/password=|:\/\//)
    expect(stagingPsqlArgs(target)).not.toContain('--single-transaction')
  })
})

describe('query and migration wrappers', () => {
  it('wraps a read-only query file and refuses extra statements', async () => {
    const { readOnlyJson } = await load()
    const wrapped = readOnlyJson("-- note\nset search_path = public, extensions;\nwith x as (select 1 as a)\nselect a from x;\n")
    expect(wrapped.startsWith('BEGIN READ ONLY;')).toBe(true)
    expect(wrapped).toContain('set search_path = public, extensions;')
    expect(wrapped).toContain("select coalesce(jsonb_agg(to_jsonb(r)), '[]') from (\nwith x as (select 1 as a)\nselect a from x\n) r;")
    expect(wrapped.trimEnd().endsWith('COMMIT;')).toBe(true)
    expect(() => readOnlyJson('select 1; delete from public.members')).toThrow('single SELECT')
    expect(readOnlyJson("select ';' as semi")).toContain("select ';' as semi")
    expect(() => readOnlyJson('delete from public.members')).toThrow('Missing read-only SELECT')
  })

  it('applies one migration and its ledger row in one transaction', async () => {
    const { migrationTransactionSql } = await load()
    const sql = 'create table public.example (id int);'
    const wrapped = migrationTransactionSql('20261017090000_club_context.sql', sql)
    expect(wrapped).toContain("set local lock_timeout = '15s';")
    expect(wrapped).toContain(sql)
    expect(wrapped).toMatch(/insert into supabase_migrations\.schema_migrations \(version, statements, name\) values \('20261017090000', array\[\$migration_[a-f0-9]{16}\$create table public\.example \(id int\);\$migration_[a-f0-9]{16}\$\], 'club_context'\);$/)
    expect(() => migrationTransactionSql('club_context.sql', sql)).toThrow('Unexpected migration name')
    expect(() => migrationTransactionSql('20261017090000_club_context.sql', 'begin;\nselect 1;\ncommit;')).toThrow('own transaction control')
  })

  it('finds every changed, added or removed snapshot row', async () => {
    const { keyedDifferences, snapshotKeys } = await load()
    const before = [{ schema_name: 'public', table_name: 'a', row_count: 1 }, { schema_name: 'public', table_name: 'b', row_count: 2 }]
    expect(keyedDifferences(before, before, snapshotKeys.inventory)).toEqual([])
    const after = [{ schema_name: 'public', table_name: 'a', row_count: 9 }, { schema_name: 'public', table_name: 'c', row_count: 2 }]
    expect(keyedDifferences(before, after, snapshotKeys.inventory)).toEqual(['public.a', 'public.b', 'public.c'])
    expect(() => keyedDifferences([before[0], before[0]], before, snapshotKeys.inventory)).toThrow('Duplicate')
  })
})

describe('backup and approval gates', () => {
  it('accepts a complete capture of the staging baseline and rejects anything weaker', async () => {
    const { validateCaptureManifest } = await load()
    const capture = await goodCapture()
    expect(validateCaptureManifest(capture).versions).toBe(14)
    expect(() => validateCaptureManifest({ ...capture, versions: capture.versions.slice(1) })).toThrow('migration history')
    expect(() => validateCaptureManifest({ ...capture, activeClientsObserved: 1 })).toThrow('active client')
    expect(() => validateCaptureManifest({ ...capture, writeCounterChanges: 2 })).toThrow('Writes')
    expect(() => validateCaptureManifest({ ...capture, files: capture.files.filter((f: { file: string }) => f.file !== 'data.sql') })).toThrow('data.sql')
  })

  it('accepts stored files only with a verified copy of each, from the known bucket', async () => {
    const { knownBucketsOnly, publicObjectUrl, storageObjectFile, validateCaptureManifest, verifyStorageCopies } = await load()
    const capture = await goodCapture()
    const records = (files: number) => [{ schema_name: 'storage', table_name: 'objects', row_count: files }]
    // A capture made while Storage was empty has no copies and still passes.
    expect(verifyStorageCopies({ manifest: capture, inventory: records(0), objects: [] })).toBe(0)

    const copies = [0, 1].map(index => ({ bucket: 'court-photos', name: `club/gallery/${index}.webp`,
      file: storageObjectFile(index), bytes: 10, sha256: 'a'.repeat(64) }))
    const withFiles = { ...capture, storageObjects: 2, files: [...capture.files,
      ...['storage_buckets.json', 'storage_objects.json', ...copies.map(copy => copy.file)]
        .map(file => ({ file, bytes: 10, sha256: 'a'.repeat(64) }))] }
    const buckets = [{ id: 'court-photos', public: true, file_size_limit: 5242880, allowed_mime_types: ['image/webp', 'image/jpeg', 'image/png'] }]
    expect(validateCaptureManifest(withFiles).files).toBe(capture.files.length + 4)
    expect(verifyStorageCopies({ manifest: withFiles, inventory: records(2), objects: copies, buckets })).toBe(2)

    expect(() => validateCaptureManifest({ ...capture, storageObjects: 2 })).toThrow('Missing capture file: storage_buckets.json')
    expect(() => validateCaptureManifest({ ...withFiles, storageObjects: 3 })).toThrow('need their copies')
    expect(() => validateCaptureManifest({ ...capture, storageObjects: undefined })).toThrow('Storage file count missing')
    expect(() => verifyStorageCopies({ manifest: withFiles, inventory: records(3), objects: copies }))
      .toThrow('do not match the captured file records')
    expect(() => verifyStorageCopies({ manifest: withFiles, inventory: records(2), objects: [copies[0], { ...copies[1], sha256: 'b'.repeat(64) }] }))
      .toThrow('missing or changed')
    expect(() => verifyStorageCopies({ manifest: withFiles, inventory: records(2), objects: [copies[1], copies[0]] })).toThrow('out of order')
    expect(() => verifyStorageCopies({ manifest: withFiles, inventory: records(2), objects: [copies[0], { ...copies[1], name: copies[0].name }] }))
      .toThrow('duplicate')
    expect(() => verifyStorageCopies({ manifest: withFiles, inventory: records(2), objects: copies, buckets: [...buckets, { ...buckets[0], id: 'avatars' }] }))
      .toThrow('unknown or changed Storage bucket')
    expect(knownBucketsOnly([{ ...buckets[0], public: false }])).toBe(false)
    expect(knownBucketsOnly([{ ...buckets[0], file_size_limit: 52428800 }])).toBe(false)
    const memberPhotos = { ...buckets[0], id: 'member-photos' }
    const withPhotos = ['20261023090000', '20261125090000']
    expect(knownBucketsOnly([buckets[0], memberPhotos], withPhotos)).toBe(true)
    // Before the member account release, staging has no member-photos bucket yet.
    expect(knownBucketsOnly(buckets, ['20261023090000'])).toBe(true)
    expect(knownBucketsOnly(buckets, withPhotos)).toBe(false)
    expect(knownBucketsOnly([memberPhotos], withPhotos)).toBe(false)
    expect(knownBucketsOnly([buckets[0], buckets[0]], ['20261023090000'])).toBe(false)
    expect(knownBucketsOnly([buckets[0], { ...memberPhotos, public: false }], withPhotos)).toBe(false)
    expect(publicObjectUrl('member-photos', 'u/p.webp'))
      .toBe('https://iclrvvsiwypxlwrwgqia.supabase.co/storage/v1/object/public/member-photos/u/p.webp')
    expect(publicObjectUrl('court-photos', 'a/b c.webp'))
      .toBe('https://iclrvvsiwypxlwrwgqia.supabase.co/storage/v1/object/public/court-photos/a/b%20c.webp')
    expect(() => publicObjectUrl('court-photos', 'a/../secret.webp')).toThrow('Unsafe')
    expect(() => publicObjectUrl('avatars', 'a.webp')).toThrow('Not a known public bucket')
  })

  it('creates Storage policies after the application functions they call, and leaves older backups unchanged', async () => {
    const { restoreTransactionSql, splitStoragePolicies } = await load()
    const policy = 'CREATE POLICY "court_photos_admin_select" ON "storage"."objects" FOR SELECT TO "authenticated" USING ((("bucket_id" = \'court-photos\'::"text") AND "private"."can_manage_court_photo"("name")));'
    const files: Record<string, string> = {
      'managed_before_app.sql': `CREATE TABLE "storage"."objects" ();\n\n${policy}\n\nALTER TABLE "storage"."objects" ENABLE ROW LEVEL SECURITY;\n`,
      'history_schema.sql': '-- history\n',
      'schema.sql': 'ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";\nCREATE FUNCTION "private"."can_manage_court_photo"("p_name" "text") RETURNS boolean;\n',
      'managed_after_app.sql': 'CREATE OR REPLACE TRIGGER "on_auth_user_created" AFTER INSERT ON "auth"."users";\n',
      'application_acl_recovery.generated.sql': '-- acl\n',
    }
    // The three default-permission groups every capture holds (tables, sequences, functions).
    const catalog = [['r', 'SELECT'], ['S', 'USAGE'], ['f', 'EXECUTE']].map(([type, privilege]) =>
      ({ kind: 'default_acl', identity: `supabase_admin:public:${type}`, details: [['supabase_admin', 'anon', privilege, false]] }))
    const sql: string = restoreTransactionSql((name: string) => files[name], [], catalog)
    expect(sql.indexOf(policy)).toBeGreaterThan(sql.indexOf('CREATE FUNCTION "private"."can_manage_court_photo"'))
    expect(sql.indexOf(policy)).toBeGreaterThan(sql.indexOf('on_auth_user_created'))
    expect(sql.split(policy)).toHaveLength(2)
    expect(sql).toContain('-- Storage policy restored after the application schema.')

    // A backup made before Storage had policies restores exactly as before.
    const plain = 'CREATE TABLE "storage"."objects" ();\n'
    expect(splitStoragePolicies(plain)).toEqual({ before: plain, policies: [] })
    // A policy in an unfamiliar shape is refused rather than guessed at.
    expect(() => splitStoragePolicies('CREATE POLICY "x" ON "storage"."objects" FOR SELECT\n  USING (true);\n')).toThrow('Unrecognised Storage policy')
  })

  it('downloads a stored file through its public link and checks it against its record', async () => {
    const { downloadStoredFile } = await load()
    const body = Buffer.from('photo bytes')
    const md5 = '"' + (await import('node:crypto')).createHash('md5').update(body).digest('hex') + '"'
    const record = { bucket_id: 'court-photos', name: 'club/gallery/a.webp', size: body.length, etag: md5 }
    const asked: string[] = []
    const serve = (status: number, bytes: Buffer) => async (url: string) => {
      asked.push(url)
      return { status, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) }
    }
    const good = await downloadStoredFile(record, 'File 1', { fetchImpl: serve(200, body) })
    expect(good.bytes.equals(body)).toBe(true)
    expect(good.etag).toBe(md5.replaceAll('"', ''))
    expect(asked).toEqual(['https://iclrvvsiwypxlwrwgqia.supabase.co/storage/v1/object/public/court-photos/club/gallery/a.webp'])

    await expect(downloadStoredFile(record, 'File 1', { fetchImpl: serve(404, body) })).rejects.toThrow('could not be downloaded (HTTP 404)')
    await expect(downloadStoredFile(record, 'File 1', { fetchImpl: serve(200, Buffer.from('short')) })).rejects.toThrow('different size')
    await expect(downloadStoredFile(record, 'File 1', { fetchImpl: serve(200, Buffer.from('PHOTO BYTES')) })).rejects.toThrow('differs from its record')
    await expect(downloadStoredFile({ ...record, size: null }, 'File 1', { fetchImpl: serve(200, body) })).rejects.toThrow('no size')
    await expect(downloadStoredFile({ ...record, bucket_id: 'avatars' }, 'File 1', { fetchImpl: serve(200, body) })).rejects.toThrow('unknown bucket')
  })

  it('opens the staging gate only for the approved package, a fresh verified backup, a passing dry run and unchanged staging', async () => {
    const { approvedManifestSha256, expectedStagingVersions, verifyApplyGate } = await load()
    const capture = await goodCapture()
    const captureManifestSha256 = 'c'.repeat(64)
    const good = { manifestSha256: approvedManifestSha256, capture, captureManifestSha256,
      restore: { result: 'PASS', captureManifestSha256 },
      dryRun: { result: 'PASS', captureManifestSha256, manifestSha256: approvedManifestSha256 },
      liveMarker: capture.publicFingerprint, liveVersions: [...expectedStagingVersions], now: Date.parse('2026-10-17T11:05:00Z') }
    expect(verifyApplyGate(good)).toEqual({ captureAgeMinutes: 60 })
    expect(() => verifyApplyGate({ ...good, manifestSha256: 'd'.repeat(64) })).toThrow('not the approved release package')
    expect(() => verifyApplyGate({ ...good, now: Date.parse('2026-10-18T10:06:00Z') })).toThrow('older than 12 hours')
    expect(() => verifyApplyGate({ ...good, restore: { result: 'STOP', captureManifestSha256 } })).toThrow('restored and verified')
    expect(() => verifyApplyGate({ ...good, restore: { result: 'PASS', captureManifestSha256: 'e'.repeat(64) } })).toThrow('different capture')
    expect(() => verifyApplyGate({ ...good, dryRun: { ...good.dryRun, result: 'STOP' } })).toThrow('dry run')
    expect(() => verifyApplyGate({ ...good, dryRun: { ...good.dryRun, manifestSha256: 'f'.repeat(64) } })).toThrow('different package')
    expect(() => verifyApplyGate({ ...good, liveMarker: '0'.repeat(32) })).toThrow('Staging schema changed')
    expect(() => verifyApplyGate({ ...good, liveVersions: [...expectedStagingVersions, '20260921111105'] })).toThrow('history changed')
  })

  it('opens a release gate only with an owner approval and that release\'s staging baseline', async () => {
    const { advisorFixesRelease, validateCaptureManifest, verifyApplyGate } = await load()
    const capture = { ...(await goodCapture()), versions: [...advisorFixesRelease.baseVersions] }
    expect(() => validateCaptureManifest(capture)).toThrow('migration history')
    expect(validateCaptureManifest(capture, advisorFixesRelease.baseVersions).versions).toBe(21)
    const manifestSha256 = '1'.repeat(64)
    const captureManifestSha256 = 'c'.repeat(64)
    const gate = { manifestSha256, capture, captureManifestSha256, restore: { result: 'PASS', captureManifestSha256 },
      dryRun: { result: 'PASS', captureManifestSha256, manifestSha256 }, liveMarker: capture.publicFingerprint,
      liveVersions: [...advisorFixesRelease.baseVersions], expectedVersions: advisorFixesRelease.baseVersions,
      now: Date.parse('2026-10-17T11:05:00Z') }
    expect(() => verifyApplyGate({ ...gate, approvedSha: null })).toThrow('not been approved')
    expect(() => verifyApplyGate(gate)).toThrow('not the approved release package')
    expect(verifyApplyGate({ ...gate, approvedSha: manifestSha256 })).toEqual({ captureAgeMinutes: 60 })
    expect(() => verifyApplyGate({ ...gate, approvedSha: manifestSha256,
      liveVersions: [...advisorFixesRelease.baseVersions, '20261017160000'] })).toThrow('history changed')
  })
})

describe('staging releases', () => {
  it('takes exactly --release <id> <mode> and knows only defined releases', async () => {
    const { advisorFixesRelease, parseReleaseArgs } = await load()
    const modes = ['--verify-local', '--capture']
    expect(parseReleaseArgs(['--release', 'advisor-fixes-20261017', '--capture'], modes)).toEqual({ release: advisorFixesRelease, mode: '--capture' })
    expect(() => parseReleaseArgs(['--capture'], modes)).toThrow('Use --release')
    expect(() => parseReleaseArgs(['--release', 'advisor-fixes-20261017', '--apply-staging'], modes)).toThrow('Use --release')
    expect(() => parseReleaseArgs(['--release', 'advisor-fixes-20261017', '--capture', '--force'], modes)).toThrow('Use --release')
    expect(() => parseReleaseArgs(['--release', 'club-platform-20261017', '--capture'], modes)).toThrow('Unknown release')
  })

  it('defines the advisor release on the 21-migration staging state, with an approval slot', async () => {
    const { advisorFixesRelease, releaseManifest, releases } = await load()
    const { releaseApprovals } = await import('../scripts/staging-release-approvals.mjs')
    expect(Object.keys(releaseApprovals).sort()).toEqual(Object.keys(releases).sort())
    expect(advisorFixesRelease.baseVersions).toHaveLength(21)
    expect(advisorFixesRelease.baseVersions.at(-1)).toBe('20261017090300')
    expect(advisorFixesRelease.migrations).toEqual(['20261017160000_supabase_advisor_fixes.sql'])
    expect(advisorFixesRelease.postChecks.flatMap((check: { ignore: string[] }) => check.ignore)).toEqual(['ledger_has_every_migration'])
    const { manifest, sha256, contents } = releaseManifest(advisorFixesRelease)
    expect(sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(manifest.files.map((file: { path: string }) => file.path)).toEqual([...advisorFixesRelease.files])
    expect(manifest.files.map((file: { path: string }) => file.path)).toContain('scripts/run-staging-release-apply.mjs')
    expect(contents.get('supabase/migrations/20261017160000_supabase_advisor_fixes.sql')?.toString('utf8'))
      .toContain('alter extension btree_gist set schema extensions;')
  })

  it('builds the follow-up on the 22-migration state and checks it against the earlier checks it changes', async () => {
    const { advisorFixesRelease, advisorFollowupRelease, releaseManifest } = await load()
    expect(advisorFollowupRelease.baseVersions).toEqual([...advisorFixesRelease.baseVersions, '20261017160000'])
    expect(advisorFollowupRelease.migrations).toEqual(['20261017170000_supabase_advisor_followup.sql'])
    expect(advisorFollowupRelease.stateCheck).toEqual({ file: 'supabase_advisor_postflight.sql', kind: 'advisor' })
    expect(advisorFollowupRelease.postChecks.map((check: { kind: string, ignore: string[] }) => [check.kind, [...check.ignore]])).toEqual([
      ['advisorFollowup', []],
      ['advisor', ['ledger_has_advisor_fix', 'only_schedule_board_is_definer_view']],
      ['postflight', ['ledger_has_every_migration']],
    ])
    const folders = [...Object.values(advisorFixesRelease.dirs), ...Object.values(advisorFixesRelease.databases)]
    expect([...Object.values(advisorFollowupRelease.dirs), ...Object.values(advisorFollowupRelease.databases)]
      .filter(name => folders.includes(name))).toEqual([])
    const { contents } = releaseManifest(advisorFollowupRelease)
    expect(contents.get('supabase/migrations/20261017170000_supabase_advisor_followup.sql')?.toString('utf8'))
      .toContain('create or replace view public.public_schedule with (security_barrier = true, security_invoker = true)')
  })

  it('builds the club profile release on the 27-migration state and re-runs every earlier check', async () => {
    const { clubProfileRelease, courtPhotosRelease, releaseManifest, releases } = await load()
    const { clubProfileChecks } = await import('../scripts/club-platform-checks.mjs')
    const { releaseApprovals } = await import('../scripts/staging-release-approvals.mjs')
    expect(clubProfileRelease.baseVersions).toEqual([...courtPhotosRelease.baseVersions, '20261023090000'])
    expect(clubProfileRelease.baseVersions).toHaveLength(27)
    expect(clubProfileRelease.migrations).toEqual(['20261115090000_club_business_profile.sql'])
    expect(clubProfileRelease.stateCheck).toEqual({ file: 'court_photos_postflight.sql', kind: 'courtPhotos' })
    expect(clubProfileRelease.postChecks.map((check: { kind: string, ignore: string[] }) => [check.kind, [...check.ignore]])).toEqual([
      ['clubProfile', []],
      ['courtPhotos', ['ledger_has_court_photos']],
      ['courtMarketplace', ['ledger_has_court_marketplace']],
      ['advisorFollowup', ['ledger_has_followup']],
      ['advisor', ['ledger_has_advisor_fix', 'only_schedule_board_is_definer_view']],
      ['postflight', ['ledger_has_every_migration']],
    ])
    // Approved by the owner after the dry run passed (applied 2026-11-16).
    expect(releaseApprovals['club-profile-20261115']).toMatch(/^[a-f0-9]{64}$/)
    const earlier = Object.values(releases).filter(release => release !== clubProfileRelease)
      .flatMap((release: { dirs: object, databases: object }) => [...Object.values(release.dirs), ...Object.values(release.databases)])
    expect([...Object.values(clubProfileRelease.dirs), ...Object.values(clubProfileRelease.databases)]
      .filter(name => earlier.includes(name))).toEqual([])
    const { contents } = releaseManifest(clubProfileRelease)
    const postflight = contents.get('supabase/verification/club_profile_postflight.sql')?.toString('utf8') ?? ''
    expect([...postflight.matchAll(/select \d+, '([a-z_]+)'/g)].map(match => match[1])).toEqual([...clubProfileChecks])
    expect(postflight).toContain("version = '20261115090000'")
  })

  it('builds the owner onboarding release on the 28-migration state and re-runs every earlier check', async () => {
    const { clubProfileRelease, ownerOnboardingRelease, releaseManifest, releases } = await load()
    const { ownerOnboardingChecks } = await import('../scripts/club-platform-checks.mjs')
    const { releaseApprovals } = await import('../scripts/staging-release-approvals.mjs')
    expect(ownerOnboardingRelease.baseVersions).toEqual([...clubProfileRelease.baseVersions, '20261115090000'])
    expect(ownerOnboardingRelease.baseVersions).toHaveLength(28)
    expect(ownerOnboardingRelease.migrations).toEqual(['20261116090000_owner_call_requests.sql', '20261116090100_club_owner_invites.sql'])
    expect(ownerOnboardingRelease.stateCheck).toEqual({ file: 'club_profile_postflight.sql', kind: 'clubProfile' })
    expect(ownerOnboardingRelease.postChecks.map((check: { kind: string, ignore: string[] }) => [check.kind, [...check.ignore]])).toEqual([
      ['ownerOnboarding', []],
      ['clubProfile', ['ledger_has_club_profile']],
      ['courtPhotos', ['ledger_has_court_photos']],
      ['courtMarketplace', ['ledger_has_court_marketplace', 'venues_open_all_day']],
      ['advisorFollowup', ['ledger_has_followup']],
      ['advisor', ['ledger_has_advisor_fix', 'only_schedule_board_is_definer_view']],
      ['postflight', ['ledger_has_every_migration']],
    ])
    // Approved by the owner after the dry run passed (applied 2026-11-16).
    expect(releaseApprovals['owner-onboarding-20261116']).toMatch(/^[a-f0-9]{64}$/)
    const earlier = Object.values(releases).filter(release => release !== ownerOnboardingRelease)
      .flatMap((release: { dirs: object, databases: object }) => [...Object.values(release.dirs), ...Object.values(release.databases)])
    expect([...Object.values(ownerOnboardingRelease.dirs), ...Object.values(ownerOnboardingRelease.databases)]
      .filter(name => earlier.includes(name))).toEqual([])
    const { contents } = releaseManifest(ownerOnboardingRelease)
    for (const migration of ownerOnboardingRelease.migrations) expect(contents.has(`supabase/migrations/${migration}`)).toBe(true)
    const postflight = contents.get('supabase/verification/owner_onboarding_postflight.sql')?.toString('utf8') ?? ''
    expect([...postflight.matchAll(/select \d+, '([a-z_]+)'/g)].map(match => match[1])).toEqual([...ownerOnboardingChecks])
    expect(postflight).toContain("version = '20261116090000'")
    expect(postflight).toContain("version = '20261116090100'")
  })

  it('builds the member GCash checkout release on the 30-migration state and re-runs every earlier check', async () => {
    const { ownerOnboardingRelease, memberGcashCheckoutRelease, releaseManifest, releases } = await load()
    const { memberGcashCheckoutChecks } = await import('../scripts/club-platform-checks.mjs')
    const { releaseApprovals } = await import('../scripts/staging-release-approvals.mjs')
    expect(memberGcashCheckoutRelease.baseVersions)
      .toEqual([...ownerOnboardingRelease.baseVersions, '20261116090000', '20261116090100'])
    expect(memberGcashCheckoutRelease.baseVersions).toHaveLength(30)
    expect(memberGcashCheckoutRelease.migrations).toEqual(['20261122090000_member_gcash_checkout.sql'])
    expect(memberGcashCheckoutRelease.stateCheck).toEqual({ file: 'owner_onboarding_postflight.sql', kind: 'ownerOnboarding' })
    expect(memberGcashCheckoutRelease.postChecks.map((check: { kind: string, ignore: string[] }) => [check.kind, [...check.ignore]])).toEqual([
      ['memberGcashCheckout', []],
      ['ownerOnboarding', ['ledger_has_owner_onboarding']],
      ['clubProfile', ['ledger_has_club_profile']],
      ['courtPhotos', ['ledger_has_court_photos']],
      ['courtMarketplace', ['ledger_has_court_marketplace', 'venues_open_all_day']],
      ['advisorFollowup', ['ledger_has_followup']],
      ['advisor', ['ledger_has_advisor_fix', 'only_schedule_board_is_definer_view']],
      ['postflight', ['ledger_has_every_migration']],
    ])
    // Approved after the capture, restore check and dry run passed, and applied to staging.
    expect(releaseApprovals['member-gcash-checkout-20261122']).toMatch(/^[a-f0-9]{64}$/)
    const earlier = Object.values(releases).filter(release => release !== memberGcashCheckoutRelease)
      .flatMap((release: { dirs: object, databases: object }) => [...Object.values(release.dirs), ...Object.values(release.databases)])
    expect([...Object.values(memberGcashCheckoutRelease.dirs), ...Object.values(memberGcashCheckoutRelease.databases)]
      .filter(name => earlier.includes(name))).toEqual([])
    const { contents } = releaseManifest(memberGcashCheckoutRelease)
    for (const migration of memberGcashCheckoutRelease.migrations) expect(contents.has(`supabase/migrations/${migration}`)).toBe(true)
    const postflight = contents.get('supabase/verification/member_gcash_checkout_postflight.sql')?.toString('utf8') ?? ''
    expect([...postflight.matchAll(/select \d+, '([a-z_]+)'/g)].map(match => match[1])).toEqual([...memberGcashCheckoutChecks])
    expect(postflight).toContain("version = '20261122090000'")
    expect(postflight).toContain('= 31')
  })

  it('builds the member codes and booking length release on the 31-migration state and re-runs every earlier check', async () => {
    const { memberGcashCheckoutRelease, memberCodesBookingLengthRelease, releaseManifest, releases } = await load()
    const { memberCodesBookingLengthChecks } = await import('../scripts/club-platform-checks.mjs')
    const { releaseApprovals } = await import('../scripts/staging-release-approvals.mjs')
    expect(memberCodesBookingLengthRelease.baseVersions).toEqual([...memberGcashCheckoutRelease.baseVersions, '20261122090000'])
    expect(memberCodesBookingLengthRelease.baseVersions).toHaveLength(31)
    expect(memberCodesBookingLengthRelease.migrations)
      .toEqual(['20261124090000_member_code_prefix.sql', '20261124100000_booking_any_length.sql'])
    expect(memberCodesBookingLengthRelease.stateCheck).toEqual({ file: 'member_gcash_checkout_postflight.sql', kind: 'memberGcashCheckout' })
    expect(memberCodesBookingLengthRelease.postChecks.map((check: { kind: string, ignore: string[] }) => [check.kind, [...check.ignore]])).toEqual([
      ['memberCodesBookingLength', []],
      ['memberGcashCheckout', ['ledger_has_member_gcash_checkout']],
      ['ownerOnboarding', ['ledger_has_owner_onboarding']],
      ['clubProfile', ['ledger_has_club_profile']],
      ['courtPhotos', ['ledger_has_court_photos']],
      ['courtMarketplace', ['ledger_has_court_marketplace', 'venues_open_all_day']],
      ['advisorFollowup', ['ledger_has_followup']],
      ['advisor', ['ledger_has_advisor_fix', 'only_schedule_board_is_definer_view']],
      ['postflight', ['ledger_has_every_migration']],
    ])
    // Approved after the capture, restore check and dry run passed, and applied to staging.
    expect(releaseApprovals['member-codes-booking-length-20261124']).toMatch(/^[a-f0-9]{64}$/)
    const earlier = Object.values(releases).filter(release => release !== memberCodesBookingLengthRelease)
      .flatMap((release: { dirs: object, databases: object }) => [...Object.values(release.dirs), ...Object.values(release.databases)])
    expect([...Object.values(memberCodesBookingLengthRelease.dirs), ...Object.values(memberCodesBookingLengthRelease.databases)]
      .filter(name => earlier.includes(name))).toEqual([])
    const { contents } = releaseManifest(memberCodesBookingLengthRelease)
    for (const migration of memberCodesBookingLengthRelease.migrations) expect(contents.has(`supabase/migrations/${migration}`)).toBe(true)
    const postflight = contents.get('supabase/verification/member_codes_booking_length_postflight.sql')?.toString('utf8') ?? ''
    expect([...postflight.matchAll(/select \d+, '([a-z_]+)'/g)].map(match => match[1])).toEqual([...memberCodesBookingLengthChecks])
    expect(postflight).toContain("version = '20261124090000'")
    expect(postflight).toContain("version = '20261124100000'")
    expect(postflight).toContain('= 33')
  })

  it('builds the rent-a-coach release on the 33-migration state and re-runs every earlier check', async () => {
    const { memberCodesBookingLengthRelease, rentACoachRelease, releaseManifest, releases } = await load()
    const { rentACoachChecks } = await import('../scripts/club-platform-checks.mjs')
    expect(rentACoachRelease.baseVersions)
      .toEqual([...memberCodesBookingLengthRelease.baseVersions, '20261124090000', '20261124100000'])
    expect(rentACoachRelease.baseVersions).toHaveLength(33)
    expect(rentACoachRelease.migrations).toEqual(['20261124110000_rent_a_coach.sql'])
    expect(rentACoachRelease.stateCheck).toEqual({ file: 'member_codes_booking_length_postflight.sql', kind: 'memberCodesBookingLength' })
    expect(rentACoachRelease.postChecks.map((check: { kind: string, ignore: string[] }) => [check.kind, [...check.ignore]]).slice(0, 2)).toEqual([
      ['rentACoach', []],
      ['memberCodesBookingLength', ['ledger_has_codes_and_length']],
    ])
    const earlier = Object.values(releases).filter(release => release !== rentACoachRelease)
      .flatMap((release: { dirs: object, databases: object }) => [...Object.values(release.dirs), ...Object.values(release.databases)])
    expect([...Object.values(rentACoachRelease.dirs), ...Object.values(rentACoachRelease.databases)]
      .filter(name => earlier.includes(name))).toEqual([])
    const { contents } = releaseManifest(rentACoachRelease)
    const migration = contents.get('supabase/migrations/20261124110000_rent_a_coach.sql')?.toString('utf8') ?? ''
    // Fixed so it applies on a clean chain: no duplicate check name, every new foreign key indexed.
    expect(migration).not.toContain('constraint coach_booking_requests_student_count_check')
    expect(migration).toContain('create index coach_request_messages_sender')
    const postflight = contents.get('supabase/verification/rent_a_coach_postflight.sql')?.toString('utf8') ?? ''
    expect([...postflight.matchAll(/select \d+, '([a-z_]+)'/g)].map(match => match[1])).toEqual([...rentACoachChecks])
    expect(postflight).toContain("version = '20261124110000'")
    expect(postflight).toContain('= 34')
  })

  it('builds the member account release on the 34-migration state, approved, and re-runs every earlier check', async () => {
    const { memberAccountRelease, rentACoachRelease, releaseManifest, releases } = await load()
    const { memberAccountChecks } = await import('../scripts/club-platform-checks.mjs')
    const { releaseApprovals } = await import('../scripts/staging-release-approvals.mjs')
    expect(memberAccountRelease.baseVersions).toEqual([...rentACoachRelease.baseVersions, '20261124110000'])
    expect(memberAccountRelease.baseVersions).toHaveLength(34)
    expect(memberAccountRelease.migrations)
      .toEqual(['20261125090000_member_profile.sql', '20261125090100_membership_requests.sql'])
    expect(memberAccountRelease.stateCheck).toEqual({ file: 'rent_a_coach_postflight.sql', kind: 'rentACoach' })
    expect(memberAccountRelease.postChecks.map((check: { kind: string, ignore: string[] }) => [check.kind, [...check.ignore]]).slice(0, 2)).toEqual([
      ['memberAccount', []],
      ['rentACoach', ['ledger_has_rent_a_coach']],
    ])
    // Every earlier postflight still runs, after its own release's checks.
    expect(memberAccountRelease.postChecks.slice(2).map((check: { file: string }) => check.file))
      .toEqual(rentACoachRelease.postChecks.slice(1).map((check: { file: string }) => check.file))
    expect(releaseApprovals['member-account-20261125']).toMatch(/^[a-f0-9]{64}$/)
    const earlier = Object.values(releases).filter(release => release !== memberAccountRelease)
      .flatMap((release: { dirs: object, databases: object }) => [...Object.values(release.dirs), ...Object.values(release.databases)])
    expect([...Object.values(memberAccountRelease.dirs), ...Object.values(memberAccountRelease.databases)]
      .filter(name => earlier.includes(name))).toEqual([])
    const { contents } = releaseManifest(memberAccountRelease)
    const profile = contents.get('supabase/migrations/20261125090000_member_profile.sql')?.toString('utf8') ?? ''
    expect(profile).toContain("values ('member-photos', 'member-photos', true, 5242880")
    const requests = contents.get('supabase/migrations/20261125090100_membership_requests.sql')?.toString('utf8') ?? ''
    expect(requests).toContain('create policy no_direct_api_access on public.membership_requests')
    const postflight = contents.get('supabase/verification/member_account_postflight.sql')?.toString('utf8') ?? ''
    expect([...postflight.matchAll(/select \d+, '([a-z_]+)'/g)].map(match => match[1])).toEqual([...memberAccountChecks])
    expect(postflight).toContain("version = '20261125090000'")
    expect(postflight).toContain("version = '20261125090100'")
    expect(postflight).toContain('= 36')
  })

  it('builds the dashboard analytics release on the 36-migration state and re-runs every earlier check', async () => {
    const { memberAccountRelease, dashboardAnalyticsRelease, releaseManifest, releases } = await load()
    const { dashboardAnalyticsChecks } = await import('../scripts/club-platform-checks.mjs')
    expect(dashboardAnalyticsRelease.baseVersions).toEqual([...memberAccountRelease.baseVersions, '20261125090000', '20261125090100'])
    expect(dashboardAnalyticsRelease.baseVersions).toHaveLength(36)
    expect(dashboardAnalyticsRelease.migrations).toEqual(['20261125120000_dashboard_analytics.sql'])
    expect(dashboardAnalyticsRelease.stateCheck).toEqual({ file: 'member_account_postflight.sql', kind: 'memberAccount' })
    expect(dashboardAnalyticsRelease.postChecks.map((check: { kind: string, ignore: string[] }) => [check.kind, [...check.ignore]]).slice(0, 2)).toEqual([
      ['dashboardAnalytics', []],
      ['memberAccount', ['ledger_has_member_account']],
    ])
    const earlier = Object.values(releases).filter(release => release !== dashboardAnalyticsRelease)
      .flatMap((release: { dirs: object, databases: object }) => [...Object.values(release.dirs), ...Object.values(release.databases)])
    expect([...Object.values(dashboardAnalyticsRelease.dirs), ...Object.values(dashboardAnalyticsRelease.databases)]
      .filter(name => earlier.includes(name))).toEqual([])
    const { contents } = releaseManifest(dashboardAnalyticsRelease)
    const migration = contents.get('supabase/migrations/20261125120000_dashboard_analytics.sql')?.toString('utf8') ?? ''
    // Read-only summaries: definer functions with a pinned search path, never writing a table.
    expect(migration).toContain('function public.admin_club_analytics(p_club_id uuid, p_days integer)')
    expect(migration).toContain('function public.platform_analytics(p_days integer)')
    expect(migration).not.toMatch(/\b(insert into|update public\.|delete from)\b/i)
    const postflight = contents.get('supabase/verification/dashboard_analytics_postflight.sql')?.toString('utf8') ?? ''
    expect([...postflight.matchAll(/select \d+, '([a-z_]+)'/g)].map(match => match[1])).toEqual([...dashboardAnalyticsChecks])
    expect(postflight).toContain("version = '20261125120000'")
    expect(postflight).toContain('= 37')
  })

  it('builds the leaderboard and tournaments release on the 37-migration state and re-runs every earlier check', async () => {
    const { dashboardAnalyticsRelease, leaderboardTournamentsRelease, releaseManifest, releases } = await load()
    const { leaderboardTournamentsChecks } = await import('../scripts/club-platform-checks.mjs')
    expect(leaderboardTournamentsRelease.baseVersions).toEqual([...dashboardAnalyticsRelease.baseVersions, '20261125120000'])
    expect(leaderboardTournamentsRelease.baseVersions).toHaveLength(37)
    // Renumbered: 20261125120000 is the dashboard migration already on staging.
    expect(leaderboardTournamentsRelease.migrations).toEqual(['20261126080000_club_leaderboard.sql', '20261126090000_club_tournaments.sql',
      '20261126100000_public_tournaments.sql'])
    expect(leaderboardTournamentsRelease.stateCheck).toEqual({ file: 'dashboard_analytics_postflight.sql', kind: 'dashboardAnalytics' })
    expect(leaderboardTournamentsRelease.postChecks.map((check: { kind: string, ignore: string[] }) => [check.kind, [...check.ignore]]).slice(0, 2)).toEqual([
      ['leaderboardTournaments', []],
      ['dashboardAnalytics', ['ledger_has_dashboard_analytics']],
    ])
    expect(leaderboardTournamentsRelease.postChecks).toHaveLength(dashboardAnalyticsRelease.postChecks.length + 1)
    const earlier = Object.values(releases).filter(release => release !== leaderboardTournamentsRelease)
      .flatMap((release: { dirs: object, databases: object }) => [...Object.values(release.dirs), ...Object.values(release.databases)])
    expect([...Object.values(leaderboardTournamentsRelease.dirs), ...Object.values(leaderboardTournamentsRelease.databases)]
      .filter(name => earlier.includes(name))).toEqual([])
    const { contents } = releaseManifest(leaderboardTournamentsRelease)
    const leaderboard = contents.get('supabase/migrations/20261126080000_club_leaderboard.sql')?.toString('utf8') ?? ''
    const tournaments = contents.get('supabase/migrations/20261126090000_club_tournaments.sql')?.toString('utf8') ?? ''
    const allClubs = contents.get('supabase/migrations/20261126100000_public_tournaments.sql')?.toString('utf8') ?? ''
    // New tables only: nothing inside the reservation-write pause is written.
    for (const sql of [leaderboard, tournaments, allClubs]) {
      expect(sql).not.toMatch(/\b(insert into|update|delete from)\s+public\.(bookings|court_sessions|open_plays|open_play_signups|court_allocations|courts|transactions)\b/i)
    }
    expect(leaderboard).toContain('create policy no_direct_api_access on public.club_matches')
    expect(tournaments).toContain('create policy no_direct_api_access on public.club_tournaments')
    // The all-clubs list only reads.
    expect(allClubs).not.toMatch(/\b(insert into|update public\.|delete from|create table)\b/i)
    expect(allClubs).toContain('grant execute on function public.list_public_tournaments(text, integer) to anon, authenticated')
    const postflight = contents.get('supabase/verification/leaderboard_tournaments_postflight.sql')?.toString('utf8') ?? ''
    expect([...postflight.matchAll(/select \d+, '([a-z_]+)'/g)].map(match => match[1])).toEqual([...leaderboardTournamentsChecks])
    expect(postflight).toContain("version = '20261126080000'")
    expect(postflight).toContain("version = '20261126090000'")
    expect(postflight).toContain("version = '20261126100000'")
    expect(postflight).toContain('= 40')
  })

  it('builds the tournament fixes release on the 40-migration state and re-runs every earlier check', async () => {
    const { leaderboardTournamentsRelease, tournamentFixesRelease, releaseManifest, releases } = await load()
    const { tournamentFixesChecks } = await import('../scripts/club-platform-checks.mjs')
    expect(tournamentFixesRelease.baseVersions).toHaveLength(40)
    expect(tournamentFixesRelease.baseVersions.slice(-3)).toEqual(['20261126080000', '20261126090000', '20261126100000'])
    expect(tournamentFixesRelease.migrations).toEqual(['20261126110000_tournament_review_fixes.sql'])
    expect(tournamentFixesRelease.stateCheck).toEqual({ file: 'leaderboard_tournaments_postflight.sql', kind: 'leaderboardTournaments' })
    expect(tournamentFixesRelease.postChecks.map((check: { kind: string, ignore: string[] }) => [check.kind, [...check.ignore]]).slice(0, 3)).toEqual([
      ['tournamentFixes', []],
      ['leaderboardTournaments', ['ledger_has_leaderboard_tournaments']],
      ['dashboardAnalytics', ['ledger_has_dashboard_analytics']],
    ])
    expect(tournamentFixesRelease.postChecks).toHaveLength(leaderboardTournamentsRelease.postChecks.length + 1)
    const earlier = Object.values(releases).filter(release => release !== tournamentFixesRelease)
      .flatMap((release: { dirs: object, databases: object }) => [...Object.values(release.dirs), ...Object.values(release.databases)])
    expect([...Object.values(tournamentFixesRelease.dirs), ...Object.values(tournamentFixesRelease.databases)]
      .filter(name => earlier.includes(name))).toEqual([])
    const { contents } = releaseManifest(tournamentFixesRelease)
    const migration = contents.get('supabase/migrations/20261126110000_tournament_review_fixes.sql')?.toString('utf8') ?? ''
    // Courts and bookings are only read.
    expect(migration).not.toMatch(/\b(insert into|update|delete from)\s+public\.(bookings|court_sessions|open_plays|open_play_signups|court_allocations|courts|transactions)\b/i)
    expect(migration).toContain('grant execute on function public.staff_void_tournament_match(uuid, uuid, text) to authenticated')
    expect(migration).not.toContain('to anon')
    const postflight = contents.get('supabase/verification/tournament_fixes_postflight.sql')?.toString('utf8') ?? ''
    expect([...postflight.matchAll(/select \d+, '([a-z_]+)'/g)].map(match => match[1])).toEqual([...tournamentFixesChecks])
    expect(postflight).toContain("version = '20261126110000'")
    expect(postflight).toContain('= 41')
  })

  it('builds the coaches and court types release on the 41-migration state and re-runs every earlier check', async () => {
    const { tournamentFixesRelease, coachesCourtTypesRelease, releaseManifest, releases } = await load()
    const { coachesCourtTypesChecks } = await import('../scripts/club-platform-checks.mjs')
    expect(coachesCourtTypesRelease.baseVersions).toHaveLength(41)
    expect(coachesCourtTypesRelease.baseVersions.at(-1)).toBe('20261126110000')
    expect(coachesCourtTypesRelease.migrations).toEqual(['20261127090000_public_coaches.sql', '20261127100000_court_types.sql'])
    expect(coachesCourtTypesRelease.stateCheck).toEqual({ file: 'tournament_fixes_postflight.sql', kind: 'tournamentFixes' })
    expect(coachesCourtTypesRelease.postChecks.map((check: { kind: string, ignore: string[] }) => [check.kind, [...check.ignore]]).slice(0, 3)).toEqual([
      ['coachesCourtTypes', []],
      ['tournamentFixes', ['ledger_has_tournament_fixes']],
      ['leaderboardTournaments', ['ledger_has_leaderboard_tournaments']],
    ])
    expect(coachesCourtTypesRelease.postChecks).toHaveLength(tournamentFixesRelease.postChecks.length + 1)
    const earlier = Object.values(releases).filter(release => release !== coachesCourtTypesRelease)
      .flatMap((release: { dirs: object, databases: object }) => [...Object.values(release.dirs), ...Object.values(release.databases)])
    expect([...Object.values(coachesCourtTypesRelease.dirs), ...Object.values(coachesCourtTypesRelease.databases)]
      .filter(name => earlier.includes(name))).toEqual([])
    const { contents } = releaseManifest(coachesCourtTypesRelease)
    const coaches = contents.get('supabase/migrations/20261127090000_public_coaches.sql')?.toString('utf8') ?? ''
    const courtTypes = contents.get('supabase/migrations/20261127100000_court_types.sql')?.toString('utf8') ?? ''
    // Bookings and the other paused tables are never written; courts only through the admin function.
    for (const migration of [coaches, courtTypes]) {
      expect(migration).not.toMatch(/\b(insert into|delete from)\s+public\.(bookings|court_sessions|open_plays|open_play_signups|court_allocations|courts|transactions)\b/i)
      expect(migration).not.toMatch(/\bupdate\s+public\.(bookings|court_sessions|open_plays|open_play_signups|court_allocations|transactions)\b/i)
    }
    expect(coaches).not.toMatch(/\b(insert into|update|delete from)\s+public\./i)
    expect(courtTypes).toContain('grant execute on function public.admin_set_court_type(uuid, text) to authenticated')
    expect(courtTypes).not.toMatch(/admin_set_court_type\(uuid, text\) to anon/)
    const postflight = contents.get('supabase/verification/coaches_court_types_postflight.sql')?.toString('utf8') ?? ''
    expect([...postflight.matchAll(/select \d+, '([a-z_]+)'/g)].map(match => match[1])).toEqual([...coachesCourtTypesChecks])
    expect(postflight).toContain("version = '20261127100000'")
    expect(postflight).toContain('= 43')
  })

  it('hashes the release definition and every file, and returns the bytes it hashed', async () => {
    const { releaseManifest } = await load()
    const { dir, release } = releaseFixture()
    const first = releaseManifest(release, dir)
    expect(first.manifest.files).toHaveLength(8)
    expect(first.contents.get('supabase/verification/isolation.sql')?.toString('utf8')).toContain('plan(3)')
    expect(releaseManifest(release, dir).sha256).toBe(first.sha256)
    const looserChecks = { ...release, postChecks: [{ file: 'post.sql', kind: 'advisor', ignore: ['foreign_keys_indexed'] }] }
    expect(releaseManifest(looserChecks, dir).sha256).not.toBe(first.sha256)
    writeFileSync(join(dir, 'supabase/verification/post.sql'), 'select 3 as check_name;\n')
    expect(releaseManifest(release, dir).sha256).not.toBe(first.sha256)
  })

  it('refuses an incomplete or inconsistent release before anything runs', async () => {
    const { releaseManifest } = await load()
    const { dir, release } = releaseFixture()
    expect(() => releaseManifest({ ...release, files: release.files.filter(path => !path.endsWith('/post.sql')) }, dir))
      .toThrow('Release file not listed: supabase/verification/post.sql')
    expect(() => releaseManifest({ ...release, migrations: ['20260101000000_old.sql'] }, dir)).toThrow('predates')
    expect(() => releaseManifest({ ...release, migrations: ['example.sql'] }, dir)).toThrow('Unexpected migration name')
    expect(() => releaseManifest({ ...release, baseVersions: ['20261017160000', '001'] }, dir)).toThrow('sorted and unique')
    expect(() => releaseManifest({ ...release, files: [...release.files, 'other/state.sql'] }, dir)).toThrow('names must be unique')
    expect(() => releaseManifest({ ...release, isolation: { file: 'isolation.sql', plan: 4 } }, dir)).toThrow('plan changed')
    writeFileSync(join(dir, 'supabase/verification/isolation.sql'), 'begin;\nselect extensions.plan(3);\ncommit;\n')
    expect(() => releaseManifest(release, dir)).toThrow('must end with rollback')
  })
})
