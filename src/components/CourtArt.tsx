/**
 * A plain top-down pickleball court in the app's teal, shown as a sample picture
 * until a club adds real photos. Always labelled, so nobody mistakes it for a photo.
 */

// A 20 ft x 44 ft court drawn sideways; 7 ft non-volley zone each side of the net.
const FT = 5.4545
const LEFT = 40
const RIGHT = 280
const TOP = 90 - 10 * FT
const BOTTOM = 90 + 10 * FT
const KITCHEN = 7 * FT

export function CourtArt({
  muted = false,
  label = 'Sample',
  className = '',
}: {
  /** Kept so callers can pass a court or club id; every court is drawn the same. */
  seed?: string
  /** Greys the court out, for courts that are out of service. */
  muted?: boolean
  /** Small label text; pass null to hide it. */
  label?: string | null
  className?: string
}) {
  return (
    <div className={`relative overflow-hidden ${muted ? 'grayscale opacity-70' : ''} ${className}`}>
      <svg viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice" className="block h-full w-full" aria-hidden focusable="false">
        <rect width="320" height="180" fill="#115e59" />
        <rect x={LEFT} y={TOP} width={RIGHT - LEFT} height={BOTTOM - TOP} fill="#0f766e" />
        <rect x={160 - KITCHEN} y={TOP} width={KITCHEN * 2} height={BOTTOM - TOP} fill="#0d9488" />
        <g stroke="#ffffff" strokeWidth="2" fill="none">
          <rect x={LEFT} y={TOP} width={RIGHT - LEFT} height={BOTTOM - TOP} />
          <line x1={160 - KITCHEN} y1={TOP} x2={160 - KITCHEN} y2={BOTTOM} />
          <line x1={160 + KITCHEN} y1={TOP} x2={160 + KITCHEN} y2={BOTTOM} />
          <line x1={LEFT} y1={90} x2={160 - KITCHEN} y2={90} />
          <line x1={160 + KITCHEN} y1={90} x2={RIGHT} y2={90} />
        </g>
        <line x1="160" y1={TOP - 6} x2="160" y2={BOTTOM + 6} stroke="#0f172a" strokeWidth="3" />
      </svg>
      {label ? (
        <span className="absolute bottom-2 left-2 rounded-md bg-slate-900/70 px-2 py-0.5 text-caption font-semibold text-white">
          {label}
        </span>
      ) : null}
    </div>
  )
}
