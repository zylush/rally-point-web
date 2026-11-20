/** Official bRineLy brand logo & icon mark assets */
type LogoProps = {
  variant?: 'color' | 'mark'
  className?: string
  title?: string
}

const BASE = import.meta.env.BASE_URL || '/'

export function BrinelyLogo({ variant = 'color', className = '', title = 'bRineLy' }: LogoProps) {
  const src = variant === 'mark' ? `${BASE}logo-mark.png` : `${BASE}logo.png`

  return (
    <img
      src={src}
      alt={title}
      className={className}
      draggable={false}
      decoding="async"
    />
  )
}
