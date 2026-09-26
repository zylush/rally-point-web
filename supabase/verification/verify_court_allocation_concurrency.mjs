// Local-only two-connection allocation rehearsal against the populated,
// enforced disposable clone. Every row created by this script is removed and
// the relevant table contents are compared with their starting digests.
import assert from 'node:assert/strict'
import pg from 'pg'

const VERIFY_DB_PORT = Number.parseInt(process.env.RALLY_VERIFY_DB_PORT ?? '54322', 10)
assert.ok(Number.isInteger(VERIFY_DB_PORT) && VERIFY_DB_PORT > 0 && VERIFY_DB_PORT <= 65_535,
  'RALLY_VERIFY_DB_PORT must be a valid local TCP port')

const DATABASE = 'rally_gate6_fixture_20260923'
const CLUB_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const VENUE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac'
const COURT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad'
const COURT_B = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaae'
const MEMBER_USER_ID = '91000000-0000-4000-8000-000000000001'
const ADMIN_USER_ID = '91000000-0000-4000-8000-000000000002'
const TEST_DATE = '2099-04-01'

const connection = () => new pg.Client({
  host: '127.0.0.1',
  port: VERIFY_DB_PORT,
  user: 'postgres',
  password: 'postgres',
  database: DATABASE,
  statement_timeout: 15_000,
})

const clientA = connection()
const clientB = connection()
const observer = connection()
const created = {
  bookings: new Set(),
  sessions: new Set(),
  openPlays: new Set(),
}

async function beginAuthenticated(client, userId = ADMIN_USER_ID) {
  await client.query('begin')
  await client.query('set local role authenticated')
  await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId])
}

async function rollbackQuietly(client) {
  try { await client.query('rollback') } catch { /* connection cleanup only */ }
}

async function booking(client, memberId, courtId, startHour) {
  const { rows: [row] } = await client.query(`
    select * from public.create_unpaid_desk_booking(
      $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::date, $6::integer, 1
    )
  `, [CLUB_ID, VENUE_ID, courtId, memberId, TEST_DATE, startHour])
  created.bookings.add(row.id)
  return row
}

async function committedBooking(client, memberId, courtId, startHour) {
  await beginAuthenticated(client)
  try {
    const row = await booking(client, memberId, courtId, startHour)
    await client.query('commit')
    return row
  } catch (error) {
    await rollbackQuietly(client)
    throw error
  }
}

async function waitForBlockedBooking() {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const { rows: [row] } = await observer.query(`
      select count(*)::int as count
      from pg_stat_activity
      where datname = current_database()
        and pid <> pg_backend_pid()
        and query like '%create_unpaid_desk_booking%'
        and wait_event_type = 'Lock'
    `)
    if (row.count > 0) return true
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return false
}

async function tableInventory() {
  const result = {}
  for (const table of ['bookings', 'court_sessions', 'open_plays', 'court_allocations', 'transactions']) {
    const { rows: [row] } = await observer.query(`
      select count(*)::int as count,
             md5(coalesce(string_agg(payload, E'\\n' order by payload), '')) as digest
      from (select to_jsonb(t)::text as payload from public.${table} t) rows
    `)
    result[table] = row
  }
  const { rows: courts } = await observer.query(`
    select id, status::text from public.courts where id in ($1::uuid, $2::uuid) order by id
  `, [COURT_A, COURT_B])
  result.courts = courts
  return result
}

async function cleanup(transactionIds) {
  await observer.query('begin')
  try {
    const sourceIds = [
      ...created.bookings,
      ...created.sessions,
      ...created.openPlays,
    ]
    if (sourceIds.length > 0) {
      await observer.query('delete from public.court_allocations where source_id = any($1::uuid[])', [sourceIds])
    }
    if (created.openPlays.size > 0) {
      await observer.query('delete from public.open_plays where id = any($1::uuid[])', [[...created.openPlays]])
    }
    if (created.sessions.size > 0) {
      await observer.query('delete from public.court_sessions where id = any($1::uuid[])', [[...created.sessions]])
    }
    if (created.bookings.size > 0) {
      await observer.query('delete from public.bookings where id = any($1::uuid[])', [[...created.bookings]])
    }
    if (transactionIds.length > 0) {
      await observer.query('delete from public.transactions where id = any($1::uuid[])', [transactionIds])
    }
    await observer.query("update public.courts set status = 'available' where id in ($1::uuid, $2::uuid)", [COURT_A, COURT_B])
    await observer.query('commit')
  } catch (error) {
    await rollbackQuietly(observer)
    throw error
  }
}

await Promise.all([clientA.connect(), clientB.connect(), observer.connect()])
let baseline
let baselineTransactions
let cleanupCompleted = false
try {
  const { rows: [identity] } = await observer.query(`
    select current_database() as database,
           exists(select 1 from pg_constraint where conname = 'court_allocations_no_overlap') as enforced
  `)
  assert.deepEqual(identity, { database: DATABASE, enforced: true })

  const { rows: [member] } = await observer.query(
    'select id from public.members where club_id = $1 and user_id = $2',
    [CLUB_ID, MEMBER_USER_ID],
  )
  assert.ok(member?.id, 'fixture member is required')
  baseline = await tableInventory()
  baselineTransactions = new Set((await observer.query('select id from public.transactions')).rows.map((row) => row.id))

  const { rows: occupied } = await observer.query(`
    select id from public.court_allocations
    where court_id in ($1::uuid, $2::uuid)
      and status in ('held', 'reserved', 'playing')
      and interval && tstzrange('2099-04-01 00:00+08', '2099-04-02 00:00+08', '[)')
  `, [COURT_A, COURT_B])
  assert.equal(occupied.length, 0, 'reserved concurrency test window must start empty')

  // Same court and interval: hold A open while B reaches the exclusion lock.
  await beginAuthenticated(clientA)
  const winner = await booking(clientA, member.id, COURT_A, 6)
  await beginAuthenticated(clientB)
  const loserPromise = booking(clientB, member.id, COURT_A, 6)
  assert.equal(await waitForBlockedBooking(), true, 'second connection must wait on the first allocation')
  await clientA.query('commit')
  let overlapError
  try { await loserPromise } catch (error) { overlapError = error }
  await rollbackQuietly(clientB)
  assert.equal(overlapError?.code, '23P01', 'overlapping writer must lose to the exclusion constraint')

  // A normal retry of the same business request must fail atomically without a
  // second booking row.
  let retryError
  try { await committedBooking(clientB, member.id, COURT_A, 6) } catch (error) { retryError = error }
  assert.equal(retryError?.code, '23P01', 'retry must not create a duplicate booking')
  const { rows: [winnerCount] } = await observer.query(`
    select
      (select count(*)::int from public.bookings where id = $1) as bookings,
      (select count(*)::int from public.court_allocations where source = 'booking' and source_id = $1) as allocations
  `, [winner.id])
  assert.deepEqual(winnerCount, { bookings: 1, allocations: 1 })

  // The owning member can cancel the unpaid booking. The business row and its
  // active allocation move together, a repeated cancellation is idempotent,
  // and the released interval can be reserved again.
  await beginAuthenticated(clientA, MEMBER_USER_ID)
  await clientA.query('select public.cancel_booking_reservation($1::uuid)', [winner.id])
  await clientA.query('select public.cancel_booking_reservation($1::uuid)', [winner.id])
  await clientA.query('commit')
  const { rows: [cancelled] } = await observer.query(`
    select
      (select status::text from public.bookings where id = $1) as booking_status,
      (select status from public.court_allocations where source = 'booking' and source_id = $1) as allocation_status
  `, [winner.id])
  assert.deepEqual(cancelled, { booking_status: 'cancelled', allocation_status: 'cancelled' })
  const replacement = await committedBooking(clientB, member.id, COURT_A, 6)
  assert.notEqual(replacement.id, winner.id)

  // Adjacent intervals on the same court and equal intervals on different
  // courts both succeed through independent connections.
  const adjacent = await Promise.all([
    committedBooking(clientA, member.id, COURT_A, 8),
    committedBooking(clientB, member.id, COURT_A, 9),
  ])
  assert.equal(adjacent.length, 2)
  const differentCourts = await Promise.all([
    committedBooking(clientA, member.id, COURT_A, 11),
    committedBooking(clientB, member.id, COURT_B, 11),
  ])
  assert.equal(differentCourts.length, 2)

  // A live rental owns the interval. Court-based open play loses while the
  // rental is active, then succeeds after end_desk_session completes it.
  await beginAuthenticated(clientA)
  const { rows: [rental] } = await clientA.query(`
    select * from public.create_desk_rental(
      $1::uuid, $2::uuid, $3::uuid, $4::uuid, 'Concurrency fixture', 1
    )
  `, [CLUB_ID, VENUE_ID, COURT_B, member.id])
  created.sessions.add(rental.id)
  await clientA.query('commit')

  const openPlayParams = [
    CLUB_ID, VENUE_ID, COURT_B, 'Concurrency fixture', rental.start_at,
    rental.end_at, 8, 0, 'all', '[concurrency-fixture]',
  ]
  await beginAuthenticated(clientB)
  let openPlayBlocked
  try {
    await clientB.query(`
      select * from public.create_open_play_session(
        $1::uuid, $2::uuid, $3::uuid, $4::text, $5::timestamptz,
        $6::timestamptz, $7::integer, $8::numeric, $9::public.skill_level, $10::text
      )
    `, openPlayParams)
  } catch (error) { openPlayBlocked = error }
  await rollbackQuietly(clientB)
  assert.equal(openPlayBlocked?.code, '23P01', 'rental must block overlapping court-based open play')

  await beginAuthenticated(clientA)
  await clientA.query('select public.end_desk_session($1::uuid)', [rental.id])
  await clientA.query('commit')

  await beginAuthenticated(clientB)
  const { rows: [openPlay] } = await clientB.query(`
    select * from public.create_open_play_session(
      $1::uuid, $2::uuid, $3::uuid, $4::text, $5::timestamptz,
      $6::timestamptz, $7::integer, $8::numeric, $9::public.skill_level, $10::text
    )
  `, openPlayParams)
  created.openPlays.add(openPlay.id)
  await clientB.query('commit')

  const { rows: [sourceSummary] } = await observer.query(`
    select
      count(*) filter (where source = 'booking')::int as bookings,
      count(*) filter (where source = 'session' and status = 'completed')::int as completed_sessions,
      count(*) filter (where source = 'open_play' and status = 'reserved')::int as open_plays
    from public.court_allocations
    where source_id = any($1::uuid[])
  `, [[...created.bookings, ...created.sessions, ...created.openPlays]])
  assert.deepEqual(sourceSummary, {
    bookings: 6,
    completed_sessions: 1,
    open_plays: 1,
  })

  const currentTransactionIds = (await observer.query('select id from public.transactions')).rows
    .map((row) => row.id)
    .filter((id) => !baselineTransactions.has(id))
  await cleanup(currentTransactionIds)
  cleanupCompleted = true
  assert.deepEqual(await tableInventory(), baseline, 'concurrency fixture cleanup must restore exact baseline')

  console.log(JSON.stringify({
    result: 'PASS',
    database: DATABASE,
    independentConnections: 2,
    blockedWriterObserved: true,
    sameCourtOverlap: 'one winner',
    retryDuplicateRows: 0,
    cancellationReleasesInterval: true,
    adjacentIntervals: 'both committed',
    differentCourts: 'both committed',
    rentalBlocksOpenPlay: true,
    completedRentalReleasesInterval: true,
    allocationSources: ['booking', 'session', 'open_play'],
    cleanupRestoredExactBaseline: true,
  }, null, 2))
} finally {
  await Promise.all([
    rollbackQuietly(clientA),
    rollbackQuietly(clientB),
  ])
  if (baseline && baselineTransactions && !cleanupCompleted) {
    const currentTransactionIds = (await observer.query('select id from public.transactions')).rows
      .map((row) => row.id)
      .filter((id) => !baselineTransactions.has(id))
    await cleanup(currentTransactionIds)
  }
  await Promise.all([clientA.end(), clientB.end(), observer.end()])
}
