// Request handling for the send-booking-email Edge Function. It has no Deno or URL imports,
// so vitest can run it (tests/send-booking-email-handler.test.ts); index.ts passes in Deno's
// settings, supabase-js and fetch.
//
// Nothing in the request is trusted except the caller's own sign-in. The app names a booking
// and its club. The booking is read from the database as the caller (the anon key with their
// own token, never a service-role key), the email is built only from what the database says,
// and it goes only to the signed-in account's own email address.

import { buildBookingEmail, DEFAULT_FROM_EMAIL, type BookingEmailKind } from './email.ts'

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-club-id',
}

const RESEND_EMAILS_URL = 'https://api.resend.com/emails'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CHECK_FAILED = 'The booking could not be checked. Please try again later.'
const SEND_FAILED = 'The email could not be sent. Please try again later.'

// The columns the email needs. The court comes the way the app reads it (api.myBooking).
const BOOKING_COLUMNS = [
  'id', 'club_id', 'venue_id', 'member_id', 'start_at', 'end_at', 'hours', 'amount', 'status',
  'payment_ref', 'payment_reference', 'payment_submitted_at',
  'court:courts!bookings_court_id_fkey(name)',
].join(', ')

/** What the app sends: which booking, and the club it belongs to. Any other field is ignored. */
export interface BookingEmailRequest {
  bookingId: string
  clubId: string
}

/** The supabase-js client options this handler passes. */
export interface ClientOptions {
  global: { headers: Record<string, string> }
  auth: { persistSession: boolean; autoRefreshToken: boolean; detectSessionInUrl: boolean }
}

export interface DbError {
  message: string
  code?: string
}

/** The part of a supabase-js query that this handler uses. */
export interface DbQuery {
  eq(column: string, value: string): DbQuery
  maybeSingle(): PromiseLike<{ data: unknown; error: DbError | null }>
}

/** The part of a supabase-js client that this handler uses. */
export interface DbClient {
  auth: {
    getUser(jwt: string): PromiseLike<{
      data: { user: { id: string; email?: string | null } | null } | null
      error: unknown
    }>
  }
  from(relation: string): { select(columns: string): DbQuery }
}

export interface BookingEmailDeps {
  /** Reads a function secret or setting, as Deno.env.get does. */
  env: (name: string) => string | undefined
  /** supabase-js createClient. */
  createClient: (url: string, key: string, options: ClientOptions) => DbClient
  /** fetch, used only to call Resend. */
  fetch: (url: string, init: RequestInit) => Promise<Response>
}

/** The booking as the database has it, with the names the email shows. */
interface BookingFacts {
  id: string
  status: string
  paymentSent: boolean
  clubName: string
  venueName: string | null
  courtName: string
  startAt: string
  endAt: string
  hours: number
  amount: number
  paymentRef: string | null
}

export function createBookingEmailHandler(deps: BookingEmailDeps): (req: Request) => Promise<Response> {
  return async function handleBookingEmail(req: Request): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
    if (req.method !== 'POST') return reply(405, { error: 'Method not allowed' })

    const supabaseUrl = deps.env('SUPABASE_URL')
    const anonKey = deps.env('SUPABASE_ANON_KEY')
    const token = bearerToken(req.headers.get('Authorization'))
    if (!supabaseUrl || !anonKey || !token) return reply(401, { error: 'Unauthorized' })

    const authClient = deps.createClient(supabaseUrl, anonKey, asCaller(token))
    const { data: auth, error: authError } = await authClient.auth.getUser(token)
    const user = auth?.user
    if (authError || !user?.id) return reply(401, { error: 'Unauthorized' })

    const resendApiKey = deps.env('RESEND_API_KEY')?.trim()
    const fromEmail = deps.env('RESEND_FROM_EMAIL')?.trim() || DEFAULT_FROM_EMAIL
    if (!resendApiKey) return reply(200, { sent: false, reason: 'RESEND_API_KEY not configured' })

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return reply(400, { sent: false, error: 'Send the booking as JSON.' })
    }
    const request = readRequest(body)
    if (!request) return reply(400, { sent: false, error: 'Send the booking id and the id of its club.' })

    // Only ever the account's own address. A recipient named in the request is ignored.
    const recipient = typeof user.email === 'string' ? user.email.trim() : ''
    if (!recipient) return reply(400, { sent: false, error: 'This account has no email address to send to.' })

    let facts: BookingFacts | null
    try {
      const db = deps.createClient(supabaseUrl, anonKey, asCaller(token, request.clubId))
      facts = await readOwnBooking(db, request, user.id)
    } catch (error) {
      console.error('send-booking-email: the booking could not be read', error)
      return reply(502, { sent: false, error: CHECK_FAILED })
    }
    if (!facts) return reply(404, { sent: false, error: 'Booking not found' })

    const kind = emailKindFor(facts)
    if (!kind) return reply(409, { sent: false, error: 'This booking has no payment or confirmation to email yet.' })

    const { subject, html, text } = buildBookingEmail({
      kind,
      bookingId: facts.id,
      clubName: facts.clubName,
      venueName: facts.venueName,
      courtName: facts.courtName,
      startAt: facts.startAt,
      endAt: facts.endAt,
      hours: facts.hours,
      amount: facts.amount,
      paymentRef: facts.paymentRef,
      recipientEmail: recipient,
    })

    let resendRes: Response
    try {
      resendRes = await deps.fetch(RESEND_EMAILS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
          // Resend sends one email per key within 24 hours, so asking again for the same
          // booking and the same email does not send it again.
          'Idempotency-Key': `booking-email/${facts.id}/${kind}`,
        },
        body: JSON.stringify({ from: fromEmail, to: [recipient], subject, html, text }),
      })
    } catch (error) {
      console.error('send-booking-email: Resend could not be reached', error)
      return reply(502, { sent: false, error: SEND_FAILED })
    }
    if (!resendRes.ok) {
      // Resend's own words stay in the function log; the app gets a plain message.
      const detail = await resendRes.text().catch(() => '')
      console.error(`send-booking-email: Resend refused the email (HTTP ${resendRes.status})`, detail)
      return reply(502, { sent: false, error: SEND_FAILED })
    }
    const sent: unknown = await resendRes.json().catch(() => null)
    return reply(200, { sent: true, id: textField(sent, 'id') })
  }
}

function reply(status: number, payload: Record<string, unknown>): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function bearerToken(header: string | null): string | null {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header ?? '')
  return match ? match[1] : null
}

/**
 * Client options that act as the caller: their own token, and the club the request names.
 * x-club-id only picks the club (private.current_club_id()); the database still checks the
 * caller's own record in that club before it shows anything.
 */
function asCaller(token: string, clubId?: string): ClientOptions {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` }
  if (clubId) headers['x-club-id'] = clubId
  return {
    global: { headers },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }
}

function readRequest(body: unknown): BookingEmailRequest | null {
  const fields = asRecord(body)
  if (!fields) return null
  const { bookingId, clubId } = fields
  if (typeof bookingId !== 'string' || typeof clubId !== 'string') return null
  if (!UUID.test(bookingId) || !UUID.test(clubId)) return null
  // The database writes ids in lower case, so compare them that way.
  return { bookingId: bookingId.toLowerCase(), clubId: clubId.toLowerCase() }
}

/**
 * The caller's own booking in the club the request names, or null when they cannot read it
 * (someone else's, another club's, or missing). Throws when the database cannot be asked.
 */
async function readOwnBooking(db: DbClient, request: BookingEmailRequest, userId: string): Promise<BookingFacts | null> {
  const { bookingId, clubId } = request

  // The caller's own player record in this club. The member_self view only ever shows the
  // signed-in person's own row, and only in the club x-club-id names.
  const self = await db.from('member_self').select('id').eq('club_id', clubId).eq('user_id', userId).maybeSingle()
  if (self.error) throw self.error
  const memberId = textField(self.data, 'id')
  if (!memberId) return null

  // Row-level security shows a player only their own bookings, but it also shows staff and
  // admins every booking at their locations, so the booking must be the caller's own too.
  const found = await db
    .from('bookings')
    .select(BOOKING_COLUMNS)
    .eq('club_id', clubId)
    .eq('id', bookingId)
    .eq('member_id', memberId)
    .maybeSingle()
  if (found.error) throw found.error
  const booking = asRecord(found.data)
  if (!booking || booking.id !== bookingId || booking.club_id !== clubId || booking.member_id !== memberId) return null

  const status = textField(booking, 'status')
  const startAt = textField(booking, 'start_at')
  const endAt = textField(booking, 'end_at')
  const hours = Number(booking.hours)
  const amount = Number(booking.amount)
  if (!status || !startAt || !endAt || !Number.isFinite(hours) || !Number.isFinite(amount)) {
    throw new Error('The booking row is missing fields the email needs')
  }

  const venueId = textField(booking, 'venue_id')
  const [club, venue] = await Promise.all([
    db.from('clubs').select('name').eq('id', clubId).maybeSingle(),
    venueId
      ? db.from('venues').select('name').eq('club_id', clubId).eq('id', venueId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])
  if (club.error) throw club.error
  if (venue.error) throw venue.error
  const clubName = textField(club.data, 'name')
  // The club is readable whenever its booking is, so a missing club means nothing to send.
  if (!clubName) return null

  return {
    id: bookingId,
    status,
    paymentSent: textField(booking, 'payment_submitted_at') !== null,
    clubName,
    // A closed location or court hides its name; the email then leaves it out or says "Court".
    venueName: textField(venue.data, 'name'),
    courtName: textField(booking.court, 'name') ?? 'Court',
    startAt,
    endAt,
    hours,
    amount,
    paymentRef: textField(booking, 'payment_ref') ?? textField(booking, 'payment_reference'),
  }
}

/**
 * Which email the booking's own state allows. "Confirmed" only once the club has confirmed it
 * ('confirmed', or 'completed' once played); "waiting for the club" only after the player sent
 * a payment. An unpaid hold or desk booking, a cancelled booking and a no-show get no email.
 */
function emailKindFor(booking: Pick<BookingFacts, 'status' | 'paymentSent'>): BookingEmailKind | null {
  if (booking.status === 'confirmed' || booking.status === 'completed') return 'booking_confirmed'
  if (booking.status === 'pending_payment' && booking.paymentSent) return 'booking_submitted'
  return null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

/** A non-blank text field of a row, or null. */
function textField(row: unknown, key: string): string | null {
  const value = asRecord(row)?.[key]
  return typeof value === 'string' && value.trim() !== '' ? value : null
}
