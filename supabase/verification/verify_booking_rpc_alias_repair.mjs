// Proves the forward booking-RPC repair at the current staging boundary before
// enforcement. Fixed local restored database; all schema/data changes roll back.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import pg from 'pg'

const VERIFY_DB_PORT = Number.parseInt(process.env.RALLY_VERIFY_DB_PORT ?? '54322', 10)
assert.ok(Number.isInteger(VERIFY_DB_PORT) && VERIFY_DB_PORT > 0 && VERIFY_DB_PORT <= 65_535,
  'RALLY_VERIFY_DB_PORT must be a valid local TCP port')

const DATABASE = 'rally_postdeploy_restore_20260922'
const CLUB_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const VENUE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab'
const MEMBER_USER_ID = '93000000-0000-4000-8000-000000000001'
const ADMIN_USER_ID = '93000000-0000-4000-8000-000000000002'
const STAFF_USER_ID = '93000000-0000-4000-8000-000000000003'
const repair = readFileSync(
  new URL('../migrations/20260922163027_booking_rpc_alias_repair.sql', import.meta.url),
  'utf8',
)
const cancellation = readFileSync(
  new URL('../migrations/20260922163830_booking_cancellation_command.sql', import.meta.url),
  'utf8',
)
const memberLookupRepair = readFileSync(
  new URL('../migrations/20260922164128_rls_member_lookup_repair.sql', import.meta.url),
  'utf8',
)
const digest = (value) => createHash('sha256').update(value).digest('hex')
const client = new pg.Client({
  host: '127.0.0.1',
  port: VERIFY_DB_PORT,
  user: 'postgres',
  password: 'postgres',
  database: DATABASE,
})

async function state() {
  const { rows: [row] } = await client.query(`
    select
      (select count(*)::int from auth.users) as users,
      (select count(*)::int from public.profiles) as profiles,
      (select count(*)::int from public.members) as members,
      (select count(*)::int from public.bookings) as bookings,
      (select count(*)::int from public.court_allocations) as allocations,
      to_regprocedure('public.cancel_booking_reservation(uuid)') is not null as cancellation_exists,
      to_regprocedure('private.is_member_owner(uuid,uuid)') is not null as member_lookup_exists,
      pg_get_functiondef(
        'public.create_unpaid_desk_booking(uuid,uuid,uuid,uuid,date,integer,integer)'::regprocedure
      ) as function_definition
  `)
  return { ...row, function_definition: digest(row.function_definition) }
}

await client.connect()
try {
  const { rows: [identity] } = await client.query('select current_database() as database')
  assert.equal(identity.database, DATABASE)
  const versions = (await client.query(
    'select version from supabase_migrations.schema_migrations order by version',
  )).rows.map((row) => row.version)
  assert.deepEqual(versions, [
    '001', '002', '003', '004', '20260803125450', '20260805094557',
    '20260921090000', '20260921110828', '20260922011918',
  ])

  const baseline = await state()
  await client.query('begin')
  try {
    await client.query(repair)
    await client.query(cancellation)
    await client.query(memberLookupRepair)
    const repairedDefinition = (await client.query(`
      select pg_get_functiondef(
        'public.create_unpaid_desk_booking(uuid,uuid,uuid,uuid,date,integer,integer)'::regprocedure
      ) as definition
    `)).rows[0].definition
    assert.notEqual(digest(repairedDefinition), baseline.function_definition)
    assert.match(repairedDefinition, /venue_row\.timezone/)
    assert.doesNotMatch(repairedDefinition, /select c\.hourly_rate, v\.timezone/)
    assert.ok((await client.query("select to_regprocedure('public.cancel_booking_reservation(uuid)') is not null as present")).rows[0].present)
    assert.ok((await client.query("select to_regprocedure('private.is_member_owner(uuid,uuid)') is not null as present")).rows[0].present)

    await client.query(`
      insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
      values
        ($1, 'member@booking-repair.example.invalid', now(), '{"full_name":"Repair Member"}'),
        ($2, 'admin@booking-repair.example.invalid', now(), '{"full_name":"Repair Admin"}'),
        ($3, 'staff@booking-repair.example.invalid', now(), '{"full_name":"Repair Staff","role":"admin"}')
    `, [MEMBER_USER_ID, ADMIN_USER_ID, STAFF_USER_ID])
    await client.query("update public.profiles set role = 'admin' where id = $1", [ADMIN_USER_ID])
    await client.query("update public.profiles set role = 'staff' where id = $1", [STAFF_USER_ID])
    await client.query(`
      insert into public.club_staff_roles (club_id, user_id, role)
      values ($1, $2, 'admin'), ($1, $3, 'staff')
    `, [CLUB_ID, ADMIN_USER_ID, STAFF_USER_ID])
    await client.query(`
      insert into public.staff_venue_grants (club_id, user_id, venue_id, granted_by)
      values ($1, $2, $3, $4)
    `, [CLUB_ID, STAFF_USER_ID, VENUE_ID, ADMIN_USER_ID])

    const { rows: [inputs] } = await client.query(`
      select
        (select id from public.members where user_id = $1) as member_id,
        (select id from public.courts where venue_id = $2 order by id limit 1) as court_id
    `, [MEMBER_USER_ID, VENUE_ID])
    assert.ok(inputs.member_id && inputs.court_id)

    await client.query('set local role authenticated')
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [STAFF_USER_ID])
    const { rows: [booking] } = await client.query(`
      select * from public.create_unpaid_desk_booking(
        $1::uuid, $2::uuid, $3::uuid, $4::uuid, date '2099-05-01', 6, 1
      )
    `, [CLUB_ID, VENUE_ID, inputs.court_id, inputs.member_id])
    assert.equal(booking.club_id, CLUB_ID)
    assert.equal(booking.venue_id, VENUE_ID)
    assert.equal(booking.status, 'pending_payment')
    assert.equal(booking.payment_method, null)
    assert.equal(booking.payment_ref, null)
    assert.ok(Number(booking.amount) > 0)

    const { rows: [allocation] } = await client.query(`
      select source, source_id, status
      from public.court_allocations where source = 'booking' and source_id = $1
    `, [booking.id])
    assert.deepEqual(allocation, {
      source: 'booking',
      source_id: booking.id,
      status: 'reserved',
    })
    const { rows: [cancelled] } = await client.query(
      'select * from public.cancel_booking_reservation($1::uuid)',
      [booking.id],
    )
    assert.equal(cancelled.status, 'cancelled')
    const { rows: [released] } = await client.query(`
      select status from public.court_allocations
      where source = 'booking' and source_id = $1
    `, [booking.id])
    assert.deepEqual(released, { status: 'cancelled' })
  } finally {
    await client.query('rollback')
  }

  assert.deepEqual(await state(), baseline, 'repair rehearsal must restore schema and data baseline')
  console.log(JSON.stringify({
    result: 'PASS',
    database: DATABASE,
    migrations: [
      '20260922163027_booking_rpc_alias_repair.sql',
      '20260922163830_booking_cancellation_command.sql',
      '20260922164128_rls_member_lookup_repair.sql',
    ],
    boundary: 'backfill plus grant repair; enforcement absent',
    assignedStaffBooking: true,
    unpaidLabelPreserved: true,
    allocationCreated: true,
    bookingCancellationReleasedAllocation: true,
    memberLookupPolicyRepairInstalled: true,
    rollbackRestoredExactBaseline: true,
  }, null, 2))
} finally {
  await client.end()
}
