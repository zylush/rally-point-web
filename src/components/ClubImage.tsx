import { useState } from 'react'
import { stockPhotoFor, stockSrc, stockSrcSet } from '../lib/stockPhotos'
import { CourtArt } from './CourtArt'
import { Photo } from './Photo'

/**
 * A club, venue or court picture that always shows something sensible:
 *
 * 1. the club's own photos, in order, without a label;
 * 2. a real stock pickleball photo picked from `seed`, labelled "Sample photo" and described by
 *    its own alt text, so nobody takes it for this club's venue (skipped for `kind="venue"`,
 *    where a sample would sit beside the club's real hero);
 * 3. the drawn sample court.
 *
 * A photo that fails to load moves on to the next step instead of leaving a broken frame.
 */
export function ClubImage({
  photos,
  seed,
  alt,
  kind = 'club',
  className = '',
  priority = false,
  lazy = false,
  sizes,
}: {
  /** The club's own photo URLs, best first. Empty values are skipped. */
  photos: readonly (string | null | undefined)[]
  /** Picks the same stock photo and drawing for the same club or court every time. */
  seed: string
  /** Describes the club's own photo, e.g. "Photo of Rally Point Davao". */
  alt: string
  kind?: 'club' | 'venue'
  className?: string
  priority?: boolean
  lazy?: boolean
  sizes?: string
}) {
  const own = photos.filter((photo): photo is string => Boolean(photo))
  const key = `${seed}|${own.join('|')}`
  const [failed, setFailed] = useState<{ key: string; count: number }>({ key, count: 0 })
  const step = failed.key === key ? failed.count : 0
  const advance = () => setFailed({ key, count: step + 1 })

  if (step < own.length) {
    return (
      <Photo
        key={own[step]}
        src={own[step]}
        alt={alt}
        className={className}
        lazy={lazy}
        priority={priority}
        onError={advance}
      />
    )
  }

  if (kind === 'club' && step === own.length) {
    const stock = stockPhotoFor(seed)
    return (
      <div className={`relative ${className}`}>
        <Photo
          src={stockSrc(stock, 'small')}
          srcSet={stockSrcSet(stock)}
          sizes={sizes ?? '(min-width: 768px) 50vw, 100vw'}
          alt={stock.alt}
          className="h-full w-full rounded-[inherit]"
          lazy={lazy}
          priority={priority}
          onError={advance}
        />
        <span className="photo-label">Sample photo</span>
      </div>
    )
  }

  return <CourtArt seed={seed} className={className} />
}
