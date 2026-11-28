import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  CALENDAR_WEEKDAYS,
  addDaysYmd,
  addMonthsYm,
  callDayLabel,
  monthLabel,
  monthOfYmd,
  monthWeeks,
  weekdayOfYmd,
} from '../lib/ownerRequests'

export type CallDayPickerProps = {
  /** The chosen day, YYYY-MM-DD. */
  value: string
  onChange: (ymd: string) => void
  /** First and last day that can be chosen, YYYY-MM-DD (Philippine dates). */
  min: string
  max: string
  /** Marked as today. Defaults to `min`. */
  today?: string
  label?: string
  className?: string
}

/** The last day of a "YYYY-MM" month. */
function lastDayOf(ym: string) {
  return addDaysYmd(`${addMonthsYm(ym, 1)}-01`, -1)
}

/** The same day number a number of months away, or that month's last day when it is shorter. */
function shiftMonths(ymd: string, months: number) {
  const ym = addMonthsYm(monthOfYmd(ymd), months)
  const day = `${ym}-${ymd.slice(8)}`
  const last = lastDayOf(ym)
  return day > last ? last : day
}

/**
 * A month calendar for picking one day between `min` and `max`, in place of the browser's own
 * date box (which looks different on every phone and reads poorly to screen readers).
 *
 * It follows the WAI-ARIA date grid: one day is in the Tab order; the arrow keys move a day or a
 * week, Home and End go to the start or end of the week, Page Up and Page Down move a month, and
 * Enter or Space chooses the day. Days outside the range are marked unavailable and cannot be
 * reached or chosen. All dates are YYYY-MM-DD strings, so the device's timezone never shifts them.
 */
export function CallDayPicker({ value, onChange, min, max, today = min, label = 'Day for the call', className = '' }: CallDayPickerProps) {
  const labelId = useId()
  const monthId = useId()
  const hintId = useId()
  const minMonth = monthOfYmd(min)
  const maxMonth = monthOfYmd(max)
  const inRange = (ymd: string) => ymd >= min && ymd <= max
  const clampDay = (ymd: string) => (ymd < min ? min : ymd > max ? max : ymd)

  const [view, setView] = useState(() => monthOfYmd(clampDay(value || min)))
  const [focusDay, setFocusDay] = useState<string | null>(null)
  // A day in another month that should take focus once that month has rendered.
  const pendingFocus = useRef<string | null>(null)
  const cells = useRef(new Map<string, HTMLTableCellElement>())

  // The one day reachable with Tab: the day last moved to, then the chosen day, then today,
  // then the first day that can be chosen in the month on show.
  let tabStop = clampDay(`${view}-01`)
  if (focusDay && monthOfYmd(focusDay) === view && inRange(focusDay)) tabStop = focusDay
  else if (monthOfYmd(value) === view && inRange(value)) tabStop = value
  else if (monthOfYmd(today) === view && inRange(today)) tabStop = today

  useEffect(() => {
    const target = pendingFocus.current
    if (!target) return
    pendingFocus.current = null
    cells.current.get(target)?.focus()
  })

  function moveTo(target: string) {
    const next = clampDay(target)
    setFocusDay(next)
    const cell = cells.current.get(next)
    if (cell) {
      // Already on screen: focus it now. Waiting for a render would leave a stale request
      // behind whenever the move changes nothing (e.g. ArrowLeft on the first open day).
      cell.focus()
      return
    }
    setView(monthOfYmd(next))
    pendingFocus.current = next
  }

  function choose(ymd: string) {
    if (!inRange(ymd)) return
    setFocusDay(ymd)
    onChange(ymd)
  }

  function onKey(event: KeyboardEvent<HTMLTableCellElement>, ymd: string) {
    const weekday = weekdayOfYmd(ymd)
    switch (event.key) {
      case 'ArrowLeft':
        moveTo(addDaysYmd(ymd, -1))
        break
      case 'ArrowRight':
        moveTo(addDaysYmd(ymd, 1))
        break
      case 'ArrowUp':
        moveTo(addDaysYmd(ymd, -7))
        break
      case 'ArrowDown':
        moveTo(addDaysYmd(ymd, 7))
        break
      case 'Home':
        moveTo(addDaysYmd(ymd, -weekday))
        break
      case 'End':
        moveTo(addDaysYmd(ymd, 6 - weekday))
        break
      case 'PageUp':
        moveTo(shiftMonths(ymd, -1))
        break
      case 'PageDown':
        moveTo(shiftMonths(ymd, 1))
        break
      case 'Enter':
      case ' ':
        choose(ymd)
        break
      default:
        return
    }
    event.preventDefault()
  }

  const canGoBack = view > minMonth
  const canGoOn = view < maxMonth
  const previous = addMonthsYm(view, -1)
  const next = addMonthsYm(view, 1)

  return (
    <div role="group" aria-labelledby={labelId} className={`call-day-picker ${className}`}>
      <p id={labelId} className="label">{label}</p>
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          className="call-month-nav"
          aria-label={`Previous month, ${monthLabel(previous)}`}
          aria-disabled={!canGoBack || undefined}
          onClick={() => canGoBack && setView(previous)}
        >
          <ChevronLeft aria-hidden="true" className="h-6 w-6" />
        </button>
        <h3 id={monthId} className="text-title font-semibold text-ink">
          {monthLabel(view)}
        </h3>
        <button
          type="button"
          className="call-month-nav"
          aria-label={`Next month, ${monthLabel(next)}`}
          aria-disabled={!canGoOn || undefined}
          onClick={() => canGoOn && setView(next)}
        >
          <ChevronRight aria-hidden="true" className="h-6 w-6" />
        </button>
      </div>
      <p id={hintId} className="sr-only">
        Use the arrow keys to move between days, and Enter to choose one.
      </p>
      <table role="grid" aria-labelledby={`${labelId} ${monthId}`} aria-describedby={hintId} className="mt-2 w-full table-fixed border-collapse">
        <thead>
          <tr>
            {CALENDAR_WEEKDAYS.map((weekday) => (
              <th key={weekday.short} role="columnheader" scope="col" className="pb-1 text-body font-semibold text-muted">
                <span aria-hidden="true">{weekday.short}</span>
                <span className="sr-only">{weekday.long}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {monthWeeks(view).map((week, row) => (
            <tr key={`${view}-${row}`}>
              {week.map((ymd, column) => {
                if (!ymd) return <td key={`blank-${column}`} role="gridcell" />
                const open = inRange(ymd)
                const chosen = ymd === value
                const isToday = ymd === today
                return (
                  <td
                    key={ymd}
                    ref={(cell) => {
                      if (cell) cells.current.set(ymd, cell)
                      else cells.current.delete(ymd)
                    }}
                    role="gridcell"
                    className="call-day-cell"
                    tabIndex={open ? (ymd === tabStop ? 0 : -1) : undefined}
                    aria-selected={open ? chosen : undefined}
                    aria-disabled={open ? undefined : true}
                    aria-current={isToday ? 'date' : undefined}
                    onClick={() => choose(ymd)}
                    onKeyDown={(event) => onKey(event, ymd)}
                  >
                    <span className="call-day" data-chosen={chosen || undefined} data-today={isToday || undefined}>
                      <span aria-hidden="true">{Number(ymd.slice(8))}</span>
                      <span className="sr-only">
                        {callDayLabel(ymd)}
                        {isToday ? ', today' : ''}
                        {open ? '' : ', not available'}
                      </span>
                    </span>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 px-1 text-balance text-body text-muted">
        Today is ringed. You can pick a day up to {callDayLabel(max)}.
      </p>
    </div>
  )
}
