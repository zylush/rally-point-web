import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Member, OpenPlaySession, OpenPlaySignup, Profile } from '../types'
import { api } from '../lib/api'
import { MemberOpenPlay, OpenPlayManage } from './OpenPlay'

const memberUser: Profile = {
  id: 'member-user',
  email: 'member@rallypoint.test',
  full_name: 'Jamie Player',
  phone: null,
  role: 'member',
  created_at: '2026-01-01T00:00:00.000Z',
}
const member: Member = {
  id: 'member-1', user_id: memberUser.id, member_code: 'RP-1001', full_name: 'Jamie Player',
  email: memberUser.email, phone: null, membership_type: 'standard', status: 'active',
  join_date: '2026-01-01', expiry_date: '2027-01-01', created_at: '2026-01-01T00:00:00.000Z',
}
const openPlay: OpenPlaySession = {
  id: 'open-play-1', title: 'Evening Open Play', court_id: 'court-a',
  court: { id: 'court-a', name: 'Court A', status: 'available', hourly_rate: 500 },
  start_at: '2026-09-19T18:00:00.000Z', end_at: '2026-09-19T20:00:00.000Z',
  capacity: 8, fee: 250, skill_level: 'all', status: 'open',
  created_at: '2026-09-19T00:00:00.000Z', seats_taken: 2, signups: [],
}
const joinedSignup: OpenPlaySignup = {
  id: 'signup-1', open_play_id: openPlay.id, member_id: member.id,
  status: 'joined', created_at: '2026-09-19T00:00:00.000Z',
}
let currentUser = memberUser

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: currentUser, signOut: vi.fn() }),
}))

vi.mock('../lib/api', () => ({
  api: {
    listOpenPlays: vi.fn(),
    memberForUser: vi.fn(),
    listCourts: vi.fn(),
    createOpenPlay: vi.fn(),
    joinOpenPlay: vi.fn(),
    leaveOpenPlay: vi.fn(),
  },
}))

describe('MemberOpenPlay loading', () => {
  beforeEach(() => {
    currentUser = memberUser
    vi.mocked(api.listOpenPlays).mockReset()
    vi.mocked(api.memberForUser).mockReset()
    vi.mocked(api.joinOpenPlay).mockReset()
    vi.mocked(api.leaveOpenPlay).mockReset()
    vi.mocked(api.listOpenPlays).mockResolvedValue([])
    vi.mocked(api.memberForUser).mockResolvedValue(null)
  })

  afterEach(() => {
    currentUser = memberUser
  })

  it('loads once per user ID and refetches when that ID changes', async () => {
    const view = render(
      <MemoryRouter>
        <MemberOpenPlay />
      </MemoryRouter>,
    )
    await screen.findByText('No open play sessions right now.')
    expect(api.memberForUser).toHaveBeenCalledTimes(1)

    currentUser = { ...memberUser }
    await act(async () => view.rerender(
      <MemoryRouter>
        <MemberOpenPlay />
      </MemoryRouter>,
    ))
    expect(api.memberForUser).toHaveBeenCalledTimes(1)

    currentUser = { ...memberUser, id: 'another-member' }
    await act(async () => view.rerender(
      <MemoryRouter>
        <MemberOpenPlay />
      </MemoryRouter>,
    ))
    await waitFor(() => expect(api.memberForUser).toHaveBeenCalledWith('another-member'))
  })

  it('disables joining when membership is not linked or a session is cancelled', async () => {
    vi.mocked(api.listOpenPlays).mockResolvedValue([openPlay, { ...openPlay, id: 'cancelled', title: 'Cancelled Game', status: 'cancelled' }])
    render(<MemoryRouter><MemberOpenPlay /></MemoryRouter>)

    expect(await screen.findByText('Evening Open Play')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Join this game' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Join this game' })[0]).toBeDisabled()
    expect(screen.getAllByRole('button', { name: 'Join this game' })[1]).toBeDisabled()
  })

  it('joins an available game and refreshes to show the signup', async () => {
    const user = userEvent.setup()
    vi.mocked(api.memberForUser).mockResolvedValue(member)
    vi.mocked(api.listOpenPlays).mockResolvedValueOnce([openPlay]).mockResolvedValue([{ ...openPlay, seats_taken: 3, signups: [joinedSignup] }])
    vi.mocked(api.joinOpenPlay).mockResolvedValue({ signup: joinedSignup, session: openPlay })
    render(<MemoryRouter><MemberOpenPlay /></MemoryRouter>)
    await user.click(await screen.findByRole('button', { name: 'Join this game' }))

    expect(api.joinOpenPlay).toHaveBeenCalledWith(openPlay.id, member.id, memberUser.id)
    expect(await screen.findByText('Joined open play!')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Leave' })).toBeInTheDocument()
  })

  it('offers a waitlist when full and reports the waitlisted signup', async () => {
    const user = userEvent.setup()
    const full = { ...openPlay, seats_taken: openPlay.capacity, status: 'full' as const }
    const signup: OpenPlaySignup = { ...joinedSignup, id: 'signup-2', status: 'waitlist' }
    vi.mocked(api.memberForUser).mockResolvedValue(member)
    vi.mocked(api.listOpenPlays).mockResolvedValueOnce([full]).mockResolvedValue([{ ...full, signups: [signup] }])
    vi.mocked(api.joinOpenPlay).mockResolvedValue({ signup, session: full })
    render(<MemoryRouter><MemberOpenPlay /></MemoryRouter>)
    await user.click(await screen.findByRole('button', { name: 'Join waitlist' }))

    expect(await screen.findByText('Added to waitlist')).toBeInTheDocument()
    expect(screen.getByText('waitlist')).toBeInTheDocument()
  })

  it('shows a join failure and leaves the join action available', async () => {
    const user = userEvent.setup()
    vi.mocked(api.memberForUser).mockResolvedValue(member)
    vi.mocked(api.listOpenPlays).mockResolvedValue([openPlay])
    vi.mocked(api.joinOpenPlay).mockRejectedValue(new Error('Signups closed'))
    render(<MemoryRouter><MemberOpenPlay /></MemoryRouter>)
    await user.click(await screen.findByRole('button', { name: 'Join this game' }))

    expect(await screen.findByText('Signups closed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Join this game' })).toBeEnabled()
  })

  it('leaves an existing signup and allows joining again', async () => {
    const user = userEvent.setup()
    vi.mocked(api.memberForUser).mockResolvedValue(member)
    vi.mocked(api.listOpenPlays).mockResolvedValueOnce([{ ...openPlay, signups: [joinedSignup] }]).mockResolvedValue([openPlay])
    render(<MemoryRouter><MemberOpenPlay /></MemoryRouter>)
    await user.click(await screen.findByRole('button', { name: 'Leave' }))

    expect(api.leaveOpenPlay).toHaveBeenCalledWith(openPlay.id, member.id)
    expect(await screen.findByText('Left session')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Join this game' })).toBeInTheDocument()
  })

  it('keeps the signup visible when leaving fails', async () => {
    const user = userEvent.setup()
    vi.mocked(api.memberForUser).mockResolvedValue(member)
    vi.mocked(api.listOpenPlays).mockResolvedValue([{ ...openPlay, signups: [joinedSignup] }])
    vi.mocked(api.leaveOpenPlay).mockRejectedValue(new Error('Please retry'))
    render(<MemoryRouter><MemberOpenPlay /></MemoryRouter>)
    await user.click(await screen.findByRole('button', { name: 'Leave' }))

    expect(await screen.findByText('Please retry')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Leave' })).toBeEnabled()
  })

  it('shows free open-floor details and ignores a cancelled signup', async () => {
    const free = { ...openPlay, court: undefined, fee: 0, notes: 'Bring your paddle', signups: [
      { ...joinedSignup, id: 'old-signup', status: 'cancelled' as const },
    ] }
    vi.mocked(api.memberForUser).mockResolvedValue(member)
    vi.mocked(api.listOpenPlays).mockResolvedValue([free])
    render(<MemoryRouter><MemberOpenPlay /></MemoryRouter>)

    expect(await screen.findByText('Bring your paddle')).toBeInTheDocument()
    expect(screen.getByText('Free')).toBeInTheDocument()
    expect(screen.getByText(/Open floor/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Leave' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Join this game' })).toBeEnabled()
  })

  it('shows missing signup and seat data as an available game while join is pending', async () => {
    const user = userEvent.setup()
    let resolveJoin!: (value: Awaited<ReturnType<typeof api.joinOpenPlay>>) => void
    const pendingJoin = new Promise<Awaited<ReturnType<typeof api.joinOpenPlay>>>((resolve) => { resolveJoin = resolve })
    vi.mocked(api.memberForUser).mockResolvedValue(member)
    vi.mocked(api.listOpenPlays).mockResolvedValueOnce([{ ...openPlay, signups: undefined, seats_taken: undefined }])
      .mockResolvedValue([{ ...openPlay, signups: [joinedSignup] }])
    vi.mocked(api.joinOpenPlay).mockReturnValue(pendingJoin)
    render(<MemoryRouter><MemberOpenPlay /></MemoryRouter>)

    expect(await screen.findByText(/0\/8/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Join this game' }))
    expect(screen.getByRole('button', { name: /Please wait/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Please wait/ })).toHaveAttribute('aria-busy', 'true')

    await act(async () => resolveJoin({ signup: joinedSignup, session: openPlay }))
    expect(await screen.findByRole('button', { name: 'Leave' })).toBeInTheDocument()
  })
})

describe('OpenPlayManage loading', () => {
  beforeEach(() => {
    vi.mocked(api.listOpenPlays).mockReset()
    vi.mocked(api.listCourts).mockReset()
    vi.mocked(api.createOpenPlay).mockReset()
    vi.mocked(api.listOpenPlays).mockResolvedValue([])
    vi.mocked(api.listCourts).mockResolvedValue([
      { id: 'court-a', name: 'Court A', status: 'available', hourly_rate: 500 },
      { id: 'court-b', name: 'Court B', status: 'available', hourly_rate: 500 },
    ])
    vi.mocked(api.createOpenPlay).mockResolvedValue({
      id: 'open-play-1',
      title: 'Evening Open Play',
      start_at: '2026-09-19T18:00:00.000Z',
      end_at: '2026-09-19T20:00:00.000Z',
      capacity: 8,
      fee: 250,
      skill_level: 'all',
      status: 'open',
      created_at: '2026-09-19T00:00:00.000Z',
    })
  })

  it('preserves the selected court when a successful publish reloads the lists', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <OpenPlayManage role="staff" />
      </MemoryRouter>,
    )
    await waitFor(() => expect(api.listCourts).toHaveBeenCalledTimes(1))

    await user.click(screen.getByRole('button', { name: 'New' }))
    await user.selectOptions(screen.getAllByRole('combobox')[0], 'court-b')
    await user.click(screen.getByRole('button', { name: 'Publish session' }))

    await waitFor(() => expect(api.listCourts).toHaveBeenCalledTimes(2))
    expect(api.createOpenPlay).toHaveBeenCalledWith(expect.objectContaining({ court_id: 'court-b' }))
    await user.click(screen.getByRole('button', { name: 'New' }))
    expect(screen.getAllByRole('combobox')[0]).toHaveValue('court-b')
  })

  it('shows active signups but hides cancelled ones for staff', async () => {
    vi.mocked(api.listOpenPlays).mockResolvedValue([{ ...openPlay, signups: [
      { ...joinedSignup, id: 'joined', member },
      { ...joinedSignup, id: 'cancelled', member_id: 'former', status: 'cancelled', member: { ...member, full_name: 'Former Player' } },
    ] }])
    render(<MemoryRouter><OpenPlayManage role="staff" /></MemoryRouter>)

    expect(await screen.findByText('Evening Open Play')).toBeInTheDocument()
    expect(screen.getByText('Jamie Player', { selector: 'section p' })).toBeInTheDocument()
    expect(screen.queryByText('Former Player')).not.toBeInTheDocument()
    expect(api.listOpenPlays).toHaveBeenCalledWith(true)
  })

  it('renders a free open-floor session without seat counts or linked signup names', async () => {
    vi.mocked(api.listOpenPlays).mockResolvedValue([
      { ...openPlay, court: undefined, seats_taken: undefined, fee: 0, signups: [joinedSignup] },
      { ...openPlay, id: 'cancelled-only', title: 'Cancelled-only Game', signups: [{ ...joinedSignup, status: 'cancelled' }] },
    ])
    render(<MemoryRouter><OpenPlayManage role="staff" /></MemoryRouter>)

    expect(await screen.findByText('Evening Open Play')).toBeInTheDocument()
    expect(screen.getByText('member-1')).toBeInTheDocument()
    expect(screen.getByText(/0\/8/)).toBeInTheDocument()
    expect(screen.getByText(/Free/)).toBeInTheDocument()
    expect(screen.getByText('Cancelled-only Game')).toBeInTheDocument()
    expect(screen.queryByText('Jamie Player', { selector: 'section p' })).not.toBeInTheDocument()
  })

  it('keeps the creation form open and shows the failure when publishing fails', async () => {
    const user = userEvent.setup()
    vi.mocked(api.createOpenPlay).mockRejectedValue(new Error('Court unavailable'))
    render(<MemoryRouter><OpenPlayManage role="admin" /></MemoryRouter>)
    await user.click(screen.getByRole('button', { name: 'New' }))
    await user.click(screen.getByRole('button', { name: 'Publish session' }))

    expect(await screen.findByText('Court unavailable')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Publish session' })).toBeInTheDocument()
    expect(api.listOpenPlays).toHaveBeenCalledTimes(1)
  })

  it('publishes edited session details without a court when none exists', async () => {
    const user = userEvent.setup()
    vi.mocked(api.listCourts).mockResolvedValue([])
    render(<MemoryRouter><OpenPlayManage role="staff" /></MemoryRouter>)
    await user.click(screen.getByRole('button', { name: 'New' }))
    const inputs = screen.getAllByRole('textbox')
    await user.clear(inputs[0])
    await user.type(inputs[0], 'Beginner mixer')
    const numbers = screen.getAllByRole('spinbutton')
    await user.clear(numbers[2])
    await user.type(numbers[2], '12')
    await user.selectOptions(screen.getAllByRole('combobox')[1], 'beginner')
    await user.click(screen.getByRole('button', { name: 'Publish session' }))

    expect(api.createOpenPlay).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Beginner mixer', court_id: undefined, capacity: 12, skill_level: 'beginner',
    }))
    expect(await screen.findByText('Open play created')).toBeInTheDocument()
  })
})
