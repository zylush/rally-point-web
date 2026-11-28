import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import { trend } from '../../lib/analytics'

export interface TrendProps {
  current: number
  previous: number
  /** Which way is good news: more bookings is 'up', more cancellations is 'down'. */
  goodWhen?: 'up' | 'down'
  compareLabel?: string
}

/**
 * The change against the previous period: an arrow and a percentage in green when it is
 * good news and red when it is not, then what it is compared with. Screen readers hear
 * "Up 12% vs previous period".
 */
export function Trend({ current, previous, goodWhen = 'up', compareLabel = 'vs previous period' }: TrendProps) {
  const change = trend(current, previous)
  if (change.kind === 'none' || change.kind === 'new' || change.kind === 'same') {
    const words = change.kind === 'none' ? 'Nothing yet' : change.kind === 'new' ? 'New this period' : 'Same as previous period'
    return <span className="text-status text-muted">{words}</span>
  }
  const up = change.kind === 'up'
  const good = up === (goodWhen === 'up')
  const Icon = up ? ArrowUpRight : ArrowDownRight
  return (
    <span
      className={`inline-flex flex-wrap items-center gap-x-1 text-status font-semibold tabular-nums ${good ? 'text-ok' : 'text-danger'}`}
    >
      <Icon aria-hidden className="size-4 shrink-0" />
      <span>
        <span className="sr-only">{up ? 'Up ' : 'Down '}</span>
        {change.pct}%
      </span>{' '}
      <span className="font-normal text-muted">{compareLabel}</span>
    </span>
  )
}
