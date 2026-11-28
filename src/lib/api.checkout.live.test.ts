import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'
import { setActiveClubId } from './clubContext'
import { emptyClubProfile } from './clubProfile'

// The live branch of the GCash QR checkout, with Supabase replaced by a small fake that
// records every table read (with its filters) and every function call.
const live = vi.hoisted(() => {
  const clubId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const venueId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab'
  const court = { id: 'court-live', club_id: clubId, venue_id: venueId, name: 'Live Court', status: 'available', hourly_rate: 600 }
  const booking = {
    id: 'booking-live', club_id: clubId, venue_id: venueId, court_id: court.id, member_id: 'member-live',
    start_at: '2099-09-20T06:00:00.000Z', end_at: '2099-09-20T07:00:00.000Z', hours: 1, amount: '600.00', status: 'pending_payment',
    payment_method: null, payment_ref: null, created_at: '2099-09-19T00:00:00.000Z', hold_expires_at: '2099-09-19T00:15:00.000Z',
    payment_reference: null, payment_submitted_at: null, confirm_by: null,
  }
  const tables = new Map<string, unknown>()
  const reads: Array<{ table: string; calls: Array<[string, unknown[]]> }> = []
  const rpc = vi.fn(async (_name: string, _args?: Record<string, unknown>) => ({ data: null as unknown, error: null as unknown }))
  const from = vi.fn((table: string) => {
    const read = { table, calls: [] as Array<[string, unknown[]]> }
    reads.push(read)
    const answer = () => {
      const value = tables.get(table)
      return value instanceof Error || (value && typeof value === 'object' && 'code' in value)
        ? { data: null, error: value }
        : { data: value ?? null, error: null }
    }
    const query: Record<string, unknown> = {
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(answer()).then(resolve),
      maybeSingle: () => {
        read.calls.push(['maybeSingle', []])
        return Promise.resolve(answer())
      },
    }
    for (const method of ['select', 'eq', 'not', 'in', 'order', 'limit']) {
      query[method] = (...args: unknown[]) => {
        read.calls.push([method, args])
        return query
      }
    }
    return query
  })
  const getPublicUrl = vi.fn((path: string) => ({ data: { publicUrl: `https://cdn.example/court-photos/${path}` } }))
  return { clubId, venueId, court, booking, tables, reads, rpc, from, getPublicUrl }
})

vi.mock('./supabase', () => ({
  isDemoMode: false,
  supabase: {
    rpc: live.rpc,
    from: live.from,
    storage: { from: () => ({ getPublicUrl: live.getPublicUrl }) },
  },
}))

const readsOf = (table: string) => live.reads.filter((read) => read.table === table)
const UNAVAILABLE = 'Online checkout is not available yet. Ask the desk to reserve this court.'

beforeEach(() => {
  vi.clearAllMocks()
  live.tables.clear()
  live.reads.length = 0
  live.rpc.mockImplementation(async () => ({ data: live.booking, error: null }))
  setActiveClubId(live.clubId)
})

describe('member checkout (live)', () => {
  it('holds the hours through hold_court_booking in the active club, taking the venue from the court', async () => {
    live.tables.set('courts', live.court)
    const held = await api.createBooking({
      court_id: live.court.id, member_id: 'member-live', dateYmd: '2099-09-20', startHour: 14, hours: 2, user_id: 'user-live',
    })
    expect(live.rpc).toHaveBeenCalledTimes(1)
    expect(live.rpc).toHaveBeenCalledWith('hold_court_booking', {
      p_club_id: live.clubId,
      p_venue_id: live.venueId,
      p_court_id: live.court.id,
      p_date: '2099-09-20',
      p_start_hour: 14,
      p_hours: 2,
    })
    // The court is read in the active club only.
    expect(readsOf('courts')[0].calls).toEqual(expect.arrayContaining([
      ['eq', ['club_id', live.clubId]],
      ['eq', ['id', live.court.id]],
    ]))
    expect(held).toMatchObject({ id: live.booking.id, amount: 600, hold_expires_at: live.booking.hold_expires_at, court: { name: 'Live Court' } })
  })

  it('sends the venue the player chose, and stops at a court the club does not have', async () => {
    live.tables.set('courts', live.court)
    await api.createBooking({
      court_id: live.court.id, venue_id: 'venue-chosen', member_id: 'm', dateYmd: '2099-09-20', startHour: 9, hours: 1, user_id: 'u',
    })
    expect(live.rpc).toHaveBeenCalledWith('hold_court_booking', expect.objectContaining({ p_venue_id: 'venue-chosen' }))

    live.rpc.mockClear()
    live.tables.set('courts', null)
    await expect(api.createBooking({
      court_id: 'other-club-court', member_id: 'm', dateYmd: '2099-09-20', startHour: 9, hours: 1, user_id: 'u',
    })).rejects.toThrow('Court not found')
    expect(live.rpc).not.toHaveBeenCalled()
  })

  it('refuses to start without an active club', async () => {
    setActiveClubId(null)
    await expect(api.createBooking({
      court_id: live.court.id, member_id: 'm', dateYmd: '2099-09-20', startHour: 9, hours: 1, user_id: 'u',
    })).rejects.toThrow('No club is selected')
    expect(live.rpc).not.toHaveBeenCalled()
  })

  it('releases a hold and sends a payment through their functions', async () => {
    await api.releaseBookingHold(live.booking.id)
    expect(live.rpc).toHaveBeenCalledWith('release_booking_hold', { p_booking_id: live.booking.id })

    const submitted = { ...live.booking, payment_reference: '1234567890', payment_submitted_at: '2099-09-19T00:05:00.000Z', payment_method: 'gcash' }
    live.rpc.mockImplementation(async () => ({ data: [submitted], error: null }))
    const sent = await api.submitBookingPayment({ booking_id: live.booking.id, reference: ' 1234 567\t890\n' })
    // Spaces and line breaks are dropped before sending.
    expect(live.rpc).toHaveBeenLastCalledWith('submit_booking_payment', { p_booking_id: live.booking.id, p_reference: '1234567890' })
    expect(sent).toMatchObject({ payment_reference: '1234567890', amount: 600 })
  })

  it('reads one booking of the active club for polling', async () => {
    live.tables.set('bookings', { ...live.booking, court: live.court })
    expect(await api.myBooking(live.booking.id)).toMatchObject({ id: live.booking.id, court: { id: live.court.id } })
    expect(readsOf('bookings')[0].calls).toEqual(expect.arrayContaining([
      ['select', ['*, court:courts!bookings_court_id_fkey(*)']],
      ['eq', ['club_id', live.clubId]],
      ['eq', ['id', live.booking.id]],
      ['maybeSingle', []],
    ]))
    live.tables.set('bookings', null)
    expect(await api.myBooking('gone')).toBeNull()
  })

  it('shows the active club’s payment methods from its public club page', async () => {
    live.tables.set('clubs', { slug: 'rally-point-gensan' })
    live.rpc.mockImplementation(async () => ({
      data: {
        ...emptyClubProfile(),
        payment_methods: [{ id: 'pay-1', label: 'GCash', account_name: 'Rally Point', account_number: '0917 000 0000', qr_path: `${live.clubId}/payment/qr.webp` }],
        addons: [], coaches: [], gallery: [],
      },
      error: null,
    }))
    expect(await api.checkoutPaymentMethods()).toEqual([{
      id: 'pay-1', label: 'GCash', account_name: 'Rally Point', account_number: '0917 000 0000',
      qr_url: `https://cdn.example/court-photos/${live.clubId}/payment/qr.webp`,
    }])
    expect(readsOf('clubs')[0].calls).toContainEqual(['eq', ['id', live.clubId]])
    expect(live.rpc).toHaveBeenCalledWith('get_public_club_profile', { p_slug: 'rally-point-gensan' })

    // A club not taking bookings has nothing to show.
    live.rpc.mockImplementation(async () => ({ data: null, error: null }))
    expect(await api.checkoutPaymentMethods()).toEqual([])
    live.tables.set('clubs', null)
    expect(await api.checkoutPaymentMethods()).toEqual([])
  })
})

describe('staff payment checks (live)', () => {
  it('lists sent, unchecked payments oldest first, with the member’s name, scoped to the club and venue', async () => {
    live.tables.set('bookings', [{ ...live.booking, payment_submitted_at: '2099-09-19T00:05:00.000Z', court: live.court }])
    live.tables.set('member_roster', [{ id: 'member-live', full_name: 'Live Member' }])
    const rows = await api.paymentsToConfirm(live.venueId)
    expect(rows).toEqual([expect.objectContaining({ id: live.booking.id, court: live.court, member: { id: 'member-live', full_name: 'Live Member' } })])
    expect(readsOf('bookings')[0].calls).toEqual(expect.arrayContaining([
      ['eq', ['club_id', live.clubId]],
      ['eq', ['status', 'pending_payment']],
      ['not', ['payment_submitted_at', 'is', null]],
      ['order', ['payment_submitted_at', { ascending: true }]],
      ['eq', ['venue_id', live.venueId]],
    ]))
    expect(readsOf('member_roster')[0].calls).toContainEqual(['eq', ['club_id', live.clubId]])

    live.reads.length = 0
    await api.paymentsToConfirm()
    expect(readsOf('bookings')[0].calls.some(([method, args]) => method === 'eq' && args[0] === 'venue_id')).toBe(false)
  })

  it('confirms and rejects through the staff functions', async () => {
    live.rpc.mockImplementation(async () => ({ data: { ...live.booking, status: 'confirmed' }, error: null }))
    expect((await api.confirmBookingPayment(live.booking.id)).status).toBe('confirmed')
    expect(live.rpc).toHaveBeenLastCalledWith('staff_confirm_booking_payment', { p_booking_id: live.booking.id })

    live.rpc.mockImplementation(async () => ({ data: { ...live.booking, status: 'cancelled' }, error: null }))
    expect((await api.rejectBookingPayment(live.booking.id, '  Not in our GCash  ')).status).toBe('cancelled')
    expect(live.rpc).toHaveBeenLastCalledWith('staff_reject_booking_payment', { p_booking_id: live.booking.id, p_reason: 'Not in our GCash' })
  })

  it('asks for a reason of 1 to 200 characters before rejecting', async () => {
    await expect(api.rejectBookingPayment(live.booking.id, '   ')).rejects.toThrow('Say why in 1 to 200 characters')
    await expect(api.rejectBookingPayment(live.booking.id, 'x'.repeat(201))).rejects.toThrow('Say why in 1 to 200 characters')
    expect(live.rpc).not.toHaveBeenCalled()
  })
})

describe('checkout errors (live)', () => {
  const fail = (error: Record<string, unknown>) => live.rpc.mockImplementation(async () => ({ data: null, error }))

  it('says checkout is not available while the functions are missing or paused', async () => {
    live.tables.set('courts', live.court)
    const hold = () => api.createBooking({ court_id: live.court.id, member_id: 'm', dateYmd: '2099-09-20', startHour: 9, hours: 1, user_id: 'u' })
    fail({ code: 'PGRST202', message: 'Could not find the function public.hold_court_booking' })
    await expect(hold()).rejects.toThrow(UNAVAILABLE)
    fail({ code: '42501', message: 'permission denied for function hold_court_booking' })
    await expect(hold()).rejects.toThrow(UNAVAILABLE)
    fail({ code: '42883', message: 'function public.release_booking_hold(uuid) does not exist' })
    await expect(api.releaseBookingHold('b')).rejects.toThrow(UNAVAILABLE)
    fail({ code: 'PGRST202', message: 'Could not find the function' })
    await expect(api.confirmBookingPayment('b')).rejects.toThrow('Payment checks are not available yet.')
    live.tables.set('bookings', { code: '42703', message: 'column bookings.payment_submitted_at does not exist' })
    await expect(api.paymentsToConfirm()).rejects.toThrow('Payment checks are not available yet.')
  })

  it('turns database answers into Errors a screen can show, keeping the functions’ own words', async () => {
    live.tables.set('courts', live.court)
    fail({ code: '23P01', message: 'conflicting key value violates exclusion constraint "court_allocations_no_overlap"' })
    const holding = api.createBooking({ court_id: live.court.id, member_id: 'm', dateYmd: '2099-09-20', startHour: 9, hours: 1, user_id: 'u' })
    await expect(holding).rejects.toBeInstanceOf(Error)
    await expect(holding).rejects.toThrow('Someone else just took those hours. Pick another time.')

    fail({ code: 'P0001', message: 'Your 15 minutes to pay ran out, so those hours were released. Pick a time again.' })
    await expect(api.submitBookingPayment({ booking_id: 'b', reference: '1234567890' })).rejects.toThrow('Your 15 minutes to pay ran out')
    fail({ code: '42501', message: 'staff access required' })
    const confirming = api.confirmBookingPayment('b')
    await expect(confirming).rejects.toBeInstanceOf(Error)
    await expect(confirming).rejects.toThrow('staff access required')
    fail({ message: 'TypeError: Failed to fetch' })
    await expect(api.releaseBookingHold('b')).rejects.toThrow('Could not reach bRineLy')
    fail({})
    await expect(api.rejectBookingPayment('b', 'Not received')).rejects.toThrow('Something went wrong. Please try again.')
  })

  it('reports a read that fails as an Error too', async () => {
    live.tables.set('bookings', { code: '42501', message: 'permission denied for table bookings' })
    const reading = api.myBooking('b')
    await expect(reading).rejects.toBeInstanceOf(Error)
    await expect(reading).rejects.toThrow('permission denied for table bookings')
  })
})
