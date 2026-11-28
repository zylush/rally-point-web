import { useId } from 'react'
import type { ComponentType, ReactNode } from 'react'

export interface SectionProps {
  title: string
  description?: ReactNode
  /** A lucide icon component, shown in a small sky chip. */
  icon?: ComponentType<{ className?: string }>
  actions?: ReactNode
  children: ReactNode
  id?: string
  bodyClassName?: string
  /** Extra classes on the card itself, e.g. a grid span. */
  className?: string
}

/** A titled card: header with an optional icon and actions, a hairline, then the body. */
export function Section({ title, description, icon: Icon, actions, children, id, bodyClassName = '', className = '' }: SectionProps) {
  const headingId = useId()
  return (
    <section id={id} aria-labelledby={headingId} className={`card min-w-0 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3.5 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          {Icon ? (
            <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
              <Icon className="size-5" />
            </span>
          ) : null}
          <div className="min-w-0">
            <h2 id={headingId} className="text-subtitle font-bold text-ink">
              {title}
            </h2>
            {description ? <div className="text-status text-muted">{description}</div> : null}
          </div>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      <div className={`p-4 sm:p-5 ${bodyClassName}`}>{children}</div>
    </section>
  )
}

export interface Fact {
  label: string
  value: ReactNode
  /** A part of the row above it ("of which members"): stepped in and quieter. */
  indent?: boolean
  strong?: boolean
}

/** Rows of label and value, a hairline between rows. A figure is never cut off. */
export function FactList({ facts }: { facts: Fact[] }) {
  return (
    <dl className="text-body">
      {facts.map((fact, index) => (
        <div
          key={`${fact.label}-${index}`}
          className={`flex min-w-0 items-baseline justify-between gap-4 py-2.5 ${index > 0 ? 'border-t border-line' : ''}`}
        >
          <dt className={`min-w-0 ${fact.indent ? 'pl-4 text-muted' : 'text-slate-700'} ${fact.strong ? 'font-semibold text-ink' : ''}`}>
            {fact.label}
          </dt>
          <dd className={`m-0 shrink-0 text-right tabular-nums ${fact.strong ? 'text-subtitle font-bold' : 'font-semibold'} ${fact.indent ? 'text-slate-700' : 'text-ink'}`}>
            {fact.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}
