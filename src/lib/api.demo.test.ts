import { beforeEach, describe, expect, it, vi } from 'vitest'
import { demoStore } from './demoStore'

vi.mock('./supabase', () => ({ isDemoMode: true, supabase: null }))
vi.mock('./demoStore', () => ({
  demoStore: {
    payMembership: vi.fn(),
  },
}))

describe('api membership renewal in demo mode', () => {
  beforeEach(() => vi.clearAllMocks())

  it('delegates safely without requiring a Supabase client', async () => {
    const { api } = await import('./api')

    await expect(
      api.payMembership('member-1', 2500, 'user-1'),
    ).resolves.toBeUndefined()
    expect(demoStore.payMembership).toHaveBeenCalledWith(
      'member-1',
      2500,
      'user-1',
    )
  })
})

describe('api booking email in demo mode', () => {
  it('shows the receipt note without calling any email service', async () => {
    const { api } = await import('./api')

    // With no Supabase client, any call to the email function would fail and report nothing sent.
    const result = await api.sendBookingConfirmationEmail({
      booking: {
        id: 'booking-1',
        court_id: 'court-1',
        member_id: 'member-1',
        start_at: '2026-11-24T10:00:00.000Z',
        end_at: '2026-11-24T12:00:00.000Z',
        hours: 2,
        amount: 900,
        status: 'confirmed',
        created_at: '2026-11-23T00:00:00.000Z',
        court: { id: 'court-1', name: 'Court 2', status: 'available', hourly_rate: 450 },
      },
      recipientEmail: 'player@example.com',
    })
    expect(result.sent).toBe(true)
    expect(result.preview).toContain('Receipt sent to player@example.com for Court 2')
  })
})
