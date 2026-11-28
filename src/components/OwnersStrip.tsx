import { useId } from 'react'
import { Link } from 'react-router-dom'

/**
 * A quiet pointer for court owners, at the end of player-facing pages. In a short club grid it
 * sits in the grid as a tile (`className` sets its columns), so no column is left empty.
 */
export function OwnersStrip({ className = '' }: { className?: string }) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className={`card flex h-full flex-wrap content-center items-center justify-between gap-4 p-5 ${className}`}>
      <div className="min-w-0 max-w-xl">
        <h2 id={headingId} className="text-title font-semibold text-ink">Run a pickleball club?</h2>
        <p className="mt-1 text-subtitle text-muted">List your courts, take bookings online and get paid to your own GCash.</p>
      </div>
      <Link to="/owners" className="btn-secondary sm:w-auto! sm:px-6">
        List your club
      </Link>
    </section>
  )
}
