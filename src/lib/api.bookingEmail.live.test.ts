import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Booking } from '../types'
import { api } from './api'
import { setActiveClubId } from './clubContext'

// The live branch of the booking email. The app names the booking and its club, nothing
// else: the send-booking-email function reads the rest from the database as the player and
// mails only the account's own address (tests/send-booking-email-handler.test.ts).
const live = vi.hoisted(() => ({
  invoke: vi.fn(async (_name: string, _options?: { body?: unknown }) => ({
    data: { sent: true, id: 'email_123' } as unknown,
    error: null as unknown,
  })),
}))

vi.mock('./supabase', () => ({
  isDemoMode: false,
  supabase: { functions: { invoke: live.invoke } },
}))

const ACTIVE_CLUB = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const BOOKING_CLUB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const booking: Booking = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  club_id: BOOKING_CLUB,
  venue_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  court_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  member_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  start_at: '2026-11-24T10:00:00.000Z',
  end_at: '2026-11-24T12:00:00.000Z',
  hours: 2,
  amount: 900,
  status: 'confirmed',
  payment_method: 'gcash',
  payment_ref: '1234567890',
  payment_reference: '1234567890',
  created_at: '2026-11-23T00:00:00.000Z',
  court: { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', name: 'Court 2', status: 'available', hourly_rate: 450 },
}

beforeEach(() => {
  vi.clearAllMocks()
  setActiveClubId(ACTIVE_CLUB)
})

describe('booking email (live)', () => {
  it('sends only the booking id and its club: no address, names, amount or reference', async () => {
    const result = await api.sendBookingConfirmationEmail({ booking, recipientEmail: 'player@example.com' })
    expect(live.invoke).toHaveBeenCalledTimes(1)
    expect(live.invoke).toHaveBeenCalledWith('send-booking-email', {
      body: { bookingId: booking.id, clubId: BOOKING_CLUB },
    })
    expect(result.sent).toBe(true)
    expect(result.preview).toContain('Receipt sent to player@example.com for Court 2')
  })

  it('names the active club when the booking does not carry its own', async () => {
    await api.sendBookingConfirmationEmail({ booking: { ...booking, club_id: undefined }, recipientEmail: 'player@example.com' })
    expect(live.invoke).toHaveBeenCalledWith('send-booking-email', {
      body: { bookingId: booking.id, clubId: ACTIVE_CLUB },
    })
  })

  it.each([
    ['email is not set up', { data: { sent: false, reason: 'RESEND_API_KEY not configured' }, error: null }],
    ['the function refuses the booking', { data: null, error: new Error('Booking not found') }],
  ])('reports nothing sent when %s', async (_label, answer) => {
    live.invoke.mockResolvedValueOnce(answer)
    const result = await api.sendBookingConfirmationEmail({ booking, recipientEmail: 'player@example.com' })
    expect(result.sent).toBe(false)
  })

  it('reports nothing sent when the call fails or no club is selected', async () => {
    live.invoke.mockRejectedValueOnce(new Error('offline'))
    expect((await api.sendBookingConfirmationEmail({ booking, recipientEmail: 'player@example.com' })).sent).toBe(false)

    setActiveClubId(null)
    const result = await api.sendBookingConfirmationEmail({ booking: { ...booking, club_id: undefined }, recipientEmail: 'player@example.com' })
    expect(result.sent).toBe(false)
    expect(live.invoke).toHaveBeenCalledTimes(1)
  })
})
