import type { ComponentType, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Sparkline } from './charts'
import { TONES } from './tones'
import type { Tone } from './tones'
import { Trend } from './Trend'

export interface StatCardProps {
  label: string
  /** Already formatted, e.g. "₱12,500" or "42". */
  value: string
  /** A lucide icon component. */
  icon: ComponentType<{ className?: string }>
  tone?: Tone
  current?: number
  previous?: number
  goodWhen?: 'up' | 'down'
  /** What the trend compares against; defaults to the previous period. */
  compareLabel?: string
  /** Per-day values for the little trend line. */
  series?: number[]
  sub?: ReactNode
  /** Makes the whole card a link to the screen with the details. */
  to?: string
}

/** One headline figure: a name, the number, how it moved, and a small line of the days behind it. */
export function StatCard({ label, value, icon: Icon, tone = 'brand', current, previous, goodWhen, compareLabel, series, sub, to }: StatCardProps) {
  const toneClasses = TONES[tone]
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-body font-semibold text-slate-600">{label}</p>
        <span aria-hidden="true" className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${toneClasses.chip}`}>
          <Icon className="size-5" />
        </span>
      </div>
      <p className="mt-1 text-heading-2 font-bold text-ink tabular-nums">{value}</p>
      {sub ? <p className="mt-0.5 text-status text-muted">{sub}</p> : null}
      {current != null && previous != null ? (
        <p className="mt-1.5">
          <Trend current={current} previous={previous} goodWhen={goodWhen} compareLabel={compareLabel} />
        </p>
      ) : null}
      {series && series.length > 0 ? <Sparkline values={series} className={`mt-3 h-10 ${toneClasses.text}`} /> : null}
    </>
  )
  const frame = 'card flex min-w-0 flex-col p-4 sm:p-5'
  if (to) {
    return (
      <Link to={to} className={`${frame} control-feedback text-inherit no-underline hover:border-brand-300`}>
        {body}
      </Link>
    )
  }
  return <div className={frame}>{body}</div>
}
