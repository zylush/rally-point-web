import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Member, Profile } from '../types'
import { api } from '../lib/api'
import { MemberHome, MemberNotifications, MemberPay } from './member'

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
})

describe('MemberPay loading semantics', () => {
  beforeEach(() => {
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
})
