import { useCallback, useState } from 'react'
import { ImageOff } from 'lucide-react'

type PhotoState = 'loading' | 'loaded' | 'error'

/**
 * A photo that waits on a grey placeholder while it downloads, then fades in.
 * `className` sizes the frame (aspect, height, rounding), so the space is held either way.
 * A photo that fails to load leaves the labelled placeholder, never a broken-image icon.
 * `fit="contain"` shows the whole picture (for QR codes), instead of filling the frame.
 * `onError` lets a parent show something else (the next photo, a sample) when this one fails.
 * `priority` loads the first picture on a page straight away instead of lazily.
 */
export function Photo({
  src,
  alt,
  className = '',
  lazy = false,
  fit = 'cover',
  srcSet,
  sizes,
  priority = false,
  onError,
}: {
  src: string
  alt: string
  className?: string
  lazy?: boolean
  fit?: 'cover' | 'contain'
  srcSet?: string
  sizes?: string
  priority?: boolean
  onError?: () => void
}) {
  const [status, setStatus] = useState<{ src: string; state: PhotoState }>({ src, state: 'loading' })
  const state = status.src === src ? status.state : 'loading'
  // A cached photo can finish before React sees its load event; catch that on mount.
  // Errors come only from the error event: jsdom and not-yet-started lazy images also
  // report complete with no size, so that alone does not mean the photo is broken.
  const checkLoaded = useCallback((img: HTMLImageElement | null) => {
    if (img?.complete && img.naturalWidth > 0) setStatus({ src, state: 'loaded' })
  }, [src])

  if (state === 'error') {
    return (
      <div role="img" aria-label={alt} data-state="error" className={`photo relative ${className}`}>
        <ImageOff size={28} className="absolute inset-0 m-auto text-slate-500" aria-hidden />
      </div>
    )
  }
  return (
    <div data-state={state} className={`photo relative overflow-hidden ${className}`}>
      <img
        ref={checkLoaded}
        src={src}
        srcSet={srcSet}
        sizes={srcSet ? sizes : undefined}
        alt={alt}
        className={`photo-img absolute inset-0 h-full w-full ${fit === 'contain' ? 'object-contain' : 'object-cover'}`}
        loading={lazy && !priority ? 'lazy' : undefined}
        fetchPriority={priority ? 'high' : undefined}
        decoding="async"
        onLoad={() => setStatus({ src, state: 'loaded' })}
        onError={() => {
          setStatus({ src, state: 'error' })
          onError?.()
        }}
      />
    </div>
  )
}
