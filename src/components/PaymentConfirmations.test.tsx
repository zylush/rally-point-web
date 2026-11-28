import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Booking, Court, Member } from '../types'
import { PaymentConfirmations } from './PaymentConfirmations'

const apiMock = vi.hoisted(() => ({
  paymentsToConfirm: vi.fn(),
  confirmBookingPayment: vi.fn(),
  rejectBookingPayment: vi.fn(),
}))

vi.mock('../lib/api', () => ({ api: apiMock }))

const court: Court = { id: 'court_2', name: 'Court B', status: 'available', hourly_rate: 500 }
const member: Member = {
  id: 'mem_001',
  user_id: 'user_member',
  member_code: 'RP-1001',
  full_name: 'Mia Member',
  email: 'member@brinely.info',
  phone: null,
  membership_type: null,
  status: 'active',
  join_date: '2026-11-01',
  expiry_date: null,
  notes: null,
  qr_token: 'QR_MIA',
  created_at: '2026-11-01T00:00:00.000Z',
}

/** A payment the player sent `sentMinutesAgo` minutes ago; the club has 15 minutes from then. */
function request(overrides: Partial<Booking> = {}, sentMinutesAgo = 3): Booking {
  const sentAt = Date.now() - sentMinutesAgo * 60000
  return {
    id: 'booking-1',
    court_id: court.id,
    member_id: member.id,
    // 2:00 PM to 4:00 PM in Philippine time.
    start_at: '2026-11-23T06:00:00.000Z',
    end_at: '2026-11-23T08:00:00.000Z',
    hours: 2,
    amount: 1000,
    status: 'pending_payment',
    payment_method: 'gcash',
    payment_ref: null,
    payment_reference: '1234567890123',
    payment_submitted_at: new Date(sentAt).toISOString(),
    confirm_by: new Date(sentAt + 15 * 60000).toISOString(),
    created_at: new Date(sentAt).toISOString(),
    court,
    member,
    ...overrides,
  }
}

beforeEach(() => {
  Object.values(apiMock).forEach((mock) => mock.mockReset())
  apiMock.paymentsToConfirm.mockResolvedValue([request()])
  apiMock.confirmBookingPayment.mockResolvedValue({ ...request(), status: 'confirmed' })
  apiMock.rejectBookingPayment.mockResolvedValue({ ...request(), status: 'cancelled' })
})

describe('PaymentConfirmations', () => {
  it('lists each payment with what the desk needs to check it', async () => {
    render(<PaymentConfirmations venueId="venue-main" />)
    const card = (await screen.findByRole('heading', { name: 'Mia Member' })).closest('li')!
    expect(apiMock.paymentsToConfirm).toHaveBeenCalledWith('venue-main')
    expect(screen.getByRole('heading', { name: 'Payments to confirm' })).toBeInTheDocument()
    expect(screen.getByText('1 waiting')).toBeInTheDocument()

    const row = within(card)
    expect(row.getByText(/Court B · Nov 23, 2026/)).toBeInTheDocument()
    expect(row.getByText('2:00 PM – 4:00 PM · 2 hours')).toBeInTheDocument()
    expect(row.getByText('Php 1,000.00')).toBeInTheDocument()
    expect(row.getByText('1234567890123')).toHaveClass('font-mono')
    expect(row.getByText(/Player sent this at \d{1,2}:\d\d [AP]M/)).toBeInTheDocument()
    expect(row.getByText('12 minutes left to confirm')).toBeInTheDocument()
    expect(row.queryByText(/Overdue/)).not.toBeInTheDocument()
    expect(row.getByRole('button', { name: 'Payment received' })).toBeEnabled()
    expect(row.getByRole('button', { name: 'Not received' })).toBeEnabled()
  })

  it('shows a request past its time in red as overdue, at the top of the list', async () => {
    apiMock.paymentsToConfirm.mockResolvedValue([
      request(),
      request({ id: 'booking-late', member: { ...member, id: 'mem_002', full_name: 'Jonah Cruz' } }, 20),
    ])
    render(<PaymentConfirmations venueId="venue-main" />)

    const overdue = await screen.findByText('Overdue — the player is waiting')
    expect(overdue).toHaveClass('text-red-700')
    expect(screen.getByText('2 waiting · 1 overdue')).toBeInTheDocument()
    const [first, second] = screen.getAllByRole('listitem')
    expect(within(first).getByRole('heading', { name: 'Jonah Cruz' })).toBeInTheDocument()
    expect(within(first).getByText('Overdue — the player is waiting')).toBeInTheDocument()
    expect(within(second).getByText(/minutes left to confirm/)).toBeInTheDocument()
  })

  it('confirms a payment, takes it off the list and says what happened', async () => {
    const user = userEvent.setup()
    const onDecided = vi.fn()
    apiMock.paymentsToConfirm.mockResolvedValueOnce([request()]).mockResolvedValue([])
    render(<PaymentConfirmations venueId="venue-main" onDecided={onDecided} />)

    await user.click(await screen.findByRole('button', { name: 'Payment received' }))
    expect(apiMock.confirmBookingPayment).toHaveBeenCalledWith('booking-1')
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(
      'Payment received: Mia Member, Court B at 2:00 PM. The hours now show as Booked',
    ))
    expect(screen.queryByRole('heading', { name: 'Mia Member' })).not.toBeInTheDocument()
    // The decided row is gone, so focus goes to the list heading instead of the top of the page.
    expect(screen.getByRole('heading', { name: 'Payments to confirm' })).toHaveFocus()
    expect(onDecided).toHaveBeenCalledWith(expect.objectContaining({ id: 'booking-1', status: 'confirmed' }))
    expect(await screen.findByText('No payments waiting.')).toBeInTheDocument()
    expect(apiMock.rejectBookingPayment).not.toHaveBeenCalled()
  })

  it('asks why a payment was not received and sends that reason', async () => {
    const user = userEvent.setup()
    const onDecided = vi.fn()
    apiMock.paymentsToConfirm.mockResolvedValueOnce([request()]).mockResolvedValue([])
    render(<PaymentConfirmations venueId="venue-main" onDecided={onDecided} />)

    await user.click(await screen.findByRole('button', { name: 'Not received' }))
    const quick = screen.getByRole('button', { name: 'No payment with this reference' })
    expect(quick).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Wrong amount' })).toHaveAttribute('aria-pressed', 'false')

    // A reason is needed before anything is sent.
    await user.click(screen.getByRole('button', { name: 'Mark as not received' }))
    expect(screen.getByText('Pick a reason or type one, so the player knows what went wrong.')).toBeInTheDocument()
    const reason = screen.getByRole('textbox', { name: 'Reason the player will see' })
    expect(reason).toHaveAttribute('aria-invalid', 'true')
    expect(reason).toHaveAttribute('maxlength', '200')
    expect(apiMock.rejectBookingPayment).not.toHaveBeenCalled()

    // A quick choice fills the reason, and the desk can add to it.
    await user.click(screen.getByRole('button', { name: 'Wrong amount' }))
    expect(reason).toHaveValue('Wrong amount')
    expect(screen.getByRole('button', { name: 'Wrong amount' })).toHaveAttribute('aria-pressed', 'true')
    await user.type(reason, ': we got Php 900')
    expect(screen.getByText('28 of 200 letters')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Mark as not received' }))
    expect(apiMock.rejectBookingPayment).toHaveBeenCalledWith('booking-1', 'Wrong amount: we got Php 900')
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Marked as not received: Mia Member, Court B at 2:00 PM.'))
    expect(screen.getByRole('heading', { name: 'Payments to confirm' })).toHaveFocus()
    expect(onDecided).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }))
    expect(await screen.findByText('No payments waiting.')).toBeInTheDocument()
    expect(apiMock.confirmBookingPayment).not.toHaveBeenCalled()
  })

  it('closes the reason form on Cancel without sending anything', async () => {
    const user = userEvent.setup()
    render(<PaymentConfirmations venueId="venue-main" />)
    await user.click(await screen.findByRole('button', { name: 'Not received' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('textbox', { name: 'Reason the player will see' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Payment received' })).toBeEnabled()
    expect(apiMock.rejectBookingPayment).not.toHaveBeenCalled()
  })

  it('keeps the request, says why and checks the list again at once when saving fails', async () => {
    const user = userEvent.setup()
    apiMock.confirmBookingPayment.mockRejectedValueOnce(new Error('Could not reach bRineLy. Check your connection and try again.'))
    render(<PaymentConfirmations venueId="venue-main" />)

    await user.click(await screen.findByRole('button', { name: 'Payment received' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach bRineLy. Check your connection and try again.')
    // The list is fetched again right away, not at the next 20-second check; the request is still waiting.
    await waitFor(() => expect(apiMock.paymentsToConfirm).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('heading', { name: 'Mia Member' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Could not reach bRineLy.')
    expect(screen.getByRole('button', { name: 'Payment received' })).toBeEnabled()
  })

  it('says so above the list when another staff member already decided the request', async () => {
    const user = userEvent.setup()
    apiMock.paymentsToConfirm.mockResolvedValueOnce([request()]).mockResolvedValue([])
    apiMock.rejectBookingPayment.mockRejectedValueOnce(new Error('This payment is already confirmed'))
    render(<PaymentConfirmations venueId="venue-main" />)

    await user.click(await screen.findByRole('button', { name: 'Not received' }))
    await user.click(screen.getByRole('button', { name: 'Wrong amount' }))
    await user.click(screen.getByRole('button', { name: 'Mark as not received' }))

    expect(await screen.findByText('No payments waiting.')).toBeInTheDocument()
    expect(apiMock.paymentsToConfirm).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Mia Member, Court B at 2:00 PM: This payment is already confirmed. It is no longer waiting, so it has left the list.',
    )
    expect(screen.getByRole('heading', { name: 'Payments to confirm' })).toHaveFocus()
    expect(screen.queryByRole('status')).toBeEmptyDOMElement()
  })

  it('shows plain words while saving and when an error has no message', async () => {
    const user = userEvent.setup()
    let fail!: (reason: unknown) => void
    apiMock.confirmBookingPayment.mockReturnValueOnce(new Promise((_, reject) => { fail = reject }))
    render(<PaymentConfirmations venueId="venue-main" />)

    await user.click(await screen.findByRole('button', { name: 'Payment received' }))
    expect(screen.getByRole('button', { name: /Saving/ })).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('button', { name: 'Not received' })).toBeDisabled()
    await act(async () => fail('offline'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save that. Check your connection and try again.')
  })

  it('shows the empty state and refreshes on demand', async () => {
    const user = userEvent.setup()
    apiMock.paymentsToConfirm.mockResolvedValue([])
    render(<PaymentConfirmations venueId="venue-main" />)
    expect(await screen.findByText('No payments waiting.')).toBeInTheDocument()
    expect(apiMock.paymentsToConfirm).toHaveBeenCalledTimes(1)

    apiMock.paymentsToConfirm.mockResolvedValueOnce([request()])
    await user.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByRole('heading', { name: 'Mia Member' })).toBeInTheDocument()
    expect(apiMock.paymentsToConfirm).toHaveBeenCalledTimes(2)
  })

  it('checks for new payments every 20 seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      apiMock.paymentsToConfirm.mockResolvedValue([])
      render(<PaymentConfirmations venueId="venue-main" />)
      expect(await screen.findByText('No payments waiting.')).toBeInTheDocument()

      apiMock.paymentsToConfirm.mockResolvedValue([request()])
      await act(async () => { await vi.advanceTimersByTimeAsync(20000) })
      expect(apiMock.paymentsToConfirm).toHaveBeenCalledTimes(2)
      expect(await screen.findByRole('heading', { name: 'Mia Member' })).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('says plainly when the list cannot load', async () => {
    apiMock.paymentsToConfirm.mockRejectedValue(new Error('Network is offline.'))
    render(<PaymentConfirmations venueId="venue-main" />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load payments to confirm. Network is offline.')
    await waitFor(() => expect(screen.queryByText('Loading payments to confirm…')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled()
  })
})
