import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Profile } from '../types'
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
  },
}))

describe('MemberOpenPlay loading', () => {
  beforeEach(() => {
    currentUser = memberUser
    vi.mocked(api.listOpenPlays).mockReset()
    vi.mocked(api.memberForUser).mockReset()
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
})
