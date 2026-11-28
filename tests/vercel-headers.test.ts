// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { mapEmbedUrl } from '../src/lib/maps'

// vercel.json serves both Vercel projects: brinely.info (production database) and brinely-staging
// plus previews (staging database). Read both database URLs from where the build takes them.
type Header = { key: string; value: string }
type VercelConfig = { headers?: { source: string; headers: Header[] }[] }

const config = JSON.parse(readFileSync('vercel.json', 'utf8')) as VercelConfig

function stagingUrl() {
  const match = readFileSync('.env.vercel', 'utf8').match(/^VITE_SUPABASE_URL=(https:\/\/[a-z0-9]+\.supabase\.co)\s*$/m)
  if (!match) throw new Error('.env.vercel names no staging VITE_SUPABASE_URL')
  return match[1]
}

function productionUrl() {
  const match = readFileSync('vite.config.ts', 'utf8').match(/^const productionProject = '([a-z0-9]+)'\s*$/m)
  if (!match) throw new Error('vite.config.ts pins no productionProject')
  return `https://${match[1]}.supabase.co`
}

const rule = config.headers?.find((entry) => entry.source === '/(.*)')
const header = (key: string) => rule?.headers.find((h) => h.key.toLowerCase() === key.toLowerCase())?.value ?? ''

/** The policy as directive name -> its sources. */
function directives(policy: string) {
  return new Map(
    policy.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
      const [name, ...sources] = part.split(/\s+/)
      return [name.toLowerCase(), sources] as const
    }),
  )
}

const csp = directives(header('Content-Security-Policy'))
const sources = (name: string) => csp.get(name) ?? []

describe('security headers in vercel.json', () => {
  it('sends every security header on every path, each once', () => {
    expect(rule).toBeDefined()
    const keys = rule!.headers.map((h) => h.key.toLowerCase())
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).toEqual(expect.arrayContaining([
      'content-security-policy',
      'strict-transport-security',
      'x-frame-options',
      'x-content-type-options',
      'referrer-policy',
      'permissions-policy',
      'cross-origin-opener-policy',
    ]))
    expect(header('X-Frame-Options')).toBe('DENY')
    expect(header('X-Content-Type-Options')).toBe('nosniff')
    expect(header('Referrer-Policy')).toBe('strict-origin-when-cross-origin')
    expect(header('Cross-Origin-Opener-Policy')).toBe('same-origin')
  })

  it('keeps HTTPS for two years on the domain and its subdomains, without asking for preload', () => {
    const hsts = header('Strict-Transport-Security').split(';').map((part) => part.trim().toLowerCase())
    expect(hsts).toContain('max-age=63072000')
    expect(hsts).toContain('includesubdomains')
    expect(hsts).not.toContain('preload')
  })

  it('refuses framing, plugins, base changes, foreign form posts and inline or eval code', () => {
    expect(sources('frame-ancestors')).toEqual(["'none'"])
    expect(sources('object-src')).toEqual(["'none'"])
    expect(sources('default-src')).toEqual(["'self'"])
    expect(sources('base-uri')).toEqual(["'self'"])
    expect(sources('form-action')).toEqual(["'self'"])
    expect(sources('script-src')).toEqual(["'self'"])
    expect(sources('style-src')).toEqual(["'self'"])
    expect(csp.has('upgrade-insecure-requests')).toBe(true)
    const all = [...csp.values()].flat()
    expect(all).not.toContain("'unsafe-eval'")
    expect(all).not.toContain("'unsafe-inline'")
  })

  it('names exact origins only: no bare *, scheme-only or wildcard host sources', () => {
    const all = [...csp.values()].flat()
    for (const source of all) {
      expect(source, source).not.toBe('*')
      expect(source, source).not.toMatch(/^(https?|wss?):?$/)
      expect(source, source).not.toContain('*')
    }
    const origins = all.filter((source) => /^[a-z]+:\/\//.test(source))
    const allowed = [stagingUrl(), productionUrl()].flatMap((url) => [url, url.replace(/^https:/, 'wss:')])
    allowed.push(new URL(mapEmbedUrl({ latitude: 6.1164, longitude: 125.1716 })!).origin)
    expect(origins.filter((origin) => !allowed.includes(origin))).toEqual([])
  })

  it('lets the app reach both Supabase projects over HTTPS and realtime websockets', () => {
    for (const url of [stagingUrl(), productionUrl()]) {
      expect(sources('connect-src')).toEqual(expect.arrayContaining([url, url.replace(/^https:/, 'wss:')]))
      // Court, club and member photos are public Storage links on the same host.
      expect(sources('img-src')).toContain(url)
    }
    expect(stagingUrl()).not.toBe(productionUrl())
  })

  it('frames only the OpenStreetMap embed the club pages use', () => {
    const embed = mapEmbedUrl({ latitude: 6.1164, longitude: 125.1716 })
    expect(sources('frame-src')).toEqual([new URL(embed!).origin])
  })

  it('turns off device features the app never uses, but keeps copy to clipboard', () => {
    const policy = header('Permissions-Policy').split(',').map((part) => part.trim())
    for (const feature of ['camera', 'microphone', 'geolocation', 'payment', 'usb']) {
      expect(policy).toContain(`${feature}=()`)
    }
    // Copy buttons (booking link, GCash number) use navigator.clipboard.writeText.
    expect(policy.some((part) => part.startsWith('clipboard-write='))).toBe(false)
  })
})
