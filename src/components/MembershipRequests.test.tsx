import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MembershipRequest } from '../types'
import { MembershipRequests } from './MembershipRequests'

const apiMock = vi.hoisted(() => ({
  membershipRequests: vi.fn(),
  approveMembershipRequest: vi.fn(),
  declineMembershipRequest: vi.fn(),
}))

vi.mock('../lib/api', () => ({ api: apiMock }))

function request(overrides: Partial<MembershipRequest> = {}): MembershipRequest {
  return {
    id: 'mreq-1',
    member_id: 'mem_001',
    member_code: 'BR-1001',
    full_name: 'Mia Member',
    nickname: 'Mimi',
    photo_url: null,
    membership_type: null,
    member_status: 'active',
    expiry_date: null,
    status: 'pending',
    // 10:00 AM in Philippine time.
    requested_at: '2026-11-24T02:00:00.000Z',
    decided_at: null,
    decline_reason: null,
    amount: null,
    ...overrides,
  }
}

beforeEach(() => {
  Object.values(apiMock).forEach((mock) => mock.mockReset())
  apiMock.membershipRequests.mockResolvedValue([request()])
  apiMock.approveMembershipRequest.mockResolvedValue(undefined)
  apiMock.declineMembershipRequest.mockResolvedValue(undefined)
})

describe('MembershipRequests', () => {
  it('lists each pending request with what the desk needs to recognise the player', async () => {
    apiMock.membershipRequests.mockResolvedValue([
      request(),
      request({
        id: 'mreq-2', member_id: 'mem_002', member_code: 'RP-1002', full_name: 'Jonah Cruz', nickname: null,
        photo_url: 'https://example.invalid/jonah.webp', membership_type: 'basic', expiry_date: '2099-01-31',
      }),
      request({ id: 'mreq-3', member_id: 'mem_003', member_code: 'RP-1003', full_name: 'Lia Reyes', nickname: null, membership_type: 'premium', expiry_date: '2020-03-01' }),
    ])
    render(<MembershipRequests staffId="u-staff" />)

    const mia = within((await screen.findByRole('heading', { name: 'Mia Member (Mimi)' })).closest('li')!)
    expect(apiMock.membershipRequests).toHaveBeenCalledWith('pending')
    expect(screen.getByRole('heading', { name: 'Membership requests' })).toBeInTheDocument()
    expect(screen.getByText('3 waiting')).toBeInTheDocument()
    expect(mia.getByText('BR-1001')).toHaveClass('font-mono')
    expect(mia.getByText('Now: player, no membership')).toBeInTheDocument()
    expect(mia.getByText('Asked Nov 24, 2026 · 10:00 AM')).toBeInTheDocument()
    expect(mia.getByRole('img', { name: 'No photo. Initials MM' })).toBeInTheDocument()
    expect(mia.getByRole('button', { name: 'Approve' })).toBeEnabled()
    expect(mia.getByRole('button', { name: 'Decline' })).toBeEnabled()

    const jonah = within(screen.getByRole('heading', { name: 'Jonah Cruz' }).closest('li')!)
    expect(jonah.getByRole('img', { name: 'Photo of Jonah Cruz' })).toHaveAttribute('src', 'https://example.invalid/jonah.webp')
    expect(jonah.getByText('Now: Basic member until Jan 31, 2099')).toBeInTheDocument()

    const lia = within(screen.getByRole('heading', { name: 'Lia Reyes' }).closest('li')!)
    expect(lia.getByText('Now: Premium, ended Mar 1, 2020')).toBeInTheDocument()
  })

  it('approves with the chosen plan and amount, sends the staff id and takes the row off the list', async () => {
    const user = userEvent.setup()
    apiMock.membershipRequests.mockResolvedValueOnce([request()]).mockResolvedValue([])
    render(<MembershipRequests staffId="u-staff" />)

    await user.click(await screen.findByRole('button', { name: 'Approve' }))
    expect(screen.getByRole('radio', { name: 'Standard' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Basic' })).toHaveFocus()
    await user.click(screen.getByRole('radio', { name: 'Premium' }))
    await user.type(screen.getByRole('textbox', { name: 'Amount received (PHP)' }), '1,500')
    await user.click(screen.getByRole('button', { name: 'Approve membership' }))

    expect(apiMock.approveMembershipRequest).toHaveBeenCalledWith('mreq-1', { membership_type: 'premium', amount: 1500 }, 'u-staff')
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(
      'Membership approved for Mia Member: Premium, Php 1,500.00 received. 30 days were added and the member rate now applies.',
    ))
    expect(screen.queryByRole('heading', { name: 'Mia Member (Mimi)' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Membership requests' })).toHaveFocus()
    expect(await screen.findByText('No membership requests waiting.')).toBeInTheDocument()
    expect(apiMock.declineMembershipRequest).not.toHaveBeenCalled()
  })

  it('accepts 0 for a free membership and keeps the default Standard plan', async () => {
    const user = userEvent.setup()
    render(<MembershipRequests staffId="u-staff" />)
    await user.click(await screen.findByRole('button', { name: 'Approve' }))
    await user.type(screen.getByRole('textbox', { name: 'Amount received (PHP)' }), '0')
    await user.click(screen.getByRole('button', { name: 'Approve membership' }))
    expect(apiMock.approveMembershipRequest).toHaveBeenCalledWith('mreq-1', { membership_type: 'standard', amount: 0 }, 'u-staff')
  })

  it('needs an amount before approving', async () => {
    const user = userEvent.setup()
    render(<MembershipRequests staffId="u-staff" />)
    await user.click(await screen.findByRole('button', { name: 'Approve' }))
    await user.click(screen.getByRole('button', { name: 'Approve membership' }))

    const amount = screen.getByRole('textbox', { name: 'Amount received (PHP)' })
    expect(screen.getByText('Enter the amount received. Type 0 if the player paid nothing.')).toBeInTheDocument()
    expect(amount).toHaveAttribute('aria-invalid', 'true')
    expect(amount).toHaveFocus()

    await user.type(amount, '-5')
    await user.click(screen.getByRole('button', { name: 'Approve membership' }))
    expect(screen.getByText('Enter the amount received (0 or more), like 500 or 500.50.')).toBeInTheDocument()
    expect(apiMock.approveMembershipRequest).not.toHaveBeenCalled()
  })

  it('requires a reason to decline, then sends it with the staff id', async () => {
    const user = userEvent.setup()
    apiMock.membershipRequests.mockResolvedValueOnce([request()]).mockResolvedValue([])
    render(<MembershipRequests staffId="u-staff" />)

    await user.click(await screen.findByRole('button', { name: 'Decline' }))
    const reason = screen.getByRole('textbox', { name: 'Reason the player will see' })
    expect(reason).toHaveFocus()
    expect(reason).toHaveAttribute('maxlength', '300')

    await user.click(screen.getByRole('button', { name: 'Decline request' }))
    expect(screen.getByText('Please give a reason the player will see.')).toBeInTheDocument()
    expect(reason).toHaveAttribute('aria-invalid', 'true')
    expect(apiMock.declineMembershipRequest).not.toHaveBeenCalled()

    await user.type(reason, '  No payment received yet  ')
    expect(screen.getByText('23 of 300 letters')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Decline request' }))
    expect(apiMock.declineMembershipRequest).toHaveBeenCalledWith('mreq-1', 'No payment received yet', 'u-staff')
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Request declined: Mia Member. The player can see your reason.'))
    expect(await screen.findByText('No membership requests waiting.')).toBeInTheDocument()
    expect(apiMock.approveMembershipRequest).not.toHaveBeenCalled()
  })

  it('closes a form on Cancel without sending anything', async () => {
    const user = userEvent.setup()
    render(<MembershipRequests staffId="u-staff" />)
    await user.click(await screen.findByRole('button', { name: 'Decline' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('textbox', { name: 'Reason the player will see' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled()
    expect(apiMock.declineMembershipRequest).not.toHaveBeenCalled()
  })

  it('keeps the request and shows the error when saving fails', async () => {
    const user = userEvent.setup()
    apiMock.approveMembershipRequest.mockRejectedValueOnce(new Error('Only club staff can manage membership requests'))
    render(<MembershipRequests staffId="u-staff" />)

    await user.click(await screen.findByRole('button', { name: 'Approve' }))
    await user.type(screen.getByRole('textbox', { name: 'Amount received (PHP)' }), '500')
    await user.click(screen.getByRole('button', { name: 'Approve membership' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Only club staff can manage membership requests')
    await waitFor(() => expect(apiMock.membershipRequests).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('heading', { name: 'Mia Member (Mimi)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve membership' })).toBeEnabled()
  })

  it('says so above the list when another staff member already decided the request', async () => {
    const user = userEvent.setup()
    apiMock.membershipRequests.mockResolvedValueOnce([request()]).mockResolvedValue([])
    apiMock.declineMembershipRequest.mockRejectedValueOnce(new Error('This request has already been decided'))
    render(<MembershipRequests staffId="u-staff" />)

    await user.click(await screen.findByRole('button', { name: 'Decline' }))
    await user.type(screen.getByRole('textbox', { name: 'Reason the player will see' }), 'Not paid')
    await user.click(screen.getByRole('button', { name: 'Decline request' }))

    expect(await screen.findByText('No membership requests waiting.')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Mia Member: This request has already been decided. It is no longer waiting, so it has left the list.',
    )
    expect(screen.getByRole('heading', { name: 'Membership requests' })).toHaveFocus()
  })

  it('shows plain words while saving and when an error has no message', async () => {
    const user = userEvent.setup()
    let fail!: (reason: unknown) => void
    apiMock.approveMembershipRequest.mockReturnValueOnce(new Promise((_, reject) => { fail = reject }))
    render(<MembershipRequests staffId="u-staff" />)

    await user.click(await screen.findByRole('button', { name: 'Approve' }))
    await user.type(screen.getByRole('textbox', { name: 'Amount received (PHP)' }), '500')
    await user.click(screen.getByRole('button', { name: 'Approve membership' }))
    expect(screen.getByRole('button', { name: /Saving/ })).toHaveAttribute('aria-busy', 'true')
    await act(async () => fail('offline'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save that. Check your connection and try again.')
  })

  it('cannot decide anything until the signed-in staff member is known', async () => {
    render(<MembershipRequests staffId={undefined} />)
    expect(await screen.findByRole('button', { name: 'Approve' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Decline' })).toBeDisabled()
  })

  it('shows the empty state and refreshes on demand', async () => {
    const user = userEvent.setup()
    apiMock.membershipRequests.mockResolvedValue([])
    render(<MembershipRequests staffId="u-staff" />)
    expect(await screen.findByText('No membership requests waiting.')).toBeInTheDocument()

    apiMock.membershipRequests.mockResolvedValueOnce([request()])
    await user.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByRole('heading', { name: 'Mia Member (Mimi)' })).toBeInTheDocument()
    expect(apiMock.membershipRequests).toHaveBeenCalledTimes(2)
  })

  it('says plainly when the list cannot load', async () => {
    apiMock.membershipRequests.mockRejectedValue(new Error('Only club staff can manage membership requests'))
    render(<MembershipRequests staffId="u-staff" />)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not load membership requests. Only club staff can manage membership requests',
    )
    await waitFor(() => expect(screen.queryByText('Loading membership requests…')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled()
  })

  it('shows recently decided requests on demand', async () => {
    const user = userEvent.setup()
    apiMock.membershipRequests.mockImplementation(async (which: string) => which === 'decided'
      ? [
          request({ id: 'mreq-a', status: 'approved', amount: 500, decided_at: '2026-11-23T03:00:00.000Z' }),
          request({ id: 'mreq-d', full_name: 'Jonah Cruz', nickname: null, status: 'declined', decline_reason: 'No payment received', decided_at: '2026-11-22T03:00:00.000Z' }),
        ]
      : [])
    render(<MembershipRequests staffId="u-staff" />)
    await screen.findByText('No membership requests waiting.')

    const toggle = screen.getByRole('button', { name: 'Show recently decided' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await user.click(toggle)
    const decided = within(await screen.findByRole('list', { name: 'Recently decided requests' }))
    expect(apiMock.membershipRequests).toHaveBeenCalledWith('decided')
    expect(decided.getByText('Approved')).toBeInTheDocument()
    expect(decided.getByText(/Php 500\.00 received/)).toBeInTheDocument()
    expect(decided.getByText('Declined')).toBeInTheDocument()
    expect(decided.getByText(/No payment received/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hide recently decided' })).toHaveAttribute('aria-expanded', 'true')
  })
})
