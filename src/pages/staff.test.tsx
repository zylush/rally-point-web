import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CourtSession } from '../types'
import { StaffCourts, StaffHome } from './staff'

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
    playingSessions: vi.fn(),
    recentCheckins: vi.fn(),
    listCourts: vi.fn(),
    listMembers: vi.fn(),
    createRental: vi.fn(),
    extendSession: vi.fn(),
    endSession: vi.fn(),
    createWalkIn: vi.fn(),
    addMemberToSession: vi.fn(),
  },
}))

const { api } = await import('../lib/api')

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
})

describe('StaffCourts', () => {
  beforeEach(() => {
    vi.mocked(api.listCourts).mockResolvedValue([
      { id: 'court_a', name: 'Court A', status: 'occupied', hourly_rate: 500 },
    ])
    vi.mocked(api.listMembers).mockResolvedValue([
      {
        id: 'mem_001',
        user_id: 'u-member-1',
        member_code: 'RP-1001',
        full_name: 'Mia Member',
        email: 'mia@example.com',
        phone: null,
        membership_type: 'standard',
        status: 'active',
        join_date: '2026-01-01',
        expiry_date: '2027-01-01',
        created_at: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'mem_002',
        user_id: 'u-member-2',
        member_code: 'RP-1002',
        full_name: 'Jonah Cruz',
        email: 'jonah@example.com',
        phone: null,
        membership_type: 'basic',
        status: 'active',
        join_date: '2026-01-01',
        expiry_date: '2027-01-01',
        created_at: '2026-01-01T00:00:00.000Z',
      },
    ])
    vi.mocked(api.playingSessions).mockResolvedValue([
      {
        id: 'session-1',
        court_id: 'court_a',
        court: { id: 'court_a', name: 'Court A', status: 'occupied', hourly_rate: 500 },
        member_id: 'mem_001',
        member: {
          id: 'mem_001',
          user_id: 'u-member-1',
          member_code: 'RP-1001',
          full_name: 'Mia Member',
          email: 'mia@example.com',
          phone: null,
          membership_type: 'standard',
          status: 'active',
          join_date: '2026-01-01',
          expiry_date: '2027-01-01',
          created_at: '2026-01-01T00:00:00.000Z',
        },
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

    expect(await screen.findByRole('heading', { name: 'Live court sessions' })).toBeInTheDocument()
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
})
