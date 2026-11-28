/** Where public/404.html leaves the address someone opened before sending them to the app. */
export const GH_PAGES_REDIRECT_KEY = 'ghpages-redirect'

/**
 * Turns the address GitHub Pages could not serve (for example `/rally-point-web/clubs/davao`)
 * into the app route it meant (`/clubs/davao`). An address that already carries a `#/` route
 * keeps that route. Returns null for the home page or anything that is not a plain local path.
 */
export function hashFromRedirect(stored: string | null, base: string): string | null {
  if (!stored || !stored.startsWith('/') || stored.includes('//')) return null

  const hashAt = stored.indexOf('#')
  const hash = hashAt >= 0 ? stored.slice(hashAt + 1) : ''
  if (hash.startsWith('/')) return hash === '/' ? null : hash

  let path = hashAt >= 0 ? stored.slice(0, hashAt) : stored
  const prefix = base.endsWith('/') ? base.slice(0, -1) : base
  if (prefix) {
    if (path === prefix) path = '/'
    else if (path.startsWith(`${prefix}/`)) path = path.slice(prefix.length)
  }
  if (path === '/' || path === '/index.html') return null
  return path
}

/**
 * Run once before the app renders: if 404.html sent someone here, show them the page they
 * asked for instead of the home page.
 */
export function restoreGhPagesRoute(
  storage: Pick<Storage, 'getItem' | 'removeItem'> = window.sessionStorage,
  history: Pick<History, 'replaceState'> = window.history,
  base: string = import.meta.env.BASE_URL,
) {
  let stored: string | null
  try {
    stored = storage.getItem(GH_PAGES_REDIRECT_KEY)
    storage.removeItem(GH_PAGES_REDIRECT_KEY)
  } catch {
    // Storage can be blocked (private browsing); the home page is a fine fallback.
    return
  }
  const route = hashFromRedirect(stored, base)
  if (route) history.replaceState(null, '', `${base}#${route}`)
}
