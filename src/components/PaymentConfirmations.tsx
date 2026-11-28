import { useEffect, useRef, useState, type FormEvent } from 'react'
import { AlertTriangle, CheckCircle2, Clock, Loader2, RefreshCw, XCircle } from 'lucide-react'
import { LoadingShapes, SkeletonLine } from './Skeleton'
import { api } from '../lib/api'
import type { Booking } from '../types'
import { CONFIRM_PAYMENT_MINUTES, fmtDate, fmtTime, peso } from '../types'

/** How often the list asks for new payments while it is open. */
const REFRESH_MS = 20000

/** The longest reason the player is sent when a payment was not received. */
const REASON_MAX = 200

const QUICK_REASONS = ['No payment with this reference', 'Wrong amount', 'Paid to the wrong account']

const SAVE_FAILED = 'Could not save that. Check your connection and try again.'

/** When the club should have checked this payment, or null when the request has no time. */
function confirmDeadline(booking: Booking): number | null {
  if (booking.confirm_by) return new Date(booking.confirm_by).getTime()
  if (booking.payment_submitted_at) return new Date(booking.payment_submitted_at).getTime() + CONFIRM_PAYMENT_MINUTES * 60000
  return null
}

function byDeadline(a: Booking, b: Booking) {
  return (confirmDeadline(a) ?? Number.MAX_SAFE_INTEGER) - (confirmDeadline(b) ?? Number.MAX_SAFE_INTEGER)
}

function timeLeftWords(ms: number) {
  if (ms < 60000) return 'Less than 1 minute left to confirm'
  const minutes = Math.ceil(ms / 60000)
  return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} left to confirm`
}

function describe(booking: Booking) {
  return `${booking.member?.full_name ?? 'Player'}, ${booking.court?.name ?? 'Court'} at ${fmtTime(booking.start_at)}`
}

/** A message as a sentence that ends with a full stop. */
function sentence(text: string) {
  return /[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`
}

function PaymentsLoading() {
  return (
    <LoadingShapes label="Loading payments to confirm…">
      <div className="space-y-2 rounded-2xl border-2 border-slate-200 p-3" aria-hidden>
        <SkeletonLine className="w-1/2" />
        <SkeletonLine className="w-4/5" />
        <SkeletonLine className="w-2/3" />
      </div>
    </LoadingShapes>
  )
}

/**
 * GCash payments players say they sent, for staff and admins to check against the
 * club's GCash. "Payment received" books the hours; "Not received" releases them and
 * tells the player why. A request past its time stays held and shows as overdue.
 */
export function PaymentConfirmations({ venueId, onDecided }: { venueId?: string; onDecided?: (booking: Booking) => void }) {
  const [rows, setRows] = useState<Booking[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string | null>(null)
  const [decision, setDecision] = useState<string | null>(null)
  // A request that could not be saved and has since left the list (say, another staff member decided it).
  const [goneNotice, setGoneNotice] = useState<string | null>(null)
  const latestLoad = useRef(0)
  const mounted = useRef(true)
  const heading = useRef<HTMLHeadingElement>(null)
  const reasonField = useRef<HTMLTextAreaElement>(null)
  const firstQuickReason = useRef<HTMLButtonElement>(null)

  /** Loads the list; gives it back when it was shown, or null when it failed or a newer load won. */
  async function load(manual = false): Promise<Booking[] | null> {
    const id = ++latestLoad.current
    if (manual) setRefreshing(true)
    try {
      const list = await api.paymentsToConfirm(venueId || undefined)
      if (!mounted.current || id !== latestLoad.current) return null
      setRows(list)
      setLoadError(null)
      return list
    } catch (e) {
      if (!mounted.current || id !== latestLoad.current) return null
      setLoadError(
        e instanceof Error && e.message
          ? `Could not load payments to confirm. ${e.message}`
          : 'Could not load payments to confirm. Check your connection and tap Refresh.',
      )
      return null
    } finally {
      if (mounted.current && id === latestLoad.current) setRefreshing(false)
    }
  }

  useEffect(() => {
    mounted.current = true
    void load()
    const poll = window.setInterval(() => void load(), REFRESH_MS)
    const tick = window.setInterval(() => setNow(Date.now()), 1000)
    return () => {
      mounted.current = false
      window.clearInterval(poll)
      window.clearInterval(tick)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueId])

  // Opening "Not received" moves focus to its first quick reason.
  useEffect(() => {
    if (rejectingId) firstQuickReason.current?.focus()
  }, [rejectingId])

  function clearRowError(bookingId: string) {
    setRowErrors((current) => {
      if (!(bookingId in current)) return current
      const next = { ...current }
      delete next[bookingId]
      return next
    })
  }

  /**
   * A request is leaving the list. If focus was on it (or already lost), it goes to the list
   * heading, so keyboard and screen reader users are not dropped at the top of the page.
   * Call this while the row is still on screen.
   */
  function keepFocusAsRowLeaves(bookingId: string) {
    const row = document.getElementById(`payment-${bookingId}-title`)?.closest('li')
    const active = document.activeElement
    if (!active || active === document.body || !active.isConnected || row?.contains(active)) heading.current?.focus()
  }

  async function decide(booking: Booking, save: () => Promise<Booking>, done: string) {
    setBusyId(booking.id)
    setDecision(null)
    setGoneNotice(null)
    clearRowError(booking.id)
    try {
      const saved = await save()
      if (!mounted.current) return
      keepFocusAsRowLeaves(booking.id)
      setRows((current) => current?.filter((row) => row.id !== booking.id) ?? current)
      setRejectingId((current) => (current === booking.id ? null : current))
      setDecision(done)
      onDecided?.(saved)
      void load()
    } catch (e) {
      if (!mounted.current) return
      const message = e instanceof Error && e.message ? e.message : SAVE_FAILED
      setRowErrors((current) => ({ ...current, [booking.id]: message }))
      // Another staff member may have decided it already: fetch the list now, not at the next
      // check. If the request has gone, say so above the list, since its row (and error) goes too.
      void load().then((fresh) => {
        if (!fresh || fresh.some((row) => row.id === booking.id)) return
        keepFocusAsRowLeaves(booking.id)
        clearRowError(booking.id)
        setRejectingId((current) => (current === booking.id ? null : current))
        setGoneNotice(`${describe(booking)}: ${sentence(message)} It is no longer waiting, so it has left the list.`)
      })
    } finally {
      if (mounted.current) setBusyId(null)
    }
  }

  function confirmReceived(booking: Booking) {
    void decide(
      booking,
      () => api.confirmBookingPayment(booking.id),
      `Payment received: ${describe(booking)}. The hours now show as Booked and the player has been told.`,
    )
  }

  function openReject(booking: Booking) {
    setRejectingId(booking.id)
    setReason('')
    setReasonError(null)
    clearRowError(booking.id)
  }

  function submitReject(event: FormEvent, booking: Booking) {
    event.preventDefault()
    if (busyId) return
    const text = reason.trim()
    const problem = !text
      ? 'Pick a reason or type one, so the player knows what went wrong.'
      : text.length > REASON_MAX
        ? `Keep the reason to ${REASON_MAX} letters or fewer.`
        : null
    setReasonError(problem)
    if (problem) {
      reasonField.current?.focus()
      return
    }
    void decide(
      booking,
      () => api.rejectBookingPayment(booking.id, text),
      `Marked as not received: ${describe(booking)}. The hours are free again and the player has been told why.`,
    )
  }

  const list = rows ? [...rows].sort(byDeadline) : null
  const overdueCount = list?.filter((b) => {
    const deadline = confirmDeadline(b)
    return deadline != null && now >= deadline
  }).length ?? 0

  return (
    <section className="enter-rise card p-4 space-y-3" aria-labelledby="payments-to-confirm-title">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 ref={heading} id="payments-to-confirm-title" tabIndex={-1} className="text-title font-extrabold text-slate-900 outline-none">
            Payments to confirm
          </h2>
          {list && list.length > 0 ? (
            <p className="text-sm font-semibold text-slate-700">
              {list.length} waiting{overdueCount > 0 ? ` · ${overdueCount} overdue` : ''}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={refreshing}
          aria-busy={refreshing}
          className="btn-compact shrink-0"
        >
          <RefreshCw size={16} aria-hidden className={refreshing ? 'animate-spin' : undefined} />
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      <p className="text-sm text-slate-600">
        Check the club&apos;s GCash for each reference number and amount before you choose.
        You have {CONFIRM_PAYMENT_MINUTES} minutes for each.
      </p>

      <div role="status" aria-live="polite">
        {decision ? (
          <p className="rounded-xl border border-brand-200 bg-brand-50 p-3 text-sm font-semibold text-brand-900">{decision}</p>
        ) : null}
      </div>

      {goneNotice ? (
        <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm font-semibold text-amber-950">{goneNotice}</p>
      ) : null}

      {loadError ? (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-800">{loadError}</p>
      ) : null}

      {list == null ? (
        loadError ? null : <PaymentsLoading />
      ) : list.length === 0 ? (
        <p className="rounded-xl bg-slate-50 p-3 text-body text-slate-700">No payments waiting.</p>
      ) : (
        <ul className="space-y-3">
          {list.map((b) => {
            const deadline = confirmDeadline(b)
            const overdue = deadline != null && now >= deadline
            const titleId = `payment-${b.id}-title`
            const reasonId = `payment-${b.id}-reason`
            const isBusy = busyId === b.id
            const rejecting = rejectingId === b.id
            const rowError = rowErrors[b.id]
            return (
              <li
                key={b.id}
                aria-labelledby={titleId}
                className={`space-y-3 rounded-2xl border-2 p-3 ${overdue ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white'}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 id={titleId} className="text-subtitle font-extrabold text-slate-900">{b.member?.full_name ?? 'Player'}</h3>
                    <p className="text-body text-slate-700">{b.court?.name ?? 'Court'} · {fmtDate(b.start_at)}</p>
                    <p className="text-body text-slate-700">
                      {fmtTime(b.start_at)} – {fmtTime(b.end_at)} · {b.hours} {b.hours === 1 ? 'hour' : 'hours'}
                    </p>
                  </div>
                  <p className="whitespace-nowrap text-title font-extrabold tabular-nums text-slate-900">{peso(b.amount)}</p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-sm font-bold text-slate-600">GCash reference</p>
                  <p className="break-all font-mono text-heading-3 font-extrabold tracking-wider text-slate-900">
                    {b.payment_reference ?? 'None given'}
                  </p>
                  {b.payment_submitted_at ? (
                    <p className="mt-1 text-sm text-slate-700">Player sent this at {fmtTime(b.payment_submitted_at)}</p>
                  ) : null}
                </div>

                {deadline != null ? (
                  overdue ? (
                    <p className="flex items-center gap-2 text-body font-extrabold text-red-700">
                      <AlertTriangle size={18} aria-hidden /> Overdue — the player is waiting
                    </p>
                  ) : (
                    <p className="flex items-center gap-2 text-body font-bold text-amber-900">
                      <Clock size={18} aria-hidden /> {timeLeftWords(deadline - now)}
                    </p>
                  )
                ) : null}

                {rowError ? <p role="alert" className="text-sm font-semibold text-red-700">{rowError}</p> : null}

                {rejecting ? (
                  <form
                    className="space-y-3 rounded-xl border-2 border-red-200 bg-white p-3"
                    noValidate
                    onSubmit={(event) => submitReject(event, b)}
                    aria-label={`Not received: ${b.member?.full_name ?? 'Player'}`}
                  >
                    <fieldset className="space-y-2">
                      <legend className="text-subtitle font-extrabold text-slate-900">Why was it not received?</legend>
                      <div className="segmented segmented-stack">
                        {QUICK_REASONS.map((quick, index) => {
                          const picked = reason.trim() === quick
                          return (
                            <button
                              key={quick}
                              ref={index === 0 ? firstQuickReason : undefined}
                              type="button"
                              aria-pressed={picked}
                              disabled={isBusy}
                              onClick={() => {
                                setReason(quick)
                                setReasonError(null)
                              }}
                            >
                              {quick}
                            </button>
                          )
                        })}
                      </div>
                    </fieldset>
                    <div>
                      <label className="label" htmlFor={reasonId}>Reason the player will see</label>
                      <textarea
                        ref={reasonField}
                        id={reasonId}
                        rows={3}
                        maxLength={REASON_MAX}
                        className="input"
                        value={reason}
                        disabled={isBusy}
                        onChange={(event) => {
                          setReason(event.target.value)
                          if (reasonError) setReasonError(null)
                        }}
                        aria-invalid={reasonError ? true : undefined}
                        aria-describedby={reasonError ? `${reasonId}-count ${reasonId}-error` : `${reasonId}-count`}
                      />
                      <p id={`${reasonId}-count`} className="mt-1 text-sm text-slate-600">
                        {reason.trim().length} of {REASON_MAX} letters
                      </p>
                      {reasonError ? (
                        <p id={`${reasonId}-error`} className="mt-1 text-sm font-semibold text-red-700">{reasonError}</p>
                      ) : null}
                    </div>
                    <div className="grid grid-cols-1 gap-2">
                      <button
                        type="submit"
                        disabled={isBusy}
                        aria-busy={isBusy}
                        className="inline-flex min-h-[54px] w-full items-center justify-center gap-2 rounded-2xl bg-red-700 px-4 text-base font-extrabold text-white disabled:opacity-60"
                      >
                        {isBusy ? (
                          <>
                            <Loader2 className="animate-spin" size={18} aria-hidden /> Saving…
                          </>
                        ) : (
                          'Mark as not received'
                        )}
                      </button>
                      <button type="button" className="btn-secondary" disabled={isBusy} onClick={() => setRejectingId(null)}>
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={busyId != null}
                      aria-busy={isBusy}
                      onClick={() => confirmReceived(b)}
                    >
                      {isBusy ? (
                        <>
                          <Loader2 className="animate-spin" size={18} aria-hidden /> Saving…
                        </>
                      ) : (
                        <>
                          <CheckCircle2 size={18} aria-hidden /> Payment received
                        </>
                      )}
                    </button>
                    <button type="button" className="btn-secondary" disabled={busyId != null} onClick={() => openReject(b)}>
                      <XCircle size={18} aria-hidden /> Not received
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
