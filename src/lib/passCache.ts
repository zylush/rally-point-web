import type { MemberPass } from '../types'

// The last QR passes a person loaded, kept on this device so My QR still opens at a
// club desk with poor signal. Cleared at sign-out, so the next person on a shared
// phone never sees them. Storage can be blocked (private windows), so every call
// is guarded and the app works without it.

const PREFIX = 'brinely.passes.'

export interface CachedPasses {
  saved_at: string
  passes: MemberPass[]
}

export function readCachedPasses(userId: string): CachedPasses | null {
  try {
    const raw = window.localStorage.getItem(PREFIX + userId)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CachedPasses
    return Array.isArray(parsed?.passes) && typeof parsed.saved_at === 'string' ? parsed : null
  } catch {
    return null
  }
}

export function writeCachedPasses(userId: string, passes: MemberPass[], now = new Date()) {
  try {
    window.localStorage.setItem(PREFIX + userId, JSON.stringify({ saved_at: now.toISOString(), passes } satisfies CachedPasses))
  } catch {
    // Storage full or blocked: the wallet still works online.
  }
}

/** Removes every saved pass on this device, whoever they belonged to. */
export function clearCachedPasses() {
  try {
    const keys: string[] = []
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i)
      if (key?.startsWith(PREFIX)) keys.push(key)
    }
    keys.forEach((key) => window.localStorage.removeItem(key))
  } catch {
    // Nothing to clear when storage is blocked.
  }
}
