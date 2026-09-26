import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CourtSession, Member } from '../types'
import { StaffCheckIn, StaffCourts, StaffHome, StaffMembers } from './staff'

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: {
      id: 'u-staff',
      email: 'staff@rallypoint.local',
      full_name: 'Sam Staff',
      role: 'staff',
    },
    signOut: vi.fn(),
  }),
}))

vi.mock('../lib/api', () => ({
  api: {
    listVenues: vi.fn(),
    playingSessions: vi.fn(),
    recentCheckins: vi.fn(),
    listCourts: vi.fn(),
    listMembers: vi.fn(),
    memberRoster: vi.fn(),
    createRental: vi.fn(),
    extendSession: vi.fn(),
    endSession: vi.fn(),
    createWalkIn: vi.fn(),
    addMemberToSession: vi.fn(),
    checkIn: vi.fn(),
    checkInByQr: vi.fn(),
  },
}))

const { api } = await import('../lib/api')
const assignedVenueId = 'venue-assigned'
beforeEach(() => {
  vi.mocked(api.listVenues).mockResolvedValue([{
    id: assignedVenueId, club_id: 'rally', slug: 'assigned', name: 'Assigned venue',
    timezone: 'Asia/Manila', open_hour: 6, close_hour: 22, is_active: true,
  }])
})
const mia: Member = {
  id: 'mem_001', user_id: 'u-member-1', member_code: 'RP-1001', full_name: 'Mia Member',
  email: 'mia@example.com', phone: '09171234567', membership_type: 'standard', status: 'active',
  join_date: '2026-01-01', expiry_date: '2027-01-01', created_at: '2026-01-01T00:00:00.000Z',
}
const jonah: Member = {
  ...mia, id: 'mem_002', user_id: 'u-member-2', member_code: 'RP-1002',
  full_name: 'Jonah Cruz', email: 'jonah@example.com', phone: '09179876543', status: 'expired',
}

describe('StaffHome', () => {
  beforeEach(() => {
    vi.mocked(api.playingSessions).mockResolvedValue([
      {
        id: 'session-1',
        court_id: 'court_a',
        court: { id: 'court_a', name: 'Court A', status: 'occupied', hourly_rate: 500 },
        start_at: '2026-08-12T18:00:00.000Z',
        end_at: '2026-08-12T19:00:00.000Z',
        status: 'playing',
        amount: 500,
        players: [
          { id: 'p-1', full_name: 'Mia Member' },
          { id: 'p-2', full_name: 'Jonah Cruz' },
        ],
      },
    ])
    vi.mocked(api.recentCheckins).mockResolvedValue([])
  })

  it('shows all players attached to a court in the currently playing list', async () => {
    render(
      <MemoryRouter>
        <StaffHome />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Court A')).not.toBeNull()
    expect(screen.getByText(/Mia Member, Jonah Cruz/i)).not.toBeNull()
  })

  it('shows the empty floor and only the five latest check-ins', async () => {
    vi.mocked(api.playingSessions).mockResolvedValue([])
    vi.mocked(api.recentCheckins).mockResolvedValue(Array.from({ length: 6 }, (_, i) => ({
      id: `check-${i}`, member_id: mia.id, checked_in_at: '2026-08-12T18:00:00.000Z',
      member: { ...mia, full_name: `Player ${i}` },
    })))
    render(<MemoryRouter><StaffHome /></MemoryRouter>)

    expect(await screen.findByText('No active sessions.')).toBeInTheDocument()
    expect(screen.getByText('Player 4')).toBeInTheDocument()
    expect(screen.queryByText('Player 5')).not.toBeInTheDocument()
  })

  it('uses a member or guest name when a session has no players array', async () => {
    vi.mocked(api.playingSessions).mockResolvedValue([
      { id: 'member-session', court_id: 'a', start_at: '2026-08-12T18:00:00.000Z', end_at: '2026-08-12T19:00:00.000Z', status: 'playing', amount: 500, member: mia },
      { id: 'guest-session', court_id: 'b', start_at: '2026-08-12T18:00:00.000Z', end_at: '2026-08-12T19:00:00.000Z', status: 'playing', amount: 500, guest_name: 'Walk-in Guest' },
    ])
    render(<MemoryRouter><StaffHome /></MemoryRouter>)

    expect(await screen.findByText(/Mia Member.*ends/)).toBeInTheDocument()
    expect(screen.getByText(/Walk-in Guest.*ends/)).toBeInTheDocument()
  })
})

describe('StaffMembers', () => {
  it('searches the limited roster by name and code and shows membership status', async () => {
    const user = userEvent.setup()
    vi.mocked(api.memberRoster).mockResolvedValue([mia, jonah])
    render(<MemoryRouter><StaffMembers /></MemoryRouter>)
    const search = screen.getByRole('searchbox', { name: 'Search members' })
    expect(await screen.findByText('Mia Member')).toBeInTheDocument()
    expect(screen.getByText('expired')).toBeInTheDocument()

    for (const [term, visible, hidden] of [
      ['mia', 'Mia Member', 'Jonah Cruz'],
      ['RP-1002', 'Jonah Cruz', 'Mia Member'],
    ]) {
      await user.clear(search)
      await user.type(search, term)
      expect(screen.getByText(visible)).toBeInTheDocument()
      expect(screen.queryByText(hidden)).not.toBeInTheDocument()
    }
    await user.clear(search)
    await user.type(search, '09171234567')
    expect(screen.queryByText('Mia Member')).not.toBeInTheDocument()
    await user.clear(search)
    await user.type(search, 'JONAH@EXAMPLE.COM')
    expect(screen.queryByText('Jonah Cruz')).not.toBeInTheDocument()
  })
})

describe('StaffCheckIn', () => {
  beforeEach(() => {
    vi.mocked(api.memberRoster).mockResolvedValue([mia, jonah])
    vi.mocked(api.checkIn).mockReset()
    vi.mocked(api.checkInByQr).mockReset()
  })

  it('trims a QR payload, confirms the member, and clears the input', async () => {
    const user = userEvent.setup()
    vi.mocked(api.checkInByQr).mockResolvedValue({
      checkin: { id: 'check-1', member_id: mia.id, checked_in_at: '2026-08-12T18:00:00.000Z', member: mia },
      member: mia,
    })
    render(<MemoryRouter><StaffCheckIn /></MemoryRouter>)
    const qr = screen.getByRole('textbox')
    expect(screen.getByRole('button', { name: 'Check in via QR' })).toBeDisabled()
    await user.type(qr, '  RP-1001  ')
    await user.click(screen.getByRole('button', { name: 'Check in via QR' }))

    expect(api.checkInByQr).toHaveBeenCalledWith('RP-1001', 'u-staff', assignedVenueId)
    expect(await screen.findByText('Checked in Mia Member')).toBeInTheDocument()
    expect(screen.getByText('Last check-in')).toBeInTheDocument()
    expect(qr).toHaveValue('')
  })

  it('shows QR errors without marking a check-in complete', async () => {
    const user = userEvent.setup()
    vi.mocked(api.checkInByQr).mockRejectedValue(new Error('Invalid code'))
    render(<MemoryRouter><StaffCheckIn /></MemoryRouter>)
    await user.type(screen.getByRole('textbox'), 'bad-code')
    await user.click(screen.getByRole('button', { name: 'Check in via QR' }))

    expect(await screen.findByText('Invalid code')).toBeInTheDocument()
    expect(screen.queryByText('Last check-in')).not.toBeInTheDocument()
  })

  it('lists active members only and sends an optional note for manual check-in', async () => {
    const user = userEvent.setup()
    vi.mocked(api.checkIn).mockResolvedValue({
      id: 'check-2', member_id: mia.id, checked_in_at: '2026-08-12T18:00:00.000Z', member: mia,
    })
    render(<MemoryRouter><StaffCheckIn /></MemoryRouter>)
    await user.click(screen.getByRole('button', { name: 'Member list' }))
    expect(await screen.findByRole('option', { name: /Mia Member/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Jonah Cruz/ })).not.toBeInTheDocument()
    await user.type(screen.getByPlaceholderText('Guest +1, etc.'), 'Guest +1')
    await user.click(screen.getByRole('button', { name: 'Confirm check-in' }))

    expect(api.checkIn).toHaveBeenCalledWith(mia.id, 'u-staff', 'Guest +1', assignedVenueId)
    expect(await screen.findByText('Checked in successfully')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Guest +1, etc.')).toHaveValue('')
  })

  it('disables manual check-in when no active member is available', async () => {
    const user = userEvent.setup()
    vi.mocked(api.memberRoster).mockResolvedValue([])
    render(<MemoryRouter><StaffCheckIn /></MemoryRouter>)
    await user.click(screen.getByRole('button', { name: 'Member list' }))
    expect(screen.getByRole('button', { name: 'Confirm check-in' })).toBeDisabled()
  })

  it('defaults manual check-in to the first active member, not an expired one', async () => {
    const user = userEvent.setup()
    vi.mocked(api.memberRoster).mockResolvedValue([jonah, mia])
    render(<MemoryRouter><StaffCheckIn /></MemoryRouter>)
    await user.click(screen.getByRole('button', { name: 'Member list' }))
    expect(await screen.findByRole('option', { name: /Mia Member/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Confirm check-in' }))

    expect(api.checkIn).toHaveBeenCalledWith(mia.id, 'u-staff', undefined, assignedVenueId)
  })

  it('keeps manual check-in available after a failed submission', async () => {
    const user = userEvent.setup()
    vi.mocked(api.checkIn).mockRejectedValue(new Error('Check-in unavailable'))
    render(<MemoryRouter><StaffCheckIn /></MemoryRouter>)
    await user.click(screen.getByRole('button', { name: 'Member list' }))
    await user.click(screen.getByRole('button', { name: 'Confirm check-in' }))

    expect(await screen.findByText('Check-in unavailable')).toBeInTheDocument()
    expect(screen.queryByText('Last check-in')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm check-in' })).toBeEnabled()
  })
})

describe('StaffCourts', () => {
  beforeEach(() => {
    vi.mocked(api.createRental).mockReset()
    vi.mocked(api.extendSession).mockReset()
    vi.mocked(api.endSession).mockReset()
    vi.mocked(api.createWalkIn).mockReset()
    vi.mocked(api.addMemberToSession).mockReset()
    vi.mocked(api.listCourts).mockResolvedValue([
      { id: 'court_a', name: 'Court A', status: 'occupied', hourly_rate: 500 },
    ])
    vi.mocked(api.memberRoster).mockResolvedValue([
      { ...mia, phone: null },
      { ...jonah, phone: null, membership_type: 'basic', status: 'active' },
    ])
    vi.mocked(api.playingSessions).mockResolvedValue([
      {
        id: 'session-1',
        court_id: 'court_a',
        court: { id: 'court_a', name: 'Court A', status: 'occupied', hourly_rate: 500 },
        member_id: 'mem_001',
        member: { ...mia, phone: null },
        start_at: '2026-08-12T18:00:00.000Z',
        end_at: '2026-08-12T19:00:00.000Z',
        status: 'playing',
        amount: 500,
        players: [{ id: 'p-1', full_name: 'Mia Member', member_id: 'mem_001' }],
      },
    ])
    vi.mocked(api.addMemberToSession).mockImplementation(async () => {
      const updatedSession: CourtSession = {
        id: 'session-1',
        court_id: 'court_a',
        court: { id: 'court_a', name: 'Court A', status: 'occupied', hourly_rate: 500 },
        member_id: 'mem_001',
        start_at: '2026-08-12T18:00:00.000Z',
        end_at: '2026-08-12T19:00:00.000Z',
        status: 'playing',
        amount: 500,
        players: [
          { id: 'p-1', full_name: 'Mia Member', member_id: 'mem_001' },
          { id: 'p-2', full_name: 'Jonah Cruz', member_id: 'mem_002' },
        ],
      }
      vi.mocked(api.playingSessions).mockResolvedValue([updatedSession])
      return updatedSession
    })
  })

  it('lets a staff member add a player to a live rented court', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <StaffCourts />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('button', { name: /add member/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /add member/i }))
    await user.selectOptions(screen.getByLabelText(/member/i), 'mem_002')
    await user.click(screen.getByRole('button', { name: /save member/i }))

    expect(api.addMemberToSession).toHaveBeenCalledWith('session-1', 'mem_002', 'u-staff')
    expect(await screen.findByText(/Mia Member, Jonah Cruz/i)).not.toBeNull()
  })

  it('keeps the chosen rental court after a live-session reload', async () => {
    const user = userEvent.setup()
    vi.mocked(api.listCourts).mockResolvedValue([
      { id: 'court_a', name: 'Court A', status: 'available', hourly_rate: 500 },
      { id: 'court_b', name: 'Court B', status: 'available', hourly_rate: 500 },
    ])
    vi.mocked(api.listCourts).mockClear()
    render(
      <MemoryRouter>
        <StaffCourts />
      </MemoryRouter>,
    )
    await screen.findByRole('heading', { name: 'Live court sessions' })
    await waitFor(() => expect(api.listCourts).toHaveBeenCalledTimes(1))

    await user.click(screen.getByRole('button', { name: 'Rent' }))
    await user.selectOptions(screen.getAllByRole('combobox')[0], 'court_b')
    await user.click(screen.getByRole('button', { name: 'Playing' }))
    await user.click(screen.getByRole('button', { name: '+1h' }))

    await waitFor(() => expect(api.listCourts).toHaveBeenCalledTimes(2))
    await user.click(screen.getByRole('button', { name: 'Rent' }))
    expect(screen.getAllByRole('combobox')[0]).toHaveValue('court_b')
  })

  it('starts a guest rental and returns to the live-session view', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><StaffCourts /></MemoryRouter>)
    await screen.findByRole('heading', { name: 'Live court sessions' })
    await user.click(screen.getByRole('button', { name: 'Rent' }))
    await user.selectOptions(screen.getAllByRole('combobox')[1], '')
    await user.type(screen.getByPlaceholderText('If no member'), 'Walk-in Guest')
    await user.click(screen.getByRole('button', { name: 'Start rental' }))

    expect(api.createRental).toHaveBeenCalledWith(expect.objectContaining({
      court_id: 'court_a', member_id: undefined, guest_name: 'Walk-in Guest', hours: 1, created_by: 'u-staff',
    }))
    expect(await screen.findByText('Court rental started')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Live court sessions' })).toBeInTheDocument()
  })

  it('keeps the rental form open and reports a rental failure', async () => {
    const user = userEvent.setup()
    vi.mocked(api.createRental).mockRejectedValue(new Error('Court is occupied'))
    render(<MemoryRouter><StaffCourts /></MemoryRouter>)
    await screen.findByRole('heading', { name: 'Live court sessions' })
    await user.click(screen.getByRole('button', { name: 'Rent' }))
    await user.click(screen.getByRole('button', { name: 'Start rental' }))

    expect(await screen.findByText('Court is occupied')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start rental' })).toBeInTheDocument()
  })

  it('reports extension errors and ends a live session', async () => {
    const user = userEvent.setup()
    vi.mocked(api.extendSession).mockRejectedValue(new Error('Cannot extend'))
    render(<MemoryRouter><StaffCourts /></MemoryRouter>)
    await screen.findByRole('button', { name: '+1h' })
    await user.click(screen.getByRole('button', { name: '+1h' }))
    expect(await screen.findByText('Cannot extend')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'End' }))
    expect(api.endSession).toHaveBeenCalledWith('session-1')
    expect(await screen.findByText('Session ended')).toBeInTheDocument()
  })

  it('registers a walk-in and clears the entered name and phone', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><StaffCourts /></MemoryRouter>)
    await screen.findByRole('heading', { name: 'Live court sessions' })
    await user.click(screen.getByRole('button', { name: 'Walk-in' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Register walk-in' })).toBeEnabled())
    const fields = screen.getAllByRole('textbox')
    await user.type(fields[0], 'Visitor One')
    await user.type(fields[1], '09170001111')
    await user.click(screen.getByRole('button', { name: 'Register walk-in' }))

    expect(api.createWalkIn).toHaveBeenCalledWith({
      full_name: 'Visitor One', phone: '09170001111', purpose: 'Day pass', amount: 350,
      venue_id: assignedVenueId, created_by: 'u-staff',
    })
    expect(await screen.findByText('Walk-in registered')).toBeInTheDocument()
    expect(fields[0]).toHaveValue('')
    expect(fields[1]).toHaveValue('')
  })

  it('cancels adding a player without changing the court', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><StaffCourts /></MemoryRouter>)
    await screen.findByRole('button', { name: 'Add member' })
    await user.click(screen.getByRole('button', { name: 'Add member' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.getByRole('button', { name: 'Add member' })).toBeInTheDocument()
    expect(api.addMemberToSession).not.toHaveBeenCalled()
  })

  it('keeps the add-member form open when the court update fails', async () => {
    const user = userEvent.setup()
    vi.mocked(api.addMemberToSession).mockRejectedValue(new Error('Court update failed'))
    render(<MemoryRouter><StaffCourts /></MemoryRouter>)
    await screen.findByRole('button', { name: 'Add member' })
    await user.click(screen.getByRole('button', { name: 'Add member' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Member' }), jonah.id)
    await user.click(screen.getByRole('button', { name: 'Save member' }))

    expect(await screen.findByText('Court update failed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save member' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Member' })).toHaveValue(jonah.id)
    expect(screen.getByText(/Mia Member.*until/)).toBeInTheDocument()
  })

  it('shows a guest fallback for a live session without linked players', async () => {
    vi.mocked(api.playingSessions).mockResolvedValue([
      { id: 'guest-session', court_id: 'court_a', start_at: '2026-08-12T18:00:00.000Z',
        end_at: '2026-08-12T19:00:00.000Z', status: 'playing', amount: 500 },
    ])
    render(<MemoryRouter><StaffCourts /></MemoryRouter>)

    expect(await screen.findByText(/Guest.*until/)).toBeInTheDocument()
  })

  it('prefers an available court over a maintenance court for a new rental', async () => {
    const user = userEvent.setup()
    vi.mocked(api.listCourts).mockResolvedValue([
      { id: 'court_a', name: 'Court A', status: 'maintenance', hourly_rate: 500 },
      { id: 'court_b', name: 'Court B', status: 'available', hourly_rate: 500 },
    ])
    render(<MemoryRouter><StaffCourts /></MemoryRouter>)
    await screen.findByRole('heading', { name: 'Live court sessions' })
    await user.click(screen.getByRole('button', { name: 'Rent' }))

    expect(screen.getAllByRole('combobox')[0]).toHaveValue('court_b')
    expect(screen.getByRole('option', { name: /Court A/ })).toBeDisabled()
  })

  it('shows an empty floor when no live sessions remain', async () => {
    vi.mocked(api.playingSessions).mockResolvedValue([])
    render(<MemoryRouter><StaffCourts /></MemoryRouter>)
    expect(await screen.findByText('No live sessions.')).toBeInTheDocument()
  })

  it('does not add a player without a selected member', async () => {
    const user = userEvent.setup()
    vi.mocked(api.memberRoster).mockResolvedValue([])
    vi.mocked(api.playingSessions).mockResolvedValue([
      { id: 'session-1', court_id: 'court_a', start_at: '2026-08-12T18:00:00.000Z',
        end_at: '2026-08-12T19:00:00.000Z', status: 'playing', amount: 500 },
    ])
    render(<MemoryRouter><StaffCourts /></MemoryRouter>)
    await user.click(await screen.findByRole('button', { name: 'Add member' }))
    expect(screen.getByRole('combobox', { name: 'Member' })).toHaveValue('')
    await user.click(screen.getByRole('button', { name: 'Save member' }))

    expect(api.addMemberToSession).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Save member' })).toBeInTheDocument()
  })
})
