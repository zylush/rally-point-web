import { beforeEach, describe, expect, it } from 'vitest'
import { api } from '../api'
import { demoStore } from '../demoStore'

// Mirrors 20261128100600_support_inquiry_insert_guard.sql: whatever the sender adds, a new
// inquiry starts open and unanswered, and only the admin update answers it.
describe('new support inquiries start unanswered', () => {
  beforeEach(() => {
    localStorage.clear()
    demoStore.reset()
  })

  it('ignores a status, response, responder or date sent with a new inquiry', async () => {
    const staff = demoStore.login('staff@brinely.info', 'staff123')
    const forged = {
      user_id: staff.id,
      category: 'booking' as const,
      subject: 'Forged answer',
      message: 'Looks answered.',
      status: 'resolved',
      response: 'Fixed by admin',
      responded_by: 'user_admin',
      responded_at: '2026-01-01T00:00:00.000Z',
      created_at: '2020-01-01T00:00:00.000Z',
    }
    const inquiry = await api.createInquiry(forged)
    expect(inquiry.status).toBe('open')
    expect(inquiry.response ?? null).toBeNull()
    expect(inquiry.responded_by ?? null).toBeNull()
    expect(inquiry.responded_at ?? null).toBeNull()
    expect(inquiry.created_at).not.toBe('2020-01-01T00:00:00.000Z')

    demoStore.login('admin@brinely.info', 'admin123')
    const answered = await api.updateInquiry({ id: inquiry.id, status: 'resolved', response: 'Real answer' })
    expect(answered).toMatchObject({ status: 'resolved', response: 'Real answer', responded_by: 'user_admin' })
  })
})
