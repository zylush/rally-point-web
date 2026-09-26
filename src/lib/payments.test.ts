import { describe, expect, it, vi } from 'vitest'
import { makePaymentRef, paymentConfig, simulateCheckout, startCheckout } from './payments'

describe('payment adapter', () => {
  it('exposes the supported methods and creates pending intents', async () => {
    expect(paymentConfig.methods.map((method) => method.id)).toEqual(['gcash', 'maya', 'card'])
    const intent = await startCheckout({
      bookingId: 'booking-1',
      amount: 2500,
      method: 'gcash',
      description: 'Court booking',
    })
    expect(intent).toMatchObject({ booking_id: 'booking-1', amount: 2500, method: 'gcash', status: 'pending' })
    expect(intent.id).toMatch(/^pi_/)
    expect(makePaymentRef('demo_wallet')).toMatch(/^DEMO_-/)
  })

  it('returns failed for zero amounts and paid for positive amounts', async () => {
    vi.useFakeTimers()
    try {
      const failedPromise = simulateCheckout({
        id: 'intent-zero', booking_id: 'booking-1', amount: 0, method: 'card', status: 'pending', checkout_url: null, created_at: new Date().toISOString(),
      })
      await vi.advanceTimersByTimeAsync(900)
      await expect(failedPromise).resolves.toEqual({ status: 'failed', ref: 'intent-zero' })

      const paidPromise = simulateCheckout({
        id: 'intent-paid', booking_id: 'booking-1', amount: 1, method: 'maya', status: 'pending', checkout_url: null, created_at: new Date().toISOString(),
      })
      await vi.advanceTimersByTimeAsync(900)
      const result = await paidPromise
      expect(result.status).toBe('paid')
      expect(result.ref).toMatch(/^MAYA-/)
    } finally {
      vi.useRealTimers()
    }
  })
})
