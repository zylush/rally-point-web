import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MemberPass, Profile } from '../types'
import { api } from '../lib/api'
import { MemberAccount } from './MemberAccount'

const state = vi.hoisted(() => ({
  user: null as Profile | null,
  refresh: vi.fn(),
  signOut: vi.fn(),
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: state.user,
    loading: false,
    demo: true,
    clubs: [],
    activeClub: null,
    refresh: state.refresh,
    signOut: state.signOut,
  }),
}))

vi.mock('../lib/api', () => ({
  api: {
    myMemberPasses: vi.fn(),
    notifications: vi.fn(),
    transactions: vi.fn(),
    requestMembership: vi.fn(),
    cancelMembershipRequest: vi.fn(),
    updateMyAccount: vi.fn(),
    setMyPhoto: vi.fn(),
  },
}))

const jamie: Profile = {
  id: 'u-member',
  email: 'jamie@example.invalid',
  full_name: 'Jamie Player',
  nickname: null,
  photo_path: null,
  role: 'member',
  created_at: '2026-01-01T00:00:00.000Z',
}

function pass(overrides: Partial<MemberPass> = {}): MemberPass {
  return {
    club_id: 'club-gensan',
    club_slug: 'gensan',
    club_name: 'Rally Point Gensan',
    member_id: 'm-1',
    member_code: 'BR-0001',
    full_name: 'Jamie Player',
    membership_type: null,
    status: 'active',
    expiry_date: null,
    is_active_member: false,
    qr_token: 'token-1',
    request: null,
    ...overrides,
  }
}

const memberAtDavao = pass({
  club_id: 'club-davao',
  club_slug: 'davao',
  club_name: 'Rally Point Davao',
  member_id: 'm-2',
  member_code: 'BR-0002',
  membership_type: 'standard',
  expiry_date: '2099-12-31',
  is_active_member: true,
  qr_token: 'token-2',
})

beforeEach(() => {
  state.user = { ...jamie }
  state.refresh.mockReset().mockResolvedValue(undefined)
  state.signOut.mockReset()
  vi.mocked(api.myMemberPasses).mockReset().mockResolvedValue([pass(), memberAtDavao])
  vi.mocked(api.notifications).mockReset().mockResolvedValue([])
  vi.mocked(api.transactions).mockReset().mockResolvedValue([])
  vi.mocked(api.requestMembership).mockReset().mockResolvedValue('req-1')
  vi.mocked(api.cancelMembershipRequest).mockReset().mockResolvedValue(undefined)
  vi.mocked(api.updateMyAccount).mockReset().mockResolvedValue(undefined)
  vi.mocked(api.setMyPhoto).mockReset().mockResolvedValue('data:image/webp;base64,AAAA')
})

function renderAccount() {
  return render(<MemoryRouter><MemberAccount /></MemoryRouter>)
}

describe('MemberAccount', () => {
  it('replaces the dashboard: greets by nickname and lists every club with its membership state', async () => {
    state.user = { ...jamie, nickname: 'Jams' }
    renderAccount()

    expect(screen.getByRole('heading', { name: 'Account' })).toBeInTheDocument()
    expect(screen.getByText('Hi, Jams')).toBeInTheDocument()
    expect(screen.getByText('Goes by', { exact: false })).toHaveTextContent('Goes by Jams')

    const gensan = await screen.findByRole('article', { name: 'Rally Point Gensan' })
    expect(within(gensan).getByText('Player')).toBeInTheDocument()
    expect(within(gensan).getByText('Regular rate')).toBeInTheDocument()
    expect(within(gensan).getByRole('button', { name: 'Become a member' })).toBeInTheDocument()
    expect(within(gensan).getByRole('link', { name: /Show my QR/ })).toHaveAttribute('href', '/member/pass?club=club-gensan')

    const davao = screen.getByRole('article', { name: 'Rally Point Davao' })
    expect(within(davao).getByText(/^Member until/)).toBeInTheDocument()
    expect(within(davao).getByText('Standard plan · member rate')).toBeInTheDocument()
    expect(within(davao).getByRole('button', { name: 'Renew membership' })).toBeInTheDocument()

    expect(api.myMemberPasses).toHaveBeenCalledWith('u-member')
    expect(screen.queryByText('Your membership')).not.toBeInTheDocument()
  })

  it('sends a membership request for a club and shows it waiting for staff', async () => {
    const user = userEvent.setup()
    vi.mocked(api.myMemberPasses)
      .mockResolvedValueOnce([pass()])
      .mockResolvedValue([pass({ request: { id: 'req-1', status: 'pending', decline_reason: null, requested_at: '2026-11-24T02:00:00.000Z', decided_at: null } })])
    renderAccount()

    await user.click(await screen.findByRole('button', { name: 'Become a member' }))

    expect(api.requestMembership).toHaveBeenCalledWith('u-member', 'club-gensan')
    expect(await screen.findByText(/Membership request sent/)).toBeInTheDocument()
    expect(screen.getByText(/Pay Rally Point Gensan at the front desk or by the club's GCash/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Withdraw request' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Become a member' })).not.toBeInTheDocument()
  })

  it('withdraws a pending request', async () => {
    const user = userEvent.setup()
    const pending = pass({ request: { id: 'req-9', status: 'pending', decline_reason: null, requested_at: '2026-11-24T02:00:00.000Z', decided_at: null } })
    vi.mocked(api.myMemberPasses).mockResolvedValueOnce([pending]).mockResolvedValue([pass()])
    renderAccount()

    await user.click(await screen.findByRole('button', { name: 'Withdraw request' }))
    expect(api.cancelMembershipRequest).toHaveBeenCalledWith('u-member', 'req-9')
    expect(await screen.findByRole('button', { name: 'Become a member' })).toBeInTheDocument()
  })

  it('shows why the last request was declined and lets the player ask again', async () => {
    vi.mocked(api.myMemberPasses).mockResolvedValue([
      pass({ request: { id: 'req-2', status: 'declined', decline_reason: 'Payment not received yet', requested_at: '2026-11-20T00:00:00.000Z', decided_at: '2026-11-21T00:00:00.000Z' } }),
    ])
    renderAccount()

    expect(await screen.findByText('Reason: Payment not received yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Become a member' })).toBeEnabled()
  })

  it('shows the error on the club card when a request is refused', async () => {
    const user = userEvent.setup()
    vi.mocked(api.myMemberPasses).mockResolvedValue([pass()])
    vi.mocked(api.requestMembership).mockRejectedValue(new Error('You already asked this club. Staff will confirm it at the desk.'))
    renderAccount()

    await user.click(await screen.findByRole('button', { name: 'Become a member' }))
    const card = screen.getByRole('article', { name: 'Rally Point Gensan' })
    expect(await within(card).findByRole('alert')).toHaveTextContent('You already asked this club.')
  })

  it('edits the full name and nickname, then refreshes the signed-in profile', async () => {
    const user = userEvent.setup()
    renderAccount()

    await user.click(screen.getByRole('button', { name: /Edit name/ }))
    const fullName = screen.getByLabelText('Full name')
    expect(fullName).toHaveValue('Jamie Player')
    expect(fullName).toHaveAttribute('maxLength', '80')
    await user.clear(fullName)
    await user.type(fullName, 'Jamie Dela Cruz')
    await user.type(screen.getByLabelText('Nickname (optional)'), 'JD')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(api.updateMyAccount).toHaveBeenCalledWith('u-member', { full_name: 'Jamie Dela Cruz', nickname: 'JD' })
    await waitFor(() => expect(state.refresh).toHaveBeenCalled())
    expect(await screen.findByText('Your name is saved.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Full name')).not.toBeInTheDocument()
  })

  it('refuses an empty name before calling the server and shows server errors', async () => {
    const user = userEvent.setup()
    vi.mocked(api.updateMyAccount).mockRejectedValue(new Error('Your nickname is limited to 30 characters'))
    renderAccount()

    await user.click(screen.getByRole('button', { name: /Edit name/ }))
    await user.clear(screen.getByLabelText('Full name'))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Please enter your name')
    expect(api.updateMyAccount).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText('Full name'), 'Jamie')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Your nickname is limited to 30 characters')).toBeInTheDocument()
    expect(screen.getByLabelText('Full name')).toBeInTheDocument()
  })

  it('adds a profile photo and removes it', async () => {
    const user = userEvent.setup()
    const { rerender } = renderAccount()
    const file = new File(['x'], 'me.jpg', { type: 'image/jpeg' })

    await user.upload(screen.getByLabelText(/Add photo/), file)
    expect(api.setMyPhoto).toHaveBeenCalledWith('u-member', file, null)
    await waitFor(() => expect(state.refresh).toHaveBeenCalled())

    state.user = { ...jamie, photo_path: 'u-member/photo.webp' }
    rerender(<MemoryRouter><MemberAccount /></MemoryRouter>)
    await user.click(screen.getByRole('button', { name: /Remove photo/ }))
    expect(api.setMyPhoto).toHaveBeenLastCalledWith('u-member', null, 'u-member/photo.webp')
  })

  it('keeps messages, charges and the rest one tap away, with the unread count', async () => {
    vi.mocked(api.notifications).mockResolvedValue([
      { id: 'n1', user_id: 'u-member', title: 'Reminder', body: 'Today', read: false, created_at: '2026-09-19T00:00:00.000Z' },
      { id: 'n2', user_id: 'u-member', title: 'Old', body: 'Yesterday', read: true, created_at: '2026-09-18T00:00:00.000Z' },
    ])
    vi.mocked(api.transactions).mockResolvedValue(Array.from({ length: 4 }, (_, i) => ({
      id: `tx-${i}`, amount: 100 + i, type: 'membership' as const, description: `Payment ${i}`, created_at: '2026-09-19T00:00:00.000Z',
    })))
    renderAccount()

    expect(await screen.findByText('Payment 2')).toBeInTheDocument()
    expect(screen.queryByText('Payment 3')).not.toBeInTheDocument()
    expect(within(screen.getByRole('link', { name: /Messages/ })).getByLabelText('1 unread')).toBeInTheDocument()
    // The site header and footer also link to Find a court; these are the page's own rows.
    const page = within(screen.getByRole('main'))
    expect(page.getByRole('link', { name: /Find a court/ })).toHaveAttribute('href', '/clubs')
    expect(page.getByRole('link', { name: /Rent a coach/ })).toHaveAttribute('href', '/member/coaches')
  })

  it('points a person with no club to Find a court', async () => {
    vi.mocked(api.myMemberPasses).mockResolvedValue([])
    renderAccount()
    expect(await screen.findByText(/You have not joined a club yet/)).toBeInTheDocument()
  })

  it('asks before logging out', async () => {
    const user = userEvent.setup()
    renderAccount()
    await screen.findByRole('article', { name: 'Rally Point Gensan' })

    await user.click(within(screen.getByRole('main')).getByRole('button', { name: 'Log out' }))
    const dialog = screen.getByRole('dialog', { name: 'Log out?' })
    expect(state.signOut).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Log out' }))
    expect(state.signOut).toHaveBeenCalledTimes(1)
  })
})
