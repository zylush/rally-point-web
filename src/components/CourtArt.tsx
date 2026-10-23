import { useId } from 'react'

/**
 * A drawn, top-down pickleball court used as a sample picture until clubs can
 * upload real photos of their courts. Each club or court gets a steady colour
 * from its id, so the same court always looks the same.
 */
const palettes = [
  { surround: '#134e4a', court: '#0d9488', kitchen: '#0f766e' }, // teal
  { surround: '#1e3a8a', court: '#2563eb', kitchen: '#1d4ed8' }, // blue
  { surround: '#14532d', court: '#16a34a', kitchen: '#15803d' }, // green
  { surround: '#7c2d12', court: '#ea580c', kitchen: '#c2410c' }, // clay
  { surround: '#3b0764', court: '#7c3aed', kitchen: '#6d28d9' }, // purple
]

function hash(seed: string) {
  let h = 0
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return h
}

// A 20 ft x 44 ft court drawn sideways; 7 ft non-volley zone each side of the net.
const FT = 5.4545
const LEFT = 40
const RIGHT = 280
const TOP = 90 - 10 * FT
const BOTTOM = 90 + 10 * FT
const KITCHEN = 7 * FT

export function CourtArt({
  seed,
  muted = false,
  label = 'Sample image',
  className = '',
}: {
  seed: string
  /** Greys the court out, for courts that are out of service. */
  muted?: boolean
  /** Small badge text; pass null to hide it. */
  label?: string | null
  className?: string
}) {
  const id = useId().replace(/:/g, '')
  const h = hash(seed)
  const colors = palettes[h % palettes.length]
  const ballX = 60 + (h % 200)
  const ballY = TOP + 12 + ((h >> 8) % Math.round(BOTTOM - TOP - 24))
  return (
    <div className={`relative overflow-hidden ${muted ? 'grayscale opacity-70' : ''} ${className}`}>
      <svg viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice" className="block h-full w-full" aria-hidden focusable="false">
        <defs>
          <radialGradient id={`${id}-light`} cx="30%" cy="20%" r="90%">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.28" />
            <stop offset="1" stopColor="#000000" stopOpacity="0.22" />
          </radialGradient>
        </defs>
        <rect width="320" height="180" fill={colors.surround} />
        <rect x={LEFT} y={TOP} width={RIGHT - LEFT} height={BOTTOM - TOP} fill={colors.court} />
        <rect x={160 - KITCHEN} y={TOP} width={KITCHEN * 2} height={BOTTOM - TOP} fill={colors.kitchen} />
        <g stroke="#ffffff" strokeWidth="2.2" fill="none">
          <rect x={LEFT} y={TOP} width={RIGHT - LEFT} height={BOTTOM - TOP} />
          <line x1={160 - KITCHEN} y1={TOP} x2={160 - KITCHEN} y2={BOTTOM} />
          <line x1={160 + KITCHEN} y1={TOP} x2={160 + KITCHEN} y2={BOTTOM} />
          <line x1={LEFT} y1={90} x2={160 - KITCHEN} y2={90} />
          <line x1={160 + KITCHEN} y1={90} x2={RIGHT} y2={90} />
        </g>
        <line x1="160" y1={TOP - 8} x2="160" y2={BOTTOM + 8} stroke="#0f172a" strokeWidth="3.5" />
        <line x1="160" y1={TOP - 8} x2="160" y2={BOTTOM + 8} stroke="#ffffff" strokeWidth="1" strokeDasharray="2 3" />
        <circle cx="160" cy={TOP - 9} r="3.2" fill="#0f172a" />
        <circle cx="160" cy={BOTTOM + 9} r="3.2" fill="#0f172a" />
        <circle cx={ballX} cy={ballY} r="4.2" fill="#facc15" stroke="#a16207" strokeWidth="0.8" />
        <rect width="320" height="180" fill={`url(#${id}-light)`} />
      </svg>
      {label ? (
        <span className="absolute bottom-2 left-2 rounded-md bg-slate-950/70 px-2 py-0.5 text-caption font-semibold text-white">
          {label}
        </span>
      ) : null}
    </div>
  )
}
