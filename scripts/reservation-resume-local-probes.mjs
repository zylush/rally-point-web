// Only receives connections already bound by the disposable-target executor.
import assert from 'node:assert/strict'
import { parseTap } from './reservation-resume-executor-guards.mjs'
import { reservationRpcs, reservationTables } from './reservation-resume-checks.mjs'

export function tapLines(raw) {
  return (Array.isArray(raw) ? raw : [raw]).flatMap(r => r.rows.flatMap(row =>
    Object.entries(row).filter(([key]) => key !== 'set_config').map(([, value]) => value)))
    .filter(value => typeof value === 'string')
}

export async function suite(client, sql, name, save) {
  assert.match(sql, /^(?:\s|--[^\n]*\n)*begin;/i)
  assert.match(sql, /rollback;\s*$/i)
  const raw = await client.query(sql)
  const lines = tapLines(raw)
  save({ name, lines }) // Preserve failed TAP before parsing it.
  return parseTap(lines, name)
}

export async function deniedWrites(client, paused) {
  let tableAttempts = 0, rpcAttempts = 0, reads = 0
  await client.query('BEGIN')
  try {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      const attempt = async sql => {
        await client.query('SAVEPOINT denied')
        await client.query(`SET LOCAL ROLE ${role}`)
        await assert.rejects(client.query(sql), e => e.code === '42501')
        await client.query('ROLLBACK TO SAVEPOINT denied')
        await client.query('RELEASE SAVEPOINT denied')
      }
      for (const table of reservationTables) {
        for (const sql of [`insert into public.${table} default values`,
          `update public.${table} set id=id where false`, `delete from public.${table} where false`]) {
          await attempt(sql); tableAttempts++
        }
      }
      if (paused || role !== 'authenticated') for (const rpc of reservationRpcs) {
        await attempt('select public.' + rpc.replace(/\((.*)\)/, (_, args) =>
          '(' + args.split(',').map(t => `null::${t.trim()}`).join(',') + ')'))
        rpcAttempts++
      }
    }
    await client.query('SET LOCAL ROLE authenticated')
    for (const table of reservationTables) { await client.query(`select count(*) from public.${table}`); reads++ }
  } finally { await client.query('ROLLBACK') }
  assert.equal(tableAttempts, 54)
  assert.equal(rpcAttempts, paused ? 27 : 18)
  assert.equal(reads, 6)
  return { tableAttempts, rpcAttempts, reads }
}

// Each proof flag must have a named, actually passing assertion, not just a suite count.
export function authorizationEvidence(rawSuites, direct) {
  const lines = rawSuites.flatMap(s => s.lines)
  const labels = {
    'member-own': 'owner sees own club-wide charge',
    'same-club-private': 'member cannot see peer club-wide charge',
    'staff-assigned-venue': 'assigned staff can create an unpaid desk booking through the scoped command',
    'staff-unassigned-venue': 'staff cannot read an unassigned venue',
    'admin-own-club': 'admin can read own-club membership charges',
    'cross-club': 'staff cannot read another club courts',
    'forged-ids': 'a staff command cannot pair a court with another venue',
    'revoked-staff-grant': 'revoking a venue grant removes staff operational access',
    'anonymous-denial': 'anonymous clients cannot read operational courts',
    'safe-tv': 'public schedule contains only safe labels for peer activity',
    'limited-roster': 'staff roster has exactly the approved columns',
  }
  const result = {}
  for (const [key, label] of Object.entries(labels)) {
    assert.ok(lines.some(s => /^ok \d+ - /.test(s) && s.endsWith(label)), `Missing observed authorization assertion: ${key}`)
    result[key] = true
  }
  assert.equal(direct.tableAttempts, 54)
  result['legacy-direct-write-denial'] = true
  return result
}

const club = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const venue = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac'
const courts = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaae']
const users = ['93000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000002']

export async function concurrency(observer, connect, record) {
  const a = await connect(), b = await connect()
  const ids = { bookings: [], court_sessions: [], open_plays: [] }
  let success = false
  const cases = {}
  const mark = (name, detail) => { cases[name] = true; record({ name, detail }) }
  async function begin(c, user = users[1]) {
    await c.query('BEGIN')
    await c.query('SET LOCAL ROLE authenticated')
    await c.query("select set_config('request.jwt.claim.sub',$1,true)", [user])
  }
  const bookSql = 'select * from public.create_unpaid_desk_booking($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::date,$6::integer,1)'
  const openSql = 'select * from public.create_open_play_session($1::uuid,$2::uuid,$3::uuid,$4::text,$5::timestamptz,$6::timestamptz,8,0,\'all\',\'[resume-local-only]\')'
  try {
    const pids = await Promise.all([a,b].map(async c => (await c.query('select pg_backend_pid() as pid')).rows[0].pid))
    assert.equal(new Set(pids).size, 2)
    await observer.query('BEGIN')
    for (const [i, id] of users.entries()) await observer.query(
      'insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',
      [id, `resume-probe-${i}@example.invalid`, { full_name: `Local resume probe ${i}` }])
    await observer.query("update public.members set status='active',expiry_date=date '2100-01-01' where user_id=any($1::uuid[])", [users])
    await observer.query("insert into public.club_staff_roles(club_id,user_id,role) values($1,$2,'admin')", [club, users[1]])
    const member = (await observer.query('select id from public.members where user_id=$1 and club_id=$2', [users[0], club])).rows[0].id
    await observer.query('COMMIT')
    const params = (court, hour) => [club,venue,court,member,'2099-04-01',hour]
    async function booking(c, court, hour) {
      const row = (await c.query(bookSql, params(court,hour))).rows[0]
      ids.bookings.push(row.id); return row
    }
    async function committed(c, court, hour) {
      await begin(c)
      try { const row = await booking(c,court,hour); await c.query('COMMIT'); return row }
      catch (error) { await c.query('ROLLBACK'); throw error }
    }
    await begin(a); const winner = await booking(a,courts[0],6)
    await begin(b)
    // Attach rejection handling immediately, before the observer starts polling.
    const pending = booking(b,courts[0],6).then(value => ({ value }), error => ({ code: error.code }))
    let blocked = false
    const deadline = Date.now() + 5000
    while (Date.now() < deadline) {
      const rows = (await observer.query("select wait_event_type from pg_stat_activity where pid=$1 and datname=current_database()", [pids[1]])).rows
      if (rows[0]?.wait_event_type === 'Lock') { blocked = true; break }
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    assert.equal(blocked, true, 'Second backend did not reach exclusion lock')
    await a.query('COMMIT')
    assert.equal((await pending).code, '23P01')
    await b.query('ROLLBACK')
    mark('same-court-one-winner', { pids, blocked: true, loser: '23P01' })
    await assert.rejects(committed(b,courts[0],6), e => e.code === '23P01')
    const count = (await observer.query(`select
      (select count(*)::int from public.bookings where court_id=$1 and start_at=('2099-04-01 06:00+08')::timestamptz) as bookings,
      (select count(*)::int from public.court_allocations where source_id=$2) as allocations`, [courts[0],winner.id])).rows[0]
    assert.deepEqual(count,{bookings:1,allocations:1}); mark('retry-no-duplicates',count)
    await begin(a,users[0])
    await a.query('select public.cancel_booking_reservation($1)',[winner.id])
    await a.query('select public.cancel_booking_reservation($1)',[winner.id])
    await a.query('COMMIT')
    assert.notEqual((await committed(b,courts[0],6)).id,winner.id)
    mark('cancellation-releases',{ repeatedCancellation: true })
    assert.equal((await Promise.all([committed(a,courts[0],8),committed(b,courts[0],9)])).length,2)
    mark('adjacent-both-succeed',{committed:2})
    assert.equal((await Promise.all([committed(a,courts[0],11),committed(b,courts[1],11)])).length,2)
    mark('different-courts-both-succeed',{committed:2})
    // Open play contends with a desk booking through the same allocation table.
    await begin(b)
    await assert.rejects(b.query(openSql,[club,venue,courts[0],'Probe',winner.start_at,winner.end_at]),e=>e.code==='23P01')
    await b.query('ROLLBACK')
    await begin(a)
    const rental = (await a.query('select * from public.create_desk_rental($1,$2,$3,$4,\'Local resume probe\',1)',[club,venue,courts[1],member])).rows[0]
    ids.court_sessions.push(rental.id)
    await a.query('COMMIT')
    const openParams = [club,venue,courts[1],'Probe',rental.start_at,rental.end_at]
    await begin(b)
    await assert.rejects(b.query(openSql,openParams),e=>e.code==='23P01')
    await b.query('ROLLBACK')
    mark('booking-rental-open-play-shared-rule',{ bookingBlocksOpenPlay:true,rentalBlocksOpenPlay:true })
    await begin(a); await a.query('select public.end_desk_session($1)',[rental.id]); await a.query('COMMIT')
    await begin(b)
    ids.open_plays.push((await b.query(openSql,openParams)).rows[0].id)
    await b.query('COMMIT')
    mark('completion-releases',{openPlayAfterCompletion:true})
    const completed = (await observer.query("select status from public.court_allocations where source='session' and source_id=$1",[rental.id])).rows[0]
    assert.equal(completed.status,'completed')
    // Successful probe cleanup is part of the approved rehearsal, never failure repair.
    await observer.query('BEGIN')
    await observer.query('delete from public.court_allocations where source_id=any($1::uuid[])',[Object.values(ids).flat()])
    for (const table of ['open_plays','court_sessions','bookings']) await observer.query(`delete from public.${table} where id=any($1::uuid[])`,[ids[table]])
    await observer.query('delete from public.transactions where created_by=$1',[users[1]])
    await observer.query('delete from public.club_staff_roles where user_id=any($1::uuid[])',[users])
    await observer.query('delete from public.members where user_id=any($1::uuid[])',[users])
    await observer.query('delete from auth.users where id=any($1::uuid[])',[users])
    await observer.query('COMMIT')
    success = true
    return { cases, independentConnections: 2 }
  } finally {
    // Releasing our uncommitted transactions is the only failure cleanup.
    // Persisted rows/grants remain untouched on failure for investigation.
    for (const c of [a,b,observer]) await c.query('ROLLBACK').catch(() => {})
    await Promise.all([a.end(),b.end()])
    record({ phase: 'concurrency-end', success })
  }
}
