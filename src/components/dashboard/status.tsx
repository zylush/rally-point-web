import { ChevronRight, CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react'
import { useId, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { fmtTime } from '../../types'
import { TONES } from './tones'

/** "Updated 7:42 PM" in Philippine time; `stale` adds a warning that the figures stopped refreshing. */
export function UpdatedStamp({ at, stale = false }: { at: Date | null; stale?: boolean }) {
  return (
    <p className="inline-flex flex-wrap items-center gap-2 text-status text-muted tabular-nums">
      {at ? <span>Updated {fmtTime(at.toISOString())}</span> : stale ? null : <span>Not updated yet</span>}
      {stale ? <span className="pill pill-warn">Not updated</span> : null}
    </p>
  )
}

export interface AttentionItem {
  key: string
  tone: 'warn' | 'danger' | 'brand'
  title: string
  detail?: string
  count?: number
  /** Where to deal with it. */
  to?: string
}

const ATTENTION_ICON = { warn: TriangleAlert, danger: CircleAlert, brand: Info } as const

/** Things that need someone: a row each, linking to where to deal with it. Empty says all is well. */
export function AttentionList({ items, empty }: { items: AttentionItem[]; empty: string }) {
  if (items.length === 0) {
    return (
      <p className="flex items-center gap-2 text-body font-semibold text-ink">
        <CircleCheck aria-hidden className="size-5 shrink-0 text-ok" />
        {empty}
      </p>
    )
  }
  return (
    <ul className="-my-1">
      {items.map((item, index) => (
        <AttentionRow key={item.key} item={item} first={index === 0} />
      ))}
    </ul>
  )
}

/**
 * One row. A link is named by its title alone (the count is already in the title);
 * the detail line is its description, so screen readers read the title first.
 */
function AttentionRow({ item, first }: { item: AttentionItem; first: boolean }) {
  const id = useId()
  const Icon = ATTENTION_ICON[item.tone]
  const content: ReactNode = (
    <>
      <span aria-hidden="true" className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${TONES[item.tone].chip}`}>
        <Icon className="size-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span id={`${id}-title`} className="block text-body font-semibold text-ink">
          {item.title}
        </span>
        {item.detail ? (
          <span id={`${id}-detail`} className="block text-status text-muted">
            {item.detail}
          </span>
        ) : null}
      </span>
      {item.count != null ? (
        <span aria-hidden="true" className={`pill tabular-nums ${TONES[item.tone].pill}`}>
          {item.count}
        </span>
      ) : null}
      {item.to ? <ChevronRight aria-hidden className="size-5 shrink-0 text-muted" /> : null}
    </>
  )
  return (
    <li className={first ? '' : 'border-t border-line'}>
      {item.to ? (
        <Link
          to={item.to}
          aria-labelledby={`${id}-title`}
          aria-describedby={item.detail ? `${id}-detail` : undefined}
          className="control-feedback -mx-2 flex min-h-14 items-center gap-3 rounded-lg px-2 py-2 text-inherit no-underline hover:bg-slate-50"
        >
          {content}
        </Link>
      ) : (
        <div className="flex min-h-14 items-center gap-3 py-2">{content}</div>
      )}
    </li>
  )
}
