import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import test from 'node:test'

const source = readFileSync(new URL('./staff-assigned-venue-smoke.js', import.meta.url), 'utf8')
const journey = runInNewContext(`(${source})`, { URL: undefined })
const assigned = '71000000-0000-4000-8100-000000000001'
const root = 'https://zylush.github.io/rally-point-web/'
const api = 'https://iclrvvsiwypxlwrwgqia.supabase.co/rest/v1/'
const scoped = table => `${api}${table}?select=*&venue_id=eq.${assigned}`

function fakePage(config = {}) {
  const listeners = new Map()
  const visits = []
  let pendingVenue
  let phase = 'courts'
  const reads = config.reads ?? {
    courts: [scoped('courts'), scoped('court_sessions')],
    bookings: [scoped('bookings')],
  }
  const page = {
    on(event, listener) { listeners.set(event, listener) },
    async setViewportSize() {},
    waitForResponse(predicate) {
      assert.equal(predicate({ request: () => ({ method: () => 'GET' }),
        url: () => config.venueUrl ?? `${api}venues?select=*` }), true)
      return new Promise(resolve => { pendingVenue = resolve })
    },
    async goto(url) {
      assert.ok(pendingVenue, 'venue response listener must precede navigation')
      assert.ok(url.startsWith(`${root}#/staff/`), 'staff route must stay on approved Pages target')
      phase = url.endsWith('/bookings') ? 'bookings' : 'courts'
      visits.push(phase)
      for (const requestUrl of reads[phase] ?? []) {
        listeners.get('request')?.({ method: () => 'GET', url: () => requestUrl })
      }
      const resolve = pendingVenue
      pendingVenue = undefined
      resolve({ status: () => 200, url: () => config.venueUrl ?? `${api}venues?select=*`,
        json: async () => config.venues?.[phase] ?? [{ id: assigned }] })
    },
    getByText(value) {
      if (value === 'Court A') return { count: async () => config.foreignCourt?.[phase] ?? 0 }
      return { first: () => ({ waitFor: async () => {} }) }
    },
    locator(selector) {
      assert.ok(selector === '#staff-venue option' || selector === '#bookings-venue option')
      return { count: async () => config.options?.[phase] ?? 0 }
    },
    keyboard: { press: async () => {} },
    getByRole() { return { first: () => ({ focus: async () => {} }) } },
    async evaluate(callback) {
      return callback.toString().includes('outlineStyle') ? 'solid' : { width: 390, documentWidth: 390 }
    },
  }
  return { page, visits }
}

test('approved staff sees one venue and only scoped courts, sessions, and bookings', async () => {
  const mock = fakePage()
  const result = await journey(mock.page)
  assert.equal(result.result, 'PASS')
  assert.deepEqual(mock.visits, ['courts', 'bookings'])
  assert.equal(result.courtReads, 2)
  assert.equal(result.bookingReads, 1)
})

test('foreign court and extra venue option have separate failure reasons', async () => {
  await assert.rejects(journey(fakePage({ foreignCourt: { courts: 1 } }).page), /unassigned court visible/i)
  await assert.rejects(journey(fakePage({ options: { courts: 2 } }).page), /extra venue option/i)
})

test('unscoped court or booking requests fail before calling the journey safe', async () => {
  const unscopedCourts = fakePage({ reads: { courts: [`${api}courts?select=*`, scoped('court_sessions')] } })
  await assert.rejects(journey(unscopedCourts.page), /unscoped courts GET/i)
  const unscopedBookings = fakePage({ reads: {
    courts: [scoped('courts'), scoped('court_sessions')],
    bookings: [`${api}bookings?select=*`],
  } })
  await assert.rejects(journey(unscopedBookings.page), /unscoped bookings GET/i)
})

test('unexpected venue API row fails before the court assertion', async () => {
  const mock = fakePage({ venues: { courts: [{ id: assigned }, { id: 'other' }] } })
  await assert.rejects(journey(mock.page), /venue API returned unexpected rows/i)
  assert.deepEqual(mock.visits, ['courts'])
})

test('a matching path on another Supabase project is not accepted', async () => {
  const foreign = 'https://different-project.supabase.co/rest/v1/'
  await assert.rejects(journey(fakePage({ venueUrl: `${foreign}venues?select=*` }).page),
    /unexpected backend/i)
  await assert.rejects(journey(fakePage({ reads: {
    courts: [`${foreign}courts?select=*&venue_id=eq.${assigned}`, scoped('court_sessions')],
    bookings: [scoped('bookings')],
  } }).page), /unexpected backend/i)
})

test('an additional unscoped operational read cannot hide behind expected scoped reads', async () => {
  const mock = fakePage({ reads: {
    courts: [scoped('courts'), scoped('court_sessions'), `${api}bookings?select=*`],
    bookings: [scoped('bookings')],
  } })
  await assert.rejects(journey(mock.page), /unscoped bookings GET on courts route/i)
})
