// Exercises the already-applied backfill against synthetic historical rows.
// Fixed local loopback only; every fixture and migration re-run is rolled back.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import pg from 'pg'

const client = new pg.Client({
  host: '127.0.0.1', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres',
})
const backfill = readFileSync(new URL('../migrations/20260921110828_tenant_backfill.sql', import.meta.url), 'utf8')
const userId = '99999999-9999-4999-8999-999999999901'
const bookingId = '99999999-9999-4999-8999-999999999902'
const sessionId = '99999999-9999-4999-8999-999999999903'
const playId = '99999999-9999-4999-8999-999999999904'
const transactionId = '99999999-9999-4999-8999-999999999905'
const clubId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const venueId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab'

await client.connect()
try {
  const versions = (await client.query('select version from supabase_migrations.schema_migrations order by version')).rows.map((row) => row.version)
  assert.deepEqual(versions, ['001', '002', '003', '004', '20260803125450', '20260805094557', '20260921090000', '20260921110828'])
  const baseline = (await client.query(`select
    (select count(*)::int from auth.users) as users,
    (select count(*)::int from public.members) as members,
    (select count(*)::int from public.bookings) as bookings,
    (select count(*)::int from public.court_allocations) as allocations`)).rows[0]
  await client.query('begin')
  try {
    const court = (await client.query('select id from public.courts where venue_id = $1 order by id limit 1', [venueId])).rows[0]
    assert.ok(court?.id, 'local Rally Point court must exist')
    await client.query('insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)', [userId, 'backfill-local-only@example.invalid', { full_name: 'Backfill Fixture' }])
    const member = (await client.query('select id from public.members where user_id = $1', [userId])).rows[0]
    assert.ok(member?.id, 'signup trigger must create a member')
    await client.query('update public.members set club_id = null where id = $1', [member.id])
    await client.query(`insert into public.bookings (id,court_id,member_id,start_at,end_at,hours,amount,status)
      values ($1,$2,$3,'2099-01-01 06:00+08','2099-01-01 07:00+08',1,500,'confirmed')`, [bookingId, court.id, member.id])
    await client.query(`insert into public.court_sessions (id,court_id,member_id,start_at,end_at,status,amount)
      values ($1,$2,$3,'2099-01-01 07:00+08','2099-01-01 08:00+08','scheduled',500)`, [sessionId, court.id, member.id])
    await client.query(`insert into public.open_plays (id,title,court_id,start_at,end_at,capacity,status)
      values ($1,'Backfill Fixture',$2,'2099-01-01 08:00+08','2099-01-01 09:00+08',8,'open')`, [playId, court.id])
    await client.query('insert into public.open_play_signups (open_play_id,member_id) values ($1,$2)', [playId, member.id])
    await client.query('insert into public.checkins (member_id) values ($1)', [member.id])
    await client.query('insert into public.walkins (full_name,purpose,amount) values ($1,$2,100)', ['Synthetic Walk-in', 'Local backfill'])
    await client.query(`insert into public.transactions (id,member_id,amount,type,description,verification_status)
      values ($1,$2,500,'court_rental','Synthetic historical charge','verified')`, [transactionId, member.id])
    await client.query('insert into public.notifications (user_id,title,body) values ($1,$2,$3)', [userId, 'Fixture', 'Local only'])
    await client.query(`insert into public.reminders (user_id,kind,title,body,fire_at,booking_id)
      values ($1,'booking','Fixture','Local only','2099-01-01 05:00+08',$2)`, [userId, bookingId])

    await client.query(backfill)
    const ownership = (await client.query(`select
      (select club_id from public.members where id = $1) as member_club,
      (select (club_id,venue_id) from public.bookings where id = $2) as booking_owner,
      (select (club_id,venue_id) from public.court_sessions where id = $3) as session_owner,
      (select (club_id,venue_id) from public.open_plays where id = $4) as play_owner,
      (select count(*)::int from public.open_play_signups where open_play_id = $4 and club_id = $5 and venue_id = $6) as signups,
      (select count(*)::int from public.checkins where member_id = $1 and club_id = $5 and venue_id = $6) as checkins,
      (select count(*)::int from public.walkins where full_name = 'Synthetic Walk-in' and club_id = $5 and venue_id = $6) as walkins,
      (select count(*)::int from public.notifications where user_id = $7 and club_id = $5) as notifications,
      (select count(*)::int from public.reminders where booking_id = $2 and club_id = $5 and venue_id = $6) as reminders,
      (select verification_status from public.transactions where id = $8) as charge_status,
      (select count(*)::int from public.court_allocations where source_id in ($2,$3,$4) and club_id = $5 and venue_id = $6) as allocations`,
      [member.id, bookingId, sessionId, playId, clubId, venueId, userId, transactionId])).rows[0]
    assert.equal(ownership.member_club, clubId)
    for (const key of ['booking_owner', 'session_owner', 'play_owner']) assert.deepEqual(ownership[key], `(${clubId},${venueId})`)
    for (const key of ['signups', 'checkins', 'walkins', 'notifications', 'reminders']) assert.equal(ownership[key], 1, key)
    assert.equal(ownership.charge_status, 'unverified')
    assert.equal(ownership.allocations, 3)
    const charges = (await client.query('select id,status from public.bookings where id=$1', [bookingId])).rows
    assert.deepEqual(charges, [{ id: bookingId, status: 'confirmed' }], 'historical booking ID/status preserved')

    await client.query('savepoint overlap_case')
    await client.query(`insert into public.bookings (court_id,member_id,start_at,end_at,hours,amount,status,club_id,venue_id)
      values ($1,$2,'2099-01-01 06:30+08','2099-01-01 07:30+08',1,500,'confirmed',$3,$4)`, [court.id, member.id, clubId, venueId])
    let overlapRejected = false
    try { await client.query(backfill) } catch (error) {
      overlapRejected = /overlap; reconcile before tenant cutover/.test(error.message)
    }
    assert.ok(overlapRejected, 'backfill must reject competing occupied intervals')
    await client.query('rollback to savepoint overlap_case')
    await client.query('release savepoint overlap_case')
    console.log(JSON.stringify({ result: 'PASS', member: 1, booking: 1, session: 1, openPlay: 1,
      signups: 1, checkins: 1, walkins: 1, notifications: 1, reminders: 1,
      historicalChargeUnverified: true, allocations: 3, overlapRejected: true }))
  } finally { await client.query('rollback') }
  const after = (await client.query(`select
    (select count(*)::int from auth.users) as users,
    (select count(*)::int from public.members) as members,
    (select count(*)::int from public.bookings) as bookings,
    (select count(*)::int from public.court_allocations) as allocations`)).rows[0]
  assert.deepEqual(after, baseline, 'synthetic data must roll back')
  console.log('Local baseline restored; no staging connection')
} finally { await client.end() }
