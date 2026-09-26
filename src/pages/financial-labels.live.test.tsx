import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Profile } from '../types'
import LoginPage from './LoginPage'
import { MemberHome, MemberPay, MemberTransactions } from './member'
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
})

describe('live financial labels', () => {
  it('calls member activity recorded charges, not payments or online checkout', async () => {
    render(<MemoryRouter><MemberHome /></MemoryRouter>)
    expect(await screen.findByText('Recent charges')).toBeInTheDocument()
    expect(screen.getByText('Php 500.00 recorded')).toBeInTheDocument()
    expect(screen.getByText('Check available times')).toBeInTheDocument()
    expect(screen.queryByText('Recent payments')).not.toBeInTheDocument()
    expect(screen.queryByText('Pick time & pay')).not.toBeInTheDocument()
  })

  it('describes an empty live charge history without calling it a payment history', async () => {
    liveState.transactions.mockResolvedValue([])
    render(<MemoryRouter><MemberHome /></MemoryRouter>)
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

  it('keeps live renewal at the desk without suggesting an online payment was taken', async () => {
    render(<MemoryRouter><MemberPay /></MemoryRouter>)
    expect(await screen.findByText('RP-LIVE', { exact: false })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Renew at the desk' })).toBeInTheDocument()
    expect(screen.getByText('Renewal price')).toBeInTheDocument()
    expect(screen.getByText(/No payment is collected online/)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Online payment' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Pay Php/ })).not.toBeInTheDocument()
    expect(liveState.payMembership).not.toHaveBeenCalled()
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
    expect(screen.getByText('Availability · QR · open play')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Join as member', pressed: false }))
    expect(screen.getByText('For players only. View availability, open play, and your QR pass.')).toBeInTheDocument()
    expect(screen.queryByText(/book, pay, open play/)).not.toBeInTheDocument()
  })
})
