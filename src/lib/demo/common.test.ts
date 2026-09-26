import { beforeEach, describe, expect, it } from 'vitest'
import { demoStore } from '../demoStore'
import { isSlotFree } from './common'

describe('demo slot checks', () => {
  beforeEach(() => demoStore.reset())

  it('blocks active sessions and pending bookings but ignores cancelled records', () => {
    const db = demoStore.get()
    const start_at = '2030-06-01T10:00:00.000Z'
    const end_at = '2030-06-01T11:00:00.000Z'
    const slot = { courtId: 'court_2', start_at, end_at }
    expect(isSlotFree(db, slot)).toBe(true)

    db.bookings.push({
      id: 'candidate', court_id: slot.courtId, member_id: 'mem_001', start_at, end_at,
      hours: 1, amount: 500, status: 'pending_payment', payment_method: null,
      payment_ref: null, session_id: null, created_at: start_at,
    })
    expect(isSlotFree(db, slot)).toBe(false)
    expect(isSlotFree(db, { ...slot, ignoreBookingId: 'candidate' })).toBe(true)

    db.bookings[0].status = 'cancelled'
    expect(isSlotFree(db, slot)).toBe(true)
    db.sessions.push({
      id: 'active', court_id: slot.courtId, member_id: 'mem_001', start_at, end_at,
      status: 'scheduled', amount: 500, created_by: 'user_staff',
    })
    expect(isSlotFree(db, slot)).toBe(false)
    db.sessions[db.sessions.length - 1].status = 'completed'
    expect(isSlotFree(db, slot)).toBe(true)
  })
})
