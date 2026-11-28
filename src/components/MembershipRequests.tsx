import { useEffect, useRef, useState, type FormEvent } from 'react'
import { CheckCircle2, Loader2, RefreshCw, XCircle } from 'lucide-react'
import { LoadingShapes, SkeletonLine } from './Skeleton'
import { MemberAvatar } from './MemberIdentity'
import { api } from '../lib/api'
import type { MembershipRequest, MembershipType } from '../types'
import { fmtDate, fmtDateTime, hasActiveMembership, peso } from '../types'

/** How often the list asks for new requests while it is open. */
const REFRESH_MS = 30000

/** The longest reason the player is sent when a request is declined (staff_decline_membership_request). */
const REASON_MAX = 300

/** The most a single approval can record (staff_approve_membership_request). */
const AMOUNT_MAX = 1_000_000

const PLANS: { value: MembershipType; label: string }[] = [
  { value: 'basic', label: 'Basic' },
  { value: 'standard', label: 'Standard' },
  { value: 'premium', label: 'Premium' },
]

const SAVE_FAILED = 'Could not save that. Check your connection and try again.'

function planLabel(type: MembershipType | null) {
  return PLANS.find((plan) => plan.value === type)?.label ?? 'No plan'
}

/** "Full Name (Nickname)", or just the full name when there is no different nickname. */
function nameWithNickname(fullName: string, nickname?: string | null) {
  const nick = nickname?.trim()
  return nick && nick.toLowerCase() !== fullName.trim().toLowerCase() ? `${fullName} (${nick})` : fullName
}

/** The member's plan before this request is decided, in the desk's words. */
function currentPlanWords(request: MembershipRequest) {
  const current = { membership_type: request.membership_type, status: request.member_status, expiry_date: request.expiry_date }
  if (!request.membership_type || !request.expiry_date) return 'Now: player, no membership'
  if (hasActiveMembership(current)) return `Now: ${planLabel(request.membership_type)} member until ${fmtDate(request.expiry_date)}`
  return `Now: ${planLabel(request.membership_type)}, ended ${fmtDate(request.expiry_date)}`
}

/** A message as a sentence that ends with a full stop. */
function sentence(text: string) {
  return /[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`
}

function RequestsLoading() {
  return (
    <LoadingShapes label="Loading membership requests…">
      <div className="space-y-2 rounded-2xl border-2 border-slate-200 p-3" aria-hidden>
        <SkeletonLine className="w-1/2" />
        <SkeletonLine className="w-4/5" />
        <SkeletonLine className="w-2/3" />
      </div>
    </LoadingShapes>
  )
}

/** Checks the amount typed in; gives back the number, or the message to show. */
function readAmount(text: string): { amount: number } | { problem: string } {
  const cleaned = text.replace(/,/g, '').trim()
  if (!cleaned) return { problem: 'Enter the amount received. Type 0 if the player paid nothing.' }
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return { problem: 'Enter the amount received (0 or more), like 500 or 500.50.' }
  const amount = Number(cleaned)
  if (!Number.isFinite(amount) || amount > AMOUNT_MAX) return { problem: `Enter an amount up to ${peso(AMOUNT_MAX)}.` }
  return { amount }
}

/** Recently approved and declined requests, newest first. */
function DecidedRequests() {
  const [rows, setRows] = useState<MembershipRequest[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    api.membershipRequests('decided').then((list) => {
      if (active) setRows(list)
    }).catch((e: unknown) => {
      if (active) setError(e instanceof Error && e.message ? `Could not load decided requests. ${e.message}` : 'Could not load decided requests.')
    })
    return () => { active = false }
  }, [])

  if (error) return <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-800">{error}</p>
  if (!rows) return <RequestsLoading />
  if (rows.length === 0) return <p className="rounded-xl bg-slate-50 p-3 text-body text-slate-700">Nothing decided yet.</p>
  return (
    <ul className="space-y-2" aria-label="Recently decided requests">
      {rows.map((r) => (
        <li key={r.id} className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-body font-extrabold text-slate-900">{nameWithNickname(r.full_name, r.nickname)}</p>
          {r.status === 'approved' ? (
            <p className="text-body text-slate-700">
              <span className="font-bold text-brand-800">Approved</span>
              {r.amount != null ? ` · ${peso(r.amount)} received` : ''}
            </p>
          ) : (
            <p className="text-body text-slate-700">
              <span className="font-bold text-red-700">Declined</span>
              {r.decline_reason ? ` · ${r.decline_reason}` : ''}
            </p>
          )}
          {r.decided_at ? <p className="text-sm text-slate-600">{fmtDateTime(r.decided_at)}</p> : null}
        </li>
      ))}
    </ul>
  )
}

/**
 * Players asking the active club for a membership. Staff and admins approve one once the
 * player has paid at the desk or by the club's own GCash (the app takes no payment): they
 * choose the plan and enter the amount received, which starts or extends the membership
 * 30 days. Or they decline it with a reason the player sees.
 */
export function MembershipRequests({ staffId }: { staffId?: string }) {
  const [rows, setRows] = useState<MembershipRequest[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const [open, setOpen] = useState<{ id: string; mode: 'approve' | 'decline' } | null>(null)
  const [plan, setPlan] = useState<MembershipType>('standard')
  const [amount, setAmount] = useState('')
  const [amountError, setAmountError] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string | null>(null)
  const [decision, setDecision] = useState<string | null>(null)
  const [goneNotice, setGoneNotice] = useState<string | null>(null)
  const [showDecided, setShowDecided] = useState(false)
  const [decidedVersion, setDecidedVersion] = useState(0)
  const latestLoad = useRef(0)
  const mounted = useRef(true)
  const heading = useRef<HTMLHeadingElement>(null)
  const amountField = useRef<HTMLInputElement>(null)
  const reasonField = useRef<HTMLTextAreaElement>(null)
  const firstPlan = useRef<HTMLInputElement>(null)

  /** Loads the list; gives it back when it was shown, or null when it failed or a newer load won. */
  async function load(manual = false): Promise<MembershipRequest[] | null> {
    const id = ++latestLoad.current
    if (manual) setRefreshing(true)
    try {
      const list = await api.membershipRequests('pending')
      if (!mounted.current || id !== latestLoad.current) return null
      setRows(list)
      setLoadError(null)
      return list
    } catch (e) {
      if (!mounted.current || id !== latestLoad.current) return null
      setLoadError(
        e instanceof Error && e.message
          ? `Could not load membership requests. ${e.message}`
          : 'Could not load membership requests. Check your connection and tap Refresh.',
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
    return () => {
      mounted.current = false
      window.clearInterval(poll)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Opening a form moves focus to its first field.
  useEffect(() => {
    if (open?.mode === 'approve') firstPlan.current?.focus()
    if (open?.mode === 'decline') reasonField.current?.focus()
  }, [open])

  function clearRowError(requestId: string) {
    setRowErrors((current) => {
      if (!(requestId in current)) return current
      const next = { ...current }
      delete next[requestId]
      return next
    })
  }

  /** As a request leaves the list, keep keyboard and screen reader users on the list heading. */
  function keepFocusAsRowLeaves(requestId: string) {
    const row = document.getElementById(`mreq-${requestId}-title`)?.closest('li')
    const active = document.activeElement
    if (!active || active === document.body || !active.isConnected || row?.contains(active)) heading.current?.focus()
  }

  async function decide(request: MembershipRequest, save: () => Promise<void>, done: string) {
    setBusyId(request.id)
    setDecision(null)
    setGoneNotice(null)
    clearRowError(request.id)
    try {
      await save()
      if (!mounted.current) return
      keepFocusAsRowLeaves(request.id)
      setRows((current) => current?.filter((row) => row.id !== request.id) ?? current)
      setOpen((current) => (current?.id === request.id ? null : current))
      setDecision(done)
      setDecidedVersion((v) => v + 1)
      void load()
    } catch (e) {
      if (!mounted.current) return
      const message = e instanceof Error && e.message ? e.message : SAVE_FAILED
      setRowErrors((current) => ({ ...current, [request.id]: message }))
      // Another staff member may have decided it already: if it has gone, say so above the list.
      void load().then((fresh) => {
        if (!fresh || fresh.some((row) => row.id === request.id)) return
        keepFocusAsRowLeaves(request.id)
        clearRowError(request.id)
        setOpen((current) => (current?.id === request.id ? null : current))
        setGoneNotice(`${request.full_name}: ${sentence(message)} It is no longer waiting, so it has left the list.`)
      })
    } finally {
      if (mounted.current) setBusyId(null)
    }
  }

  function openForm(request: MembershipRequest, mode: 'approve' | 'decline') {
    setOpen({ id: request.id, mode })
    setPlan('standard')
    setAmount('')
    setAmountError(null)
    setReason('')
    setReasonError(null)
    clearRowError(request.id)
  }

  function submitApprove(event: FormEvent, request: MembershipRequest) {
    event.preventDefault()
    if (busyId || !staffId) return
    const read = readAmount(amount)
    if ('problem' in read) {
      setAmountError(read.problem)
      amountField.current?.focus()
      return
    }
    setAmountError(null)
    const chosen = plan
    void decide(
      request,
      () => api.approveMembershipRequest(request.id, { membership_type: chosen, amount: read.amount }, staffId),
      `Membership approved for ${request.full_name}: ${planLabel(chosen)}, ${peso(read.amount)} received. 30 days were added and the member rate now applies.`,
    )
  }

  function submitDecline(event: FormEvent, request: MembershipRequest) {
    event.preventDefault()
    if (busyId || !staffId) return
    const text = reason.trim()
    const problem = !text
      ? 'Please give a reason the player will see.'
      : text.length > REASON_MAX
        ? `Keep the reason to ${REASON_MAX} letters or fewer.`
        : null
    setReasonError(problem)
    if (problem) {
      reasonField.current?.focus()
      return
    }
    void decide(
      request,
      () => api.declineMembershipRequest(request.id, text, staffId),
      `Request declined: ${request.full_name}. The player can see your reason.`,
    )
  }

  return (
    <section className="enter-rise card p-4 space-y-3" aria-labelledby="membership-requests-title">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 ref={heading} id="membership-requests-title" tabIndex={-1} className="text-title font-extrabold text-slate-900 outline-none">
            Membership requests
          </h2>
          {rows && rows.length > 0 ? <p className="text-sm font-semibold text-slate-700">{rows.length} waiting</p> : null}
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
        Approve once the player has paid you at the desk or by the club&apos;s GCash. Approving adds 30 days and turns on the member rate.
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

      {rows == null ? (
        loadError ? null : <RequestsLoading />
      ) : rows.length === 0 ? (
        <p className="rounded-xl bg-slate-50 p-3 text-body text-slate-700">No membership requests waiting.</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => {
            const titleId = `mreq-${r.id}-title`
            const amountId = `mreq-${r.id}-amount`
            const reasonId = `mreq-${r.id}-reason`
            const isBusy = busyId === r.id
            const mode = open?.id === r.id ? open.mode : null
            const rowError = rowErrors[r.id]
            const displayName = nameWithNickname(r.full_name, r.nickname)
            return (
              <li key={r.id} aria-labelledby={titleId} className="space-y-3 rounded-2xl border-2 border-slate-200 bg-white p-3">
                <div className="flex items-start gap-3">
                  <MemberAvatar name={r.full_name} photoUrl={r.photo_url} />
                  <div className="min-w-0">
                    <h3 id={titleId} className="text-subtitle font-extrabold text-slate-900 break-words">{displayName}</h3>
                    <p className="font-mono text-body font-bold text-slate-800">{r.member_code}</p>
                    <p className="text-body text-slate-700">{currentPlanWords(r)}</p>
                    <p className="text-sm text-slate-600">Asked {fmtDateTime(r.requested_at)}</p>
                  </div>
                </div>

                {rowError ? <p role="alert" className="text-sm font-semibold text-red-700">{rowError}</p> : null}

                {mode === 'approve' ? (
                  <form
                    className="space-y-3 rounded-xl border-2 border-brand-200 bg-white p-3"
                    noValidate
                    onSubmit={(event) => submitApprove(event, r)}
                    aria-label={`Approve: ${r.full_name}`}
                  >
                    <fieldset className="space-y-2">
                      <legend className="text-subtitle font-extrabold text-slate-900">Plan</legend>
                      <div className="segmented">
                        {PLANS.map((option, index) => (
                          <label key={option.value}>
                            <input
                              ref={index === 0 ? firstPlan : undefined}
                              type="radio"
                              name={`mreq-${r.id}-plan`}
                              value={option.value}
                              checked={plan === option.value}
                              disabled={isBusy}
                              onChange={() => setPlan(option.value)}
                              className="sr-only"
                            />
                            {option.label}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    <div>
                      <label className="label" htmlFor={amountId}>Amount received (PHP)</label>
                      <input
                        ref={amountField}
                        id={amountId}
                        className="input tabular-nums"
                        inputMode="decimal"
                        autoComplete="off"
                        placeholder="0.00"
                        value={amount}
                        disabled={isBusy}
                        onChange={(event) => {
                          setAmount(event.target.value)
                          if (amountError) setAmountError(null)
                        }}
                        aria-invalid={amountError ? true : undefined}
                        aria-describedby={amountError ? `${amountId}-hint ${amountId}-error` : `${amountId}-hint`}
                      />
                      <p id={`${amountId}-hint`} className="mt-1 text-sm text-slate-600">
                        What the player paid you. Type 0 if it was free.
                      </p>
                      {amountError ? (
                        <p id={`${amountId}-error`} className="mt-1 text-sm font-semibold text-red-700">{amountError}</p>
                      ) : null}
                    </div>
                    <div className="grid grid-cols-1 gap-2">
                      <button type="submit" className="btn-primary" disabled={isBusy || !staffId} aria-busy={isBusy}>
                        {isBusy ? (
                          <>
                            <Loader2 className="animate-spin" size={18} aria-hidden /> Saving…
                          </>
                        ) : (
                          'Approve membership'
                        )}
                      </button>
                      <button type="button" className="btn-secondary" disabled={isBusy} onClick={() => setOpen(null)}>
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : mode === 'decline' ? (
                  <form
                    className="space-y-3 rounded-xl border-2 border-red-200 bg-white p-3"
                    noValidate
                    onSubmit={(event) => submitDecline(event, r)}
                    aria-label={`Decline: ${r.full_name}`}
                  >
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
                        disabled={isBusy || !staffId}
                        aria-busy={isBusy}
                        className="inline-flex min-h-[54px] w-full items-center justify-center gap-2 rounded-2xl bg-red-700 px-4 text-base font-extrabold text-white disabled:opacity-60"
                      >
                        {isBusy ? (
                          <>
                            <Loader2 className="animate-spin" size={18} aria-hidden /> Saving…
                          </>
                        ) : (
                          'Decline request'
                        )}
                      </button>
                      <button type="button" className="btn-secondary" disabled={isBusy} onClick={() => setOpen(null)}>
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={busyId != null || !staffId}
                      onClick={() => openForm(r, 'approve')}
                    >
                      <CheckCircle2 size={18} aria-hidden /> Approve
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={busyId != null || !staffId}
                      onClick={() => openForm(r, 'decline')}
                    >
                      <XCircle size={18} aria-hidden /> Decline
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <div className="border-t border-slate-200 pt-3">
        <button
          type="button"
          className="inline-flex min-h-12 items-center px-1 text-body font-bold text-brand-800 underline underline-offset-4"
          aria-expanded={showDecided}
          aria-controls="membership-requests-decided"
          onClick={() => setShowDecided((value) => !value)}
        >
          {showDecided ? 'Hide recently decided' : 'Show recently decided'}
        </button>
        <div id="membership-requests-decided" className={showDecided ? 'mt-2' : undefined}>
          {showDecided ? <DecidedRequests key={decidedVersion} /> : null}
        </div>
      </div>
    </section>
  )
}
