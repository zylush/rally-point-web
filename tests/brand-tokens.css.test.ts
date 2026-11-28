import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync('src/index.css', 'utf8')
const html = readFileSync('index.html', 'utf8')
const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8')) as Record<string, unknown>

function token(name: string) {
  const match = css.match(new RegExp(`${name}:\\s*([^;]+);`))
  return match?.[1].trim().toLowerCase()
}

describe('bRineLy "quiet court" design tokens', () => {
  it('takes its colours from the logo: navy ink and a deep sky accent on warm white', () => {
    expect(token('--color-ink')).toBe('#0b2a5b')
    expect(token('--color-brand-900')).toBe('#0b2a5b')
    expect(token('--color-brand-700')).toBe('#0369a1')
    expect(token('--color-brand-100')).toBe('#e0f2fe')
    expect(token('--color-brand-400')).toBe('#38bdf8')
    expect(token('--color-canvas')).toBe('#fafaf7')
    expect(token('--color-line')).toBe('#e7e5e0')
    expect(token('--color-field')).toBe('#8a8782')
  })

  it('keeps the page flat: no glows, glass or gradient panels', () => {
    expect(css).not.toContain('radial-gradient')
    expect(css).not.toContain('backdrop-filter')
    // Only the loading shimmer may use a gradient.
    const gradients = css.match(/linear-gradient\([^)]*\)/g) ?? []
    for (const gradient of gradients) expect(gradient).toContain('#eeece7')
  })

  it('gives the body the warm canvas, not the old dark background', () => {
    const start = css.search(/\nbody \{/)
    const body = css.slice(start, css.indexOf('}', start))
    expect(body).toContain('background: var(--color-canvas);')
    expect(css).not.toContain('#020617')
  })

  it('defines the public-site pieces', () => {
    for (const selector of ['.site-header', '.site-footer', '.site-nav-link', '.text-link', '.photo-label', '.segmented', '.text-tabs', '.day-strip', '.day-card', '.notice']) {
      expect(css).toContain(`${selector} {`)
    }
    expect(css).toContain(".segmented > :is([aria-pressed='true']")
    expect(css).toContain(".text-tabs > :is([aria-pressed='true']")
    expect(css).toContain(".day-card[aria-pressed='true']")
    expect(css).not.toContain('.chip-option')
  })

  it('describes the site the same way in the page head and the app manifest', () => {
    const description = 'Find a pickleball court in the Philippines, book by the hour, and pay the club by GCash.'
    expect(html).toContain('<title>bRineLy — Book a pickleball court</title>')
    expect(html).toContain('<meta name="theme-color" content="#fafaf7" />')
    expect(html).toContain(description)
    expect(manifest.description).toBe(description)
    expect(manifest.background_color).toBe('#fafaf7')
    expect(manifest.theme_color).toBe('#fafaf7')
  })
})
