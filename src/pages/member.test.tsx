import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Member, Profile } from '../types'
import { api } from '../lib/api'
import { MemberHome, MemberNotifications, MemberPay, MemberProfile, MemberTransactions } from './member'

const memberUser = {
  id: 'u-member',
  email: 'member@rallypoint.test',
  full_name: 'Jamie Player',
  phone: null,
  role: 'member',
  created_at: '2026-01-01T00:00:00.000Z',
} satisfies Profile
let currentMemberUser: Profile = memberUser

const membership = {
  id: 'member-1',
  user_id: memberUser.id,
  member_code: 'RP-001',
  full_name: memberUser.full_name,
  email: memberUser.email,
  phone: null,
  membership_type: 'premium',
  status: 'active',
  join_date: '2026-01-01',
  expiry_date: '2026-12-31',
  notes: null,
  qr_token: null,
  created_at: '2026-01-01T00:00:00.000Z',
} satisfies Member

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: currentMemberUser,
    loading: false,
    demo: true,
    signIn: vi.fn(),
    signUpMember: vi.fn(),
    signOut: vi.fn(),
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

describe('MemberPay loading semantics', () => {
  beforeEach(() => {
    vi.mocked(api.memberForUser).mockReset()
    vi.mocked(api.payMembership).mockReset()
    vi.mocked(api.memberForUser).mockResolvedValue(membership)
  })

  it('announces a pending renewal and prevents duplicate submissions', async () => {
    let resolvePayment!: () => void
    const pendingPayment = new Promise<void>((resolve) => {
      resolvePayment = resolve
    })
    vi.mocked(api.payMembership).mockReturnValueOnce(pendingPayment)
    const user = userEvent.setup()

    render(
      <MemoryRouter initialEntries={['/member/pay']}>
        <MemberPay />
      </MemoryRouter>,
    )

    const button = await screen.findByRole('button', { name: /pay php 2,500/i })
    await user.click(button)

    expect(api.payMembership).toHaveBeenCalledTimes(1)
    expect(api.payMembership).toHaveBeenCalledWith(
      membership.id,
      2500,
      memberUser.id,
    )
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button).toHaveAccessibleName(/processing/i)

    await user.click(button)
    expect(api.payMembership).toHaveBeenCalledTimes(1)

    resolvePayment()
    expect(await screen.findByRole('button', { name: /pay php 2,500/i })).toBeEnabled()
  })

  it('keeps renewal disabled without a linked membership', async () => {
    vi.mocked(api.memberForUser).mockResolvedValue(null)
    render(<MemoryRouter><MemberPay /></MemoryRouter>)
    await waitFor(() => expect(api.memberForUser).toHaveBeenCalledWith(memberUser.id))
    expect(screen.getByRole('button', { name: /pay php 2,500/i })).toBeDisabled()
  })

  it('reports a failed renewal and allows a retry', async () => {
    const user = userEvent.setup()
    vi.mocked(api.payMembership).mockRejectedValue(new Error('Payment unavailable'))
    render(<MemoryRouter><MemberPay /></MemoryRouter>)
    const button = await screen.findByRole('button', { name: /pay php 2,500/i })
    await waitFor(() => expect(button).toBeEnabled())
    await user.click(button)

    expect(await screen.findByText('Payment unavailable')).toBeInTheDocument()
    expect(button).toBeEnabled()
  })

  it('refreshes membership after a successful renewal', async () => {
    const user = userEvent.setup()
    vi.mocked(api.memberForUser).mockResolvedValueOnce(membership).mockResolvedValue({ ...membership, expiry_date: '2027-01-30' })
    render(<MemoryRouter><MemberPay /></MemoryRouter>)
    const button = await screen.findByRole('button', { name: /pay php 2,500/i })
    await waitFor(() => expect(button).toBeEnabled())
    await user.click(button)

    expect(api.payMembership).toHaveBeenCalledWith(membership.id, 2500, memberUser.id)
    expect(await screen.findByText('Payment recorded. Membership extended 30 days.')).toBeInTheDocument()
    expect(api.memberForUser).toHaveBeenCalledTimes(2)
  })
})

describe('MemberHome renewal action', () => {
  beforeEach(() => {
    vi.mocked(api.memberForUser).mockResolvedValue(membership)
    vi.mocked(api.notifications).mockResolvedValue([])
    vi.mocked(api.transactions).mockResolvedValue([])
  })

  it('puts Renew inside the membership card and reuses the existing payment route', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/member']}>
        <Routes>
          <Route path="/member" element={<MemberHome />} />
          <Route path="/member/pay" element={<div>Renewal checkout</div>} />
        </Routes>
      </MemoryRouter>,
    )

    const membershipLabel = await screen.findByText('Your membership')
    const card = membershipLabel.closest('section')
    expect(card).not.toBeNull()

    const renew = within(card!).getByRole('link', { name: 'Renew membership' })
    expect(renew).toHaveTextContent('Renew')
    expect(renew).toHaveAttribute('href', '/member/pay')
    expect(renew).toHaveClass('min-h-12')
    expect(renew).toHaveClass('control-feedback')

    renew.focus()
    expect(renew).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(await screen.findByText('Renewal checkout')).toBeInTheDocument()
  })

  it('removes only the duplicate renewal tile and preserves unique member actions', async () => {
    render(
      <MemoryRouter initialEntries={['/member']}>
        <MemberHome />
      </MemoryRouter>,
    )

    await screen.findByText('Your membership')
    expect(
      screen.queryByRole('link', { name: /pay dues/i }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /book a court/i })).toHaveAttribute(
      'href',
      '/member/book',
    )
    expect(
      screen.getByRole('link', { name: /join open play/i }),
    ).toHaveAttribute('href', '/member/open')
    expect(screen.getByRole('link', { name: /show my qr/i })).toHaveAttribute(
      'href',
      '/member/pass',
    )
  })

  it('loads member data through the existing API boundary', async () => {
    render(
      <MemoryRouter initialEntries={['/member']}>
        <MemberHome />
      </MemoryRouter>,
    )

    await screen.findByText('Your membership')
    expect(api.memberForUser).toHaveBeenCalledWith(memberUser.id)
    expect(api.notifications).toHaveBeenCalledWith(memberUser.id)
    expect(api.transactions).toHaveBeenCalledWith(memberUser.id, 'member')
  })

  it('shows unread reminders and only the three latest payments', async () => {
    vi.mocked(api.notifications).mockResolvedValue([
      { id: 'n1', user_id: memberUser.id, title: 'Reminder', body: 'Today', read: false, created_at: '2026-09-19T00:00:00.000Z' },
      { id: 'n2', user_id: memberUser.id, title: 'Old', body: 'Yesterday', read: true, created_at: '2026-09-18T00:00:00.000Z' },
    ])
    vi.mocked(api.transactions).mockResolvedValue(Array.from({ length: 4 }, (_, i) => ({
      id: `tx-${i}`, amount: 100 + i, type: 'membership' as const,
      description: `Payment ${i}`, created_at: '2026-09-19T00:00:00.000Z',
    })))
    render(<MemoryRouter><MemberHome /></MemoryRouter>)

    expect(await screen.findByText('Payment 2')).toBeInTheDocument()
    expect(screen.queryByText('Payment 3')).not.toBeInTheDocument()
    const messages = screen.getByRole('link', { name: /Messages/ })
    expect(within(messages).getByText('1')).toBeInTheDocument()
  })

  it('shows a missing membership and an empty payment history', async () => {
    vi.mocked(api.memberForUser).mockResolvedValue(null)
    render(<MemoryRouter><MemberHome /></MemoryRouter>)

    expect(await screen.findByText('No payments yet.')).toBeInTheDocument()
    expect(screen.getByText('n/a')).toBeInTheDocument()
  })
})

describe('Member account details', () => {
  beforeEach(() => {
    vi.mocked(api.memberForUser).mockResolvedValue(membership)
    vi.mocked(api.transactions).mockResolvedValue([])
  })

  it('shows a member profile with the membership fallback phone', async () => {
    vi.mocked(api.memberForUser).mockResolvedValue({ ...membership, phone: '09171234567' })
    render(<MemoryRouter><MemberProfile /></MemoryRouter>)

    expect(await screen.findByText('RP-001')).toBeInTheDocument()
    expect(screen.getByText('09171234567')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Renew membership/ })).toHaveAttribute('href', '/member/pay')
  })

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
