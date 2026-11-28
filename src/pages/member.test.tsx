import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Profile } from '../types'
import { api } from '../lib/api'
import { MemberNotifications, MemberTransactions } from './member'

const memberUser = {
  id: 'u-member',
  email: 'member@brinely.info',
  full_name: 'Jamie Player',
  phone: null,
  role: 'member',
  created_at: '2026-01-01T00:00:00.000Z',
} satisfies Profile
let currentMemberUser: Profile = memberUser
const auth = vi.hoisted(() => ({
  signOut: vi.fn(),
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: currentMemberUser,
    loading: false,
    demo: true,
    signIn: vi.fn(),
    signUpMember: vi.fn(),
    signOut: auth.signOut,
    refresh: vi.fn(),
  }),
}))

vi.mock('../lib/api', () => ({
  api: {
    memberForUser: vi.fn(),
    notifications: vi.fn(),
    transactions: vi.fn(),
    payMembership: vi.fn(),
    markNotifRead: vi.fn(),
  },
}))

describe('MemberNotifications loading', () => {
  beforeEach(() => {
    currentMemberUser = memberUser
    vi.mocked(api.notifications).mockReset()
    vi.mocked(api.notifications).mockResolvedValue([])
  })

  afterEach(() => {
    currentMemberUser = memberUser
  })

  it('does not refetch for a new profile object with the same user ID, but refetches for a different ID', async () => {
    const view = render(
      <MemoryRouter>
        <MemberNotifications />
      </MemoryRouter>,
    )
    await waitFor(() => expect(api.notifications).toHaveBeenCalledTimes(1))

    currentMemberUser = { ...memberUser }
    await act(async () => view.rerender(
      <MemoryRouter>
        <MemberNotifications />
      </MemoryRouter>,
    ))
    expect(api.notifications).toHaveBeenCalledTimes(1)

    currentMemberUser = { ...memberUser, id: 'another-member' }
    await act(async () => view.rerender(
      <MemoryRouter>
        <MemberNotifications />
      </MemoryRouter>,
    ))
    expect(api.notifications).toHaveBeenCalledWith('another-member')
  })

  it('marks an unread message as read and refreshes its state', async () => {
    const user = userEvent.setup()
    const notice = { id: 'notice-1', user_id: memberUser.id, title: 'Court ready', body: 'See you soon', read: false, created_at: '2026-09-19T00:00:00.000Z' }
    vi.mocked(api.notifications).mockResolvedValueOnce([notice]).mockResolvedValue([{ ...notice, read: true }])
    vi.mocked(api.markNotifRead).mockReset()
    vi.mocked(api.markNotifRead).mockResolvedValue(undefined)
    render(<MemoryRouter><MemberNotifications /></MemoryRouter>)

    await user.click(await screen.findByRole('button', { name: /Court ready/ }))
    expect(api.markNotifRead).toHaveBeenCalledWith('notice-1')
    await waitFor(() => expect(screen.queryByText('New')).not.toBeInTheDocument())
    expect(api.notifications).toHaveBeenCalledTimes(2)
  })
})

describe('MemberTransactions', () => {
  it('renders transaction descriptions, types, and amounts', async () => {
    vi.mocked(api.transactions).mockResolvedValue([{
      id: 'tx-1', amount: 2500, type: 'court_rental', description: 'Court A rental',
      created_at: '2026-09-19T00:00:00.000Z',
    }])
    render(<MemoryRouter><MemberTransactions /></MemoryRouter>)

    expect(await screen.findByText('Court A rental')).toBeInTheDocument()
    expect(screen.getByText(/court rental/)).toBeInTheDocument()
    expect(screen.getByText('Php 2,500.00')).toBeInTheDocument()
  })
})
