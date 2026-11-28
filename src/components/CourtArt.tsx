/**
 * A plain top-down pickleball court, shown as a sample picture when a club has no photos
 * and the stock photo cannot load. Always labelled, so nobody mistakes it for a photo.
 * The seed picks one of a few quiet tints from the site palette, so a list of courts is not
 * identical, and the drawing stays a calm stand-in rather than the loudest thing on the page.
 */

// A 20 ft x 44 ft court drawn sideways; 7 ft non-volley zone each side of the net.
const FT = 5.4545
const LEFT = 40
const RIGHT = 280
const TOP = 90 - 10 * FT
const BOTTOM = 90 + 10 * FT
const KITCHEN = 7 * FT

/** Surround, playing area and non-volley zone: canvas, hairline and pale sky tints only. */
const COLOURWAYS = [
  { surround: '#f0f9ff', court: '#e0f2fe', kitchen: '#f0f9ff' }, // brand-50, brand-100
  { surround: '#fafaf7', court: '#e0f2fe', kitchen: '#f0f9ff' }, // canvas, brand-100, brand-50
  { surround: '#e7e5e0', court: '#f0f9ff', kitchen: '#e0f2fe' }, // line, brand-50, brand-100
  { surround: '#fafaf7', court: '#f0f9ff', kitchen: '#e0f2fe' }, // canvas, brand-50, brand-100
] as const

/** Court lines and net in the navy ink. */
const INK = '#0b2a5b'

function colourwayFor(seed = '') {
  let total = 0
  for (let i = 0; i < seed.length; i += 1) total = (total * 31 + seed.charCodeAt(i)) >>> 0
  return COLOURWAYS[total % COLOURWAYS.length]
}

export function CourtArt({
  seed,
  muted = false,
  label = 'Sample',
  className = '',
}: {
  /** A court or club id: the same seed always gets the same court colours. */
  seed?: string
  /** Greys the court out, for courts that are out of service. */
  muted?: boolean
  /** Small label text; pass null to hide it. */
  label?: string | null
  className?: string
}) {
  const colours = colourwayFor(seed)
  return (
    <div className={`relative overflow-hidden ${muted ? 'grayscale opacity-70' : ''} ${className}`}>
      <svg viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice" className="block h-full w-full" aria-hidden focusable="false">
        <rect width="320" height="180" fill={colours.surround} />
        <rect x={LEFT} y={TOP} width={RIGHT - LEFT} height={BOTTOM - TOP} fill={colours.court} />
        <rect x={160 - KITCHEN} y={TOP} width={KITCHEN * 2} height={BOTTOM - TOP} fill={colours.kitchen} />
        <g className="court-lines" stroke={INK} strokeOpacity="0.55" strokeWidth="1.5" fill="none">
          <rect x={LEFT} y={TOP} width={RIGHT - LEFT} height={BOTTOM - TOP} pathLength="1" />
          <line x1={160 - KITCHEN} y1={TOP} x2={160 - KITCHEN} y2={BOTTOM} pathLength="1" />
          <line x1={160 + KITCHEN} y1={TOP} x2={160 + KITCHEN} y2={BOTTOM} pathLength="1" />
          <line x1={LEFT} y1={90} x2={160 - KITCHEN} y2={90} pathLength="1" />
          <line x1={160 + KITCHEN} y1={90} x2={RIGHT} y2={90} pathLength="1" />
        </g>
        <line x1="160" y1={TOP - 6} x2="160" y2={BOTTOM + 6} stroke={INK} strokeWidth="2.5" />
      </svg>
      {label ? (
        <span className="photo-label">{label}</span>
      ) : null}
    </div>
  )
}
