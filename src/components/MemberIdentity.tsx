import { useState } from 'react'
import { initialsOf } from '../lib/memberPass'

/**
 * A member's profile photo, or their initials when there is none or it fails to load.
 * Takes a ready link (api.ts turns stored member-photos paths into links).
 * Used on Account, the QR pass, membership requests and the desk's check-in result.
 */
export function MemberAvatar({
  name,
  photoUrl,
  size = 'md',
  shape = 'rounded',
}: {
  name: string
  photoUrl?: string | null
  size?: 'sm' | 'md' | 'lg'
  /** 'circle' is the header's account button: round, with initials in the brand colour. */
  shape?: 'rounded' | 'circle'
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const circle = shape === 'circle'
  const box =
    size === 'lg'
      ? 'h-20 w-20 text-2xl rounded-2xl'
      : size === 'sm'
        ? `h-10 w-10 ${circle ? 'text-[0.9375rem] tracking-wide rounded-full' : 'text-body rounded-xl'}`
        : 'h-14 w-14 text-lg rounded-2xl'
  if (photoUrl && failedUrl !== photoUrl) {
    return (
      <img
        src={photoUrl}
        alt={`Photo of ${name}`}
        className={`${box} shrink-0 ${circle ? 'border border-line' : 'border-2 border-slate-200'} bg-slate-100 object-cover`}
        onError={() => setFailedUrl(photoUrl)}
      />
    )
  }
  return (
    <div
      className={`${box} flex shrink-0 items-center justify-center font-extrabold ${circle ? 'bg-brand-100 text-brand-900' : 'bg-slate-100 text-slate-700'}`}
      role="img"
      aria-label={`No photo. Initials ${initialsOf(name)}`}
    >
      <span aria-hidden>{initialsOf(name)}</span>
    </div>
  )
}
