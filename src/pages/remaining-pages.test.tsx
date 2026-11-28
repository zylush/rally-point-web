import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  Booking,
  CheckoutPaymentMethod,
  Court,
  CourtSession,
  Member,
  MyClub,
  Profile,
  PublicClubDetail,
  ScheduleBlock,
  TimeSlot,
  Transaction,
  Venue,
} from '../types'
import { AdminHome, AdminMemberForm, AdminMembers, AdminOps, AdminTransactions, AdminUsers } from './admin'
import { MemberBook } from './MemberBook'
import { MemberPass } from './MemberPass'
import { AdminBoard, ScheduleBoard, TvBoard } from './ScheduleBoard'
import { AdminBookings, BookingsDesk } from './BookingsDesk'
import { localRangeISO, ymdLocal } from '../types'

const authState = vi.hoisted(() => ({
  user: {
    id: 'user_admin',
    email: 'admin@brinely.info',
    full_name: 'Alex Admin',
    role: 'admin',
    phone: null,
    created_at: '2026-01-01T00:00:00.000Z',
  } as Profile | null,
  activeClub: null as MyClub | null,
  joinClub: vi.fn(),
  signIn: vi.fn(),
  listeners: new Set<() => void>(),
}))
const adminUser = authState.user as Profile
const memberUser: Profile = {
  ...adminUser,
  id: 'user_member',
  email: 'member@brinely.info',
  full_name: 'Mia Member',
  role: 'member',
}

const apiMock = vi.hoisted(() => ({
  stats: vi.fn(),
  transactions: vi.fn(),
  listMembers: vi.fn(),
  getMember: vi.fn(),
  saveMember: vi.fn(),
  listCourts: vi.fn(),
  playingSessions: vi.fn(),
  createRental: vi.fn(),
  extendSession: vi.fn(),
  endSession: vi.fn(),
  createWalkIn: vi.fn(),
  checkIn: vi.fn(),
  users: vi.fn(),
  memberForUser: vi.fn(),
  availability: vi.fn(),
  myBookings: vi.fn(),
  createBooking: vi.fn(),
  releaseBookingHold: vi.fn(),
  checkoutPaymentMethods: vi.fn(),
  submitBookingPayment: vi.fn(),
  myBooking: vi.fn(),
  paymentsToConfirm: vi.fn(),
  membershipRequests: vi.fn(),
  confirmBookingPayment: vi.fn(),
  rejectBookingPayment: vi.fn(),
  sendBookingConfirmationEmail: vi.fn(),
  publicClubDetail: vi.fn(),
  publicClubAvailability: vi.fn(),
  ensureMemberQr: vi.fn(),
  myMemberPasses: vi.fn(),
  daySchedule: vi.fn(),
  listBookings: vi.fn(),
  listVenues: vi.fn(),
}))

// The signed-in person can change during a test (signing in from the booking screen).
vi.mock('../context/AuthContext', async () => {
  const { useSyncExternalStore } = await import('react')
  const subscribe = (listener: () => void) => {
    authState.listeners.add(listener)
    return () => {
      authState.listeners.delete(listener)
    }
  }
  const currentUser = () => authState.user
  return {
    useAuth: () => ({
      user: useSyncExternalStore(subscribe, currentUser, currentUser),
      loading: false,
      demo: true,
      activeClub: authState.activeClub,
      joinClub: authState.joinClub,
      signIn: authState.signIn,
      signUpMember: vi.fn(),
      verifySignupCode: vi.fn(),
      resendSignupCode: vi.fn(),
      resetPassword: vi.fn(),
      signOut: vi.fn(),
      refresh: vi.fn(),
    }),
  }
})

function signInAs(profile: Profile) {
  authState.user = profile
  authState.listeners.forEach((listener) => listener())
}

vi.mock('../lib/api', () => ({ api: apiMock }))

const member: Member = {
  id: 'mem_001',
  user_id: 'user_member',
  member_code: 'RP-1001',
  full_name: 'Mia Member',
  email: 'member@brinely.info',
  phone: '+63 917 555 0101',
  membership_type: 'premium',
  status: 'active',
  join_date: '2026-01-01',
  expiry_date: '2026-12-31',
  notes: null,
  qr_token: 'QR_MIA',
  created_at: '2026-01-01T00:00:00.000Z',
}

const members: Member[] = [
  member,
  { ...member, id: 'mem_002', member_code: 'RP-1002', full_name: 'Jonah Cruz', email: 'jonah@example.com', status: 'expired' },
]

const court: Court = { id: 'court_2', name: 'Court B', status: 'available', hourly_rate: 500 }
const session: CourtSession = {
  id: 'session-1', court_id: court.id, member_id: member.id, start_at: '2026-09-20T12:00:00.000Z', end_at: '2026-09-20T13:00:00.000Z', status: 'playing', amount: 500, created_by: 'user_admin', court, member,
}
const booking: Booking = {
  id: 'booking-1', court_id: court.id, member_id: member.id, start_at: '2026-09-21T12:00:00.000Z', end_at: '2026-09-21T13:00:00.000Z', hours: 1, amount: 500, status: 'confirmed', payment_method: 'gcash', payment_ref: 'GCASH-REF', created_at: '2026-09-20T00:00:00.000Z', court, member,
}
const venue: Venue = {
  id: 'venue-main',
  club_id: 'club-rally-point',
  slug: 'gensan-main',
  name: 'Rally Point Gensan',
  timezone: 'Asia/Manila',
  open_hour: 6,
  close_hour: 22,
  is_active: true,
}
const gcash: CheckoutPaymentMethod = {
  id: 'pay-gcash',
  label: 'GCash',
  account_name: 'Rally Point Gensan',
  account_number: '0917 123 4567',
  qr_url: 'https://example.test/gcash-qr.png',
}
const REFERENCE = '1234567890123'
const RECEIPT = 'Receipt sent to member@brinely.info for Court B'
const BOOKING_INTENT_KEY = 'brinely_booking_intent'
/** Another club, opened from Find a court at /clubs/rally-point-davao/book. */
const davaoClub: MyClub = { club_id: 'club-davao', slug: 'rally-point-davao', name: 'Rally Point Davao', role: 'member' }
const davaoDetail: PublicClubDetail = {
  slug: 'rally-point-davao',
  name: 'Rally Point Davao',
  city: 'Davao City',
  address: 'Lanang',
  venues: [{
    id: venue.id,
    name: venue.name,
    open_hour: 6,
    close_hour: 22,
    address: null,
    city: 'Davao City',
    latitude: null,
    longitude: null,
    courts: [{ id: court.id, name: court.name, hourly_rate: 500, member_rate: null, in_service: true }],
  }],
}

function openSlots(): TimeSlot[] {
  return Array.from({ length: 16 }, (_, index) => ({ startHour: index + 6, label: `${index + 6}:00`, available: true }))
}

/** Tomorrow on the club's (Philippine) calendar, as the booking screen's date buttons count it. */
function tomorrowPh() {
  return ymdLocal(new Date(Date.now() + 86400000))
}

function renderClubBooking(path = `/clubs/${davaoClub.slug}/book?venue=${venue.id}&court=${court.id}`) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/clubs/:slug/book" element={<MemberBook />} />
      </Routes>
    </MemoryRouter>,
  )
}
/** The booking once the player has sent their reference: the club now has 15 minutes to check it. */
function sentBooking(reference = REFERENCE): Booking {
  return {
    ...booking,
    status: 'pending_payment',
    payment_ref: null,
    payment_reference: reference,
    payment_submitted_at: new Date().toISOString(),
    confirm_by: new Date(Date.now() + 15 * 60000).toISOString(),
  }
}
/** The booking while its hours are held for checkout, by the server's clock, and nothing has been sent. */
function heldBooking(minutesLeft = 15): Booking {
  return {
    ...booking,
    status: 'pending_payment',
    payment_ref: null,
    hold_expires_at: new Date(Date.now() + minutesLeft * 60000).toISOString(),
  }
}
const transaction: Transaction = { id: 'tx-1', member_id: member.id, amount: 500, type: 'booking', description: 'Court booking', created_at: '2026-09-20T00:00:00.000Z', member }
const scheduleBlocks: ScheduleBlock[] = [
  { id: 'schedule-1', kind: 'session', court_id: court.id, court_name: court.name, title: 'Mia Member', subtitle: 'playing', start_at: '2026-09-20T12:00:00.000Z', end_at: '2026-09-20T13:00:00.000Z', status: 'playing', amount: 500 },
  { id: 'schedule-2', kind: 'booking', court_id: court.id, court_name: court.name, title: 'Jonah Cruz', subtitle: 'online', start_at: '2026-09-20T14:00:00.000Z', end_at: '2026-09-20T15:00:00.000Z', status: 'confirmed', amount: 500 },
  { id: 'schedule-3', kind: 'open_play', court_id: null, court_name: 'Open floor', title: 'Open play', subtitle: '2/8', start_at: '2026-09-20T16:00:00.000Z', end_at: '2026-09-20T18:00:00.000Z', status: 'open', amount: 250 },
]

function tomorrowYmd() {
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  return ymdLocal(tomorrow)
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function resetMocks() {
  Object.values(apiMock).forEach((mock) => mock.mockReset())
  apiMock.stats.mockResolvedValue({ members: 40, active_now: 3, revenue_today: 20040, courts_occupied: 2 })
  apiMock.transactions.mockResolvedValue([transaction])
  apiMock.listMembers.mockResolvedValue(members)
  apiMock.getMember.mockResolvedValue(member)
  apiMock.saveMember.mockResolvedValue(undefined)
  apiMock.listCourts.mockResolvedValue([court])
  apiMock.playingSessions.mockResolvedValue([session])
  apiMock.createRental.mockResolvedValue({ ...session, id: 'rental-1' })
  apiMock.extendSession.mockResolvedValue(session)
  apiMock.endSession.mockResolvedValue(undefined)
  apiMock.createWalkIn.mockResolvedValue({ id: 'walkin-1', full_name: 'Walk-in', purpose: 'Day pass', amount: 350, created_at: '2026-09-20T00:00:00.000Z' })
  apiMock.checkIn.mockResolvedValue({ id: 'checkin-1', member_id: member.id, checked_in_at: '2026-09-20T00:00:00.000Z' })
  apiMock.users.mockResolvedValue([authState.user])
  apiMock.memberForUser.mockResolvedValue(member)
  apiMock.availability.mockResolvedValue([{ court, slots: Array.from({ length: 16 }, (_, index) => ({ startHour: index + 6, label: `${index + 6}:00`, available: true })) }])
  apiMock.myBookings.mockResolvedValue([booking])
  apiMock.createBooking.mockResolvedValue({ ...booking, status: 'pending_payment', payment_ref: null })
  apiMock.releaseBookingHold.mockResolvedValue(undefined)
  apiMock.checkoutPaymentMethods.mockResolvedValue([gcash])
  apiMock.submitBookingPayment.mockImplementation(async ({ reference }: { reference: string }) => sentBooking(reference))
  apiMock.myBooking.mockImplementation(async () => sentBooking())
  apiMock.paymentsToConfirm.mockResolvedValue([])
  apiMock.membershipRequests.mockResolvedValue([])
  apiMock.confirmBookingPayment.mockResolvedValue(booking)
  apiMock.rejectBookingPayment.mockResolvedValue({ ...booking, status: 'cancelled' })
  apiMock.sendBookingConfirmationEmail.mockResolvedValue({ sent: true, preview: RECEIPT })
  apiMock.publicClubDetail.mockResolvedValue(davaoDetail)
  apiMock.publicClubAvailability.mockResolvedValue([{ court, slots: openSlots() }])
  apiMock.ensureMemberQr.mockResolvedValue(member)
  apiMock.daySchedule.mockResolvedValue(scheduleBlocks)
  apiMock.listBookings.mockResolvedValue([booking])
  apiMock.listVenues.mockResolvedValue([venue])
}

beforeEach(() => {
  authState.user = adminUser
  authState.activeClub = null
  authState.listeners.clear()
  authState.joinClub.mockReset().mockResolvedValue(davaoClub)
  authState.signIn.mockReset()
  sessionStorage.clear()
  resetMocks()
})

describe('admin pages', () => {
  it('renders the dashboard and transaction summary', async () => {
    render(<MemoryRouter><AdminHome /></MemoryRouter>)
    expect(await screen.findByText('Revenue today')).toBeInTheDocument()
    expect(screen.getByText('Php 20,040.00')).toBeInTheDocument()
    expect(screen.getByText('Court booking')).toBeInTheDocument()
    expect(apiMock.stats).toHaveBeenCalled()
    expect(apiMock.transactions).toHaveBeenCalled()
  })

  it('searches members and routes to the new-member form', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/admin/members']}>
        <Routes>
          <Route path="/admin/members" element={<AdminMembers />} />
          <Route path="/admin/members/new" element={<AdminMemberForm />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByText('2 on file')).toBeInTheDocument()
    await user.type(screen.getByRole('searchbox', { name: 'Search members' }), 'Jonah')
    expect(screen.getByText('Jonah Cruz')).toBeInTheDocument()
    expect(screen.queryByText('Mia Member')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'New member' }))
    expect(await screen.findByRole('heading', { name: 'New member' })).toBeInTheDocument()
  })

  it('edits an existing member and creates a new member', async () => {
    const user = userEvent.setup()
    const view = render(
      <MemoryRouter initialEntries={['/admin/members/mem_001']}>
        <Routes>
          <Route path="/admin/members/:id" element={<AdminMemberForm />} />
          <Route path="/admin/members/new" element={<AdminMemberForm />} />
          <Route path="/admin/members" element={<p>Members list</p>} />
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByRole('heading', { name: 'Update member' })).toBeInTheDocument()
    const existingName = screen.getByDisplayValue('Mia Member')
    await user.clear(existingName)
    await user.type(existingName, 'Mia Edited')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(apiMock.saveMember).toHaveBeenCalledWith(expect.objectContaining({ id: 'mem_001', full_name: 'Mia Edited' }))
    expect(await screen.findByText('Members list')).toBeInTheDocument()

    view.unmount()
    render(
      <MemoryRouter initialEntries={['/admin/members/new']}>
        <Routes>
          <Route path="/admin/members/new" element={<AdminMemberForm />} />
          <Route path="/admin/members" element={<p>Members list</p>} />
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByRole('heading', { name: 'New member' })).toBeInTheDocument()
    await user.type(screen.getAllByRole('textbox')[0], 'New Admin Member')
    await user.click(screen.getByRole('button', { name: 'Create member' }))
    expect(apiMock.saveMember).toHaveBeenLastCalledWith(expect.objectContaining({ full_name: 'New Admin Member' }))
    expect(await screen.findByText('Members list')).toBeInTheDocument()
  })

  it('covers floor operations across rent, extend, walk-in, check-in, and playing tabs', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><AdminOps /></MemoryRouter>)
    expect(await screen.findByText('Currently playing')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Rent' }))
    await user.click(screen.getByRole('button', { name: 'Start rental' }))
    expect(apiMock.createRental).toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Extend' }))
    await user.click(screen.getByRole('button', { name: /\+1 hour/ }))
    expect(apiMock.extendSession).toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Walk-in' }))
    await user.clear(screen.getByPlaceholderText('Full name'))
    await user.type(screen.getByPlaceholderText('Full name'), 'Walk-in Player')
    await user.click(screen.getByRole('button', { name: 'Register' }))
    expect(apiMock.createWalkIn).toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Check-in' }))
    await user.clear(screen.getByPlaceholderText('Note'))
    await user.type(screen.getByPlaceholderText('Note'), 'Ready to play')
    await user.click(screen.getByRole('button', { name: 'Confirm check-in' }))
    expect(apiMock.checkIn).toHaveBeenCalledWith(member.id, 'user_admin', 'Ready to play', venue.id)
    await user.click(screen.getByRole('button', { name: 'Playing' }))
    await user.click(screen.getByRole('button', { name: 'End' }))
    expect(apiMock.endSession).toHaveBeenCalled()
  })

  it('renders transactions and users', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<MemoryRouter><AdminTransactions /></MemoryRouter>)
    expect(await screen.findByText('Court booking')).toBeInTheDocument()
    unmount()
    render(<MemoryRouter><AdminUsers /></MemoryRouter>)
    expect(await screen.findByText('Alex Admin')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Go back' }))
  })
})

describe('member booking and pass pages', () => {
  beforeEach(() => {
    authState.user = memberUser
  })

  it('shows the club QR, takes the GCash reference, waits for the club, then shows the booking', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      apiMock.sendBookingConfirmationEmail.mockResolvedValueOnce({ sent: false, preview: RECEIPT })
      render(<MemoryRouter><MemberBook /></MemoryRouter>)
      expect(await screen.findByText(/Available times/)).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: /Court B/ }))
      await user.click(screen.getByRole('button', { name: /^12:00/ }))
      await user.click(screen.getByRole('button', { name: /Continue/ }))
      expect(await screen.findByText('Checkout')).toBeInTheDocument()
      expect(apiMock.createBooking).toHaveBeenCalledWith(expect.objectContaining({ user_id: memberUser.id }))

      // The club's own QR code, account and number, with plain steps.
      expect(screen.getByRole('img', { name: 'GCash QR code to pay Rally Point Gensan' })).toHaveAttribute('src', gcash.qr_url)
      expect(screen.getByText('Rally Point Gensan', { selector: 'dd' })).toBeInTheDocument()
      expect(screen.getByText('0917 123 4567')).toBeInTheDocument()
      expect(screen.getByText(/Open GCash and scan the QR code, or send the money to the number shown/)).toBeInTheDocument()
      expect(screen.getByText((_, element) => element?.tagName === 'LI' && element.textContent === 'Pay exactly Php 500.00.')).toBeInTheDocument()
      expect(screen.getByText('Time left to pay')).toBeInTheDocument()
      expect(screen.queryByText(/Demo checkout/)).not.toBeInTheDocument()

      // GCash shows the reference with spaces; they are taken out before sending.
      await user.type(screen.getByLabelText('GCash reference number'), '1234 567 890123')
      await user.click(screen.getByRole('button', { name: /I.ve paid/ }))
      expect(apiMock.submitBookingPayment).toHaveBeenCalledWith({ booking_id: booking.id, reference: REFERENCE })

      expect(await screen.findByRole('heading', { name: 'Waiting for the club to confirm' })).toBeInTheDocument()
      expect(screen.getByText(REFERENCE)).toBeInTheDocument()
      expect(screen.getByRole('timer', { name: /left for the club to confirm/ })).toBeInTheDocument()
      // The time to pay has stopped, and there is no going back once the payment is sent.
      expect(screen.queryByText('Time left to pay')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Change time/ })).not.toBeInTheDocument()

      // The first check finds the club still checking.
      await act(async () => { await vi.advanceTimersByTimeAsync(15000) })
      expect(apiMock.myBooking).toHaveBeenCalledWith(booking.id)
      expect(screen.getByRole('heading', { name: 'Waiting for the club to confirm' })).toBeInTheDocument()

      apiMock.myBooking.mockResolvedValue({ ...booking, payment_ref: null, payment_reference: REFERENCE })
      await act(async () => { await vi.advanceTimersByTimeAsync(15000) })
      expect(await screen.findByText('Booking confirmed')).toBeInTheDocument()
      expect(screen.getByText(/This hour now shows as Booked\.\s+No refunds\./)).toBeInTheDocument()
      expect(screen.getByText(REFERENCE)).toBeInTheDocument()
      expect(apiMock.releaseBookingHold).not.toHaveBeenCalled()
      // An email that could not be sent is not shown as sent.
      await waitFor(() => expect(apiMock.sendBookingConfirmationEmail).toHaveBeenCalledTimes(1))
      expect(screen.queryByText(RECEIPT)).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Book another' }))
      expect(screen.getByText(/Available times/)).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('checks the reference number before sending it', async () => {
    // A club with a number but no QR picture yet: the steps say to send to the number.
    apiMock.checkoutPaymentMethods.mockResolvedValue([{ ...gcash, qr_url: null }])
    const user = userEvent.setup()
    render(<MemoryRouter><MemberBook /></MemoryRouter>)
    await user.click(await screen.findByRole('button', { name: /^12:00/ }))
    await user.click(screen.getByRole('button', { name: /Continue/ }))
    const field = await screen.findByLabelText('GCash reference number')
    expect(field).toHaveAttribute('autocomplete', 'off')
    expect(screen.getByText('Open GCash and send the money to the number shown.')).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /QR code/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /I.ve paid/ }))
    expect(screen.getByText('Type the reference number GCash showed you after you paid.')).toBeInTheDocument()
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(field).toHaveFocus()

    await user.type(field, 'REF-123')
    await user.click(screen.getByRole('button', { name: /I.ve paid/ }))
    expect(screen.getByText(/That does not look like a GCash reference number\. It should be 6 to 30 letters or numbers/)).toBeInTheDocument()

    await user.clear(field)
    await user.type(field, '12345')
    await user.click(screen.getByRole('button', { name: /I.ve paid/ }))
    expect(screen.getByText(/That does not look like a GCash reference number/)).toBeInTheDocument()
    expect(apiMock.submitBookingPayment).not.toHaveBeenCalled()

    await user.clear(field)
    await user.type(field, ' ab12 3456 ')
    await user.click(screen.getByRole('button', { name: /I.ve paid/ }))
    expect(apiMock.submitBookingPayment).toHaveBeenCalledWith({ booking_id: booking.id, reference: 'ab123456' })
    expect(await screen.findByRole('heading', { name: 'Waiting for the club to confirm' })).toBeInTheDocument()
  })

  it('keeps the checkout open with a plain message when sending the reference fails', async () => {
    const user = userEvent.setup()
    apiMock.submitBookingPayment.mockRejectedValueOnce(new Error('This GCash reference number was already used for another booking'))
    // The club did not get it: the booking still waits for payment.
    apiMock.myBooking.mockResolvedValue(heldBooking())
    render(<MemoryRouter><MemberBook /></MemoryRouter>)
    await user.click(await screen.findByRole('button', { name: /^12:00/ }))
    await user.click(screen.getByRole('button', { name: /Continue/ }))
    await user.type(await screen.findByLabelText('GCash reference number'), REFERENCE)
    await user.click(screen.getByRole('button', { name: /I.ve paid/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This GCash reference number was already used for another booking')
    expect(apiMock.myBooking).toHaveBeenCalledWith(booking.id)
    expect(screen.getByText('Checkout')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Change time/ })).toBeEnabled()

    // When the booking cannot be checked either, the error still shows.
    apiMock.submitBookingPayment.mockRejectedValueOnce(new Error('Could not reach bRineLy. Check your connection and try again.'))
    apiMock.myBooking.mockRejectedValueOnce(new Error('offline'))
    await user.click(screen.getByRole('button', { name: /I.ve paid/ }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not reach bRineLy.'))
    expect(screen.getByText('Checkout')).toBeInTheDocument()

    // A reference the club refused as written is the player's to fix, so nothing else is asked.
    apiMock.myBooking.mockClear()
    apiMock.submitBookingPayment.mockRejectedValueOnce(new Error('Enter the GCash reference number: 6 to 30 letters or digits'))
    await user.click(screen.getByRole('button', { name: /I.ve paid/ }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Enter the GCash reference number'))
    expect(apiMock.myBooking).not.toHaveBeenCalled()
  })

  it.each([
    ['the reply to “I’ve paid” is lost', 'Could not reach bRineLy. Check your connection and try again.'],
    ['the payment was sent before', 'You already sent a payment for this booking'],
  ])('waits for the club when %s but the club has the payment', async (_, message) => {
    const user = userEvent.setup()
    apiMock.submitBookingPayment.mockRejectedValueOnce(new Error(message))
    render(<MemoryRouter><MemberBook /></MemoryRouter>)
    await user.click(await screen.findByRole('button', { name: /^12:00/ }))
    await user.click(screen.getByRole('button', { name: /Continue/ }))
    await user.type(await screen.findByLabelText('GCash reference number'), REFERENCE)
    await user.click(screen.getByRole('button', { name: /I.ve paid/ }))

    expect(await screen.findByRole('heading', { name: 'Waiting for the club to confirm' })).toBeInTheDocument()
    expect(apiMock.myBooking).toHaveBeenCalledWith(booking.id)
    expect(screen.queryByText(message)).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText(REFERENCE)).toBeInTheDocument()
    expect(screen.getByRole('timer', { name: /left for the club to confirm/ })).toBeInTheDocument()
  })

  it('keeps the hours held after a payment is sent, even once the club is late', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      render(<MemoryRouter><MemberBook /></MemoryRouter>)
      await user.click(await screen.findByRole('button', { name: /^12:00/ }))
      await user.click(screen.getByRole('button', { name: /Continue/ }))
      await user.type(await screen.findByLabelText('GCash reference number'), REFERENCE)
      await user.click(screen.getByRole('button', { name: /I.ve paid/ }))
      await screen.findByRole('heading', { name: 'Waiting for the club to confirm' })

      // Past both the 15 minutes to pay and the club's 15 minutes to check.
      await act(async () => { await vi.advanceTimersByTimeAsync(16 * 60000) })
      expect(screen.getByText('The club is taking longer than usual.')).toBeInTheDocument()
      expect(screen.getByText(/Your hours stay held for you, so you do not need to pay again/)).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Waiting for the club to confirm' })).toBeInTheDocument()
      expect(apiMock.releaseBookingHold).not.toHaveBeenCalled()
      expect(screen.queryByText(/ran out/)).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('goes back to the times with a notice when the club did not receive the payment', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      render(<MemoryRouter><MemberBook /></MemoryRouter>)
      await user.click(await screen.findByRole('button', { name: /^12:00/ }))
      await user.click(screen.getByRole('button', { name: /Continue/ }))
      await user.type(await screen.findByLabelText('GCash reference number'), REFERENCE)
      await user.click(screen.getByRole('button', { name: /I.ve paid/ }))
      await screen.findByRole('heading', { name: 'Waiting for the club to confirm' })

      apiMock.myBooking.mockResolvedValue({ ...sentBooking(), status: 'cancelled' })
      await act(async () => { await vi.advanceTimersByTimeAsync(15000) })
      // The club's reason is in the player's notifications; the notice does not guess it.
      expect(await screen.findByRole('alert')).toHaveTextContent(
        `The club did not confirm your payment with reference ${REFERENCE}, so those hours were released. ` +
          'Check your notifications for the club’s reason.',
      )
      expect(screen.queryByText(/did not receive/)).not.toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Open your notifications' })).toHaveAttribute('href', '/member/notifications')
      expect(screen.getByText(/Available times/)).toBeInTheDocument()
      expect(await screen.findByText('Tap the hours you want')).toBeInTheDocument()
      expect(screen.queryByText('Booking confirmed')).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not start a checkout when the club has no GCash payment set up', async () => {
    apiMock.checkoutPaymentMethods.mockResolvedValue([])
    const user = userEvent.setup()
    render(<MemoryRouter><MemberBook /></MemoryRouter>)
    expect(await screen.findByText("This club hasn't set up GCash payment yet. Ask the desk to reserve.")).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^12:00/ }))
    expect(screen.queryByRole('button', { name: /Continue/ })).not.toBeInTheDocument()
    expect(apiMock.createBooking).not.toHaveBeenCalled()
  })

  it('offers to try again when the club payment details do not load', async () => {
    apiMock.checkoutPaymentMethods.mockRejectedValueOnce(new Error('offline'))
    const user = userEvent.setup()
    render(<MemoryRouter><MemberBook /></MemoryRouter>)
    expect(await screen.findByRole('alert')).toHaveTextContent('We could not load how to pay this club.')
    expect(screen.queryByRole('button', { name: /Continue/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('button', { name: /Continue/ })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('says where each of the player’s bookings stands in plain words', async () => {
    apiMock.myBookings.mockResolvedValue([
      { ...heldBooking(10), id: 'held' },
      { ...sentBooking(), id: 'sent' },
      { ...booking, id: 'paid', payment_ref: null, payment_reference: '9876543210' },
      // Made at the desk: no hold time, paid at the desk, so nothing to continue here.
      { ...booking, id: 'desk', status: 'pending_payment', payment_ref: null },
    ])
    render(<MemoryRouter><MemberBook /></MemoryRouter>)
    expect(await screen.findAllByText('Waiting for payment')).toHaveLength(2)
    expect(screen.getByText('Waiting for the club to confirm')).toBeInTheDocument()
    expect(screen.getByText('Booked')).toBeInTheDocument()
    expect(screen.getByText(/Ref 9876543210/)).toBeInTheDocument()
    // Only the online checkouts left open can be picked up again.
    expect(screen.getAllByRole('button', { name: 'Continue to pay' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Check status' })).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Continue to pay' })).toHaveClass('btn-primary')
  })

  it('reopens an unpaid checkout from Your bookings with the time it has left', async () => {
    const user = userEvent.setup()
    const held = { ...heldBooking(10), id: 'held' }
    apiMock.myBookings.mockResolvedValue([held])
    apiMock.myBooking.mockResolvedValue(held)
    render(<MemoryRouter><MemberBook /></MemoryRouter>)
    // A pick in the grid has nothing to do with the checkout being reopened.
    await user.click(await screen.findByRole('button', { name: /^12:00/ }))
    await user.click(screen.getByRole('button', { name: 'Continue to pay' }))

    expect(await screen.findByText('Checkout')).toBeInTheDocument()
    expect(apiMock.myBooking).toHaveBeenCalledWith('held')
    expect(apiMock.createBooking).not.toHaveBeenCalled()
    expect(screen.getByRole('timer').textContent).toMatch(/^(9|10):\d\d$/)
    expect(screen.queryByRole('button', { name: 'Continue to pay' })).not.toBeInTheDocument()

    await user.type(screen.getByLabelText('GCash reference number'), REFERENCE)
    await user.click(screen.getByRole('button', { name: /I.ve paid/ }))
    expect(apiMock.submitBookingPayment).toHaveBeenCalledWith({ booking_id: 'held', reference: REFERENCE })
    expect(await screen.findByRole('heading', { name: 'Waiting for the club to confirm' })).toBeInTheDocument()
  })

  it('says plainly when a checkout in Your bookings is no longer held', async () => {
    const user = userEvent.setup()
    const held = { ...heldBooking(10), id: 'held' }
    apiMock.myBookings.mockResolvedValue([held])
    // A newer hold gave these hours back since the list was loaded.
    apiMock.myBooking.mockResolvedValue({ ...held, status: 'cancelled' })
    render(<MemoryRouter><MemberBook /></MemoryRouter>)
    await user.click(await screen.findByRole('button', { name: 'Continue to pay' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Those hours are no longer held for you, so there is nothing to pay.')
    expect(screen.queryByText('Checkout')).not.toBeInTheDocument()
  })

  it('opens the waiting screen for a sent payment from Your bookings', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const sent = { ...sentBooking(), id: 'sent' }
      apiMock.myBookings.mockResolvedValue([sent])
      apiMock.myBooking.mockResolvedValue(sent)
      // The receipt email fails: the booking still shows as confirmed.
      apiMock.sendBookingConfirmationEmail.mockRejectedValueOnce(new Error('Email service down'))
      render(<MemoryRouter><MemberBook /></MemoryRouter>)
      await user.click(await screen.findByRole('button', { name: 'Check status' }))

      expect(await screen.findByRole('heading', { name: 'Waiting for the club to confirm' })).toBeInTheDocument()
      expect(screen.getByText(REFERENCE)).toBeInTheDocument()
      expect(screen.getByRole('timer', { name: /left for the club to confirm/ })).toBeInTheDocument()
      expect(apiMock.myBooking).toHaveBeenCalledWith('sent')
      expect(apiMock.createBooking).not.toHaveBeenCalled()

      apiMock.myBooking.mockResolvedValue({ ...sent, status: 'confirmed' })
      await act(async () => { await vi.advanceTimersByTimeAsync(15000) })
      expect(await screen.findByText('Booking confirmed')).toBeInTheDocument()
      await waitFor(() => expect(apiMock.sendBookingConfirmationEmail).toHaveBeenCalledTimes(1))
      expect(screen.queryByText(RECEIPT)).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Book another' }))
      expect(screen.getByText(/Available times/)).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('reflects a confirmed 2h booking as booked for 2 hours (no refund), emails the receipt once, without redundant refetches', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const { start_at, end_at } = localRangeISO(tomorrowPh(), 12, 2)
      const twoHourBooking: Booking = {
        id: 'bk_2h',
        court_id: court.id,
        member_id: member.id,
        start_at,
        end_at,
        hours: 2,
        amount: 1000,
        status: 'confirmed',
        payment_method: 'gcash',
        payment_ref: null,
        payment_reference: REFERENCE,
        created_at: new Date().toISOString(),
        court,
        member,
      }
      const held: Booking = {
        ...twoHourBooking,
        status: 'pending_payment',
        payment_method: null,
        payment_reference: null,
        hold_expires_at: new Date(Date.now() + 15 * 60000).toISOString(),
      }
      const sent: Booking = { ...held, payment_reference: REFERENCE, payment_submitted_at: new Date().toISOString() }
      apiMock.createBooking.mockResolvedValueOnce(held)
      apiMock.submitBookingPayment.mockResolvedValueOnce(sent)
      apiMock.myBooking.mockResolvedValue(sent)

      render(<MemoryRouter><MemberBook /></MemoryRouter>)
      expect(await screen.findByText(/Available times/)).toBeInTheDocument()

      // Tomorrow, 2 hours from 12:00 PM.
      await user.click(screen.getByRole('button', { name: 'Tomorrow' }))
      await user.click(await screen.findByRole('button', { name: /^12:00 PM/ }))
      await user.click(screen.getByRole('button', { name: /^1:00 PM/ }))
      expect(screen.getByText('12:00 PM – 2:00 PM · 2 hours')).toBeInTheDocument()
      expect(screen.getByText('No refund once booked.')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: /Continue/ }))
      expect(apiMock.createBooking).toHaveBeenCalledWith(expect.objectContaining({ dateYmd: tomorrowPh(), startHour: 12, hours: 2 }))
      await user.type(await screen.findByLabelText('GCash reference number'), REFERENCE)
      await user.click(screen.getByRole('button', { name: /I.ve paid/ }))
      await screen.findByRole('heading', { name: 'Waiting for the club to confirm' })
      // Nothing is emailed while the club is still checking the payment.
      expect(apiMock.sendBookingConfirmationEmail).not.toHaveBeenCalled()

      apiMock.myBooking.mockResolvedValue(twoHourBooking)
      await act(async () => { await vi.advanceTimersByTimeAsync(15000) })
      expect(await screen.findByText('Booking confirmed')).toBeInTheDocument()
      expect(screen.getByText('Booked · 2 hours')).toBeInTheDocument()
      expect(screen.getByText(/These 2 hours now show as Booked\.\s+No refunds\./)).toBeInTheDocument()
      expect(await screen.findByText(RECEIPT)).toBeInTheDocument()
      expect(apiMock.sendBookingConfirmationEmail).toHaveBeenCalledTimes(1)
      expect(apiMock.sendBookingConfirmationEmail).toHaveBeenCalledWith(expect.objectContaining({
        // The receipt carries the GCash reference the player sent.
        booking: expect.objectContaining({ id: twoHourBooking.id, hours: 2, payment_ref: REFERENCE }),
        recipientEmail: memberUser.email,
        venueName: venue.name,
      }))

      const availCallsBeforeReturn = apiMock.availability.mock.calls.length
      const memberCallsBeforeReturn = apiMock.memberForUser.mock.calls.length
      const myBookingsCallsBeforeReturn = apiMock.myBookings.mock.calls.length

      await user.click(screen.getByRole('button', { name: 'Book another' }))
      expect(screen.getByText('Your bookings')).toBeInTheDocument()
      expect(screen.getByText('All bookings are non-refundable')).toBeInTheDocument()
      expect(screen.getAllByText('No refund').length).toBeGreaterThan(0)
      // Both hours of the player's own booking say so, and cannot be picked again.
      expect(screen.getAllByText('Booked · yours')).toHaveLength(2)
      expect(screen.queryByRole('button', { name: /^12:00 PM/ })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /^1:00 PM/ })).not.toBeInTheDocument()

      // Switching back to Today uses cached availability and does not re-fetch user/bookings
      await user.click(screen.getByRole('button', { name: 'Today' }))
      expect(apiMock.availability).toHaveBeenCalledTimes(availCallsBeforeReturn)
      expect(apiMock.memberForUser).toHaveBeenCalledTimes(memberCallsBeforeReturn)
      expect(apiMock.myBookings).toHaveBeenCalledTimes(myBookingsCallsBeforeReturn)

      // The email went once: later ticks do not send it again.
      await act(async () => { await vi.advanceTimersByTimeAsync(30000) })
      expect(apiMock.sendBookingConfirmationEmail).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('marks the player’s own booked and held hours in the grid, so they are not offered again', async () => {
    const user = userEvent.setup()
    const day = tomorrowPh()
    apiMock.myBookings.mockResolvedValue([
      { ...booking, id: 'own-paid', ...localRangeISO(day, 10, 1), hours: 1 },
      { ...heldBooking(10), id: 'own-held', ...localRangeISO(day, 15, 2), hours: 2 },
    ])
    render(<MemoryRouter><MemberBook /></MemoryRouter>)
    await user.click(await screen.findByRole('button', { name: 'Tomorrow' }))

    expect(await screen.findAllByText('Booked · yours')).toHaveLength(1)
    expect(screen.getAllByText('Held for you')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: /^10:00 AM/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^3:00 PM/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^4:00 PM/ })).not.toBeInTheDocument()

    // Hours right before the player's own are still free to tap on their own.
    expect(screen.getByRole('button', { name: /^9:00 AM/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^2:00 PM/ })).toBeInTheDocument()
    expect(screen.queryByText(/Only \dh free/)).not.toBeInTheDocument()
  })

  it('lets a visitor pick a time on a club page and holds the hours only after they sign in, then takes the GCash payment', async () => {
    authState.user = null
    authState.signIn.mockImplementation(async () => {
      signInAs(memberUser)
      return memberUser
    })
    // The club confirms at its first check, so the booking shows straight away.
    apiMock.myBooking.mockResolvedValue({ ...booking, payment_ref: null, payment_reference: REFERENCE })
    const user = userEvent.setup()
    renderClubBooking()

    expect(await screen.findByRole('heading', { level: 1, name: 'Book at Rally Point Davao' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Back to Rally Point Davao/ })).toHaveAttribute('href', `/clubs/${davaoClub.slug}`)
    await user.click(screen.getByRole('button', { name: 'Tomorrow' }))
    await user.click(await screen.findByRole('button', { name: /^12:00 PM/ }))
    // Visitors see the club's public times; nothing of a player's is read yet.
    expect(apiMock.publicClubAvailability).toHaveBeenCalledWith(davaoClub.slug, tomorrowPh(), venue.id)
    expect(apiMock.availability).not.toHaveBeenCalled()
    expect(apiMock.memberForUser).not.toHaveBeenCalled()
    expect(apiMock.checkoutPaymentMethods).not.toHaveBeenCalled()
    expect(screen.getByText('You log in before you pay. The 15 minutes to pay start after that.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Continue/ }))
    const dialog = await screen.findByRole('dialog', { name: /^Log in to book/ })
    expect(within(dialog).getByText('By continuing, you confirm you are booking under your account.')).toBeInTheDocument()
    // No hold yet: the 15 minutes start only once the visitor has signed in.
    expect(apiMock.createBooking).not.toHaveBeenCalled()
    expect(authState.joinClub).not.toHaveBeenCalled()
    expect(JSON.parse(sessionStorage.getItem(BOOKING_INTENT_KEY) ?? 'null')).toMatchObject({
      clubSlug: davaoClub.slug,
      venueId: venue.id,
      courtId: court.id,
      dateYmd: tomorrowPh(),
      startHour: 12,
      hours: 1,
      autoCheckout: true,
    })

    await user.type(within(dialog).getByLabelText('Email'), memberUser.email)
    await user.type(within(dialog).getByLabelText('Password'), 'secret123')
    const submit = within(dialog).getAllByRole('button', { name: 'Log in' })
      .find((button) => button.getAttribute('type') === 'submit')
    if (!submit) throw new Error('Could not find the log in button')
    await user.click(submit)

    // Signed in: the player joins the club as a player, then the picked hours are held.
    expect(await screen.findByText('Checkout')).toBeInTheDocument()
    expect(authState.joinClub).toHaveBeenCalledWith(davaoClub.slug, { asPlayer: true })
    expect(apiMock.createBooking).toHaveBeenCalledTimes(1)
    expect(apiMock.createBooking).toHaveBeenCalledWith(expect.objectContaining({
      court_id: court.id,
      dateYmd: tomorrowPh(),
      startHour: 12,
      hours: 1,
      member_id: member.id,
      user_id: memberUser.id,
    }))
    expect(screen.getByText('Time left to pay')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'GCash QR code to pay Rally Point Gensan' })).toBeInTheDocument()
    expect(sessionStorage.getItem(BOOKING_INTENT_KEY)).toBeNull()

    await user.type(screen.getByLabelText('GCash reference number'), REFERENCE)
    await user.click(screen.getByRole('button', { name: /I.ve paid/ }))
    expect(await screen.findByText('Booking confirmed')).toBeInTheDocument()
    expect(await screen.findByText(RECEIPT)).toBeInTheDocument()
    expect(apiMock.sendBookingConfirmationEmail).toHaveBeenCalledTimes(1)
    expect(apiMock.sendBookingConfirmationEmail).toHaveBeenCalledWith(expect.objectContaining({
      clubName: 'Rally Point Davao',
      recipientEmail: memberUser.email,
    }))
  })

  it('carries on into checkout with the saved pick when the screen reloads after signing in', async () => {
    authState.user = memberUser
    authState.activeClub = davaoClub
    sessionStorage.setItem(BOOKING_INTENT_KEY, JSON.stringify({
      clubSlug: davaoClub.slug,
      venueId: venue.id,
      courtId: court.id,
      dateYmd: tomorrowPh(),
      startHour: 15,
      hours: 2,
      autoCheckout: true,
    }))
    const first = renderClubBooking(`/clubs/${davaoClub.slug}/book`)

    expect(await screen.findByText('Checkout')).toBeInTheDocument()
    expect(apiMock.createBooking).toHaveBeenCalledTimes(1)
    expect(apiMock.createBooking).toHaveBeenCalledWith(expect.objectContaining({
      court_id: court.id,
      venue_id: venue.id,
      dateYmd: tomorrowPh(),
      startHour: 15,
      hours: 2,
      user_id: memberUser.id,
    }))
    expect(screen.getByText('Time left to pay')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Book at Rally Point Davao' })).toBeInTheDocument()
    // Already in this club: no joining again, and the player's own times are used.
    expect(authState.joinClub).not.toHaveBeenCalled()
    expect(apiMock.publicClubAvailability).not.toHaveBeenCalled()
    expect(sessionStorage.getItem(BOOKING_INTENT_KEY)).toBeNull()
    first.unmount()

    // A pick saved for a day the screen no longer offers is not carried on.
    apiMock.createBooking.mockClear()
    sessionStorage.setItem(BOOKING_INTENT_KEY, JSON.stringify({
      clubSlug: davaoClub.slug,
      venueId: venue.id,
      courtId: court.id,
      dateYmd: '2020-01-01',
      startHour: 15,
      hours: 2,
      autoCheckout: true,
    }))
    renderClubBooking(`/clubs/${davaoClub.slug}/book`)
    expect(await screen.findByText('Tap the hours you want')).toBeInTheDocument()
    expect(apiMock.createBooking).not.toHaveBeenCalled()
  })

  it('does not let a platform superadmin book from a club page', async () => {
    authState.user = { ...adminUser, id: 'user_platform', role: 'superadmin' }
    const user = userEvent.setup()
    renderClubBooking()
    await user.click(await screen.findByRole('button', { name: /^12:00 PM/ }))
    await user.click(screen.getByRole('button', { name: /Continue/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Only player accounts can book courts online.')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(apiMock.createBooking).not.toHaveBeenCalled()
    expect(authState.joinClub).not.toHaveBeenCalled()
    expect(apiMock.checkoutPaymentMethods).not.toHaveBeenCalled()
  })

  it('charges an active member the member rate and shows players what members pay', async () => {
    const slots = Array.from({ length: 16 }, (_, index) => ({ startHour: index + 6, label: `${index + 6}:00`, available: true }))
    const discounted: Court = { ...court, member_rate: 400 }
    apiMock.availability.mockResolvedValue([{ court: discounted, slots }])
    const first = render(<MemoryRouter><MemberBook /></MemoryRouter>)
    expect(await screen.findByRole('button', { name: /Court B/ })).toHaveTextContent('Php 400.00/hr')
    expect(screen.getByText(/You pay the member rate/)).toBeInTheDocument()
    first.unmount()

    apiMock.memberForUser.mockResolvedValue({ ...member, membership_type: null, expiry_date: null })
    render(<MemoryRouter><MemberBook /></MemoryRouter>)
    const courtButton = await screen.findByRole('button', { name: /Court B/ })
    expect(courtButton).toHaveTextContent('Php 500.00/hr')
    expect(courtButton).toHaveTextContent('Members Php 400.00/hr')
    expect(screen.getByRole('link', { name: 'Book at another club' })).toHaveAttribute('href', '/clubs')
  })

  it('shows an out-of-service court as unavailable and starts on a bookable court', async () => {
    const slots = Array.from({ length: 16 }, (_, index) => ({ startHour: index + 6, label: `${index + 6}:00`, available: true }))
    const closed: Court = { ...court, id: 'court_closed', name: 'Court Z', status: 'maintenance' }
    apiMock.availability.mockResolvedValueOnce([
      { court: closed, slots: slots.map((slot) => ({ ...slot, available: false })) },
      { court, slots },
    ])
    render(<MemoryRouter><MemberBook /></MemoryRouter>)

    const closedButton = await screen.findByRole('button', { name: /Court Z/ })
    expect(closedButton).toBeDisabled()
    expect(closedButton).toHaveTextContent('Out of service')
    expect(screen.getByRole('button', { name: /12:00/ })).toBeEnabled()
  })

  it('shows every hour of a booking as Booked, selects the whole length, and says there are no refunds', async () => {
    const user = userEvent.setup()
    const slots: TimeSlot[] = Array.from({ length: 16 }, (_, index) => ({ startHour: index + 6, label: `${index + 6}:00`, available: true }))
    // 9 AM is over; someone has 2 PM to 4 PM.
    slots[3] = { ...slots[3], available: false, blocked: 'passed' }
    slots[8] = { ...slots[8], available: false, blocked: 'booked' }
    slots[9] = { ...slots[9], available: false, blocked: 'booked' }
    apiMock.availability.mockResolvedValue([{ court, slots }])
    // No bookings of their own, so every "Booked" here is an hour of the grid.
    apiMock.myBookings.mockResolvedValue([])
    render(<MemoryRouter><MemberBook /></MemoryRouter>)

    expect(await screen.findAllByText('Booked')).toHaveLength(2)
    expect(screen.getByText('Passed')).toBeInTheDocument()
    // Taken and past hours are plain text, not buttons.
    expect(screen.queryByRole('button', { name: /^2:00 PM/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^3:00 PM/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^9:00 AM/ })).not.toBeInTheDocument()

    // 1 PM is free on its own, but the booked 2 PM is plain text, so the pick cannot run into it.
    await user.click(screen.getByRole('button', { name: /^1:00 PM/ }))
    expect(screen.getByText('1:00 PM – 2:00 PM · 1 hour')).toBeInTheDocument()
    expect(screen.queryByText(/Only \dh free/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^4:00 PM/ }))
    await user.click(screen.getByRole('button', { name: /^5:00 PM/ }))
    expect(screen.getByText('4:00 PM – 6:00 PM · 2 hours')).toBeInTheDocument()
    expect(screen.getAllByText('Selected')).toHaveLength(2)

    await user.click(screen.getByRole('button', { name: /Continue/ }))
    expect(apiMock.createBooking).toHaveBeenCalledWith(expect.objectContaining({ startHour: 16, hours: 2 }))
    expect(await screen.findByText(/Bookings cannot be cancelled or refunded/)).toBeInTheDocument()
    expect(screen.getByText(/No refunds\./)).toBeInTheDocument()
  })

  it('counts down 15 minutes to pay, then releases the hours and goes back to the times', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      // By this phone's clock, which runs 10 minutes fast, the server's hold ends in 5 minutes.
      // The phone still counts the full 15 from when the hold came back.
      apiMock.createBooking.mockResolvedValue(heldBooking(5))
      // Nothing was sent, so the hours are let go when the time runs out.
      apiMock.myBooking.mockResolvedValue({ ...heldBooking(5), status: 'cancelled' })
      render(<MemoryRouter><MemberBook /></MemoryRouter>)
      await user.click(await screen.findByRole('button', { name: /^12:00/ }))
      await user.click(screen.getByRole('button', { name: /Continue/ }))

      expect(await screen.findByText('Time left to pay')).toBeInTheDocument()
      expect(screen.getByRole('timer').textContent).toMatch(/^1[45]:\d\d$/)

      await act(async () => { await vi.advanceTimersByTimeAsync(14 * 60000) })
      expect(screen.getByRole('timer').textContent).toMatch(/^[01]:\d\d$/)
      expect(apiMock.releaseBookingHold).not.toHaveBeenCalled()

      await act(async () => { await vi.advanceTimersByTimeAsync(60000) })
      expect(await screen.findByRole('alert')).toHaveTextContent('Your 15 minutes to pay ran out')
      expect(apiMock.myBooking).toHaveBeenCalledWith(booking.id)
      expect(apiMock.releaseBookingHold).toHaveBeenCalledWith(booking.id)
      expect(screen.queryByText('Checkout')).not.toBeInTheDocument()
      expect(apiMock.submitBookingPayment).not.toHaveBeenCalled()
      // The old pick is gone, so "Pick a time again" means it.
      expect(await screen.findByText('Tap the hours you want')).toBeInTheDocument()
      expect(screen.queryByText('Selected')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Continue/ })).toBeDisabled()
      // The notice goes once the player starts choosing again.
      await user.click(screen.getByRole('button', { name: /^12:00 PM/ }))
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('waits for the club instead when the time to pay runs out after the club got the payment', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      // The reply to "I've paid" is lost and the check after it fails too, so the checkout stays open.
      apiMock.submitBookingPayment.mockRejectedValueOnce(new Error('Could not reach bRineLy. Check your connection and try again.'))
      apiMock.myBooking.mockRejectedValueOnce(new Error('offline'))
      render(<MemoryRouter><MemberBook /></MemoryRouter>)
      await user.click(await screen.findByRole('button', { name: /^12:00/ }))
      await user.click(screen.getByRole('button', { name: /Continue/ }))
      await user.type(await screen.findByLabelText('GCash reference number'), REFERENCE)
      await user.click(screen.getByRole('button', { name: /I.ve paid/ }))
      expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach bRineLy.')

      // When the 15 minutes run out, the club has the payment after all.
      apiMock.myBooking.mockResolvedValue(sentBooking())
      await act(async () => { await vi.advanceTimersByTimeAsync(15 * 60000) })
      expect(await screen.findByRole('heading', { name: 'Waiting for the club to confirm' })).toBeInTheDocument()
      expect(apiMock.releaseBookingHold).not.toHaveBeenCalled()
      expect(screen.queryByText(/ran out/)).not.toBeInTheDocument()
      expect(screen.getByText(REFERENCE)).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('still lets the hours go when the time runs out and the booking cannot be checked', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      apiMock.myBooking.mockRejectedValue(new Error('offline'))
      render(<MemoryRouter><MemberBook /></MemoryRouter>)
      await user.click(await screen.findByRole('button', { name: /^12:00/ }))
      await user.click(screen.getByRole('button', { name: /Continue/ }))
      await screen.findByText('Time left to pay')

      await act(async () => { await vi.advanceTimersByTimeAsync(15 * 60000) })
      expect(await screen.findByRole('alert')).toHaveTextContent('Your 15 minutes to pay ran out')
      expect(apiMock.releaseBookingHold).toHaveBeenCalledWith(booking.id)
    } finally {
      vi.useRealTimers()
    }
  })

  it('releases the held hours at once on Change time when no reference was typed', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><MemberBook /></MemoryRouter>)
    await user.click(await screen.findByRole('button', { name: /^12:00/ }))
    await user.click(screen.getByRole('button', { name: /Continue/ }))
    await screen.findByText('Checkout')

    await user.click(screen.getByRole('button', { name: /Change time/ }))
    expect(apiMock.releaseBookingHold).toHaveBeenCalledWith(booking.id)
    expect(await screen.findByText(/Available times/)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('renders a member QR pass and the no-club state', async () => {
    apiMock.myMemberPasses.mockResolvedValueOnce([{
      club_id: 'club-gensan', club_slug: 'gensan', club_name: 'Rally Point Gensan', member_id: member.id,
      member_code: 'RP-1001', full_name: member.full_name, membership_type: 'standard', status: 'active',
      expiry_date: '2099-12-31', is_active_member: true, qr_token: 'token-1', request: null,
    }])
    const first = render(<MemoryRouter><MemberPass /></MemoryRouter>)
    expect(await screen.findByRole('img', { name: 'Check-in QR code for Rally Point Gensan' })).toBeInTheDocument()
    expect(screen.getByText('RP-1001')).toBeInTheDocument()
    first.unmount()
    apiMock.myMemberPasses.mockResolvedValueOnce([])
    render(<MemoryRouter><MemberPass /></MemoryRouter>)
    expect(await screen.findByText(/You have no club pass yet/)).toBeInTheDocument()
  })
})

describe('schedule and booking desk pages', () => {
  it('renders the schedule list, refreshes, changes dates, and supports TV mode', async () => {
    const user = userEvent.setup()
    const schedule = render(<MemoryRouter><ScheduleBoard role="admin" /></MemoryRouter>)
    expect((await screen.findAllByText('Mia Member')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Open play').length).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: /Refresh/ }))
    expect(apiMock.daySchedule).toHaveBeenCalledTimes(3)
    const dateInput = screen.getByDisplayValue(/^\d{4}-\d{2}-\d{2}$/)
    const nextDate = tomorrowYmd()
    await user.clear(dateInput)
    await user.type(dateInput, nextDate)
    expect(apiMock.daySchedule).toHaveBeenCalledWith(nextDate, venue.id)
    const { unmount } = render(<MemoryRouter><TvBoard /></MemoryRouter>)
    expect(await screen.findByText(/Live board/)).toBeInTheDocument()
    unmount()
    schedule.unmount()
    render(<MemoryRouter><AdminBoard /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Schedule board' })).toBeInTheDocument()
  })

  it('renders booking rows and an adapter error state', async () => {
    const first = render(<MemoryRouter><BookingsDesk role="admin" /></MemoryRouter>)
    expect(await screen.findByText(/Court B/)).toBeInTheDocument()
    expect(screen.getByText('GCASH-REF')).toBeInTheDocument()
    first.unmount()
    apiMock.listBookings.mockRejectedValueOnce(new Error('Bookings unavailable'))
    const error = render(<MemoryRouter><BookingsDesk role="admin" /></MemoryRouter>)
    expect(await screen.findByText('Bookings unavailable')).toBeInTheDocument()
    error.unmount()
    apiMock.listBookings.mockResolvedValueOnce([booking])
    render(<MemoryRouter><AdminBookings /></MemoryRouter>)
    expect(await screen.findByText('Online bookings')).toBeInTheDocument()
  })

  it('waits for venue access before making one venue-scoped booking request', async () => {
    const venueRequest = deferred<Venue[]>()
    const bookingRequest = deferred<Booking[]>()
    apiMock.listVenues.mockReturnValue(venueRequest.promise)
    apiMock.listBookings.mockReturnValue(bookingRequest.promise)

    render(<MemoryRouter><BookingsDesk role="staff" /></MemoryRouter>)
    expect(apiMock.listBookings).not.toHaveBeenCalled()

    await act(async () => venueRequest.resolve([venue]))
    await waitFor(() => expect(apiMock.listBookings).toHaveBeenCalledTimes(1))
    expect(apiMock.listBookings).toHaveBeenCalledWith(venue.id)
    expect(screen.queryByText('No online bookings yet.')).not.toBeInTheDocument()

    await act(async () => bookingRequest.resolve([booking]))
    expect(await screen.findByText('GCASH-REF')).toBeInTheDocument()
  })

  it('keeps the selected venue result when an older booking request fails later', async () => {
    const user = userEvent.setup()
    const secondVenue = { ...venue, id: 'venue-second', name: 'Rally Point Lagao' }
    const firstRequest = deferred<Booking[]>()
    const secondRequest = deferred<Booking[]>()
    const secondBooking = { ...booking, id: 'booking-second', court: { ...court, name: 'Court C' } }
    apiMock.listVenues.mockResolvedValue([venue, secondVenue])
    apiMock.listBookings.mockImplementation((id: string) => id === venue.id ? firstRequest.promise : secondRequest.promise)

    render(<MemoryRouter><BookingsDesk role="staff" /></MemoryRouter>)
    const selector = await screen.findByRole('combobox', { name: 'Venue' })
    await waitFor(() => expect(apiMock.listBookings).toHaveBeenCalledWith(venue.id))
    await user.selectOptions(selector, secondVenue.id)
    await waitFor(() => expect(apiMock.listBookings).toHaveBeenCalledWith(secondVenue.id))
    await act(async () => secondRequest.resolve([secondBooking]))
    expect(await screen.findByText(/Court C/)).toBeInTheDocument()

    await act(async () => firstRequest.reject(new Error('Old venue unavailable')))
    expect(screen.getByText(/Court C/)).toBeInTheDocument()
    expect(screen.queryByText('Old venue unavailable')).not.toBeInTheDocument()
  })

  it('clears a failed venue load after switching to a successful venue', async () => {
    const user = userEvent.setup()
    const secondVenue = { ...venue, id: 'venue-second', name: 'Rally Point Lagao' }
    apiMock.listVenues.mockResolvedValue([venue, secondVenue])
    apiMock.listBookings.mockImplementation((id: string) => id === venue.id
      ? Promise.reject(new Error('Bookings unavailable'))
      : Promise.resolve([booking]))

    render(<MemoryRouter><BookingsDesk role="staff" /></MemoryRouter>)
    expect(await screen.findByText('Bookings unavailable')).toBeInTheDocument()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Venue' }), secondVenue.id)
    expect(await screen.findByText('GCASH-REF')).toBeInTheDocument()
    expect(screen.queryByText('Bookings unavailable')).not.toBeInTheDocument()
  })

  it('shows a fresh load when returning to a venue before its retry finishes', async () => {
    const user = userEvent.setup()
    const secondVenue = { ...venue, id: 'venue-second', name: 'Rally Point Lagao' }
    const secondVenueRequest = deferred<Booking[]>()
    const retryRequest = deferred<Booking[]>()
    let mainVenueCalls = 0
    apiMock.listVenues.mockResolvedValue([venue, secondVenue])
    apiMock.listBookings.mockImplementation((id: string) => {
      if (id === secondVenue.id) return secondVenueRequest.promise
      mainVenueCalls += 1
      return mainVenueCalls === 1 ? Promise.reject(new Error('Bookings unavailable')) : retryRequest.promise
    })

    render(<MemoryRouter><BookingsDesk role="staff" /></MemoryRouter>)
    expect(await screen.findByText('Bookings unavailable')).toBeInTheDocument()
    const selector = screen.getByRole('combobox', { name: 'Venue' })
    await user.selectOptions(selector, secondVenue.id)
    await waitFor(() => expect(apiMock.listBookings).toHaveBeenCalledWith(secondVenue.id))
    await user.selectOptions(selector, venue.id)
    await waitFor(() => expect(mainVenueCalls).toBe(2))
    expect(screen.queryByText('Bookings unavailable')).not.toBeInTheDocument()
    expect(screen.queryByText('No online bookings yet.')).not.toBeInTheDocument()

    await act(async () => retryRequest.resolve([booking]))
    expect(await screen.findByText('GCASH-REF')).toBeInTheDocument()
    expect(apiMock.listVenues).toHaveBeenCalledTimes(1)
    await act(async () => secondVenueRequest.resolve([]))
  })

  it('filters booking rows by accessible venue and covers empty and fallback fields', async () => {
    const user = userEvent.setup()
    const secondVenue = { ...venue, id: 'venue-second', slug: 'gensan-lagao', name: 'Rally Point Lagao' }
    const fallbackBooking: Booking = {
      ...booking,
      id: 'booking-fallback',
      status: 'pending_payment',
      payment_method: null,
      payment_ref: null,
      court: undefined,
      member: undefined,
    }
    apiMock.listVenues.mockResolvedValue([venue, secondVenue])
    apiMock.listBookings.mockResolvedValue([fallbackBooking])

    const view = render(<MemoryRouter><BookingsDesk role="staff" /></MemoryRouter>)
    expect(await screen.findByRole('combobox', { name: 'Venue' })).toHaveValue(venue.id)
    expect(await screen.findByText((_, element) => (
      element?.tagName === 'P'
      && element.textContent?.includes('Court') === true
      && element.textContent?.includes('Member') === true
    ))).toBeInTheDocument()
    // An unpaid desk booking (no online hold) reads in the desk's words.
    expect(screen.getByText('Unpaid · 1h')).toBeInTheDocument()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Venue' }), secondVenue.id)
    await waitFor(() => expect(apiMock.listBookings).toHaveBeenLastCalledWith(secondVenue.id))

    view.unmount()
    apiMock.listVenues.mockResolvedValue([])
    apiMock.listBookings.mockResolvedValue([])
    apiMock.listBookings.mockClear()
    render(<MemoryRouter><BookingsDesk role="staff" /></MemoryRouter>)
    expect(await screen.findByText('No online bookings yet.')).toBeInTheDocument()
    expect(apiMock.listBookings).not.toHaveBeenCalled()
  })

  it('puts payments to confirm for the selected venue at the top and reloads the list after a decision', async () => {
    const user = userEvent.setup()
    const secondVenue = { ...venue, id: 'venue-second', name: 'Rally Point Lagao' }
    apiMock.listVenues.mockResolvedValue([venue, secondVenue])
    apiMock.paymentsToConfirm.mockResolvedValueOnce([sentBooking()]).mockResolvedValue([])
    render(<MemoryRouter><BookingsDesk role="staff" /></MemoryRouter>)

    expect(await screen.findByRole('heading', { name: 'Payments to confirm' })).toBeInTheDocument()
    expect(await screen.findByText(REFERENCE)).toBeInTheDocument()
    expect(apiMock.paymentsToConfirm).toHaveBeenCalledWith(venue.id)
    await waitFor(() => expect(apiMock.listBookings).toHaveBeenCalledTimes(1))

    await user.click(screen.getByRole('button', { name: 'Payment received' }))
    expect(apiMock.confirmBookingPayment).toHaveBeenCalledWith(booking.id)
    expect(await screen.findByText('No payments waiting.')).toBeInTheDocument()
    await waitFor(() => expect(apiMock.listBookings).toHaveBeenCalledTimes(2))

    await user.selectOptions(screen.getByRole('combobox', { name: 'Venue' }), secondVenue.id)
    await waitFor(() => expect(apiMock.paymentsToConfirm).toHaveBeenLastCalledWith(secondVenue.id))
  })

  it('uses a safe booking error message for non-Error failures', async () => {
    apiMock.listVenues.mockRejectedValue('offline')
    render(<MemoryRouter><BookingsDesk role="admin" /></MemoryRouter>)
    expect(await screen.findByText('Could not load bookings')).toBeInTheDocument()
  })
})
