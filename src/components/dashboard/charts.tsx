import { useId, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { niceMax, sum } from '../../lib/analytics'
import { TONES, sharePct } from './tones'
import type { Tone } from './tones'

/*
 * Charts drawn with plain divs and one small SVG: no chart library. Every chart carries a
 * visually hidden table with the same figures, so screen readers get the numbers, not shapes.
 * Text is never smaller than 12px (`text-caption`).
 */

const EMPTY_TEXT = 'No data in this period'

function EmptyLine() {
  return <p className="text-body text-muted">{EMPTY_TEXT}</p>
}

// ---------------------------------------------------------------------------
// Sparkline
// ---------------------------------------------------------------------------

/** A small trend line with a faint area under it, in the current text colour. Decorative. */
export function Sparkline({ values, className = '' }: { values: number[]; className?: string }) {
  if (values.length === 0) return null
  // One value draws a flat line across, so a card never jumps when the second day arrives.
  const series = values.length === 1 ? [values[0], values[0]] : values
  const top = Math.max(0, ...series)
  const bottom = Math.min(0, ...series)
  const span = top - bottom || 1
  const y = (value: number) => 30 - ((value - bottom) / span) * 26
  const baseline = y(0).toFixed(2)
  const points = series.map((value, index) => `${((index / (series.length - 1)) * 100).toFixed(2)},${y(value).toFixed(2)}`)
  return (
    <svg
      viewBox="0 0 100 32"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
      className={`block w-full overflow-visible ${className}`}
    >
      <polygon points={`0,${baseline} ${points.join(' ')} 100,${baseline}`} fill="currentColor" opacity={0.1} />
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Bar chart
// ---------------------------------------------------------------------------

export interface BarPoint {
  key: string
  label: string
  value: number
}

export interface BarChartProps {
  label: string
  points: BarPoint[]
  format: (n: number) => string
  /** Plot height in px. */
  height?: number
  tone?: Tone
}

/** First, last and evenly spaced indexes in between, at most `max` of them. */
function labelIndexes(count: number, max: number): Set<number> {
  if (count <= max) return new Set(Array.from({ length: count }, (_, i) => i))
  const step = (count - 1) / (max - 1)
  return new Set(Array.from({ length: max }, (_, k) => Math.round(k * step)))
}

/** Keeps a label or tooltip inside the chart: edge bars anchor to their own side. */
function anchorClass(index: number, count: number): string {
  const share = (index + 0.5) / Math.max(1, count)
  if (share < 0.25) return 'left-0'
  return share > 0.75 ? 'right-0' : 'left-1/2 -translate-x-1/2'
}

const PHONE_LABELS = 4
const DESK_LABELS = 7

/**
 * Bars per day (or any key), with a rounded axis and three gridlines. Hover, tap or focus a bar
 * to see "label · value". The bars are one tab stop: arrow keys, Home and End move between them.
 */
export function BarChart({ label, points, format, height = 160, tone = 'brand' }: BarChartProps) {
  const [hovered, setHovered] = useState<number | null>(null)
  const [focused, setFocused] = useState<number | null>(null)
  const [current, setCurrent] = useState<number | null>(null)
  const bars = useRef<(HTMLButtonElement | null)[]>([])

  const max = Math.max(0, ...points.map((point) => point.value))
  if (points.length === 0 || max <= 0) {
    return (
      <figure className="m-0">
        <EmptyLine />
        <figcaption className="sr-only">{label}</figcaption>
      </figure>
    )
  }

  const top = niceMax(max)
  const shown = hovered ?? focused
  const tabIndex = Math.min(current ?? points.length - 1, points.length - 1)
  const ticks = [1, 0.5, 0].map((fraction) => ({ fraction, text: format(top * fraction) }))
  // Room for the longest axis label: about 7px a character at 12px, plus a gap.
  const axisWidth = Math.max(...ticks.map((tick) => tick.text.length)) * 7 + 10
  const phone = labelIndexes(points.length, PHONE_LABELS)
  const desk = labelIndexes(points.length, DESK_LABELS)
  const toneClasses = TONES[tone]

  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = points.length - 1
    const next =
      event.key === 'ArrowRight' || event.key === 'ArrowUp'
        ? Math.min(last, index + 1)
        : event.key === 'ArrowLeft' || event.key === 'ArrowDown'
          ? Math.max(0, index - 1)
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null
    if (next === null) return
    event.preventDefault()
    setCurrent(next)
    bars.current[next]?.focus()
  }

  return (
    <figure className="m-0">
      <div className="relative" style={{ height, paddingLeft: axisWidth }}>
        {ticks.map((tick) => (
          <div
            key={tick.fraction}
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 flex items-center gap-2"
            style={{ bottom: `${tick.fraction * 100}%`, transform: 'translateY(50%)' }}
          >
            <span
              data-label={tick.text}
              className="shrink-0 text-right text-caption text-muted tabular-nums before:content-[attr(data-label)]"
              style={{ width: axisWidth - 8 }}
            />
            <span className="h-px flex-1 bg-line" />
          </div>
        ))}
        <div
          role="group"
          aria-label={label}
          className="absolute inset-y-0 right-0 flex items-end gap-px sm:gap-[3px]"
          style={{ left: axisWidth }}
        >
          {points.map((point, index) => {
            const active = shown === index
            const pct = (point.value / top) * 100
            const text = `${point.label} · ${format(point.value)}`
            return (
              <button
                key={point.key}
                ref={(element) => {
                  bars.current[index] = element
                }}
                type="button"
                tabIndex={index === tabIndex ? 0 : -1}
                aria-label={`${point.label}: ${format(point.value)}`}
                className="relative flex h-full min-w-0 flex-1 items-end border-0 bg-transparent p-0"
                onPointerEnter={(event) => {
                  if (event.pointerType === 'mouse') setHovered(index)
                }}
                onPointerLeave={(event) => {
                  if (event.pointerType === 'mouse') setHovered(null)
                }}
                // Safari does not focus a tapped button; focus it so the tooltip shows and blur hides it.
                onClick={(event) => event.currentTarget.focus()}
                onFocus={() => {
                  setFocused(index)
                  setCurrent(index)
                }}
                onBlur={() => setFocused((was) => (was === index ? null : was))}
                onKeyDown={(event) => move(event, index)}
              >
                <span
                  aria-hidden="true"
                  className={`block w-full rounded-t-[3px] transition-[height,background-color] motion-reduce:transition-none ${active ? toneClasses.fillStrong : toneClasses.fill}`}
                  style={{ height: `${pct}%`, minHeight: point.value > 0 ? 2 : 0 }}
                />
                {active ? (
                  <span
                    role="tooltip"
                    className={`pointer-events-none absolute z-10 mb-1.5 whitespace-nowrap rounded-lg bg-ink px-2.5 py-1.5 text-caption font-semibold text-white tabular-nums ${anchorClass(index, points.length)}`}
                    style={{ bottom: `${pct}%` }}
                  >
                    {text}
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
      </div>
      <div aria-hidden="true" className="mt-2 flex h-4 gap-px sm:gap-[3px]" style={{ paddingLeft: axisWidth }}>
        {points.map((point, index) => {
          const onPhone = phone.has(index)
          const onDesk = desk.has(index)
          return (
            <span key={point.key} className="relative min-w-0 flex-1">
              {onPhone || onDesk ? (
                <span
                  data-label={point.label}
                  className={`absolute top-0 whitespace-nowrap text-caption text-muted before:content-[attr(data-label)] ${anchorClass(index, points.length)} ${
                    onPhone && !onDesk ? 'sm:hidden' : !onPhone ? 'max-sm:hidden' : ''
                  }`}
                />
              ) : null}
            </span>
          )
        })}
      </div>
      <table className="sr-only">
        <caption>{label}</caption>
        <tbody>
          {points.map((point) => (
            <tr key={point.key}>
              <th scope="row">{point.label}</th>
              <td>{format(point.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}

// ---------------------------------------------------------------------------
// Stacked bar
// ---------------------------------------------------------------------------

export interface StackedSegment {
  key: string
  label: string
  value: number
  tone: Tone
}

/** One bar split by share, with a legend of label, value and share under it. */
export function StackedBar({ label, segments, format }: { label: string; segments: StackedSegment[]; format: (n: number) => string }) {
  const total = sum(segments.map((segment) => Math.max(0, segment.value)))
  if (total <= 0) {
    return (
      <div>
        <EmptyLine />
        <p className="sr-only">{label}</p>
      </div>
    )
  }
  return (
    <div>
      <div aria-hidden="true" className="flex h-3 overflow-hidden rounded-full bg-slate-100">
        {segments
          .filter((segment) => segment.value > 0)
          .map((segment) => (
            <span
              key={segment.key}
              className={`h-full border-r-2 border-white last:border-r-0 ${TONES[segment.tone].fill}`}
              style={{ width: `${(segment.value / total) * 100}%` }}
            />
          ))}
      </div>
      {/* The legend is the table: one copy of every figure, labelled for screen readers. */}
      <table className="mt-3 w-full text-body">
        <caption className="sr-only">{label}</caption>
        <thead className="sr-only">
          <tr>
            <th scope="col">Part</th>
            <th scope="col">Amount</th>
            <th scope="col">Share</th>
          </tr>
        </thead>
        <tbody>
          {segments.map((segment) => (
            <tr key={segment.key}>
              <th scope="row" className="py-1 pr-3 text-left font-normal text-ink">
                <span className="flex min-w-0 items-center gap-2">
                  <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-full ${TONES[segment.tone].fill}`} />
                  <span className="min-w-0">{segment.label}</span>
                </span>
              </th>
              <td className="py-1 pr-3 text-right font-semibold whitespace-nowrap text-ink tabular-nums">{format(segment.value)}</td>
              <td className="w-12 py-1 text-right text-status text-muted tabular-nums">{sharePct(segment.value, total)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Meter
// ---------------------------------------------------------------------------

export interface MeterProps {
  label: string
  value: number
  max: number
  /** Plain words beside the label, such as "42 of 120 hours". */
  detail?: string
  tone?: Tone
}

/** A labelled share bar: how full a court was, how far along a target is. */
export function Meter({ label, value, max, detail, tone = 'brand' }: MeterProps) {
  const labelId = useId()
  const safeMax = max > 0 ? max : 1
  const now = Math.min(Math.max(0, value), safeMax)
  const pct = max > 0 ? Math.round((now / safeMax) * 100) : 0
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span id={labelId} className="min-w-0 text-body font-semibold text-ink">
          {label}
        </span>
        {detail ? <span className="shrink-0 text-status text-muted tabular-nums">{detail}</span> : null}
      </div>
      <div
        role="meter"
        aria-labelledby={labelId}
        aria-valuemin={0}
        aria-valuemax={safeMax}
        aria-valuenow={now}
        aria-valuetext={detail ? `${pct}%, ${detail}` : `${pct}%`}
        className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-slate-100"
      >
        <div
          className={`h-full rounded-full transition-[width] motion-reduce:transition-none ${TONES[tone].fill}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Heat grid
// ---------------------------------------------------------------------------

export interface HeatGridProps {
  label: string
  /** Rows × columns, e.g. weekday (Mon = 0) × hour of day. */
  grid: number[][]
  rowLabels: string[]
  colLabels: string[]
  format?: (n: number) => string
}

/** Five flat steps from pale to deep sky; empty cells stay grey. */
const HEAT_STEPS = ['bg-slate-100', 'bg-brand-100', 'bg-brand-200', 'bg-brand-400', 'bg-brand-600', 'bg-brand-800'] as const

function heatStep(value: number, max: number): number {
  if (!(value > 0) || !(max > 0)) return 0
  return Math.max(1, Math.ceil((value / max) * (HEAT_STEPS.length - 1)))
}

const bookingsText = (n: number) => `${n} ${n === 1 ? 'booking' : 'bookings'}`

/**
 * When the courts are busy: one small cell per weekday and hour, darker when busier. It scrolls
 * sideways inside its card on a phone. Screen readers get the five busiest times.
 */
export function HeatGrid({ label, grid, rowLabels, colLabels, format = bookingsText }: HeatGridProps) {
  const cells = grid.flatMap((row, r) => row.map((value, c) => ({ r, c, value })))
  const max = Math.max(0, ...cells.map((cell) => cell.value))
  if (max <= 0) {
    return (
      <div>
        <EmptyLine />
        <p className="sr-only">{label}</p>
      </div>
    )
  }
  const name = (r: number, c: number) => `${rowLabels[r] ?? ''} ${colLabels[c] ?? ''}`.trim()
  const busiest = cells
    .filter((cell) => cell.value > 0)
    .sort((a, b) => b.value - a.value || a.r - b.r || a.c - b.c)
    .slice(0, 5)
  const columns = colLabels.length || (grid[0]?.length ?? 0)
  const template = { gridTemplateColumns: `2.75rem repeat(${columns}, minmax(1.25rem, 1fr))` }
  // Every third column label, so "18:00" fits over its cells.
  const labelEvery = columns > 12 ? 3 : 1

  return (
    <div className="min-w-0">
      <div className="max-w-full overflow-x-auto pb-1">
        <div aria-hidden="true" className="grid min-w-[36rem] gap-0.5" style={template}>
          <span />
          {colLabels.map((col, c) => (
            <span key={col} className="relative h-4 text-caption text-muted tabular-nums">
              {c % labelEvery === 0 ? (
                <span data-label={col} className="absolute left-0 top-0 whitespace-nowrap before:content-[attr(data-label)]" />
              ) : null}
            </span>
          ))}
          {grid.map((row, r) => [
            <span
              key={`label-${r}`}
              data-label={rowLabels[r] ?? ''}
              className="flex items-center text-caption font-semibold text-muted before:content-[attr(data-label)]"
            />,
            ...row.map((value, c) => (
              <span
                key={`${r}-${c}`}
                title={`${name(r, c)} · ${format(value)}`}
                className={`h-6 rounded-[3px] ${HEAT_STEPS[heatStep(value, max)]}`}
              />
            )),
          ])}
        </div>
      </div>
      <div aria-hidden="true" className="mt-3 flex items-center gap-1.5 text-caption text-muted">
        <span>Quiet</span>
        {HEAT_STEPS.map((step) => (
          <span key={step} className={`size-3.5 rounded-[3px] ${step}`} />
        ))}
        <span>Busy</span>
      </div>
      <table className="sr-only">
        <caption>{`${label}: busiest times`}</caption>
        <tbody>
          {busiest.map((cell) => (
            <tr key={`${cell.r}-${cell.c}`}>
              <th scope="row">{name(cell.r, cell.c)}</th>
              <td>{format(cell.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
