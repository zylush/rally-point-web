/** Official bRineLy brand logo & icon mark assets (vector art traced from logo.png, in public/) */
type LogoVariant = 'color' | 'mark' | 'animated' | 'wordmark'

type LogoProps = {
  variant?: LogoVariant
  className?: string
  /** Accessible name. Pass an empty string when the logo is decorative. */
  title?: string
}

const BASE = import.meta.env.BASE_URL || '/'

const SOURCES: Record<LogoVariant, string> = {
  color: 'logo.png',
  mark: 'logo-mark.svg',
  /** The mark with a spinning, hopping ball; it holds still when the visitor asks for less motion. */
  animated: 'logo-mark-animated.svg',
  wordmark: 'logo-wordmark.svg',
}

export function BrinelyLogo({ variant = 'color', className = '', title = 'bRineLy' }: LogoProps) {
  return (
    <img
      src={`${BASE}${SOURCES[variant]}`}
      alt={title}
      className={className}
      draggable={false}
      decoding="async"
    />
  )
}
