import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Profile } from '../types'
import LoginPage from './LoginPage'
import { MemberTransactions } from './member'
import { MemberAccount } from './MemberAccount'
import { AdminHome, AdminTransactions } from './admin'

const liveState = vi.hoisted(() => ({
  user: {
    id: 'member-live',
    email: 'member@example.invalid',
    full_name: 'Mia Member',
    phone: null,
    role: 'member',
    created_at: '2026-09-23T00:00:00.000Z',
  } as Profile | null,
  memberForUser: vi.fn(),
  notifications: vi.fn(),
  transactions: vi.fn(),
  stats: vi.fn(),
  payMembership: vi.fn(),
  myMemberPasses: vi.fn(),
  requestMembership: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({ isDemoMode: false, supabase: null }))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: liveState.user,
    loading: false,
    demo: false,
    signIn: vi.fn(),
    signUpMember: vi.fn(),
    resetPassword: vi.fn(),
    signOut: vi.fn(),
    refresh: vi.fn(),
  }),
}))
vi.mock('../lib/api', () => ({
  api: {
    memberForUser: liveState.memberForUser,
    notifications: liveState.notifications,
    transactions: liveState.transactions,
    stats: liveState.stats,
    payMembership: liveState.payMembership,
    myMemberPasses: liveState.myMemberPasses,
    requestMembership: liveState.requestMembership,
  },
}))

const member = {
  id: 'membership-live',
  user_id: 'member-live',
  member_code: 'RP-LIVE',
  full_name: 'Mia Member',
  email: 'member@example.invalid',
  phone: null,
  membership_type: 'standard',
  status: 'active',
  join_date: '2026-09-01',
  expiry_date: '2026-10-01',
  notes: null,
  qr_token: null,
  created_at: '2026-09-01T00:00:00.000Z',
}
const livePass = {
  club_id: 'club-live',
  club_slug: 'live-club',
  club_name: 'Live Club',
  member_id: 'membership-live',
  member_code: 'RP-LIVE',
  full_name: 'Mia Member',
  membership_type: 'standard',
  status: 'active',
  expiry_date: '2026-09-01',
  is_active_member: false,
  qr_token: 'token-live',
  request: null,
}
const charge = {
  id: 'charge-live',
  member_id: member.id,
  amount: 500,
  type: 'court_rental',
  description: 'Court rental',
  verification_status: 'unverified',
  created_at: '2026-09-23T08:00:00.000Z',
}

beforeEach(() => {
  liveState.user = { id: 'member-live', email: 'member@example.invalid', full_name: 'Mia Member', phone: null, role: 'member', created_at: '2026-09-23T00:00:00.000Z' }
  liveState.memberForUser.mockReset().mockResolvedValue(member)
  liveState.notifications.mockReset().mockResolvedValue([])
  liveState.transactions.mockReset().mockResolvedValue([charge])
  liveState.stats.mockReset().mockResolvedValue({ members: 1, active_now: 0, revenue_today: 500, courts_occupied: 0 })
  liveState.payMembership.mockReset()
  liveState.myMemberPasses.mockReset().mockResolvedValue([livePass])
  liveState.requestMembership.mockReset().mockResolvedValue('request-live')
})

describe('live financial labels', () => {
  it('calls member activity recorded charges, not payments or online checkout', async () => {
    render(<MemoryRouter><MemberAccount /></MemoryRouter>)
    expect(await screen.findByText('Recent charges')).toBeInTheDocument()
    expect(screen.getByText('Php 500.00 recorded')).toBeInTheDocument()
    expect(screen.queryByText('Quick actions')).not.toBeInTheDocument()
    expect(screen.queryByText('Recent payments')).not.toBeInTheDocument()
    expect(screen.queryByText('Pick time & pay')).not.toBeInTheDocument()
  })

  it('describes an empty live charge history without calling it a payment history', async () => {
    liveState.transactions.mockResolvedValue([])
    render(<MemoryRouter><MemberAccount /></MemoryRouter>)
    expect(await screen.findByText('No charges recorded yet.')).toBeInTheDocument()
    expect(screen.queryByText('No payments yet.')).not.toBeInTheDocument()
  })

  it('labels the member transaction list as recorded charges', async () => {
    render(<MemoryRouter><MemberTransactions /></MemoryRouter>)
    expect(await screen.findByText('Court rental')).toBeInTheDocument()
    expect(screen.getByText('Recorded charges')).toBeInTheDocument()
    expect(screen.getByText('Php 500.00 recorded')).toBeInTheDocument()
    expect(screen.queryByText('Your payments')).not.toBeInTheDocument()
  })

  it('asks the club to confirm a live renewal instead of taking an online payment', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><MemberAccount /></MemoryRouter>)
    await user.click(await screen.findByRole('button', { name: 'Renew membership' }))
    expect(liveState.requestMembership).toHaveBeenCalledWith('member-live', 'club-live')
    expect(liveState.payMembership).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /Pay Php/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/card number/i)).not.toBeInTheDocument()
  })

  it('labels the admin dashboard sum as recorded charges rather than collected revenue', async () => {
    liveState.user = { ...liveState.user!, role: 'admin' }
    render(<MemoryRouter><AdminHome /></MemoryRouter>)
    expect(await screen.findByText('Recorded charges today')).toBeInTheDocument()
    expect(screen.getByText('Php 500.00')).toBeInTheDocument()
    expect(screen.queryByText('Revenue today')).not.toBeInTheDocument()
  })

  it('does not title the live admin transaction ledger as revenue', async () => {
    liveState.user = { ...liveState.user!, role: 'admin' }
    render(<MemoryRouter><AdminTransactions /></MemoryRouter>)
    expect(await screen.findByText('Court rental')).toBeInTheDocument()
    expect(screen.getByText('Recorded charges')).toBeInTheDocument()
    expect(screen.queryByText('All revenue')).not.toBeInTheDocument()
  })

  it('does not advertise online payment to unauthenticated live visitors', async () => {
    liveState.user = null
    const user = userEvent.setup()
    render(<MemoryRouter><LoginPage /></MemoryRouter>)
    expect(screen.getByRole('heading', { level: 1, name: 'Log in' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sign up', pressed: false }))
    expect(screen.getByText('For players only. View availability, open play, and your QR pass.')).toBeInTheDocument()
    expect(screen.queryByText(/Book and pay for courts/)).not.toBeInTheDocument()
  })
})
