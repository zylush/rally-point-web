import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Booking, Court, CourtSession, Member, Profile, ScheduleBlock, Transaction, Venue } from '../types'
import { AdminHome, AdminMemberForm, AdminMembers, AdminOps, AdminTransactions, AdminUsers } from './admin'
import { MemberBook } from './MemberBook'
import { MemberPass } from './MemberPass'
import { AdminBoard, ScheduleBoard, TvBoard } from './ScheduleBoard'
import { AdminBookings, BookingsDesk } from './BookingsDesk'
import { ymdLocal } from '../types'

const authState = vi.hoisted(() => ({
  user: {
    id: 'user_admin',
    email: 'admin@rallypoint.local',
    full_name: 'Alex Admin',
    role: 'admin',
    phone: null,
    created_at: '2026-01-01T00:00:00.000Z',
  } as Profile,
}))
const adminUser = authState.user
const memberUser: Profile = {
  ...adminUser,
  id: 'user_member',
  email: 'member@rallypoint.local',
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
  payBooking: vi.fn(),
  ensureMemberQr: vi.fn(),
  daySchedule: vi.fn(),
  listBookings: vi.fn(),
  listVenues: vi.fn(),
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: authState.user,
    loading: false,
    demo: true,
    signIn: vi.fn(),
    signUpMember: vi.fn(),
    resetPassword: vi.fn(),
    signOut: vi.fn(),
    refresh: vi.fn(),
  }),
}))

vi.mock('../lib/api', () => ({ api: apiMock }))

const member: Member = {
  id: 'mem_001',
  user_id: 'user_member',
  member_code: 'RP-1001',
  full_name: 'Mia Member',
  email: 'member@rallypoint.local',
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
  apiMock.payBooking.mockResolvedValue(booking)
  apiMock.ensureMemberQr.mockResolvedValue(member)
  apiMock.daySchedule.mockResolvedValue(scheduleBlocks)
  apiMock.listBookings.mockResolvedValue([booking])
  apiMock.listVenues.mockResolvedValue([venue])
}

beforeEach(() => {
  authState.user = adminUser
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

  it('selects a court/time, checks out, and shows the confirmed booking', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><MemberBook /></MemoryRouter>)
    expect(await screen.findByText(/Available times/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Court B/ }))
    await user.click(screen.getByRole('button', { name: /12:00/ }))
    await user.click(screen.getByRole('button', { name: /Continue/ }))
    expect(await screen.findByText('Checkout')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Maya/ }))
    await user.click(screen.getByRole('button', { name: /Pay Php 500/ }))
    expect(await screen.findByText('Booking confirmed')).toBeInTheDocument()
    expect(apiMock.createBooking).toHaveBeenCalledWith(expect.objectContaining({ user_id: memberUser.id }))
    expect(apiMock.payBooking).toHaveBeenCalledWith(expect.objectContaining({ method: 'maya', user_id: memberUser.id }))
    await user.click(screen.getByRole('button', { name: 'Book another' }))
    expect(screen.getByText(/Available times/)).toBeInTheDocument()
  })

  it('renders a member QR pass and the no-membership state', async () => {
    const first = render(<MemoryRouter><MemberPass /></MemoryRouter>)
    expect(await screen.findByAltText('Check-in QR code')).toBeInTheDocument()
    expect(screen.getByText('RP-1001')).toBeInTheDocument()
    first.unmount()
    apiMock.memberForUser.mockResolvedValueOnce(null)
    render(<MemoryRouter><MemberPass /></MemoryRouter>)
    expect(await screen.findByText(/No membership linked/)).toBeInTheDocument()
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
    expect(screen.getByText(/pending payment/)).toBeInTheDocument()
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

  it('uses a safe booking error message for non-Error failures', async () => {
    apiMock.listVenues.mockRejectedValue('offline')
    render(<MemoryRouter><BookingsDesk role="admin" /></MemoryRouter>)
    expect(await screen.findByText('Could not load bookings')).toBeInTheDocument()
  })
})
