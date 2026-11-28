/**
 * Stand-in pickleball photos, self-hosted under `public/media/stock/`.
 *
 * Every photo is free to use under the Unsplash License or the Pexels License, as stated on its
 * own page (`sourceUrl`). They are placeholders, not pictures of any club: wherever one replaces
 * a club's own photo, the UI must label it "Sample photo". Alt text describes the picture only
 * and never starts with "Photo of", which is kept for real club photos.
 *
 * Real photographs only: no renders or illustrations, so the site never shows a court that
 * could not exist.
 *
 * Art direction, so the set reads as one: daylight and warm natural light; blue or green
 * courts; pickleball plainly (paddles, perforated balls, the kitchen line), never tennis or
 * padel; no readable brand logos (small marks are softened at encoding); no children; no face
 * as the main subject; tropical settings where a free photo allows. All photos share one gentle
 * grade (slightly warmer, slightly more contrast).
 */

export type StockPhotoUse = 'hero' | 'login' | 'owners' | 'club'

export type StockPhoto = {
  id: string
  /** 1600px wide WebP, relative to the site base. Use `stockSrc`. */
  src: string
  /** 800px wide WebP, relative to the site base. Use `stockSrc`. */
  srcSmall: string
  /** Size of the 1600px version. */
  width: number
  height: number
  /** Short name for the credits list, e.g. "Forehand on a blue court". */
  title: string
  alt: string
  photographer: string
  sourceUrl: string
  license: 'Unsplash License' | 'Pexels License'
  use: StockPhotoUse[]
}

function photo(
  id: string,
  width: number,
  height: number,
  details: Omit<StockPhoto, 'id' | 'src' | 'srcSmall' | 'width' | 'height'>,
): StockPhoto {
  return {
    id,
    src: `media/stock/${id}-1600.webp`,
    srcSmall: `media/stock/${id}-800.webp`,
    width,
    height,
    ...details,
  }
}

export const STOCK_PHOTOS: readonly StockPhoto[] = [
  photo('player-forehand-blue-court', 1600, 1066, {
    title: 'Forehand on a blue court',
    alt: 'A player in a cap reaching for a forehand on a sunny outdoor court, with a net, trees and other players behind',
    photographer: 'Jon Matthews',
    sourceUrl: 'https://unsplash.com/photos/usqfZcs_GfM',
    license: 'Unsplash License',
    use: ['hero', 'club'],
  }),
  photo('doubles-through-net', 1600, 1066, {
    title: 'Doubles seen through the net',
    alt: 'Two doubles players waiting at the baseline of a blue outdoor court, seen through the net, with palm trees beyond the fence',
    photographer: 'Jon Matthews',
    sourceUrl: 'https://unsplash.com/photos/X7n27HXxAIc',
    license: 'Unsplash License',
    use: ['login', 'club'],
  }),
  photo('aerial-courts-blue', 1600, 1200, {
    title: 'Courts from above',
    alt: 'Aerial view of blue and green pickleball courts with nets',
    photographer: 'Frank Schrader',
    sourceUrl: 'https://www.pexels.com/photo/29821186/',
    license: 'Pexels License',
    use: ['owners', 'club'],
  }),
  photo('net-shadow-green-court', 1600, 1200, {
    title: 'Net shadow on a green court',
    alt: 'A pickleball net casting its shadow across a green court beside blue playing areas in bright sun',
    photographer: 'Frank Schrader',
    sourceUrl: 'https://www.pexels.com/photo/shadow-play-on-a-sunny-pickleball-court-29820785/',
    license: 'Pexels License',
    use: ['club'],
  }),
  photo('paddle-ball-court', 1600, 1066, {
    title: 'Paddle and ball on the court',
    alt: 'A paddle and a yellow ball lying on a blue pickleball court',
    photographer: 'Mason Tuttle',
    sourceUrl: 'https://www.pexels.com/photo/17299528/',
    license: 'Pexels License',
    use: ['club'],
  }),
  photo('paddle-at-net', 1600, 978, {
    title: 'Paddle against the net',
    alt: 'A paddle and a yellow ball resting against the net on a blue court',
    photographer: 'Mason Tuttle',
    sourceUrl: 'https://www.pexels.com/photo/17299530/',
    license: 'Pexels License',
    use: ['club'],
  }),
]

function firstFor(use: StockPhotoUse): StockPhoto {
  const found = STOCK_PHOTOS.find((p) => p.use.includes(use))
  if (!found) throw new Error(`No stock photo for ${use}`)
  return found
}

export const HERO_PHOTO = firstFor('hero')
export const LOGIN_PHOTO = firstFor('login')
export const OWNERS_PHOTO = firstFor('owners')

/** Photos that may stand in for a club or court without photos of its own. */
export const CLUB_POOL: readonly StockPhoto[] = STOCK_PHOTOS.filter((p) => p.use.includes('club'))

/** Full URL of a stock photo, under the site base (e.g. `/rally-point-web/` on GitHub Pages). */
export function stockSrc(photo: StockPhoto, size: 'large' | 'small' = 'large'): string {
  return `${import.meta.env.BASE_URL}${size === 'small' ? photo.srcSmall : photo.src}`
}

/** `srcset` value offering both widths. */
export function stockSrcSet(photo: StockPhoto): string {
  return `${stockSrc(photo, 'small')} 800w, ${stockSrc(photo, 'large')} 1600w`
}

/** FNV-1a 32-bit hash of the string's UTF-16 code units. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash
}

/** The same club-pool photo every time for a given seed (a club slug or court id, say). */
export function stockPhotoFor(seed: string): StockPhoto {
  return CLUB_POOL[fnv1a(seed) % CLUB_POOL.length]
}
