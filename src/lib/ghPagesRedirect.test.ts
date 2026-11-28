import { describe, expect, it, vi } from 'vitest'
import { GH_PAGES_REDIRECT_KEY, hashFromRedirect, restoreGhPagesRoute } from './ghPagesRedirect'

const base = '/rally-point-web/'

describe('hashFromRedirect', () => {
  it('turns a path under the site base into an app route, keeping the query', () => {
    expect(hashFromRedirect('/rally-point-web/clubs/rally-point-davao', base)).toBe('/clubs/rally-point-davao')
    expect(hashFromRedirect('/rally-point-web/clubs?q=davao', base)).toBe('/clubs?q=davao')
  })

  it('keeps a route that already sits after the #', () => {
    expect(hashFromRedirect('/rally-point-web/old#/owners', base)).toBe('/owners')
  })

  it('works when the site is served from the domain root', () => {
    expect(hashFromRedirect('/clubs/rally-point-gensan/book', '/')).toBe('/clubs/rally-point-gensan/book')
  })

  it('ignores the home page, empty values and anything that is not a plain local path', () => {
    for (const value of [null, '', '/rally-point-web/', '/rally-point-web', '/rally-point-web/index.html', 'https://evil.example/x', '//evil.example/x', '/rally-point-web//evil']) {
      expect(hashFromRedirect(value, base)).toBeNull()
    }
    expect(hashFromRedirect('/rally-point-web/#/', base)).toBeNull()
  })
})

describe('restoreGhPagesRoute', () => {
  function fakeStorage(value: string | null) {
    return { getItem: vi.fn(() => value), removeItem: vi.fn() }
  }

  it('moves to the saved route once and forgets it', () => {
    const storage = fakeStorage('/rally-point-web/owners')
    const history = { replaceState: vi.fn() }
    restoreGhPagesRoute(storage, history, base)
    expect(storage.removeItem).toHaveBeenCalledWith(GH_PAGES_REDIRECT_KEY)
    expect(history.replaceState).toHaveBeenCalledWith(null, '', '/rally-point-web/#/owners')
  })

  it('leaves the address alone when nothing was saved', () => {
    const history = { replaceState: vi.fn() }
    restoreGhPagesRoute(fakeStorage(null), history, base)
    expect(history.replaceState).not.toHaveBeenCalled()
  })

  it('carries on when storage is blocked', () => {
    const storage = { getItem: vi.fn(() => { throw new Error('blocked') }), removeItem: vi.fn() }
    const history = { replaceState: vi.fn() }
    expect(() => restoreGhPagesRoute(storage, history, base)).not.toThrow()
    expect(history.replaceState).not.toHaveBeenCalled()
  })
})
