// Validates the proposed staging fixture package against the restored staging
// database. The connection is fixed to local loopback and all work is rolled
// back, even after the cleanup script is exercised.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import pg from 'pg'

const VERIFY_DB_PORT = Number.parseInt(process.env.RALLY_VERIFY_DB_PORT ?? '54322', 10)
assert.ok(Number.isInteger(VERIFY_DB_PORT) && VERIFY_DB_PORT > 0 && VERIFY_DB_PORT <= 65_535,
  'RALLY_VERIFY_DB_PORT must be a valid local TCP port')

const BASE_MIGRATIONS = [
  '001',
  '002',
  '003',
  '004',
  '20260803125450',
  '20260805094557',
  '20260921090000',
  '20260921110828',
  '20260922011918',
]
const mode = process.argv[2] ?? '--rollback'
assert.equal(process.argv.length, mode === '--rollback' && process.argv[2] === undefined ? 2 : 3,
  'expected at most one verifier mode')
const modes = {
  '--rollback': {
    database: 'rally_postdeploy_restore_20260922',
    expectedMigrations: BASE_MIGRATIONS,
    retainFixture: false,
  },
  '--enforced-clone': {
    database: 'rally_gate6_fixture_20260923',
    expectedMigrations: [
      ...BASE_MIGRATIONS,
      '20260921111105',
      '20260922163027',
      '20260922163830',
      '20260922164128',
    ].toSorted(),
    retainFixture: true,
  },
}
assert.ok(Object.hasOwn(modes, mode), `unsupported verifier mode: ${mode}`)
const configuration = modes[mode]

const fixtureSql = readFileSync(
  new URL('./staging_fixture.sql', import.meta.url),
  'utf8',
)
const cleanupSql = readFileSync(
  new URL('./staging_fixture_cleanup.sql', import.meta.url),
  'utf8',
)

const users = {
  RALLY_MEMBER_USER_ID: {
    id: '91000000-0000-4000-8000-000000000001',
    email: 'rally-member@tenant-fixture.invalid',
    name: 'Fixture Rally Member',
  },
  RALLY_ADMIN_USER_ID: {
    id: '91000000-0000-4000-8000-000000000002',
    email: 'rally-admin@tenant-fixture.invalid',
    name: 'Fixture Rally Admin',
  },
  RALLY_STAFF_USER_ID: {
    id: '91000000-0000-4000-8000-000000000003',
    email: 'rally-staff@tenant-fixture.invalid',
    name: 'Fixture Rally Staff',
  },
  SECOND_MEMBER_USER_ID: {
    id: '92000000-0000-4000-8000-000000000001',
    email: 'second-member@tenant-fixture.invalid',
    name: 'Fixture Second Member',
  },
  SECOND_ADMIN_USER_ID: {
    id: '92000000-0000-4000-8000-000000000002',
    email: 'second-admin@tenant-fixture.invalid',
    name: 'Fixture Second Admin',
  },
  SECOND_STAFF_USER_ID: {
    id: '92000000-0000-4000-8000-000000000003',
    email: 'second-staff@tenant-fixture.invalid',
    name: 'Fixture Second Staff',
  },
}

const databaseTestDirectory = new URL('../tests/database/', import.meta.url)
const databaseTestSql = readdirSync(databaseTestDirectory)
  .filter((name) => name.endsWith('.sql'))
  .map((name) => readFileSync(new URL(name, databaseTestDirectory), 'utf8'))
  .join('\n')
for (const user of Object.values(users)) {
  assert.ok(
    !databaseTestSql.includes(user.id),
    `local fixture user ID ${user.id} collides with a database test fixture`,
  )
}

const touchedTables = [
  ['auth', 'users'],
  ['public', 'profiles'],
  ['public', 'members'],
  ['public', 'clubs'],
  ['public', 'venues'],
  ['public', 'courts'],
  ['public', 'club_staff_roles'],
  ['public', 'staff_venue_grants'],
  ['public', 'bookings'],
  ['public', 'court_sessions'],
  ['public', 'open_plays'],
  ['public', 'open_play_signups'],
  ['public', 'checkins'],
  ['public', 'walkins'],
  ['public', 'transactions'],
  ['public', 'notifications'],
  ['public', 'reminders'],
  ['public', 'court_allocations'],
]

const expectedDeltas = {
  'auth.users': 6,
  'public.profiles': 6,
  'public.members': 6,
  'public.clubs': 1,
  'public.venues': 3,
  'public.courts': 3,
  'public.club_staff_roles': 4,
  'public.staff_venue_grants': 2,
  'public.bookings': 2,
  'public.court_sessions': 2,
  'public.open_plays': 2,
  'public.open_play_signups': 2,
  'public.checkins': 2,
  'public.walkins': 2,
  'public.transactions': 2,
  'public.notifications': 2,
  'public.reminders': 2,
  'public.court_allocations': 6,
}

function render(template) {
  let result = template
  for (const [token, user] of Object.entries(users)) {
    result = result.replaceAll(`{{${token}}}`, user.id)
  }
  const unresolved = result.match(/\{\{[A-Z0-9_]+\}\}/g) ?? []
  assert.deepEqual(unresolved, [], 'fixture SQL contains unresolved tokens')
  return result
}

async function inventory(client) {
  const result = {}
  for (const [schema, table] of touchedTables) {
    const key = `${schema}.${table}`
    const { rows: [row] } = await client.query(`
      select count(*)::int as count,
             md5(coalesce(string_agg(row_text, E'\\n' order by row_text), '')) as digest
      from (select to_jsonb(t)::text as row_text from ${schema}.${table} t) rows
    `)
    result[key] = row
  }
  return result
}

async function aclDigest(client) {
  const { rows: [row] } = await client.query(`
    with acl_rows as (
      select 'relation'::text as kind, n.nspname as schema_name, c.relname as object_name,
             coalesce(c.relacl::text, '') as acl
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('public', 'private') and c.relkind in ('r', 'v')
      union all
      select 'function', n.nspname, p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
             coalesce(p.proacl::text, '')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private')
      union all
      select 'policy', schemaname, tablename || '.' || policyname,
             coalesce(roles::text, '') || ':' || coalesce(cmd, '') || ':' ||
             coalesce(qual, '') || ':' || coalesce(with_check, '')
      from pg_policies where schemaname in ('public', 'private')
    )
    select md5(string_agg(kind || ':' || schema_name || ':' || object_name || ':' || acl,
                          E'\\n' order by kind, schema_name, object_name, acl)) as digest
    from acl_rows
  `)
  return row.digest
}

const client = new pg.Client({
  host: '127.0.0.1',
  port: VERIFY_DB_PORT,
  user: 'postgres',
  password: 'postgres',
  database: configuration.database,
})

await client.connect()
try {
  const { rows: [identity] } = await client.query(`
    select current_database() as database,
           inet_server_addr()::text as server_address,
           inet_server_port() as server_port
  `)
  assert.equal(identity.database, configuration.database)
  assert.ok(
    identity.server_address === '127.0.0.1'
      || identity.server_address === '127.0.0.1/32'
      || identity.server_address === '::1'
      || identity.server_address === '::1/128'
      || identity.server_address.startsWith('172.'),
    `refusing database outside the local Docker network: ${identity.server_address}`,
  )
  assert.equal(identity.server_port, 5432, 'expected the local container server port')

  const versions = (await client.query(
    'select version from supabase_migrations.schema_migrations order by version',
  )).rows.map((row) => row.version)
  assert.deepEqual(versions, configuration.expectedMigrations)

  if (configuration.retainFixture) {
    const { rows: [enforcement] } = await client.query(`
      select
        exists(select 1 from pg_constraint where conname = 'court_allocations_no_overlap') as overlap_constraint,
        not has_table_privilege('authenticated', 'public.bookings', 'insert') as booking_insert_revoked,
        not has_table_privilege('authenticated', 'public.transactions', 'insert') as transaction_insert_revoked
    `)
    assert.deepEqual(enforcement, {
      overlap_constraint: true,
      booking_insert_revoked: true,
      transaction_insert_revoked: true,
    })
  }

  const baseline = await inventory(client)
  const baselineAcl = await aclDigest(client)
  await client.query('begin isolation level serializable')
  let transactionOpen = true
  try {
    for (const user of Object.values(users)) {
      await client.query(`
        insert into auth.users (
          id, aud, role, email, email_confirmed_at, raw_app_meta_data,
          raw_user_meta_data, created_at, updated_at
        ) values (
          $1, 'authenticated', 'authenticated', $2, now(),
          '{"provider":"email","providers":["email"]}'::jsonb,
          jsonb_build_object('full_name', $3::text, 'role', 'admin'), now(), now()
        )
      `, [user.id, user.email, user.name])
    }

    await client.query(render(fixtureSql))

    const populated = await inventory(client)
    for (const [table, delta] of Object.entries(expectedDeltas)) {
      assert.equal(
        populated[table].count,
        baseline[table].count + delta,
        `${table} fixture row delta`,
      )
    }

    await client.query('savepoint duplicate_fixture')
    let duplicateRefused = false
    try {
      await client.query(render(fixtureSql))
    } catch (error) {
      duplicateRefused = /signup role|fixture .*already exists/.test(error.message)
    }
    await client.query('rollback to savepoint duplicate_fixture')
    await client.query('release savepoint duplicate_fixture')
    assert.ok(duplicateRefused, 'fixture preflight must refuse a duplicate run')

    const { rows: [roleSummary] } = await client.query(`
      select
        count(*) filter (where p.role = 'member')::int as members,
        count(*) filter (where p.role = 'admin')::int as admins,
        count(*) filter (where p.role = 'staff')::int as staff,
        count(*) filter (where m.club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')::int as rally_memberships,
        count(*) filter (where m.club_id = '72000000-0000-4000-8000-000000000000')::int as second_memberships
      from public.profiles p join public.members m on m.user_id = p.id
      where p.id = any($1::uuid[])
    `, [Object.values(users).map((user) => user.id)])
    assert.deepEqual(roleSummary, {
      members: 2,
      admins: 2,
      staff: 2,
      rally_memberships: 3,
      second_memberships: 3,
    })

    const { rows: [grantSummary] } = await client.query(`
      select
        count(*) filter (where user_id = '{{RALLY_STAFF_USER_ID}}'::uuid
                          and venue_id = '71000000-0000-4000-8100-000000000001')::int as rally_assigned,
        count(*) filter (where user_id = '{{SECOND_STAFF_USER_ID}}'::uuid
                          and venue_id = '72000000-0000-4000-8100-000000000001')::int as second_assigned,
        count(*) filter (where user_id = '{{SECOND_STAFF_USER_ID}}'::uuid
                          and venue_id = '72000000-0000-4000-8100-000000000002')::int as second_unassigned
      from public.staff_venue_grants
      where user_id in ('{{RALLY_STAFF_USER_ID}}'::uuid, '{{SECOND_STAFF_USER_ID}}'::uuid)
    `.replaceAll('{{RALLY_STAFF_USER_ID}}', users.RALLY_STAFF_USER_ID.id)
      .replaceAll('{{SECOND_STAFF_USER_ID}}', users.SECOND_STAFF_USER_ID.id))
    assert.deepEqual(grantSummary, {
      rally_assigned: 1,
      second_assigned: 1,
      second_unassigned: 0,
    })

    const { rows: [ownership] } = await client.query(`
      select
        count(*) filter (where club_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
                          and venue_id = '71000000-0000-4000-8100-000000000001')::int as rally,
        count(*) filter (where club_id = '72000000-0000-4000-8000-000000000000'
                          and venue_id in ('72000000-0000-4000-8100-000000000001',
                                           '72000000-0000-4000-8100-000000000002'))::int as second
      from (
        select club_id, venue_id from public.bookings where id in (
          '71000000-0000-4000-8300-000000000001'::uuid,
          '72000000-0000-4000-8300-000000000001'::uuid
        )
        union all select club_id, venue_id from public.court_sessions
          where notes = '[tenant-fixture-v1]'
        union all select club_id, venue_id from public.open_plays
          where notes = '[tenant-fixture-v1]'
        union all select club_id, venue_id from public.checkins
          where note = '[tenant-fixture-v1]'
        union all select club_id, venue_id from public.walkins
          where purpose = '[tenant-fixture-v1]'
      ) fixture_activity
    `)
    assert.equal(ownership.rally, 5)
    assert.equal(ownership.second, 5)

    const { rows: [finance] } = await client.query(`
      select count(*)::int as charges,
             bool_and(verification_status = 'unverified') as all_unverified
      from public.transactions
      where id in ('71000000-0000-4000-8900-000000000001',
                   '72000000-0000-4000-8900-000000000001')
    `)
    assert.deepEqual(finance, { charges: 2, all_unverified: true })

    const { rows: [payments] } = await client.query(`
      select count(*)::int as bookings,
             bool_and(status = 'pending_payment'
                      and payment_method is null
                      and payment_ref is null) as all_unpaid
      from public.bookings
      where id in ('71000000-0000-4000-8300-000000000001',
                   '72000000-0000-4000-8300-000000000001')
    `)
    assert.deepEqual(payments, { bookings: 2, all_unpaid: true })

    const { rows: [overlaps] } = await client.query(`
      select count(*)::int as count
      from public.court_allocations a
      join public.court_allocations b
        on a.id < b.id and a.court_id = b.court_id and a.interval && b.interval
      where a.status in ('held', 'reserved', 'playing')
        and b.status in ('held', 'reserved', 'playing')
    `)
    assert.equal(overlaps.count, 0, 'fixture contains overlapping active allocations')

    const scheduleColumns = (await client.query(`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'public_schedule'
      order by ordinal_position
    `)).rows.map((row) => row.column_name)
    assert.deepEqual(scheduleColumns, [
      'id', 'club_id', 'venue_id', 'venue_name', 'court_id', 'court_name',
      'kind', 'title', 'start_at', 'end_at', 'status', 'subtitle',
    ])
    for (const forbidden of ['full_name', 'email', 'phone', 'qr_token', 'amount', 'payment_ref']) {
      assert.ok(!scheduleColumns.includes(forbidden), `public schedule exposes ${forbidden}`)
    }

    const safeSchedule = (await client.query(`
      select kind, title, status, subtitle
      from public.public_schedule
      where venue_id = '71000000-0000-4000-8100-000000000001'
      order by kind
    `)).rows
    assert.deepEqual(safeSchedule, [
      { kind: 'booking', title: 'Reserved', status: 'reserved', subtitle: 'reserved' },
      { kind: 'open_play', title: 'Open play', status: 'open', subtitle: '8 seats' },
      { kind: 'session', title: 'In use', status: 'scheduled', subtitle: 'scheduled' },
    ])

    assert.equal(await aclDigest(client), baselineAcl, 'fixture changed ACL, RLS, or function grants')

    let cleanupRestoredExactBaseline = false
    let missingFixtureCleanupRefused = false
    let transaction
    if (configuration.retainFixture) {
      await client.query('commit')
      transactionOpen = false
      transaction = 'committed to local disposable enforcement clone'
    } else {
      await client.query(render(cleanupSql))
      // Local equivalent of the required trusted Auth Admin deletion. The hosted
      // cleanup contract intentionally keeps direct auth.users DML out of SQL.
      await client.query('delete from auth.users where id = any($1::uuid[])', [
        Object.values(users).map((user) => user.id),
      ])
      const cleaned = await inventory(client)
      assert.deepEqual(cleaned, baseline, 'cleanup did not restore the exact baseline contents')
      assert.equal(await aclDigest(client), baselineAcl, 'cleanup changed ACL, RLS, or function grants')
      cleanupRestoredExactBaseline = true

      await client.query('savepoint duplicate_cleanup')
      try {
        await client.query(render(cleanupSql))
      } catch (error) {
        missingFixtureCleanupRefused = /cleanup refused/.test(error.message)
      }
      await client.query('rollback to savepoint duplicate_cleanup')
      await client.query('release savepoint duplicate_cleanup')
      assert.ok(missingFixtureCleanupRefused, 'cleanup preflight must refuse a missing fixture set')
      transaction = 'rolled back'
    }

    console.log(JSON.stringify({
      result: 'PASS',
      database: configuration.database,
      migrations: versions,
      accounts: 6,
      memberships: { rallyPoint: 3, secondClub: 3 },
      activityRows: 18,
      allocations: 6,
      noActiveOverlaps: true,
      financialLabelsUnverified: true,
      unpaidBookings: true,
      aclUnchanged: true,
      duplicateFixtureRefused: true,
      missingFixtureCleanupRefused,
      cleanupRestoredExactBaseline,
      transaction,
    }, null, 2))
  } finally {
    if (transactionOpen) await client.query('rollback')
  }
} finally {
  await client.end()
}
