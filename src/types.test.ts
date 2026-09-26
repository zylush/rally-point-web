import { describe, expect, it } from 'vitest'
import {
  CLUB_CLOSE_HOUR,
  CLUB_OPEN_HOUR,
  fmtDate,
  fmtDateTime,
  fmtTime,
  friendlyStatus,
  hourLabel,
  localRangeISO,
  parseQrPayload,
  peso,
  qrPayload,
  ymdLocal,
} from './types'

describe('shared formatting and QR helpers', () => {
  it('round-trips signed QR payloads and accepts member-code shortcuts', () => {
    expect(qrPayload('RP-1001', 'QR_MIA')).toBe('RP1|RP-1001|QR_MIA')
    expect(parseQrPayload(' RP1|RP-1001|QR_MIA ')).toEqual({ member_code: 'RP-1001', token: 'QR_MIA' })
    expect(parseQrPayload('rp-1002')).toEqual({ member_code: 'RP-1002', token: '' })
    expect(parseQrPayload('not-a-qr')).toBeNull()
    expect(parseQrPayload('RP1|missing')).toBeNull()
  })

  it('maps user-facing statuses and preserves unknown words', () => {
    const known = [
      'active', 'expired', 'pending', 'suspended', 'confirmed', 'pending_payment',
      'cancelled', 'completed', 'no_show', 'scheduled', 'playing', 'open', 'full',
      'joined', 'waitlist', 'available', 'occupied', 'maintenance', 'basic', 'standard', 'premium',
    ]
    for (const status of known) expect(friendlyStatus(status)).not.toBe(status)
    expect(friendlyStatus('some_new_status')).toBe('some new status')
  })

  it('formats PHP, dates, times, and local ranges consistently', () => {
    const date = new Date('2026-09-20T14:05:00.000Z')
    expect(peso(2500)).toBe('Php 2,500.00')
    expect(fmtDate(date.toISOString())).toContain('2026')
    expect(fmtTime(date.toISOString())).toMatch(/\d{1,2}:05/)
    expect(fmtDateTime(date.toISOString())).toContain('·')
    expect(hourLabel(CLUB_OPEN_HOUR)).toMatch(/\d{1,2}:00/)
    expect(ymdLocal(new Date(2026, 8, 20))).toBe('2026-09-20')
    const range = localRangeISO('2026-09-20', CLUB_OPEN_HOUR, 2)
    expect(new Date(range.end_at).getTime() - new Date(range.start_at).getTime()).toBe(2 * 3600000)
    expect(CLUB_CLOSE_HOUR).toBeGreaterThan(CLUB_OPEN_HOUR)
  })
})
