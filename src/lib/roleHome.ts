import type { Role } from '../types'

/**
 * Where each role lands when there is nowhere better to go. Players and members have no
 * area of their own: they use the public site (Find a court) with an account menu.
 */
export function homeFor(role: Role) {
  if (role === 'superadmin') return '/superadmin'
  if (role === 'admin') return '/admin'
  if (role === 'staff') return '/staff'
  return '/clubs'
}

/** A page inside this app worth returning to: a hash path, not the sign-in page itself. */
export function safeReturnPath(from: unknown): string | null {
  if (typeof from !== 'string' || !from.startsWith('/') || from.startsWith('//')) return null
  if (from === '/login' || from.startsWith('/login?') || from.startsWith('/login/')) return null
  return from
}

/**
 * Where someone goes once signed in. Players and members go back to the page they were on
 * (or Find a court); staff, admins and superadmins go to their own desk.
 */
export function afterSignIn(role: Role, from?: unknown) {
  if (role !== 'member') return homeFor(role)
  return safeReturnPath(from) ?? homeFor(role)
}
