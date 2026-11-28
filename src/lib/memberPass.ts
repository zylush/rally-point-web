import type { MemberPass } from '../types'
import { fmtDate } from '../types'

/** Initials of the first and last word of a name, for when there is no photo. */
export function initialsOf(name: string | null | undefined) {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean)
  return `${words[0]?.[0] ?? ''}${words.length > 1 ? words[words.length - 1][0] : ''}`.toUpperCase() || '?'
}

export type PassTone = 'ok' | 'warn' | 'muted'

export function planName(type: MemberPass['membership_type']) {
  return type ? type.charAt(0).toUpperCase() + type.slice(1) : 'No'
}

/** How a club pass reads in plain words: member until a date, ended, or player at the regular rate. */
export function passStatus(pass: Pick<MemberPass, 'is_active_member' | 'membership_type' | 'expiry_date'>): {
  tone: PassTone
  label: string
  detail: string
} {
  if (pass.is_active_member) {
    return {
      tone: 'ok',
      label: pass.expiry_date ? `Member until ${fmtDate(pass.expiry_date)}` : 'Member',
      detail: `${planName(pass.membership_type)} plan · member rate`,
    }
  }
  if (pass.membership_type) {
    return {
      tone: 'warn',
      label: pass.expiry_date ? `Membership ended ${fmtDate(pass.expiry_date)}` : 'Membership not active',
      detail: 'Regular rate until it is renewed',
    }
  }
  return { tone: 'muted', label: 'Player', detail: 'Regular rate' }
}

export const passToneClass: Record<PassTone, string> = {
  ok: 'pill-ok',
  warn: 'pill-warn',
  muted: 'pill-muted',
}
