import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MembershipRequest } from '../types'
import { AdminBookings, StaffBookings } from './BookingsDesk'

const apiMock = vi.hoisted(() => ({
  listVenues: vi.fn(),
  listBookings: vi.fn(),
  paymentsToConfirm: vi.fn(),
  membershipRequests: vi.fn(),
  approveMembershipRequest: vi.fn(),
  declineMembershipRequest: vi.fn(),
}))

vi.mock('../lib/api', () => ({ api: apiMock }))

const auth = vi.hoisted(() => ({
  user: { id: 'u-admin', email: 'admin@example.invalid', full_name: 'Ada Admin', role: 'admin' },
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: auth.user, signOut: vi.fn() }),
}))

const pending: MembershipRequest = {
  id: 'mreq-1', member_id: 'mem_002', member_code: 'BR-1002', full_name: 'Jonah Cruz', nickname: 'JC',
  photo_url: null, membership_type: null, member_status: 'active', expiry_date: null, status: 'pending',
  requested_at: '2026-11-24T02:00:00.000Z', decided_at: null, decline_reason: null, amount: null,
}

beforeEach(() => {
  Object.values(apiMock).forEach((mock) => mock.mockReset())
  auth.user = { id: 'u-admin', email: 'admin@example.invalid', full_name: 'Ada Admin', role: 'admin' }
  apiMock.listVenues.mockResolvedValue([{ id: 'venue-1', club_id: 'club-1', name: 'Main', timezone: 'Asia/Manila', open_hour: 6, close_hour: 22, is_active: true }])
  apiMock.listBookings.mockResolvedValue([])
  apiMock.paymentsToConfirm.mockResolvedValue([])
  apiMock.membershipRequests.mockResolvedValueOnce([pending]).mockResolvedValue([])
  apiMock.approveMembershipRequest.mockResolvedValue(undefined)
})

describe('membership requests on the Bookings desk', () => {
  it('sit with the GCash payment confirmations for staff', async () => {
    auth.user = { id: 'u-staff', email: 'staff@example.invalid', full_name: 'Sam Staff', role: 'staff' }
    render(<MemoryRouter><StaffBookings /></MemoryRouter>)

    expect(await screen.findByRole('heading', { name: 'Jonah Cruz (JC)' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Membership requests' })).toBeInTheDocument()
    expect(screen.getByText('Confirm GCash payments and memberships, and see player bookings')).toBeInTheDocument()
    // Payments load once the venue list arrives, which can be after the membership list.
    await waitFor(() => expect(apiMock.paymentsToConfirm).toHaveBeenCalled())
    expect(apiMock.membershipRequests).toHaveBeenCalledWith('pending')
  })

  it('lets an admin approve a request with their own id', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><AdminBookings /></MemoryRouter>)

    const row = within((await screen.findByRole('heading', { name: 'Jonah Cruz (JC)' })).closest('li')!)
    await user.click(row.getByRole('button', { name: 'Approve' }))
    await user.click(screen.getByRole('radio', { name: 'Basic' }))
    await user.type(screen.getByRole('textbox', { name: 'Amount received (PHP)' }), '300')
    await user.click(screen.getByRole('button', { name: 'Approve membership' }))

    expect(apiMock.approveMembershipRequest).toHaveBeenCalledWith('mreq-1', { membership_type: 'basic', amount: 300 }, 'u-admin')
    expect(await screen.findByText('No membership requests waiting.')).toBeInTheDocument()
  })
})
