import { useEffect, useState } from 'react'
import { AppHeader, AppShell, LoadingBlock, SignOutButton } from '../components/Shell'
import { api } from '../lib/api'
import { isDemoMode } from '../lib/supabase'
import type { Booking, Role, Venue } from '../types'
import { fmtDateTime, peso } from '../types'

type DeskRole = 'staff' | 'admin'
type VenueSelection = { role: DeskRole; venues: Venue[]; venueId: string; requestId: number }
type BookingResult = { role: DeskRole; venueId: string; requestId: number; rows: Booking[]; error: string | null }

export function BookingsDesk({ role }: { role: 'staff' | 'admin' }) {
  const [selection, setSelection] = useState<VenueSelection | null>(null)
  const [venueError, setVenueError] = useState<{ role: DeskRole; message: string } | null>(null)
  const [bookingResult, setBookingResult] = useState<BookingResult | null>(null)
  const currentSelection = selection?.role === role ? selection : null
  const venueId = currentSelection?.venueId ?? ''
  const requestId = currentSelection?.requestId ?? -1
  const currentResult = bookingResult?.role === role && bookingResult.venueId === venueId && bookingResult.requestId === requestId
    ? bookingResult : null
  const error = (venueError?.role === role ? venueError.message : null) ?? currentResult?.error
  const loading = !error && (!currentSelection || (venueId !== '' && !currentResult))
  const rows = currentResult?.rows ?? []

  useEffect(() => {
    let active = true
    setSelection(null)
    setVenueError(null)
    setBookingResult(null)
    void (async () => {
      try {
        const venues = await api.listVenues(undefined, role)
        if (active) setSelection({ role, venues, venueId: venues[0]?.id ?? '', requestId: 0 })
      } catch (e) {
        if (active) setVenueError({ role, message: e instanceof Error ? e.message : 'Could not load bookings' })
      }
    })()
    return () => { active = false }
  }, [role])

  useEffect(() => {
    if (!venueId) return
    let active = true
    void (async () => {
      try {
        const rows = await api.listBookings(venueId)
        if (active) setBookingResult({ role, venueId, requestId, rows, error: null })
      } catch (e) {
        if (active) setBookingResult({ role, venueId, requestId, rows: [], error: e instanceof Error ? e.message : 'Could not load bookings' })
      }
    })()
    return () => { active = false }
  }, [role, venueId, requestId])

  return (
    <AppShell role={role as Role}>
      <AppHeader
        title="Online bookings"
        subtitle="Member self-service court holds"
        right={<SignOutButton />}
      />
      <main className="safe-bottom px-4 pt-4 space-y-3">
        {currentSelection && currentSelection.venues.length > 1 ? (
          <section className="card p-3">
            <label className="label" htmlFor="bookings-venue">Venue</label>
            <select id="bookings-venue" className="input" value={venueId} onChange={(event) => {
              const nextVenueId = event.target.value
              setSelection((current) => current?.role === role && current.venues.some((venue) => venue.id === nextVenueId)
                ? { ...current, venueId: nextVenueId, requestId: current.requestId + 1 } : current)
            }}>
              {currentSelection.venues.map((venue) => <option key={venue.id} value={venue.id}>{venue.name}</option>)}
            </select>
          </section>
        ) : null}
        {loading ? (
          <LoadingBlock />
        ) : error ? (
          <section className="card p-4 text-sm text-red-600">{error}</section>
        ) : rows.length === 0 ? (
          <section className="card p-4 text-sm text-slate-500">No online bookings yet.</section>
        ) : (
          <section className="card p-2">
            {rows.map((b) => (
              <div key={b.id} className="list-row px-2">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-sm truncate">
                    {b.court?.name ?? 'Court'} · {b.member?.full_name ?? 'Member'}
                  </p>
                  <p className="text-xs text-slate-400">
                    {fmtDateTime(b.start_at)} · {b.hours}h ·{' '}
                    <span className="capitalize">{b.status.replace('_', ' ')}</span>
                    {b.payment_method ? ` · ${b.payment_method}` : ''}
                  </p>
                  {b.payment_ref ? (
                    <p className="text-[10px] font-mono text-slate-400 mt-0.5">{b.payment_ref}</p>
                  ) : null}
                </div>
                <p className="font-bold text-sm whitespace-nowrap">{peso(b.amount)}{!isDemoMode ? ' recorded' : ''}</p>
              </div>
            ))}
          </section>
        )}
      </main>
    </AppShell>
  )
}

export function StaffBookings() {
  return <BookingsDesk role="staff" />
}

export function AdminBookings() {
  return <BookingsDesk role="admin" />
}
