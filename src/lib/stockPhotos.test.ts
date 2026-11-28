import { describe, expect, it } from 'vitest'
import {
  CLUB_POOL,
  HERO_PHOTO,
  LOGIN_PHOTO,
  OWNERS_PHOTO,
  STOCK_PHOTOS,
  stockPhotoFor,
  stockSrc,
  stockSrcSet,
} from './stockPhotos'

// The app tsconfig has no Node types, so list public/ through Vite's glob (keys only; nothing is imported).
const publicFiles = new Set(Object.keys(import.meta.glob('/public/media/stock/*.webp')))

describe('stock photos', () => {
  it('points every entry at a file that exists under public/', () => {
    expect(publicFiles.size).toBe(STOCK_PHOTOS.length * 2)
    for (const photo of STOCK_PHOTOS) {
      for (const file of [photo.src, photo.srcSmall]) {
        expect(publicFiles.has(`/public/${file}`), file).toBe(true)
      }
    }
  })

  it('links each photo to its own free-licence page', () => {
    for (const photo of STOCK_PHOTOS) {
      expect(photo.sourceUrl).toMatch(/^https:\/\/(unsplash\.com\/photos\/|www\.pexels\.com\/photo\/)/)
      expect(photo.license).toBe(photo.sourceUrl.includes('unsplash.com') ? 'Unsplash License' : 'Pexels License')
      expect(photo.photographer.trim()).not.toBe('')
    }
  })

  it('describes each picture without the "Photo of" wording kept for real club photos', () => {
    for (const photo of STOCK_PHOTOS) {
      expect(photo.alt.trim()).not.toBe('')
      expect(photo.alt).not.toMatch(/^photo of/i)
    }
  })

  it('has unique ids, unique titles and sensible sizes', () => {
    const ids = STOCK_PHOTOS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    const titles = STOCK_PHOTOS.map((p) => p.title.trim())
    expect(titles.every((t) => t !== '')).toBe(true)
    expect(new Set(titles).size).toBe(titles.length)
    for (const photo of STOCK_PHOTOS) {
      expect(photo.width).toBe(1600)
      expect(photo.height).toBeGreaterThan(0)
    }
  })

  it('picks the hero, login and owners photos and a club pool of at least five', () => {
    expect(HERO_PHOTO.use).toContain('hero')
    expect(LOGIN_PHOTO.use).toContain('login')
    expect(OWNERS_PHOTO.use).toContain('owners')
    expect(CLUB_POOL.length).toBeGreaterThanOrEqual(5)
    expect(CLUB_POOL.every((p) => p.use.includes('club'))).toBe(true)
  })

  it('gives the same club photo for the same seed', () => {
    const seeds = ['rally-point-gensan', 'rally-point-davao', 'court-1', '', 'ñ-club']
    for (const seed of seeds) {
      const photo = stockPhotoFor(seed)
      expect(CLUB_POOL).toContain(photo)
      expect(stockPhotoFor(seed)).toBe(photo)
    }
    const spread = new Set(Array.from({ length: 40 }, (_, i) => stockPhotoFor(`club-${i}`).id))
    expect(spread.size).toBeGreaterThan(1)
  })

  it('prefixes the site base to photo URLs', () => {
    const base = import.meta.env.BASE_URL
    expect(stockSrc(HERO_PHOTO, 'large')).toBe(`${base}${HERO_PHOTO.src}`)
    expect(stockSrc(HERO_PHOTO, 'small')).toBe(`${base}${HERO_PHOTO.srcSmall}`)
    expect(stockSrcSet(HERO_PHOTO)).toBe(`${base}${HERO_PHOTO.srcSmall} 800w, ${base}${HERO_PHOTO.src} 1600w`)
  })
})
