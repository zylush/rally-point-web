import type { CSSProperties } from 'react'
import './CourtSymbolsBackdrop.css'

/*
 * A faint field of pickleball line drawings (paddles, balls, nets, courts, trophies, hour
 * clocks) behind the public pages, drifting very slowly. It is decoration only: hidden from
 * screen readers, never takes a click, stays under every header, card and form field, and
 * stands still for people who ask for reduced motion.
 */

type SymbolId = 'paddle' | 'ball' | 'net' | 'court' | 'paddles' | 'trophy' | 'clock'

/** Placement in percent of the view, size in px, and the drift each symbol makes. */
type Spot = {
  symbol: SymbolId
  top: number
  left: number
  size: number
  /** Starting tilt in degrees. */
  tilt: number
  /** Seconds for one drift out and back; varied so the field never moves in step. */
  duration: number
  /** Negative delay, so the field is already mid-drift on first paint. */
  delay: number
  /** How far the symbol drifts, in px, and how much it turns, in degrees. */
  dx: number
  dy: number
  turn: number
  /** Only shown on wider screens, so phones keep a sparse field. */
  wide?: boolean
}

const COURT_SYMBOL_SPOTS: Spot[] = [
  { symbol: 'paddle', top: 6, left: 4, size: 64, tilt: -24, duration: 26, delay: -3, dx: 14, dy: -18, turn: 10 },
  { symbol: 'ball', top: 14, left: 28, size: 40, tilt: 0, duration: 21, delay: -11, dx: -12, dy: 16, turn: 90 },
  { symbol: 'net', top: 9, left: 56, size: 76, tilt: 6, duration: 32, delay: -7, dx: 18, dy: 10, turn: -4, wide: true },
  { symbol: 'trophy', top: 4, left: 84, size: 56, tilt: 10, duration: 28, delay: -15, dx: -10, dy: 14, turn: -8 },
  { symbol: 'court', top: 34, left: 10, size: 72, tilt: 14, duration: 34, delay: -20, dx: 12, dy: 12, turn: 6, wide: true },
  { symbol: 'clock', top: 30, left: 44, size: 48, tilt: -8, duration: 24, delay: -5, dx: -14, dy: -12, turn: 12, wide: true },
  { symbol: 'paddles', top: 38, left: 74, size: 70, tilt: -6, duration: 30, delay: -9, dx: 10, dy: -16, turn: -10 },
  { symbol: 'ball', top: 52, left: 92, size: 34, tilt: 0, duration: 19, delay: -2, dx: -16, dy: 10, turn: -120, wide: true },
  { symbol: 'ball', top: 56, left: 2, size: 44, tilt: 0, duration: 23, delay: -13, dx: 16, dy: -10, turn: 120 },
  { symbol: 'paddle', top: 62, left: 34, size: 58, tilt: 32, duration: 29, delay: -18, dx: -12, dy: 14, turn: -12, wide: true },
  { symbol: 'net', top: 70, left: 60, size: 80, tilt: -4, duration: 33, delay: -24, dx: -16, dy: -8, turn: 4 },
  { symbol: 'trophy', top: 80, left: 14, size: 50, tilt: -12, duration: 27, delay: -6, dx: 12, dy: -14, turn: 8, wide: true },
  { symbol: 'court', top: 84, left: 82, size: 66, tilt: -16, duration: 31, delay: -16, dx: -10, dy: -12, turn: -6 },
  { symbol: 'clock', top: 90, left: 46, size: 42, tilt: 8, duration: 22, delay: -10, dx: 14, dy: -10, turn: -14, wide: true },
  { symbol: 'paddles', top: 22, left: 66, size: 54, tilt: 18, duration: 25, delay: -21, dx: -12, dy: 12, turn: 10, wide: true },
  { symbol: 'ball', top: 76, left: 40, size: 30, tilt: 0, duration: 18, delay: -8, dx: 10, dy: 12, turn: 100 },
]

function SymbolDefs() {
  return (
    <svg width="0" height="0" className="court-symbols-defs" focusable="false">
      <defs>
        <symbol id="court-symbol-paddle" viewBox="0 0 24 24">
          <rect x="5.5" y="2" width="11" height="13.5" rx="5.5" />
          <path d="M11 15.5v6.5M9.5 19h3M8.5 6.5l5 5M13.5 6.5l-5 5" />
        </symbol>
        <symbol id="court-symbol-ball" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="8.5" />
          <circle cx="12" cy="7.5" r="1" />
          <circle cx="8" cy="10.5" r="1" />
          <circle cx="16" cy="10.5" r="1" />
          <circle cx="12" cy="12.5" r="1" />
          <circle cx="9.5" cy="15.5" r="1" />
          <circle cx="14.5" cy="15.5" r="1" />
        </symbol>
        <symbol id="court-symbol-net" viewBox="0 0 24 24">
          <path d="M2 8h20M2 8v10M22 8v10M2 13h20M6 8v5M10 8v5M14 8v5M18 8v5M2 18h20" />
        </symbol>
        <symbol id="court-symbol-court" viewBox="0 0 24 24">
          <rect x="4" y="2" width="16" height="20" rx="1" />
          <path d="M4 12h16M4 9h16M4 15h16M12 2v7M12 15v7" />
        </symbol>
        <symbol id="court-symbol-paddles" viewBox="0 0 24 24">
          <g transform="rotate(-32 12 12)">
            <rect x="8.5" y="1.5" width="7" height="9.5" rx="3.5" />
            <path d="M12 11v6" />
          </g>
          <g transform="rotate(32 12 12)">
            <rect x="8.5" y="1.5" width="7" height="9.5" rx="3.5" />
            <path d="M12 11v6" />
          </g>
          <circle cx="12" cy="20" r="2" />
        </symbol>
        <symbol id="court-symbol-trophy" viewBox="0 0 24 24">
          <path d="M8 3h8v5.5a4 4 0 0 1-8 0zM8 5H5a3 3 0 0 0 3 4.5M16 5h3a3 3 0 0 1-3 4.5M12 12.5v4M9 21h6M10 16.5h4v4.5h-4z" />
        </symbol>
        <symbol id="court-symbol-clock" viewBox="0 0 24 24">
          <circle cx="12" cy="13" r="8.5" />
          <path d="M12 8.5V13l3 2M10 2h4M12 2v2.5" />
        </symbol>
      </defs>
    </svg>
  )
}

/** The moving symbol field. Mount it once, as the first child of a public page frame. */
export function CourtSymbolsBackdrop() {
  return (
    <div className="court-symbols" aria-hidden="true" data-testid="court-symbols">
      <SymbolDefs />
      {COURT_SYMBOL_SPOTS.map((spot, index) => (
        <svg
          key={index}
          className={`court-symbol${spot.wide ? ' court-symbol-wide' : ''}`}
          focusable="false"
          style={
            {
              top: `${spot.top}%`,
              left: `${spot.left}%`,
              width: spot.size,
              height: spot.size,
              '--cs-tilt': `${spot.tilt}deg`,
              '--cs-turn': `${spot.turn}deg`,
              '--cs-dx': `${spot.dx}px`,
              '--cs-dy': `${spot.dy}px`,
              animationDuration: `${spot.duration}s`,
              animationDelay: `${spot.delay}s`,
            } as CSSProperties
          }
        >
          <use href={`#court-symbol-${spot.symbol}`} />
        </svg>
      ))}
    </div>
  )
}
