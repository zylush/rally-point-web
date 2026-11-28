import { useRef } from 'react'
import type { KeyboardEvent } from 'react'
import { ANALYTICS_PERIODS } from '../../lib/analytics'
import type { AnalyticsPeriod } from '../../lib/analytics'

export interface PeriodSwitchProps {
  value: AnalyticsPeriod
  onChange: (period: AnalyticsPeriod) => void
  /** The dates the period covers, e.g. "Oct 26 – Nov 24, 2026". */
  rangeText?: string
  /** The group's name for screen readers. */
  label?: string
}

/** "7 days / 30 days / 90 days" as one radio group: Tab reaches the picked one, arrow keys move. */
export function PeriodSwitch({ value, onChange, rangeText, label = 'Period' }: PeriodSwitchProps) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([])

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = ANALYTICS_PERIODS.length - 1
    const next =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? (index + 1) % ANALYTICS_PERIODS.length
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? (index + last) % ANALYTICS_PERIODS.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null
    if (next === null) return
    event.preventDefault()
    onChange(ANALYTICS_PERIODS[next])
    buttons.current[next]?.focus()
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div role="radiogroup" aria-label={label} className="segmented segmented-fit">
        {ANALYTICS_PERIODS.map((period, index) => {
          const checked = period === value
          return (
            <button
              key={period}
              ref={(element) => {
                buttons.current[index] = element
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              onClick={() => onChange(period)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className="whitespace-nowrap tabular-nums"
            >
              {period} days
            </button>
          )
        })}
      </div>
      {rangeText ? <p className="text-status text-muted tabular-nums">{rangeText}</p> : null}
    </div>
  )
}
