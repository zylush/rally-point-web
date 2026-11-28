// @vitest-environment node
import { createClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { DEFAULT_FROM_EMAIL } from '../supabase/functions/send-booking-email/email.ts'
import {
  createBookingEmailHandler,
  type BookingEmailDeps,
  type ClientOptions,
  type DbClient,
} from '../supabase/functions/send-booking-email/handler.ts'

/*
 * The send-booking-email request handler, run through the real supabase-js client. A fake
 * Supabase server answers its HTTP calls the way the database would for this caller: a club's
 * rows show only while x-club-id names that club, and only the rows row-level security lets
 * the caller read (their own member record and booking; as staff, a colleague's booking too).
 * Resend is a recorded fetch.
 */

const SUPABASE_URL = 'https://project.supabase.test'
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/send-booking-email`
const ANON_KEY = 'anon-public-key'
const SERVICE_ROLE_KEY = 'service-role-secret'
const RESEND_KEY = 're_test_key'
const TOKEN = 'caller-access-token'
const ACCOUNT_EMAIL = 'player@example.com'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const CLUB = '22222222-2222-4222-8222-222222222222'
const OTHER_CLUB = '33333333-3333-4333-8333-333333333333'
const MEMBER = '44444444-4444-4444-8444-444444444444'
const OTHER_MEMBER = '55555555-5555-4555-8555-555555555555'
const VENUE = '66666666-6666-4666-8666-666666666666'
const BOOKING = '77777777-7777-4777-8777-777777777777'
const OTHERS_BOOKING = '88888888-8888-4888-8888-888888888888'
const MISSING_BOOKING = '99999999-9999-4999-8999-999999999999'

const SEND_FAILED = 'The email could not be sent. Please try again later.'

type Row = Record<string, unknown>

/** The caller's own booking, confirmed by the club. Names hold markup, as an admin could type. */
const confirmed: Row = {
  id: BOOKING,
  club_id: CLUB,
  venue_id: VENUE,
  member_id: MEMBER,
  start_at: '2026-11-24T10:00:00+00:00',
  end_at: '2026-11-24T12:00:00+00:00',
  hours: 2,
  amount: 900,
  status: 'confirmed',
  payment_ref: '1234567890',
  payment_reference: '1234567890',
  payment_submitted_at: '2026-11-23T09:00:00+00:00',
  court: { name: 'Court <2>' },
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function fakeSupabase() {
  const users = new Map<string, Row>([
    [`Bearer ${TOKEN}`, { id: USER_ID, aud: 'authenticated', role: 'authenticated', email: ACCOUNT_EMAIL }],
  ])
  // What the caller can read while x-club-id names each club.
  const rows: Record<string, Record<string, Row[]>> = {
    [CLUB]: {
      member_self: [{ id: MEMBER, user_id: USER_ID, club_id: CLUB }],
      bookings: [confirmed, { ...confirmed, id: OTHERS_BOOKING, member_id: OTHER_MEMBER }],
      clubs: [{ id: CLUB, name: 'Rally <Point> & "Co"' }],
      venues: [{ id: VENUE, club_id: CLUB, name: "Lagao's courts" }],
    },
    // The caller has no record in this club, so none of its private rows show.
    [OTHER_CLUB]: {
      clubs: [{ id: OTHER_CLUB, name: 'Other club' }],
    },
  }
  const failing = new Set<string>()
  const ignoredFilters = new Set<string>()
  const requests: Array<{ path: string; params: URLSearchParams; headers: Headers }> = []
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const headers = new Headers(init?.headers)
    requests.push({ path: url.pathname, params: url.searchParams, headers })
    if (url.pathname === '/auth/v1/user') {
      const user = users.get(headers.get('Authorization') ?? '')
      return user ? jsonResponse(200, user) : jsonResponse(401, { code: 401, error_code: 'bad_jwt', msg: 'invalid JWT' })
    }
    const relation = url.pathname.replace(/^\/rest\/v1\//, '')
    if (failing.has(relation)) {
      return jsonResponse(500, { code: 'XX000', message: 'private database detail', details: null, hint: null })
    }
    const visible = rows[headers.get('x-club-id') ?? '']?.[relation] ?? []
    const filters = [...url.searchParams].filter(([name]) => name !== 'select' && !ignoredFilters.has(name))
    return jsonResponse(200, visible.filter((row) => filters.every(([column, test]) => test === `eq.${String(row[column])}`)))
  })
  return { users, rows, failing, ignoredFilters, requests, fetch }
}

let server: ReturnType<typeof fakeSupabase>
let settings: Record<string, string | undefined>
let resend: ReturnType<typeof vi.fn<(url: string, init: RequestInit) => Promise<Response>>>
let consoleError: MockInstance<typeof console.error>

function setUp() {
  const deps = {
    env: vi.fn((name: string) => settings[name]),
    // The real supabase-js client, talking to the fake server.
    createClient: vi.fn((url: string, key: string, options: ClientOptions) =>
      createClient(url, key, { ...options, global: { ...options.global, fetch: server.fetch } }) as unknown as DbClient),
    fetch: resend,
  } satisfies BookingEmailDeps
  return { handle: createBookingEmailHandler(deps), deps }
}

function post(body: unknown, options: { token?: string | null; raw?: string } = {}): Request {
  const headers = new Headers({ 'Content-Type': 'application/json' })
  const token = options.token === undefined ? TOKEN : options.token
  if (token) headers.set('Authorization', `Bearer ${token}`)
  return new Request(FUNCTION_URL, { method: 'POST', headers, body: options.raw ?? JSON.stringify(body) })
}

const databaseReads = () => server.requests.filter((request) => request.path.startsWith('/rest/v1/'))
const readsOf = (relation: string) => server.requests.filter((request) => request.path === `/rest/v1/${relation}`)

/** The one email handed to Resend. */
function sentEmail() {
  expect(resend).toHaveBeenCalledTimes(1)
  const [url, init] = resend.mock.calls[0]
  return {
    url,
    init,
    headers: new Headers(init.headers),
    body: JSON.parse(String(init.body)) as { from: string; to: string[]; subject: string; html: string; text: string },
  }
}

beforeEach(() => {
  server = fakeSupabase()
  settings = {
    SUPABASE_URL,
    SUPABASE_ANON_KEY: ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
    RESEND_API_KEY: RESEND_KEY,
  }
  resend = vi.fn(async (_url: string, _init: RequestInit) => jsonResponse(200, { id: 'email_123' }))
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  consoleError.mockRestore()
})

describe('send-booking-email: who may ask', () => {
  it('answers the CORS preflight and refuses other methods', async () => {
    const { handle } = setUp()
    const preflight = await handle(new Request(FUNCTION_URL, { method: 'OPTIONS' }))
    expect(preflight.status).toBe(200)
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(preflight.headers.get('Access-Control-Allow-Headers')).toBe('authorization, x-client-info, apikey, content-type, x-club-id')
    expect((await handle(new Request(FUNCTION_URL, { method: 'GET' }))).status).toBe(405)
    expect(server.fetch).not.toHaveBeenCalled()
  })

  it('answers 401 without an Authorization header, before reading anything', async () => {
    const { handle, deps } = setUp()
    const res = await handle(post({ bookingId: BOOKING, clubId: CLUB }, { token: null }))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Unauthorized' })
    expect(deps.createClient).not.toHaveBeenCalled()
    expect(server.fetch).not.toHaveBeenCalled()
    expect(resend).not.toHaveBeenCalled()
  })

  it('answers 401 when the auth server does not accept the token', async () => {
    const { handle } = setUp()
    const res = await handle(post({ bookingId: BOOKING, clubId: CLUB }, { token: 'forged-token' }))
    expect(res.status).toBe(401)
    expect(server.requests.map((request) => request.path)).toEqual(['/auth/v1/user'])
    expect(resend).not.toHaveBeenCalled()
  })

  it('still answers { sent: false } when Resend is not set up, without reading the booking', async () => {
    settings.RESEND_API_KEY = undefined
    const { handle } = setUp()
    const res = await handle(post({ bookingId: BOOKING, clubId: CLUB }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ sent: false, reason: 'RESEND_API_KEY not configured' })
    expect(databaseReads()).toHaveLength(0)
    expect(resend).not.toHaveBeenCalled()
  })
})

describe('send-booking-email: what the request may say', () => {
  it('answers 400 to a body that is not JSON', async () => {
    const { handle } = setUp()
    const res = await handle(post(null, { raw: '{"bookingId": ' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ sent: false, error: 'Send the booking as JSON.' })
    expect(databaseReads()).toHaveLength(0)
    expect(resend).not.toHaveBeenCalled()
  })

  it.each([
    ['no club id', { bookingId: BOOKING }],
    ['no booking id', { clubId: CLUB }],
    ['a booking id that is not an id', { bookingId: 'booking-1', clubId: CLUB }],
    ['a list', [BOOKING, CLUB]],
    ['null', null],
  ])('answers 400 to a body with %s', async (_label, body) => {
    const { handle } = setUp()
    const res = await handle(post(body))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ sent: false, error: 'Send the booking id and the id of its club.' })
    expect(databaseReads()).toHaveLength(0)
    expect(resend).not.toHaveBeenCalled()
  })

  it('never mails an address the request names: an account without an email gets 400 and nothing is sent', async () => {
    server.users.set(`Bearer ${TOKEN}`, { id: USER_ID, aud: 'authenticated', email: '', phone: '639171234567' })
    const { handle } = setUp()
    const res = await handle(post({ bookingId: BOOKING, clubId: CLUB, recipientEmail: 'someone.else@example.com' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ sent: false, error: 'This account has no email address to send to.' })
    expect(databaseReads()).toHaveLength(0)
    expect(resend).not.toHaveBeenCalled()
  })
})

describe('send-booking-email: whose booking', () => {
  it.each([
    ['a booking that does not exist', { bookingId: MISSING_BOOKING, clubId: CLUB }],
    ['someone else’s booking that the caller can see as staff', { bookingId: OTHERS_BOOKING, clubId: CLUB }],
    ['a club where the caller has no record', { bookingId: BOOKING, clubId: OTHER_CLUB }],
  ])('answers 404 and sends nothing for %s', async (_label, body) => {
    const { handle } = setUp()
    const res = await handle(post(body))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ sent: false, error: 'Booking not found' })
    expect(resend).not.toHaveBeenCalled()
  })

  it('checks the booking is the caller’s own even when the database returns someone else’s', async () => {
    // As if the member filter were dropped: staff may read a colleague's booking.
    server.ignoredFilters.add('member_id')
    const { handle } = setUp()
    const res = await handle(post({ bookingId: OTHERS_BOOKING, clubId: CLUB }))
    expect(res.status).toBe(404)
    expect(resend).not.toHaveBeenCalled()
  })

  it('reads only as the caller, in the club the request names, never with a service-role key', async () => {
    const { handle, deps } = setUp()
    expect((await handle(post({ bookingId: BOOKING, clubId: CLUB }))).status).toBe(200)

    const reads = databaseReads()
    expect(reads.map((read) => read.path).sort()).toEqual([
      '/rest/v1/bookings',
      '/rest/v1/clubs',
      '/rest/v1/member_self',
      '/rest/v1/venues',
    ])
    for (const read of reads) {
      expect(read.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`)
      expect(read.headers.get('apikey')).toBe(ANON_KEY)
      expect(read.headers.get('x-club-id')).toBe(CLUB)
    }
    const filtersOf = (relation: string) =>
      Object.fromEntries([...readsOf(relation)[0].params].filter(([name]) => name !== 'select'))
    expect(filtersOf('member_self')).toEqual({ club_id: `eq.${CLUB}`, user_id: `eq.${USER_ID}` })
    expect(filtersOf('bookings')).toEqual({ club_id: `eq.${CLUB}`, id: `eq.${BOOKING}`, member_id: `eq.${MEMBER}` })

    for (const [, key] of deps.createClient.mock.calls) expect(key).toBe(ANON_KEY)
    expect(deps.env).not.toHaveBeenCalledWith('SUPABASE_SERVICE_ROLE_KEY')
    expect(JSON.stringify(server.requests.map((request) => [...request.headers]))).not.toContain(SERVICE_ROLE_KEY)
  })

  it('answers 502 without the database’s own words when the booking cannot be read', async () => {
    server.failing.add('bookings')
    const { handle } = setUp()
    const res = await handle(post({ bookingId: BOOKING, clubId: CLUB }))
    expect(res.status).toBe(502)
    const text = await res.text()
    expect(JSON.parse(text)).toEqual({ sent: false, error: 'The booking could not be checked. Please try again later.' })
    expect(text).not.toContain('private database detail')
    expect(resend).not.toHaveBeenCalled()
  })
})

describe('send-booking-email: what the email says', () => {
  it('emails a confirmed booking to the account’s own address, built only from the database', async () => {
    const { handle } = setUp()
    const res = await handle(post({
      bookingId: BOOKING,
      clubId: CLUB,
      // What the old function took from the request. None of it may reach the email.
      recipientEmail: 'victim@example.com',
      kind: 'booking_submitted',
      clubName: 'Spoofed Club',
      venueName: 'Spoofed Venue',
      courtName: 'Spoofed Court',
      startAt: '2030-01-01T00:00:00Z',
      endAt: '2030-01-01T05:00:00Z',
      hours: 5,
      amount: 1,
      paymentRef: 'SPOOFEDREF',
    }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ sent: true, id: 'email_123' })

    const { url, init, headers, body } = sentEmail()
    expect(url).toBe('https://api.resend.com/emails')
    expect(init.method).toBe('POST')
    expect(headers.get('Authorization')).toBe(`Bearer ${RESEND_KEY}`)
    expect(headers.get('Idempotency-Key')).toBe(`booking-email/${BOOKING}/booking_confirmed`)
    expect(body.from).toBe(DEFAULT_FROM_EMAIL)
    expect(body.to).toEqual([ACCOUNT_EMAIL])
    expect(body.subject).toBe('Booked: Court <2> (2 hours) · Rally <Point> & "Co"')

    expect(body.html).toContain('Booking confirmed')
    expect(body.html).toContain('Php 900.00')
    expect(body.html).toContain('6:00 PM – 8:00 PM<br>')
    expect(body.html).toContain('1234567890')
    // Every name is escaped: club admins type them.
    expect(body.html).toContain('Rally &lt;Point&gt; &amp; &quot;Co&quot;')
    expect(body.html).toContain('Court &lt;2&gt;')
    expect(body.html).toContain('Lagao&#39;s courts')
    expect(body.html).not.toContain('<Point>')
    expect(body.html).not.toContain('Court <2>')
    expect(body.text).toContain('Total paid: Php 900.00')

    const everything = JSON.stringify(body)
    for (const spoofed of ['victim@example.com', 'Spoofed', 'SPOOFEDREF', '5 hours', 'Php 1.00', '2030']) {
      expect(everything).not.toContain(spoofed)
    }
  })

  it('says a sent payment is waiting for the club, never that it is confirmed', async () => {
    server.rows[CLUB].bookings = [{ ...confirmed, status: 'pending_payment', payment_ref: null, payment_reference: 'GCASH998877' }]
    const { handle } = setUp()
    const res = await handle(post({ bookingId: BOOKING, clubId: CLUB, kind: 'booking_confirmed' }))
    expect(res.status).toBe(200)

    const { headers, body } = sentEmail()
    expect(headers.get('Idempotency-Key')).toBe(`booking-email/${BOOKING}/booking_submitted`)
    expect(body.subject).toBe('Booking request: Court <2> (2 hours) · Rally <Point> & "Co"')
    expect(body.html).toContain('Booking request received')
    expect(body.html).toContain('Waiting for the club to confirm')
    expect(body.html).toContain('GCASH998877')
    expect(body.html).not.toContain('Booking confirmed')
    expect(body.text).toContain('Amount sent: Php 900.00')
    expect(body.text).not.toContain('Total paid')
  })

  it.each([
    ['an unpaid hold', { status: 'pending_payment', payment_submitted_at: null, payment_reference: null, payment_ref: null }],
    ['a cancelled booking', { status: 'cancelled' }],
    ['a no-show', { status: 'no_show' }],
  ])('sends nothing for %s', async (_label, change) => {
    server.rows[CLUB].bookings = [{ ...confirmed, ...change }]
    const { handle } = setUp()
    const res = await handle(post({ bookingId: BOOKING, clubId: CLUB }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ sent: false, error: 'This booking has no payment or confirmation to email yet.' })
    expect(resend).not.toHaveBeenCalled()
  })

  it('names the court plainly and leaves the location out when the database hides them', async () => {
    server.rows[CLUB].bookings = [{ ...confirmed, court: null }]
    server.rows[CLUB].venues = []
    const { handle } = setUp()
    expect((await handle(post({ bookingId: BOOKING, clubId: CLUB }))).status).toBe(200)
    const { body } = sentEmail()
    expect(body.subject).toBe('Booked: Court (2 hours) · Rally <Point> & "Co"')
    expect(body.html).not.toContain('>Location</td>')
  })

  it('sends from RESEND_FROM_EMAIL when it is set', async () => {
    settings.RESEND_FROM_EMAIL = ' Club desk <desk@brinely.info> '
    const { handle } = setUp()
    expect((await handle(post({ bookingId: BOOKING, clubId: CLUB }))).status).toBe(200)
    expect(sentEmail().body.from).toBe('Club desk <desk@brinely.info>')
  })
})

describe('send-booking-email: when Resend fails', () => {
  it('keeps Resend’s own error in the function log and gives the app a plain message', async () => {
    resend.mockResolvedValueOnce(new Response(
      '{"name":"validation_error","message":"player@example.com is on the suppression list"}',
      { status: 422, headers: { 'Content-Type': 'application/json' } },
    ))
    const { handle } = setUp()
    const res = await handle(post({ bookingId: BOOKING, clubId: CLUB }))
    expect(res.status).toBe(502)
    const text = await res.text()
    expect(JSON.parse(text)).toEqual({ sent: false, error: SEND_FAILED })
    expect(text).not.toContain('suppression')
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('422'), expect.stringContaining('suppression list'))
  })

  it('gives the same plain message when Resend cannot be reached', async () => {
    resend.mockRejectedValueOnce(new TypeError('getaddrinfo ENOTFOUND api.resend.com'))
    const { handle } = setUp()
    const res = await handle(post({ bookingId: BOOKING, clubId: CLUB }))
    expect(res.status).toBe(502)
    const text = await res.text()
    expect(JSON.parse(text)).toEqual({ sent: false, error: SEND_FAILED })
    expect(text).not.toContain('ENOTFOUND')
    expect(consoleError).toHaveBeenCalled()
  })
})
