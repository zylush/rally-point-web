// Populated RLS verification for the enforced disposable clone. No remote
// connection is accepted. The forward privacy repair, peer-charge probe,
// synthetic regression fixtures, and grant revocation are all rolled back.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import pg from 'pg'

const root = new URL('../../', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')
function transactionBody(sql) {
  assert.match(sql, /^(?:\s|--[^\n]*\n)*begin;/i)
  assert.match(sql, /rollback;\s*$/i)
  return sql.replace(/^(?:\s|--[^\n]*\n)*begin;/i, '').replace(/rollback;\s*$/i, '')
}

const VERIFY_DB_PORT = Number.parseInt(process.env.RALLY_VERIFY_DB_PORT ?? '54322', 10)
assert.ok(Number.isInteger(VERIFY_DB_PORT) && VERIFY_DB_PORT > 0 && VERIFY_DB_PORT <= 65_535,
  'RALLY_VERIFY_DB_PORT must be a valid local TCP port')

const DATABASE = 'rally_gate6_fixture_20260923'
const RALLY_MEMBER = '91000000-0000-4000-8000-000000000001'
const RALLY_ADMIN = '91000000-0000-4000-8000-000000000002'
const RALLY_STAFF = '91000000-0000-4000-8000-000000000003'
const SECOND_MEMBER = '92000000-0000-4000-8000-000000000001'
const SECOND_ADMIN = '92000000-0000-4000-8000-000000000002'
const SECOND_STAFF = '92000000-0000-4000-8000-000000000003'
const RALLY_CLUB = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const RALLY_FIXTURE_VENUE = '71000000-0000-4000-8100-000000000001'

const client = new pg.Client({
  host: '127.0.0.1',
  port: VERIFY_DB_PORT,
  user: 'postgres',
  password: 'postgres',
  database: DATABASE,
})

async function asRole(role, userId, action) {
  await client.query('savepoint role_check')
  try {
    await client.query(`set local role ${role}`)
    if (userId) {
      await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId])
    }
    return await action()
  } finally {
    await client.query('rollback to savepoint role_check')
    await client.query('release savepoint role_check')
  }
}

async function operationalCounts(userId) {
  return asRole('authenticated', userId, async () => {
    const { rows: [row] } = await client.query(`
      select
        (select count(*)::int from public.venues) as venues,
        (select count(*)::int from public.courts) as courts,
        (select count(*)::int from public.bookings) as bookings,
        (select count(*)::int from public.court_sessions) as sessions,
        (select count(*)::int from public.open_plays) as open_plays,
        (select count(*)::int from public.open_play_signups) as signups,
        (select count(*)::int from public.checkins) as checkins,
        (select count(*)::int from public.transactions) as transactions,
        (select count(*)::int from public.notifications) as notifications,
        (select count(*)::int from public.reminders) as reminders,
        (select count(*)::int from public.court_allocations) as allocations,
        (select count(*)::int from public.member_roster) as roster,
        (select count(*)::int from public.member_self) as member_self,
        (select count(*)::int from public.club_staff_roles) as staff_roles,
        (select count(*)::int from public.staff_venue_grants) as venue_grants
    `)
    return row
  })
}

await client.connect()
try {
  await client.query('set search_path = public, extensions')
  const beforeSchema = (await client.query(read('supabase/verification/schema_fingerprint.sql'))).rows
  const beforeData = (await client.query(read('supabase/verification/backup_content_inventory.sql'))).rows
  await client.query('begin')
  await client.query(read('supabase/migrations/20260923053440_member_privacy_repair.sql'))
  const { rows: [identity] } = await client.query(`
    select current_database() as database,
           exists(select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'private' and p.proname = 'is_member_owner') as member_lookup_repaired,
           exists(select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'cancel_booking_reservation') as cancellation_available
  `)
  assert.deepEqual(identity, {
    database: DATABASE,
    member_lookup_repaired: true,
    cancellation_available: true,
  })

  assert.deepEqual(await operationalCounts(RALLY_MEMBER), {
    venues: 3,
    courts: 7,
    bookings: 1,
    sessions: 1,
    open_plays: 1,
    signups: 1,
    checkins: 1,
    transactions: 1,
    notifications: 1,
    reminders: 1,
    allocations: 0,
    roster: 0,
    member_self: 1,
    staff_roles: 0,
    venue_grants: 0,
  })

  assert.deepEqual(await operationalCounts(RALLY_STAFF), {
    venues: 1,
    courts: 1,
    bookings: 1,
    sessions: 1,
    open_plays: 1,
    signups: 1,
    checkins: 1,
    transactions: 1,
    notifications: 0,
    reminders: 0,
    allocations: 3,
    roster: 3,
    member_self: 1,
    staff_roles: 0,
    venue_grants: 0,
  })

  assert.deepEqual(await operationalCounts(RALLY_ADMIN), {
    venues: 3,
    courts: 7,
    bookings: 1,
    sessions: 1,
    open_plays: 1,
    signups: 1,
    checkins: 1,
    transactions: 1,
    notifications: 0,
    reminders: 0,
    allocations: 3,
    roster: 3,
    member_self: 1,
    staff_roles: 2,
    venue_grants: 1,
  })

  const noOperationalAccess = {
    venues: 0,
    courts: 0,
    bookings: 0,
    sessions: 0,
    open_plays: 0,
    signups: 0,
    checkins: 0,
    transactions: 0,
    notifications: 0,
    reminders: 0,
    allocations: 0,
    roster: 0,
    member_self: 0,
    staff_roles: 0,
    venue_grants: 0,
  }
  for (const userId of [SECOND_MEMBER, SECOND_ADMIN, SECOND_STAFF]) {
    assert.deepEqual(await operationalCounts(userId), noOperationalAccess)
  }

  await asRole('authenticated', RALLY_MEMBER, async () => {
    await assert.rejects(client.query('select * from public.members'), (error) => error.code === '42501')
  })

  const rosterColumns = (await client.query(`
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'member_roster'
    order by ordinal_position
  `)).rows.map((row) => row.column_name)
  assert.deepEqual(rosterColumns, [
    'club_id', 'id', 'member_code', 'full_name', 'membership_type',
    'status', 'expiry_date', 'created_at',
  ])
  for (const forbidden of ['email', 'phone', 'qr_token', 'amount', 'payment_ref']) {
    assert.ok(!rosterColumns.includes(forbidden), `member roster exposes ${forbidden}`)
  }

  await asRole('anon', null, async () => {
    const { rows: [schedule] } = await client.query(`
      select count(*)::int as count,
             bool_and(title in ('In use', 'Reserved', 'Open play')) as safe_titles
      from public.public_schedule
    `)
    assert.deepEqual(schedule, { count: 3, safe_titles: true })
    await assert.rejects(client.query('select * from public.courts'), (error) => error.code === '42501')
  })

  const { rows: [grantBefore] } = await client.query(`
    select is_active from public.staff_venue_grants
    where club_id = $1 and user_id = $2 and venue_id = $3
  `, [RALLY_CLUB, RALLY_STAFF, RALLY_FIXTURE_VENUE])
  assert.deepEqual(grantBefore, { is_active: true })
  await client.query('savepoint revoke_grant')
  try {
    await client.query(`
      update public.staff_venue_grants set is_active = false
      where club_id = $1 and user_id = $2 and venue_id = $3
    `, [RALLY_CLUB, RALLY_STAFF, RALLY_FIXTURE_VENUE])
    await client.query('set local role authenticated')
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [RALLY_STAFF])
    const { rows: [revoked] } = await client.query(`
      select
        (select count(*)::int from public.venues) as venues,
        (select count(*)::int from public.courts) as courts,
        (select count(*)::int from public.bookings) as bookings,
        (select count(*)::int from public.court_allocations) as allocations
    `)
    assert.deepEqual(revoked, { venues: 0, courts: 0, bookings: 0, allocations: 0 })
  } finally {
    await client.query('rollback to savepoint revoke_grant')
    await client.query('release savepoint revoke_grant')
  }
  const { rows: [grantAfter] } = await client.query(`
    select is_active from public.staff_venue_grants
    where club_id = $1 and user_id = $2 and venue_id = $3
  `, [RALLY_CLUB, RALLY_STAFF, RALLY_FIXTURE_VENUE])
  assert.deepEqual(grantAfter, grantBefore)

  await client.query('savepoint original_probe')
  await client.query(transactionBody(read('supabase/verification/same_club_member_privacy_preflight.sql')))
  await client.query('rollback to savepoint original_probe')
  await client.query('release savepoint original_probe')
  await client.query(read('supabase/seed.sql'))
  const raw = await client.query(transactionBody(read('supabase/tests/database/same_club_privacy.test.sql')))
  const tap = raw.flatMap((result) => result.rows.flatMap((row) => Object.values(row)))
    .filter((line) => typeof line === 'string')
  assert.deepEqual(tap.filter((line) => /^not ok|^# Looks like/i.test(line)), [])
  assert.deepEqual(tap.filter((line) => /^1\.\.\d+$/.test(line)), ['1..68'])
  assert.equal(tap.filter((line) => /^ok \d+/.test(line)).length, 68)
  await client.query('rollback')
  assert.deepEqual((await client.query(read('supabase/verification/schema_fingerprint.sql'))).rows, beforeSchema)
  assert.deepEqual((await client.query(read('supabase/verification/backup_content_inventory.sql'))).rows, beforeData)

  console.log(JSON.stringify({
    result: 'PASS',
    database: DATABASE,
    rallyMemberOwnRowsOnly: true,
    originalSameClubChargeProbePassed: true,
    sameClubPrivacyAssertions: 68,
    localSchemaAndDataUnchanged: true,
    rallyStaffAssignedVenueOnly: true,
    rallyAdminAllClubVenues: true,
    secondClubCrossTenantRows: 0,
    anonymousOperationalTablesDenied: true,
    publicScheduleRows: 3,
    limitedRosterColumns: rosterColumns,
    revokedStaffOperationalRows: 0,
    revocationRolledBack: true,
  }, null, 2))
} finally {
  await client.query('rollback')
  await client.end()
}
