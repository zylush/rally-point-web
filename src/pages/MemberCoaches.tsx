import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, CalendarDays, RefreshCw } from 'lucide-react'
import { AppHeader, AppShell, SignOutButton } from '../components/Shell'
import { CoachRequestThread } from '../components/CoachRequestThread'
import { LoadingShapes } from '../components/Skeleton'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import type { CoachBookingRequest, CoachBookingSlot } from '../types'
import { fmtDateTime, peso } from '../types'

function slotRate(slot: CoachBookingSlot, students = 1) {
  const duration = (new Date(slot.ends_at).getTime() - new Date(slot.starts_at).getTime()) / 3600000
  const total = slot.pricing_model === 'per_student' ? slot.rate * students * duration : slot.rate
  return {
    label: slot.pricing_model === 'per_student' ? `${peso(slot.rate)} per player per hour` : `${peso(slot.rate)} per session`,
    total,
  }
}

function dateRange() {
  const from = new Date()
  const until = new Date(from)
  until.setDate(until.getDate() + 30)
  return { from: from.toISOString(), until: until.toISOString() }
}

export function MemberCoaches() {
  const { activeClub, user } = useAuth()
  const [slots, setSlots] = useState<CoachBookingSlot[]>([])
  const [requests, setRequests] = useState<CoachBookingRequest[]>([])
  const [students, setStudents] = useState<Record<string, number>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [thread, setThread] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const range = dateRange()
    try {
      const [available, mine] = await Promise.all([
        api.memberListCoachSlots(range.from, range.until),
        api.memberListMyCoachRequests(),
      ])
      setSlots(available)
      setRequests(mine)
      setError(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load coaches and lesson requests')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function requestSlot(event: FormEvent, slot: CoachBookingSlot) {
    event.preventDefault()
    if (busy) return
    const studentCount = students[slot.slot_id] ?? 1
    setBusy(slot.slot_id)
    setError(null)
    try {
      await api.memberRequestCoachSlot({
        slot,
        student_count: studentCount,
        message: notes[slot.slot_id] ?? '',
      })
      setNotes((current) => ({ ...current, [slot.slot_id]: '' }))
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not request this lesson')
    } finally {
      setBusy(null)
    }
  }

  async function cancel(requestId: string) {
    if (busy) return
    setBusy(requestId)
    setError(null)
    try {
      await api.memberCancelCoachRequest(requestId)
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not cancel this request')
    } finally {
      setBusy(null)
    }
  }

  return (
    <AppShell role={user?.role ?? 'member'}>
      <AppHeader
        title="Rent a coach"
        subtitle={activeClub?.name ?? 'Choose a coach time'}
        right={<SignOutButton />}
      />
      <main className="safe-bottom space-y-4 px-4 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link to="/member" className="control-feedback inline-flex min-h-12 items-center gap-2 text-body font-semibold text-brand-800">
            <ArrowLeft size={18} aria-hidden /> Back to home
          </Link>
          <Link to="/coaches" className="text-link inline-flex min-h-12 items-center text-body">
            Browse coaches at every club
          </Link>
        </div>
        <section className="card space-y-2 p-4">
          <h2 className="text-title font-semibold text-slate-900">Choose a lesson time</h2>
          <p className="text-body text-slate-700">
            Request a time and wait for the coach to accept. This books the coach only, not a court. After confirmation,
            message the coach to agree where to play. No lesson payment is collected in the app.
          </p>
        </section>

        {error ? <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-body font-semibold text-red-800" role="alert">{error}</p> : null}
        <div className="flex justify-end">
          <button type="button" className="control-feedback inline-flex min-h-12 items-center gap-2 rounded-xl px-3 text-body font-semibold text-brand-800"
            onClick={() => void refresh()}>
            <RefreshCw size={18} aria-hidden /> Refresh
          </button>
        </div>

        {loading ? (
          <LoadingShapes label="Loading coach times…">
            <div className="space-y-3"><div className="skeleton h-32 rounded-2xl!" /><div className="skeleton h-32 rounded-2xl!" /></div>
          </LoadingShapes>
        ) : slots.length === 0 ? (
          <section className="card p-4">
            <p className="text-subtitle font-semibold text-slate-900">No available coach times right now</p>
            <p className="mt-1 text-body text-slate-600">Check again later or ask the club when its coaches will post more times.</p>
          </section>
        ) : (
          <section className="space-y-3" aria-labelledby="coach-times-heading">
            <h2 id="coach-times-heading" className="text-title font-semibold text-slate-900">Available times</h2>
            {slots.map((slot) => {
              const players = students[slot.slot_id] ?? 1
              const price = slotRate(slot, players)
              return (
                <article key={slot.slot_id} className="card space-y-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      {slot.coach_photo_url ? (
                        <img src={slot.coach_photo_url} alt={`Photo of ${slot.coach_name}`} className="h-14 w-14 shrink-0 rounded-full object-cover" loading="lazy" />
                      ) : (
                        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-50 text-title font-semibold text-brand-800" aria-hidden>
                          {slot.coach_name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}
                        </span>
                      )}
                      <div className="min-w-0">
                        <p className="text-subtitle font-semibold text-slate-900">{slot.coach_name}</p>
                        {slot.coach_headline ? <p className="text-body text-slate-600">{slot.coach_headline}</p> : null}
                      </div>
                    </div>
                    <div className="min-w-0 shrink-0 text-right">
                      <p className="text-body font-semibold text-brand-800">{price.label}</p>
                    </div>
                  </div>
                  <p className="flex items-center gap-2 text-body text-slate-700">
                    <CalendarDays size={16} aria-hidden /> {fmtDateTime(slot.starts_at)} – {fmtDateTime(slot.ends_at)}
                  </p>
                  <p className="text-body text-slate-600">
                    {slot.lesson_type === 'private' ? 'Private lesson' : `Group lesson · ${slot.remaining_students ?? slot.max_students} place(s) left`}
                  </p>
                  {slot.booking_policy ? (
                    <details className="rounded-xl bg-slate-50 p-3">
                      <summary className="min-h-11 cursor-pointer content-center text-body font-semibold text-slate-800">Coach booking policy</summary>
                      <p className="whitespace-pre-line text-body text-slate-700">{slot.booking_policy}</p>
                    </details>
                  ) : null}
                  <details className="rounded-xl border border-slate-200 p-3">
                    <summary className="min-h-11 cursor-pointer content-center text-body font-semibold text-brand-800">Request this time</summary>
                    <form className="space-y-3 pt-2" onSubmit={(event) => void requestSlot(event, slot)}>
                      {slot.lesson_type === 'group' ? (
                        <label className="block space-y-1 text-body font-semibold text-slate-800">
                          Number of players
                          <select className="input min-h-12 w-full" value={players}
                            onChange={(event) => setStudents((current) => ({ ...current, [slot.slot_id]: Number(event.target.value) }))}>
                            {Array.from({ length: Math.max(1, slot.remaining_students ?? slot.max_students) }, (_, index) => index + 1)
                              .map((count) => <option key={count} value={count}>{count}</option>)}
                          </select>
                        </label>
                      ) : null}
                      <p className="text-body text-slate-700">
                        Estimated lesson price: <strong>{peso(price.total)}</strong>
                        {slot.pricing_model === 'per_session' ? ' for the session' : ` for ${players} player${players === 1 ? '' : 's'}`}
                      </p>
                      <label className="block space-y-1 text-body font-semibold text-slate-800">
                        Note to the coach (optional)
                        <textarea className="input min-h-24 w-full" maxLength={600}
                          value={notes[slot.slot_id] ?? ''}
                          onChange={(event) => setNotes((current) => ({ ...current, [slot.slot_id]: event.target.value }))} />
                      </label>
                      <button type="submit" className="btn-primary w-full" disabled={busy !== null}>
                        {busy === slot.slot_id ? 'Sending request…' : 'Request coach time'}
                      </button>
                    </form>
                  </details>
                </article>
              )
            })}
          </section>
        )}

        <section className="space-y-3" aria-labelledby="my-coach-requests">
          <h2 id="my-coach-requests" className="text-title font-semibold text-slate-900">Your lesson requests</h2>
          {requests.length === 0 ? (
            <p className="card p-4 text-body text-slate-600">Your requests will appear here.</p>
          ) : requests.map((request) => (
            <article key={request.request_id} className="card space-y-3 p-4">
              <div>
                <p className="text-subtitle font-semibold text-slate-900">{request.coach_name}</p>
                <p className="text-body text-slate-700">{fmtDateTime(request.starts_at)} – {fmtDateTime(request.ends_at)}</p>
                <p className="text-body text-slate-600">{request.student_count} player(s) · {peso(request.quoted_amount)} · {request.status.replace('_', ' ')}</p>
              </div>
              {request.status === 'accepted' ? (
                <p className="text-body font-semibold text-green-800">Accepted. Message the coach to agree on a court; the court is not reserved here.</p>
              ) : null}
              {request.status === 'requested' ? (
                <p className="text-body text-amber-800">Waiting for the coach. This time is held until the request is accepted, declined or cancelled.</p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {(request.status === 'requested' || request.status === 'accepted') ? (
                  <button type="button" className="btn-secondary" disabled={busy !== null}
                    onClick={() => void cancel(request.request_id)}>
                    {busy === request.request_id ? 'Cancelling…' : 'Cancel request'}
                  </button>
                ) : null}
                <button type="button" className="btn-secondary" onClick={() => setThread(thread === request.request_id ? null : request.request_id)}>
                  {thread === request.request_id ? 'Close conversation' : `Message ${request.coach_name.split(' ')[0]}`}
                </button>
              </div>
              {thread === request.request_id && user ? (
                <CoachRequestThread request={request} viewerId={user.id} otherName={request.coach_name} />
              ) : null}
            </article>
          ))}
        </section>
      </main>
    </AppShell>
  )
}
