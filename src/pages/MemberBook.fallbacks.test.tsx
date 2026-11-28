import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Booking, CheckoutPaymentMethod, Court, Member, MyClub, Profile, PublicClubDetail, TimeSlot } from '../types'
import { ymdLocal } from '../types'
import { MemberBook } from './MemberBook'

const authState = vi.hoisted(() => ({
  user: null as Profile | null,
  activeClub: null as MyClub | null,
  joinClub: vi.fn(),
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: authState.user,
    loading: false,
    demo: true,
    activeClub: authState.activeClub,
    joinClub: authState.joinClub,
    signIn: vi.fn(),
    signUpMember: vi.fn(),
    verifySignupCode: vi.fn(),
    resendSignupCode: vi.fn(),
    resetPassword: vi.fn(),
    signOut: vi.fn(),
    refresh: vi.fn(),
  }),
}))

const apiMock = vi.hoisted(() => ({
  memberForUser: vi.fn(),
  listVenues: vi.fn(),
  availability: vi.fn(),
  myBookings: vi.fn(),
  createBooking: vi.fn(),
  releaseBookingHold: vi.fn(),
  checkoutPaymentMethods: vi.fn(),
  submitBookingPayment: vi.fn(),
  myBooking: vi.fn(),
  sendBookingConfirmationEmail: vi.fn(),
  publicClubDetail: vi.fn(),
  publicClubAvailability: vi.fn(),
  publicClubProfile: vi.fn(),
}))

vi.mock('../lib/api', () => ({ api: apiMock }))

const memberUser: Profile = {
  id: 'user_member',
  email: 'member@brinely.info',
  full_name: 'Mia Member',
  role: 'member',
  phone: null,
  created_at: '2026-01-01T00:00:00.000Z',
}
const staffUser: Profile = { ...memberUser, id: 'user_staff', email: 'staff@brinely.info', full_name: 'Sam Staff', role: 'staff' }

const member: Member = {
  id: 'mem_001',
  user_id: memberUser.id,
  member_code: 'RP-1001',
  full_name: 'Mia Member',
  email: memberUser.email,
  phone: null,
  membership_type: 'premium',
  status: 'active',
  join_date: '2026-01-01',
  expiry_date: '2099-12-31',
  notes: null,
  qr_token: 'QR_MIA',
  created_at: '2026-01-01T00:00:00.000Z',
}
const gensanClub: MyClub = { club_id: 'club-gensan', slug: 'rally-point-gensan', name: 'Rally Point Gensan', role: 'member' }
const court: Court = { id: 'court_2', name: 'Court B', status: 'available', hourly_rate: 500 }
const venue = {
  id: 'venue-main', club_id: 'club-gensan', slug: 'gensan-main', name: 'Gensan Main',
  timezone: 'Asia/Manila', open_hour: 6, close_hour: 22, is_active: true,
}
const gcash: CheckoutPaymentMethod = {
  id: 'pay-gcash',
  label: 'GCash',
  account_name: 'Rally Point Gensan',
  account_number: '0917 123 4567',
  qr_url: 'https://example.test/gcash-qr.png',
}
const REFERENCE = '1234567890123'
const held: Booking = {
  id: 'booking-1', court_id: court.id, member_id: member.id, start_at: '2099-09-21T04:00:00.000Z', end_at: '2099-09-21T05:00:00.000Z',
  hours: 1, amount: 500, status: 'pending_payment', payment_method: null, payment_ref: null, created_at: '2099-09-20T00:00:00.000Z', court,
  hold_expires_at: new Date(Date.now() + 15 * 60000).toISOString(),
}
function sent(): Booking {
  return {
    ...held,
    payment_reference: REFERENCE,
    payment_submitted_at: new Date().toISOString(),
    confirm_by: new Date(Date.now() + 15 * 60000).toISOString(),
  }
}
const davaoDetail: PublicClubDetail = {
  slug: 'rally-point-davao',
  name: 'Rally Point Davao',
  city: 'Davao City',
  address: 'Lanang',
  venues: [{
    id: venue.id, name: 'Davao Main', open_hour: 6, close_hour: 22, address: null, city: 'Davao City', latitude: null, longitude: null,
    courts: [{ id: court.id, name: court.name, hourly_rate: 500, member_rate: null, in_service: true }],
  }],
}

function slots(available = true): TimeSlot[] {
  return Array.from({ length: 16 }, (_, index) => ({
    startHour: index + 6,
    label: `${index + 6}:00`,
    available,
    ...(available ? {} : { blocked: 'booked' as const }),
  }))
}

function renderClub(slug = 'rally-point-davao') {
  return render(
    <MemoryRouter initialEntries={[`/clubs/${slug}/book`]}>
      <Routes>
        <Route path="/clubs/:slug/book" element={<MemberBook />} />
      </Routes>
    </MemoryRouter>,
  )
}

function renderOwnClub() {
  return render(<MemoryRouter><MemberBook /></MemoryRouter>)
}

/** Picks 12:00 PM, holds it, and opens the pay step. */
async function openCheckout(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: /^12:00 PM/ }))
  await user.click(screen.getByRole('button', { name: /Continue/ }))
  await screen.findByText('Checkout')
}

/** From the pay step, sends a reference number. */
async function sendReference(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('GCash reference number'), REFERENCE)
  await user.click(screen.getByRole('button', { name: /I.ve paid/ }))
}

beforeEach(() => {
  authState.user = null
  authState.activeClub = null
  authState.joinClub.mockReset().mockResolvedValue(gensanClub)
  sessionStorage.clear()
  Object.values(apiMock).forEach((mock) => mock.mockReset())
  apiMock.memberForUser.mockResolvedValue(member)
  apiMock.listVenues.mockResolvedValue([venue])
  apiMock.availability.mockResolvedValue([{ court, slots: slots() }])
  apiMock.myBookings.mockResolvedValue([])
  apiMock.createBooking.mockResolvedValue(held)
  apiMock.releaseBookingHold.mockResolvedValue(undefined)
  apiMock.checkoutPaymentMethods.mockResolvedValue([gcash])
  apiMock.submitBookingPayment.mockImplementation(async () => sent())
  apiMock.myBooking.mockImplementation(async () => sent())
  apiMock.sendBookingConfirmationEmail.mockResolvedValue({ sent: false })
  apiMock.publicClubDetail.mockResolvedValue(davaoDetail)
  apiMock.publicClubAvailability.mockResolvedValue([{ court, slots: slots() }])
  apiMock.publicClubProfile.mockResolvedValue(null)
})

describe('visitor log-in during booking', () => {
  it('shows what the visitor picked in the log-in sheet, and the way back above the title', async () => {
    const user = userEvent.setup()
    renderClub()
    expect(await screen.findByRole('link', { name: /Back to Rally Point Davao/ })).toHaveAttribute('href', '/clubs/rally-point-davao')
    await user.click(await screen.findByRole('button', { name: /^12:00 PM/ }))
    await user.click(screen.getByRole('button', { name: /^Continue/ }))
    const sheet = await screen.findByRole('dialog', { name: /Log in to book at Rally Point Davao/ })
    expect(within(sheet).getByText(/^Court B · .+ · 12:00 PM–1:00 PM · Php 500\.00$/)).toBeInTheDocument()
  })
})

describe('booking steps on the booking screen', () => {
  it('shows a visitor the log-in step and a player only choose, pay and confirmed', async () => {
    const first = renderClub()
    const visitorSteps = await screen.findByRole('list', { name: 'Booking steps' })
    expect(within(visitorSteps).getByText('Log in')).toBeInTheDocument()
    expect(within(visitorSteps).getByText('Choose a time').closest('li')).toHaveAttribute('aria-current', 'step')
    expect(screen.queryByText('1. Venue · 2. Date · 3. Court · 4. Pay')).not.toBeInTheDocument()
    first.unmount()

    authState.user = memberUser
    const user = userEvent.setup()
    renderOwnClub()
    const steps = await screen.findByRole('list', { name: 'Booking steps' })
    expect(within(steps).queryByText('Log in')).not.toBeInTheDocument()
    await openCheckout(user)
    expect(within(screen.getByRole('list', { name: 'Booking steps' })).getByText('Pay').closest('li'))
      .toHaveAttribute('aria-current', 'step')
  })

  it('sums up the pick in a Your booking card with one Continue button', async () => {
    authState.user = memberUser
    authState.activeClub = gensanClub
    const user = userEvent.setup()
    renderOwnClub()
    const summary = within(await screen.findByRole('complementary', { name: 'Your booking' }))
    expect(summary.getByText('Rally Point Gensan')).toBeInTheDocument()
    expect(summary.getByText('Court B')).toBeInTheDocument()
    expect(summary.getByText('Tap the hours you want')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^12:00 PM/ }))
    expect(summary.getByText('12:00 PM – 1:00 PM · 1 hour')).toBeInTheDocument()
    expect(summary.getByText('Php 500.00')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^Continue/ })).toHaveLength(1)
    expect(summary.getByRole('button', { name: /^Continue/ })).toBeEnabled()
    // Dates, courts and picked hours are toggles that say which one is picked.
    expect(screen.getByRole('button', { name: 'Today' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /^12:00 PM/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /Court B/ })).toHaveAttribute('aria-pressed', 'true')
    // There is no separate length choice: the hours tapped are the length.
    expect(screen.queryByRole('button', { name: '1h' })).not.toBeInTheDocument()
  })
})

describe('picking hours by tapping slots', () => {
  const pressed = (name: RegExp) => screen.getByRole('button', { name }).getAttribute('aria-pressed')

  it('adds the next or previous hour with no maximum, and trims from either end', async () => {
    authState.user = memberUser
    authState.activeClub = gensanClub
    const user = userEvent.setup()
    renderOwnClub()
    const summary = within(await screen.findByRole('complementary', { name: 'Your booking' }))

    await user.click(await screen.findByRole('button', { name: /^12:00 PM/ }))
    await user.click(screen.getByRole('button', { name: /^1:00 PM/ }))
    expect(summary.getByText('12:00 PM – 2:00 PM · 2 hours')).toBeInTheDocument()
    expect(summary.getByText('Php 1,000.00')).toBeInTheDocument()

    // The hour before the pick joins it too.
    await user.click(screen.getByRole('button', { name: /^11:00 AM/ }))
    expect(summary.getByText('11:00 AM – 2:00 PM · 3 hours')).toBeInTheDocument()

    // There is no maximum: a fourth and fifth hour join too.
    await user.click(screen.getByRole('button', { name: /^2:00 PM/ }))
    await user.click(screen.getByRole('button', { name: /^3:00 PM/ }))
    expect(pressed(/^3:00 PM/)).toBe('true')
    expect(summary.getByText('11:00 AM – 4:00 PM · 5 hours')).toBeInTheDocument()
    expect(summary.getByText('Php 2,500.00')).toBeInTheDocument()

    // Tapping an end hour removes it.
    await user.click(screen.getByRole('button', { name: /^3:00 PM/ }))
    await user.click(screen.getByRole('button', { name: /^2:00 PM/ }))
    await user.click(screen.getByRole('button', { name: /^11:00 AM/ }))
    expect(summary.getByText('12:00 PM – 2:00 PM · 2 hours')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^1:00 PM/ }))
    expect(summary.getByText('12:00 PM – 1:00 PM · 1 hour')).toBeInTheDocument()

    // An hour away from the pick starts a new one; tapping the only picked hour clears it.
    await user.click(screen.getByRole('button', { name: /^5:00 PM/ }))
    expect(pressed(/^12:00 PM/)).toBe('false')
    expect(summary.getByText('5:00 PM – 6:00 PM · 1 hour')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^5:00 PM/ }))
    expect(summary.getByText('Tap the hours you want')).toBeInTheDocument()
  })

  it('holds the picked hours as one booking', async () => {
    authState.user = memberUser
    const user = userEvent.setup()
    renderOwnClub()
    await user.click(await screen.findByRole('button', { name: /^3:00 PM/ }))
    await user.click(screen.getByRole('button', { name: /^4:00 PM/ }))
    await user.click(screen.getByRole('button', { name: /^Continue/ }))
    expect(apiMock.createBooking).toHaveBeenCalledWith(expect.objectContaining({ startHour: 15, hours: 2 }))
  })
})

describe('booking screen dead ends', () => {
  it('a: an unknown club shows only the message and a link to all clubs', async () => {
    apiMock.publicClubDetail.mockResolvedValue(null)
    renderClub('nowhere')
    expect(await screen.findByText('This club is not taking bookings.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'See all clubs' })).toHaveAttribute('href', '/clubs')
    expect(screen.queryByText('Date')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Continue/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Booking steps' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Back to/ })).not.toBeInTheDocument()
  })

  it('b: a club with no courts says so and links to its page and all clubs', async () => {
    apiMock.publicClubDetail.mockResolvedValue({ ...davaoDetail, venues: [] })
    apiMock.publicClubAvailability.mockResolvedValue([])
    renderClub()
    expect(await screen.findByText('This club has not listed courts yet.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to the club page' })).toHaveAttribute('href', '/clubs/rally-point-davao')
    expect(screen.getByRole('link', { name: 'See all clubs' })).toHaveAttribute('href', '/clubs')
    expect(screen.queryByText(/Available times/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Continue/ })).not.toBeInTheDocument()
  })

  it('c: every court out of service says none are open and links to the club page', async () => {
    apiMock.publicClubAvailability.mockResolvedValue([
      { court: { ...court, status: 'maintenance' }, slots: slots(false) },
      { court: { ...court, id: 'court_3', name: 'Court C', status: 'maintenance' }, slots: slots(false) },
    ])
    renderClub()
    expect(await screen.findByText('No courts are open for booking right now.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to the club page' })).toHaveAttribute('href', '/clubs/rally-point-davao')
    expect(screen.queryByRole('button', { name: /Continue/ })).not.toBeInTheDocument()
  })

  it('d: a day with no free hours says to try another day', async () => {
    authState.user = memberUser
    apiMock.availability.mockResolvedValue([{ court, slots: slots(false) }])
    renderOwnClub()
    expect(await screen.findByText(/^No free hours on .+\. Try another day\.$/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Continue/ })).toBeDisabled()
  })

  it("folds today's hours that are over into one line, so the grid starts at the first open hour", async () => {
    authState.user = memberUser
    const day = slots()
    // 6 AM to 9 AM are over; 10 AM onward can still be booked.
    for (let index = 0; index < 4; index += 1) day[index] = { ...day[index], available: false, blocked: 'passed' }
    apiMock.availability.mockResolvedValue([{ court, slots: day }])
    renderOwnClub()
    expect(await screen.findByText('Hours before 10:00 AM have passed.')).toBeInTheDocument()
    expect(screen.queryByText('Passed')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^10:00 AM/ })).toBeEnabled()
  })

  it('says when every hour of the day is over', async () => {
    authState.user = memberUser
    apiMock.availability.mockResolvedValue([
      { court, slots: slots().map((slot) => ({ ...slot, available: false, blocked: 'passed' as const })) },
    ])
    renderOwnClub()
    expect(await screen.findByText(/^Every hour on .+ has passed\. Try another day\.$/)).toBeInTheDocument()
  })

  it('e: signed-in staff are told at once that only player accounts book, with no Continue', async () => {
    authState.user = staffUser
    renderClub()
    expect(await screen.findByText('Only player accounts can book courts online. Please sign in with a player account.')).toBeInTheDocument()
    expect(await screen.findByText(/Available times/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Continue/ })).not.toBeInTheDocument()
    expect(apiMock.checkoutPaymentMethods).not.toHaveBeenCalled()
    expect(apiMock.createBooking).not.toHaveBeenCalled()
  })

  it('f: a QR code that does not load says to send the amount to the number', async () => {
    authState.user = memberUser
    const user = userEvent.setup()
    renderOwnClub()
    await openCheckout(user)
    const qr = screen.getByRole('img', { name: 'GCash QR code to pay Rally Point Gensan' })
    expect(qr).toHaveAttribute('src', gcash.qr_url)
    fireEvent.error(qr)
    expect(screen.getByText('The QR code did not load. Send Php 500.00 to the number below.')).toBeInTheDocument()
    expect(screen.getByText('0917 123 4567')).toBeInTheDocument()
  })

  it('f: a QR code that does not load, with no number, says to ask the desk', async () => {
    authState.user = memberUser
    apiMock.checkoutPaymentMethods.mockResolvedValue([{ ...gcash, account_number: null }])
    const user = userEvent.setup()
    renderOwnClub()
    await openCheckout(user)
    fireEvent.error(screen.getByRole('img', { name: 'GCash QR code to pay Rally Point Gensan' }))
    expect(screen.getByText(/Ask the desk for the club's GCash number\./)).toBeInTheDocument()
  })

  it('g: the waiting screen links home and to notifications', async () => {
    authState.user = memberUser
    const user = userEvent.setup()
    renderOwnClub()
    await openCheckout(user)
    await sendReference(user)
    expect(await screen.findByRole('heading', { name: 'Waiting for the club to confirm' })).toBeInTheDocument()
    expect(screen.getByText(/You can leave this screen/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Find another court' })).toHaveAttribute('href', '/clubs')
    expect(screen.getByRole('link', { name: 'Open notifications' })).toHaveAttribute('href', '/member/notifications')
  })

  it('h: a confirmed booking offers Book another and a link home', async () => {
    authState.user = memberUser
    apiMock.myBooking.mockImplementation(async () => ({ ...sent(), status: 'confirmed' }))
    const user = userEvent.setup()
    renderOwnClub()
    await openCheckout(user)
    await sendReference(user)
    expect(await screen.findByText('Booking confirmed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Book another' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Find another court' })).toHaveAttribute('href', '/clubs')
  })

  it('i: a turned-down payment offers to call the club when it lists a phone', async () => {
    authState.user = memberUser
    authState.activeClub = gensanClub
    apiMock.publicClubProfile.mockResolvedValue({ phone: '0917 555 0000' })
    apiMock.myBooking.mockImplementation(async () => ({ ...sent(), status: 'cancelled' }))
    const user = userEvent.setup()
    renderOwnClub()
    await openCheckout(user)
    await sendReference(user)
    expect(await screen.findByRole('alert')).toHaveTextContent('The club did not confirm your payment')
    const call = await screen.findByRole('link', { name: 'Call the club: 0917 555 0000' })
    expect(call).toHaveAttribute('href', 'tel:09175550000')
    expect(apiMock.publicClubProfile).toHaveBeenCalledWith('rally-point-gensan')
  })

  it('i: a turned-down payment without a club phone shows no call link', async () => {
    authState.user = memberUser
    authState.activeClub = gensanClub
    apiMock.myBooking.mockImplementation(async () => ({ ...sent(), status: 'cancelled' }))
    const user = userEvent.setup()
    renderOwnClub()
    await openCheckout(user)
    await sendReference(user)
    expect(await screen.findByRole('link', { name: 'Open your notifications' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Call the club/ })).not.toBeInTheDocument()
  })

  it('i: a later turned-down payment does not keep a phone number from an earlier one', async () => {
    authState.user = memberUser
    authState.activeClub = gensanClub
    apiMock.publicClubProfile.mockResolvedValueOnce({ phone: '0917 555 0000' })
    apiMock.myBooking.mockImplementation(async () => ({ ...sent(), status: 'cancelled' }))
    const user = userEvent.setup()
    renderOwnClub()
    await openCheckout(user)
    await sendReference(user)
    expect(await screen.findByRole('link', { name: 'Call the club: 0917 555 0000' })).toBeInTheDocument()

    // The second time, the club's profile does not load.
    apiMock.publicClubProfile.mockRejectedValueOnce(new Error('offline'))
    await openCheckout(user)
    await sendReference(user)
    await waitFor(() => expect(apiMock.publicClubProfile).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByRole('link', { name: /Call the club/ })).not.toBeInTheDocument())
  })

  it('c: still shows an error when every court is out of service', async () => {
    authState.user = memberUser
    apiMock.availability.mockResolvedValue([{ court: { ...court, status: 'maintenance' }, slots: slots(false) }])
    apiMock.myBookings.mockRejectedValue(new Error('Bookings are down'))
    renderOwnClub()
    expect(await screen.findByText('No courts are open for booking right now.')).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent('Bookings are down')
  })
})

/** Makes the screen report a phone width, and the app's bottom menu a given height. */
function asPhone(navHeight = 72) {
  const matchMedia = vi.fn((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
  Object.defineProperty(window, 'matchMedia', { value: matchMedia, configurable: true, writable: true })
  const height = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function offsetHeight(this: HTMLElement) {
    return this.classList.contains('bottom-nav') ? navHeight : 0
  })
  return () => {
    Reflect.deleteProperty(window, 'matchMedia')
    height.mockRestore()
  }
}

describe('picking a time', () => {
  it('on a phone, keeps the pick and the only Continue in a bar at the bottom of the screen', async () => {
    const restore = asPhone(72)
    try {
      authState.user = memberUser
      authState.activeClub = gensanClub
      renderOwnClub()
      const bar = await screen.findByRole('region', { name: 'Your pick' })
      // Players have no bottom menu any more, so the bar sits at the bottom of the screen.
      expect(bar).toHaveStyle({ bottom: '0px' })
      expect(within(bar).getByText('Pick your hours to continue')).toBeInTheDocument()
      await waitFor(() => expect(within(bar).getByRole('button', { name: 'Continue' })).toBeDisabled())
      expect(within(bar).getByRole('button', { name: 'Continue' })).toHaveAttribute('aria-describedby', 'book-pick-hint')

      fireEvent.click(screen.getByRole('button', { name: '12:00 PM' }))
      expect(within(bar).getByText('12:00–1:00 PM · Php 500.00')).toBeInTheDocument()
      expect(within(bar).queryByText('Pick your hours to continue')).not.toBeInTheDocument()
      // One Continue on the screen, in the bar; the summary card keeps the details.
      expect(screen.getAllByRole('button', { name: /^Continue/ })).toHaveLength(1)
      const summary = within(screen.getByRole('complementary', { name: 'Your booking' }))
      expect(summary.queryByRole('button', { name: /^Continue/ })).not.toBeInTheDocument()
      expect(summary.getByText(/You pay the member rate/)).toBeInTheDocument()

      fireEvent.click(within(bar).getByRole('button', { name: 'Continue' }))
      expect(await screen.findByText('Checkout')).toBeInTheDocument()
      expect(screen.queryByRole('region', { name: 'Your pick' })).not.toBeInTheDocument()
    } finally {
      restore()
    }
  })

  it('on a phone, a visitor’s bar sits at the very bottom, with no menu under it', async () => {
    const restore = asPhone(72)
    try {
      renderClub()
      const bar = await screen.findByRole('region', { name: 'Your pick' })
      expect(bar).toHaveStyle({ bottom: '0px' })
    } finally {
      restore()
    }
  })

  it('on a wide screen, says why Continue cannot be tapped until a time is picked', async () => {
    authState.user = memberUser
    renderOwnClub()
    const summary = within(await screen.findByRole('complementary', { name: 'Your booking' }))
    await waitFor(() => expect(summary.getByRole('button', { name: /^Continue/ })).toBeDisabled())
    expect(summary.getByText('Pick your hours to continue')).toBeInTheDocument()
    expect(summary.getByRole('button', { name: /^Continue/ })).toHaveAttribute('aria-describedby', 'book-pick-hint')
    expect(screen.queryByRole('region', { name: 'Your pick' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '12:00 PM' }))
    expect(summary.queryByText('Pick your hours to continue')).not.toBeInTheDocument()
    expect(summary.getByRole('button', { name: /^Continue/ })).toBeEnabled()
  })

  it('groups the hours by part of the day and shows free hours by their time alone', async () => {
    authState.user = memberUser
    const day = slots()
    day[8] = { ...day[8], available: false, blocked: 'booked' }
    apiMock.availability.mockResolvedValue([{ court, slots: day }])
    renderOwnClub()
    const morning = await screen.findByRole('group', { name: /Morning/ })
    expect(within(morning).getByRole('heading', { name: 'Morning 5–11 AM' })).toBeInTheDocument()
    expect(within(morning).getByRole('button', { name: '6:00 AM' })).toBeInTheDocument()
    const afternoon = screen.getByRole('group', { name: /Afternoon/ })
    expect(within(afternoon).getByRole('button', { name: '12:00 PM' })).toBeInTheDocument()
    // 2 PM is taken: it says so in words and cannot be tapped.
    expect(within(afternoon).getByText('Booked')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^2:00 PM/ })).not.toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: /Evening/ })).getByRole('button', { name: '8:00 PM' })).toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: /Late night/ })).getByRole('button', { name: '9:00 PM' })).toBeInTheDocument()
    expect(screen.queryByText('Available')).not.toBeInTheDocument()

    fireEvent.click(within(afternoon).getByRole('button', { name: '12:00 PM' }))
    const picked = within(afternoon).getByRole('button', { name: /^12:00 PM/ })
    expect(picked).toHaveTextContent('Selected')
    expect(picked).toHaveClass('picked-mark')
  })

  it('shows the court price in body text, not small grey print', async () => {
    authState.user = memberUser
    renderOwnClub()
    const price = await screen.findByText('Php 500.00/hr')
    expect(price).toHaveClass('text-body', 'text-ink')
    expect(price).not.toHaveClass('text-xs')
  })

  it('opens on tomorrow when every hour today is over, and offers See tomorrow from today', async () => {
    authState.user = memberUser
    const today = ymdLocal(new Date())
    const over = slots().map((slot) => ({ ...slot, available: false, blocked: 'passed' as const }))
    apiMock.availability.mockImplementation(async (ymd: string) => [{ court, slots: ymd === today ? over : slots() }])
    renderOwnClub()
    expect(await screen.findByText('No open hours are left today, so this shows tomorrow.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tomorrow' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '12:00 PM' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'Today' }))
    expect(await screen.findByText(/^Every hour on .+ has passed\. Try another day\.$/)).toBeInTheDocument()
    expect(screen.queryByText(/No open hours are left today/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'See tomorrow' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Tomorrow' })).toHaveAttribute('aria-pressed', 'true'))
    expect(await screen.findByRole('button', { name: '12:00 PM' })).toBeEnabled()
  })

  it('stays on a day the player picked, even when it is full', async () => {
    authState.user = memberUser
    const today = ymdLocal(new Date())
    apiMock.availability.mockImplementation(async (ymd: string) => [{ court, slots: ymd === today ? slots() : slots(false) }])
    renderOwnClub()
    expect(await screen.findByRole('button', { name: '12:00 PM' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Tomorrow' }))
    expect(await screen.findByText(/^No free hours on .+\. Try another day\.$/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tomorrow' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /^See / })).toBeInTheDocument()
  })
})

describe('checkout', () => {
  it('shows the number to send to large, with a Copy number button', async () => {
    authState.user = memberUser
    const user = userEvent.setup()
    renderOwnClub()
    await openCheckout(user)
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const number = screen.getByText('0917 123 4567')
    expect(number).toHaveClass('text-heading-2', 'tabular-nums')
    expect(number).not.toHaveClass('font-mono')
    fireEvent.click(screen.getByRole('button', { name: 'Copy number' }))
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument()
    expect(writeText).toHaveBeenCalledWith('09171234567')

    const field = screen.getByLabelText('GCash reference number')
    expect(field).toHaveAttribute('inputmode', 'numeric')
    expect(field).toHaveAttribute('placeholder', expect.stringMatching(/\d/))
    expect(field.closest('section')).toHaveClass('max-w-2xl')
  })

  it('says so when the number cannot be copied', async () => {
    authState.user = memberUser
    const user = userEvent.setup()
    renderOwnClub()
    await openCheckout(user)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Copy number' }))
    expect(await screen.findByText(/Copying did not work on this phone/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy number' })).toBeInTheDocument()
  })

  it('asks before Change time lets the hours go once a reference is typed', async () => {
    authState.user = memberUser
    const user = userEvent.setup()
    renderOwnClub()
    await openCheckout(user)
    await user.type(screen.getByLabelText('GCash reference number'), REFERENCE)

    await user.click(screen.getByRole('button', { name: /Change time/ }))
    expect(screen.getByText('These hours will be released. Only go back if you have not paid.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Stay here' })).toHaveFocus()
    expect(apiMock.releaseBookingHold).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Stay here' }))
    expect(screen.queryByText(/These hours will be released/)).not.toBeInTheDocument()
    expect(screen.getByText('Checkout')).toBeInTheDocument()
    expect(screen.getByLabelText('GCash reference number')).toHaveValue(REFERENCE)

    await user.click(screen.getByRole('button', { name: /Change time/ }))
    await user.click(screen.getByRole('button', { name: 'Release and change time' }))
    expect(apiMock.releaseBookingHold).toHaveBeenCalledWith(held.id)
    expect(await screen.findByText(/Available times/)).toBeInTheDocument()
  })
})
