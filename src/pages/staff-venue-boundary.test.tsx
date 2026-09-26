import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CourtSession, Venue } from '../types'
import { StaffCheckIn, StaffCourts, StaffHome, StaffMembers } from './staff'

const assignedVenue: Venue = {
  id: 'venue-assigned', club_id: 'rally', slug: 'assigned', name: 'Assigned venue',
  timezone: 'Asia/Manila', open_hour: 6, close_hour: 22, is_active: true,
}

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u-staff', role: 'staff' }, signOut: vi.fn() }),
}))

vi.mock('../lib/api', () => ({
  api: {
    listVenues: vi.fn(), listCourts: vi.fn(), playingSessions: vi.fn(),
    recentCheckins: vi.fn(), memberRoster: vi.fn(), listMembers: vi.fn(),
    checkIn: vi.fn(), checkInByQr: vi.fn(),
  },
}))

const { api } = await import('../lib/api')

describe('staff venue read boundary', () => {
  let resolveVenues: (venues: Venue[]) => void

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.listVenues).mockImplementation(() => new Promise((resolve) => { resolveVenues = resolve }))
    vi.mocked(api.listCourts).mockResolvedValue([])
    vi.mocked(api.playingSessions).mockResolvedValue([])
    vi.mocked(api.recentCheckins).mockResolvedValue([])
    vi.mocked(api.memberRoster).mockResolvedValue([])
  })

  it('does not load courts or sessions before the assigned venue is known', async () => {
    render(<MemoryRouter><StaffCourts /></MemoryRouter>)
    expect(api.listVenues).toHaveBeenCalledWith('u-staff', 'staff')
    expect(api.listCourts).not.toHaveBeenCalled()
    expect(api.playingSessions).not.toHaveBeenCalled()

    await act(async () => { resolveVenues([assignedVenue]) })
    await waitFor(() => expect(api.listCourts).toHaveBeenCalledWith(assignedVenue.id))
    expect(api.playingSessions).toHaveBeenCalledWith(assignedVenue.id)
    expect(api.listCourts).not.toHaveBeenCalledWith()
    expect(api.playingSessions).not.toHaveBeenCalledWith()
  })

  it('does not load home sessions or check-ins before the assigned venue is known', async () => {
    render(<MemoryRouter><StaffHome /></MemoryRouter>)
    expect(api.listVenues).toHaveBeenCalledWith('u-staff', 'staff')
    expect(api.playingSessions).not.toHaveBeenCalled()
    expect(api.recentCheckins).not.toHaveBeenCalled()

    await act(async () => { resolveVenues([assignedVenue]) })
    await screen.findByText('Currently playing')
    await waitFor(() => expect(api.playingSessions).toHaveBeenCalledWith(assignedVenue.id))
    expect(api.recentCheckins).toHaveBeenCalledWith(assignedVenue.id)
  })

  it('does not permit check-in before a venue is assigned', async () => {
    const user = userEvent.setup()
    vi.mocked(api.checkInByQr).mockResolvedValue({
      checkin: { id: 'check-1', member_id: 'member-1', checked_in_at: '2026-09-24T00:00:00Z' },
      member: { id: 'member-1', full_name: 'Fixture Member' },
    } as Awaited<ReturnType<typeof api.checkInByQr>>)
    render(<MemoryRouter><StaffCheckIn /></MemoryRouter>)
    await user.type(screen.getByRole('textbox'), 'RP-1001')
    expect(screen.getByRole('button', { name: 'Check in via QR' })).toBeDisabled()
    expect(api.checkInByQr).not.toHaveBeenCalled()

    await act(async () => { resolveVenues([assignedVenue]) })
    await user.click(screen.getByRole('button', { name: 'Check in via QR' }))
    expect(api.checkInByQr).toHaveBeenCalledWith('RP-1001', 'u-staff', assignedVenue.id)
  })

  it('drops a stale court-session result after switching to another assigned venue', async () => {
    const user = userEvent.setup()
    const secondVenue = { ...assignedVenue, id: 'venue-second', name: 'Second assigned venue' }
    let resolveFirstSessions: (sessions: CourtSession[]) => void
    vi.mocked(api.listVenues).mockResolvedValue([assignedVenue, secondVenue])
    vi.mocked(api.playingSessions).mockImplementation((venueId) => venueId === assignedVenue.id
      ? new Promise((resolve) => { resolveFirstSessions = resolve })
      : Promise.resolve([{
        id: 'second-session', court_id: 'second-court', venue_id: secondVenue.id,
        court: { id: 'second-court', name: 'Second Court', status: 'occupied', hourly_rate: 500 },
        start_at: '2026-09-24T10:00:00Z', end_at: '2026-09-24T11:00:00Z',
        status: 'playing', amount: 500,
      }]))

    render(<MemoryRouter><StaffCourts /></MemoryRouter>)
    await waitFor(() => expect(api.playingSessions).toHaveBeenCalledWith(assignedVenue.id))
    await user.selectOptions(screen.getByLabelText('Venue'), secondVenue.id)
    expect(await screen.findByText('Second Court')).toBeInTheDocument()

    await act(async () => { resolveFirstSessions([{
      id: 'first-session', court_id: 'first-court', venue_id: assignedVenue.id,
      court: { id: 'first-court', name: 'First Court', status: 'occupied', hourly_rate: 500 },
      start_at: '2026-09-24T10:00:00Z', end_at: '2026-09-24T11:00:00Z',
      status: 'playing', amount: 500,
    }]) })
    expect(screen.queryByText('First Court')).not.toBeInTheDocument()
    expect(screen.getByText('Second Court')).toBeInTheDocument()
  })

  it('keeps operational reads and actions closed with no assigned venue', async () => {
    vi.mocked(api.listVenues).mockResolvedValue([])
    render(<MemoryRouter><StaffCourts /></MemoryRouter>)
    expect(await screen.findByText('No assigned venue.')).toBeInTheDocument()
    expect(api.listCourts).not.toHaveBeenCalled()
    expect(api.playingSessions).not.toHaveBeenCalled()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Rent' }))
    expect(screen.getByRole('button', { name: 'Start rental' })).toBeDisabled()
  })

  it('shows venue-load failure without falling back to broad reads', async () => {
    vi.mocked(api.listVenues).mockRejectedValue(new Error('Venue lookup unavailable'))
    render(<MemoryRouter><StaffHome /></MemoryRouter>)
    expect(await screen.findByText('Venue lookup unavailable')).toBeInTheDocument()
    expect(api.playingSessions).not.toHaveBeenCalled()
    expect(api.recentCheckins).not.toHaveBeenCalled()
  })

  it('uses only the limited staff roster for the member directory', async () => {
    vi.mocked(api.memberRoster).mockResolvedValue([{
      id: 'member-1', member_code: 'RP-1001', full_name: 'Roster Member',
      membership_type: 'standard', status: 'active', join_date: '2026-01-01',
      expiry_date: '2027-01-01', created_at: '2026-01-01T00:00:00Z',
    }])
    vi.mocked(api.listMembers).mockResolvedValue([{
      id: 'member-2', member_code: 'RP-1002', full_name: 'Admin-only Member',
      email: 'private@example.com', phone: '09170000000',
      membership_type: 'standard', status: 'active', join_date: '2026-01-01',
      expiry_date: '2027-01-01', created_at: '2026-01-01T00:00:00Z',
    }])

    render(<MemoryRouter><StaffMembers /></MemoryRouter>)
    expect(await screen.findByText('Roster Member')).toBeInTheDocument()
    expect(screen.queryByText('Admin-only Member')).not.toBeInTheDocument()
    expect(api.memberRoster).toHaveBeenCalledOnce()
    expect(api.listMembers).not.toHaveBeenCalled()
  })

  it('shows a roster error without trying the admin member view', async () => {
    vi.mocked(api.memberRoster).mockRejectedValue(new Error('Roster unavailable'))
    vi.mocked(api.listMembers).mockResolvedValue([])

    render(<MemoryRouter><StaffMembers /></MemoryRouter>)
    expect(await screen.findByText('Roster unavailable')).toBeInTheDocument()
    expect(api.listMembers).not.toHaveBeenCalled()
  })

  it('reports a failed home read without showing a false empty floor', async () => {
    vi.mocked(api.playingSessions).mockRejectedValue(new Error('Court status unavailable'))
    render(<MemoryRouter><StaffHome /></MemoryRouter>)
    await act(async () => { resolveVenues([assignedVenue]) })

    expect(await screen.findByText('Court status unavailable')).toBeInTheDocument()
    expect(screen.queryByText('No active sessions.')).not.toBeInTheDocument()
  })

  it('reports a failed court read and keeps rental closed', async () => {
    vi.mocked(api.listCourts).mockRejectedValue(new Error('Courts unavailable'))
    render(<MemoryRouter><StaffCourts /></MemoryRouter>)
    await act(async () => { resolveVenues([assignedVenue]) })

    expect(await screen.findByText('Courts unavailable')).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Rent' }))
    expect(screen.getByRole('button', { name: 'Start rental' })).toBeDisabled()
  })

  it('reports a failed check-in roster read without using the admin view', async () => {
    vi.mocked(api.memberRoster).mockRejectedValue(new Error('Check-in roster unavailable'))
    render(<MemoryRouter><StaffCheckIn /></MemoryRouter>)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Member list' }))

    expect(await screen.findByText('Check-in roster unavailable')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm check-in' })).toBeDisabled()
    expect(api.listMembers).not.toHaveBeenCalled()
  })
})
