import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, CalendarPlus, RefreshCw } from 'lucide-react'
import { AppHeader, AppShell, SignOutButton } from '../components/Shell'
import { CoachRequestThread } from '../components/CoachRequestThread'
import { LoadingShapes } from '../components/Skeleton'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import type { CoachBookingRequest, CoachBookingSlot, CoachProfileAccess } from '../types'
import { fmtDateTime, peso } from '../types'

function manilaInstant(value: string) {
  const parsed = new Date(`${value}:00+08:00`)
  if (!Number.isFinite(parsed.getTime())) throw new Error('Enter a valid Philippine date and time')
  return parsed.toISOString()
}

function priceLabel(row: Pick<CoachBookingSlot, 'pricing_model' | 'rate'>) {
  return row.pricing_model === 'per_student' ? `${peso(row.rate)} per player per hour` : `${peso(row.rate)} per session`
}

export function CoachPortal() {
  const { user } = useAuth()
  const [profiles, setProfiles] = useState<CoachProfileAccess[]>([])
  const [slots, setSlots] = useState<CoachBookingSlot[]>([])
  const [requests, setRequests] = useState<CoachBookingRequest[]>([])
  const [selectedCoachId, setSelectedCoachId] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [lessonType, setLessonType] = useState<'private' | 'group'>('private')
  const [pricingModel, setPricingModel] = useState<'per_student' | 'per_session'>('per_student')
  const [rate, setRate] = useState('')
  const [maxStudents, setMaxStudents] = useState(4)
  const [policyDraft, setPolicyDraft] = useState<Record<string, string>>({})
  const [thread, setThread] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const activeProfiles = useMemo(() => profiles.filter((profile) => profile.is_active), [profiles])

  const refresh = useCallback(async () => {
    try {
      const [nextProfiles, nextSlots, nextRequests] = await Promise.all([
        api.coachMyProfiles(),
        api.coachListMySlots(),
        api.coachListMyRequests(),
      ])
      setProfiles(nextProfiles)
      setSlots(nextSlots)
      setRequests(nextRequests)
      setSelectedCoachId((current) =>
        nextProfiles.some((profile) => profile.coach_id === current && profile.is_active)
          ? current
          : nextProfiles.find((profile) => profile.is_active)?.coach_id ?? '',
      )
      setPolicyDraft((current) => Object.fromEntries(
        nextProfiles.map((profile) => [profile.coach_id, current[profile.coach_id] ?? profile.booking_policy ?? '']),
      ))
      setError(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load coach workspace')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function createSlot(event: FormEvent) {
    event.preventDefault()
    if (busy || !selectedCoachId) return
    setBusy('slot')
    setError(null)
    try {
      await api.coachUpsertBookingSlot({
        coach_id: selectedCoachId,
        starts_at: manilaInstant(start),
        ends_at: manilaInstant(end),
        lesson_type: lessonType,
        pricing_model: pricingModel,
        rate: Number(rate),
        max_students: lessonType === 'private' ? 1 : maxStudents,
      })
      setStart('')
      setEnd('')
      setRate('')
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not publish this time')
    } finally {
      setBusy(null)
    }
  }

  async function savePolicy(profile: CoachProfileAccess) {
    if (busy) return
    setBusy(`policy:${profile.coach_id}`)
    setError(null)
    try {
      await api.coachSetBookingPolicy(profile.coach_id, policyDraft[profile.coach_id] ?? '')
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save your booking policy')
    } finally {
      setBusy(null)
    }
  }

  async function setSlotOpen(slot: CoachBookingSlot, isOpen: boolean) {
    if (busy) return
    setBusy(slot.slot_id)
    setError(null)
    try {
      await api.coachSetBookingSlotOpen(slot.slot_id, isOpen)
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not update this coach time')
    } finally {
      setBusy(null)
    }
  }

  async function respond(requestId: string, accept: boolean) {
    if (busy) return
    setBusy(requestId)
    setError(null)
    try {
      await api.coachRespondToBookingRequest(requestId, accept)
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not update this request')
    } finally {
      setBusy(null)
    }
  }

  return (
    <AppShell role={user?.role ?? 'member'}>
      <AppHeader title="Coach tools" subtitle="Your linked clubs and lesson requests" right={<SignOutButton />} />
      <main className="safe-bottom space-y-4 px-4 pt-4">
        <Link to="/member" className="control-feedback inline-flex min-h-12 items-center gap-2 text-body font-semibold text-brand-800">
          <ArrowLeft size={18} aria-hidden /> Back to home
        </Link>
        <section className="card space-y-2 p-4">
          <h2 className="text-title font-semibold text-slate-900">Coach workspace</h2>
          <p className="text-body text-slate-700">Post coach times and respond to lesson requests. Lesson requests do not reserve a court and do not collect payment.</p>
        </section>
        {error ? <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-body font-semibold text-red-800" role="alert">{error}</p> : null}
        <div className="flex justify-end">
          <button type="button" className="control-feedback inline-flex min-h-12 items-center gap-2 rounded-xl px-3 text-body font-semibold text-brand-800"
            onClick={() => void refresh()}>
            <RefreshCw size={18} aria-hidden /> Refresh
          </button>
        </div>
        {loading ? (
          <LoadingShapes label="Loading coach workspace…">
            <div className="space-y-3"><div className="skeleton h-32 rounded-2xl!" /><div className="skeleton h-32 rounded-2xl!" /></div>
          </LoadingShapes>
        ) : profiles.length === 0 ? (
          <section className="card space-y-2 p-4">
            <h2 className="text-subtitle font-semibold text-slate-900">No coach profile is linked to this account</h2>
            <p className="text-body text-slate-700">Ask a club admin to link the email you used to sign up. Only profiles explicitly linked to your account appear here.</p>
          </section>
        ) : (
          <>
            <section className="card space-y-3 p-4">
              <h2 className="text-title font-semibold text-slate-900">Your club coach profiles</h2>
              <ul className="space-y-3">
                {profiles.map((profile) => (
                  <li key={profile.coach_id} className="rounded-xl border border-slate-200 p-3">
                    <p className="text-subtitle font-semibold text-slate-900">{profile.full_name}</p>
                    <p className="text-body text-slate-600">{profile.club_name}</p>
                    {!profile.is_active ? <p className="mt-1 text-body font-semibold text-amber-800">This coach profile is inactive.</p> : null}
                    <label className="mt-3 block space-y-1 text-body font-semibold text-slate-800">
                      Booking policy (optional)
                      <textarea className="input min-h-24 w-full" maxLength={2000}
                        value={policyDraft[profile.coach_id] ?? ''}
                        onChange={(event) => setPolicyDraft((current) => ({ ...current, [profile.coach_id]: event.target.value }))} />
                    </label>
                    <button type="button" className="btn-secondary mt-2" disabled={busy !== null}
                      onClick={() => void savePolicy(profile)}>
                      {busy === `policy:${profile.coach_id}` ? 'Saving…' : 'Save booking policy'}
                    </button>
                  </li>
                ))}
              </ul>
            </section>

            {activeProfiles.length > 0 ? (
              <section className="card space-y-3 p-4">
                <h2 className="text-title font-semibold text-slate-900">Publish a coach time</h2>
                <form className="space-y-3" onSubmit={(event) => void createSlot(event)}>
                  <label className="block space-y-1 text-body font-semibold text-slate-800">
                    Club profile
                    <select className="input min-h-12 w-full" value={selectedCoachId} onChange={(event) => setSelectedCoachId(event.target.value)}>
                      {activeProfiles.map((profile) => <option key={profile.coach_id} value={profile.coach_id}>{profile.club_name}</option>)}
                    </select>
                  </label>
                  <label className="block space-y-1 text-body font-semibold text-slate-800">
                    Starts (Philippine time)
                    <input className="input min-h-12 w-full" type="datetime-local" step={900} value={start}
                      onChange={(event) => setStart(event.target.value)} required />
                  </label>
                  <label className="block space-y-1 text-body font-semibold text-slate-800">
                    Ends (Philippine time)
                    <input className="input min-h-12 w-full" type="datetime-local" step={900} value={end}
                      onChange={(event) => setEnd(event.target.value)} required />
                  </label>
                  <label className="block space-y-1 text-body font-semibold text-slate-800">
                    Lesson format
                    <select className="input min-h-12 w-full" value={lessonType}
                      onChange={(event) => setLessonType(event.target.value as 'private' | 'group')}>
                      <option value="private">Private lesson</option>
                      <option value="group">Group lesson</option>
                    </select>
                  </label>
                  <label className="block space-y-1 text-body font-semibold text-slate-800">
                    Price basis
                    <select className="input min-h-12 w-full" value={pricingModel}
                      onChange={(event) => setPricingModel(event.target.value as 'per_student' | 'per_session')}>
                      <option value="per_student">Per player per hour</option>
                      <option value="per_session">One price for the session</option>
                    </select>
                  </label>
                  <label className="block space-y-1 text-body font-semibold text-slate-800">
                    Price in pesos
                    <input className="input min-h-12 w-full" type="number" inputMode="decimal" min={0} max={100000} step="0.01"
                      value={rate} onChange={(event) => setRate(event.target.value)} required />
                  </label>
                  {lessonType === 'group' ? (
                    <label className="block space-y-1 text-body font-semibold text-slate-800">
                      Maximum players
                      <input className="input min-h-12 w-full" type="number" inputMode="numeric" min={2} max={16}
                        value={maxStudents} onChange={(event) => setMaxStudents(Number(event.target.value))} required />
                    </label>
                  ) : null}
                  <button type="submit" className="btn-primary flex w-full items-center justify-center gap-2" disabled={busy !== null}>
                    <CalendarPlus size={18} aria-hidden /> {busy === 'slot' ? 'Publishing…' : 'Publish this time'}
                  </button>
                </form>
              </section>
            ) : null}

            <section className="space-y-3" aria-labelledby="coach-slots-heading">
              <h2 id="coach-slots-heading" className="text-title font-semibold text-slate-900">Your published times</h2>
              {slots.length === 0 ? <p className="card p-4 text-body text-slate-600">You have not published any times yet.</p> : null}
              {slots.map((slot) => (
                <article key={slot.slot_id} className="card space-y-2 p-4">
                  <p className="text-subtitle font-semibold text-slate-900">{slot.club_name} · {slot.lesson_type} lesson</p>
                  <p className="text-body text-slate-700">{fmtDateTime(slot.starts_at)} – {fmtDateTime(slot.ends_at)}</p>
                  <p className="text-body text-slate-600">{priceLabel(slot)} · {slot.active_students ?? 0}/{slot.max_students} places requested or booked</p>
                  <p className={`text-body font-semibold ${slot.is_open ? 'text-green-800' : 'text-slate-600'}`}>{slot.is_open ? 'Open for requests' : 'Closed'}</p>
                  <button type="button" className="btn-secondary" disabled={busy !== null || (!!slot.active_students && slot.is_open)}
                    onClick={() => void setSlotOpen(slot, !slot.is_open)}>
                    {busy === slot.slot_id ? 'Updating…' : slot.is_open ? 'Close time' : 'Reopen time'}
                  </button>
                </article>
              ))}
            </section>

            <section className="space-y-3" aria-labelledby="coach-requests-heading">
              <h2 id="coach-requests-heading" className="text-title font-semibold text-slate-900">Lesson requests</h2>
              {requests.length === 0 ? <p className="card p-4 text-body text-slate-600">New player requests will appear here.</p> : null}
              {requests.map((request) => (
                <article key={request.request_id} className="card space-y-3 p-4">
                  <div>
                    <p className="text-subtitle font-semibold text-slate-900">{request.player_name ?? 'Player'} · {request.club_name}</p>
                    <p className="text-body text-slate-700">{fmtDateTime(request.starts_at)} – {fmtDateTime(request.ends_at)}</p>
                    <p className="text-body text-slate-600">{request.student_count} player(s) · {peso(request.quoted_amount)} · {request.status.replace('_', ' ')}</p>
                    {request.message ? <p className="mt-2 whitespace-pre-wrap text-body text-slate-700">Note: {request.message}</p> : null}
                    {request.player_email ? <p className="mt-1 text-body text-slate-600">{request.player_email}</p> : null}
                  </div>
                  {request.status === 'requested' ? (
                    <>
                      <p className="text-body text-amber-800">This time is held while you decide. Accepting confirms coach time only; agree on a court with the player in the conversation.</p>
                      <div className="grid grid-cols-2 gap-2">
                        <button type="button" className="btn-primary" disabled={busy !== null}
                          onClick={() => void respond(request.request_id, true)}>
                          {busy === request.request_id ? 'Saving…' : 'Accept'}
                        </button>
                        <button type="button" className="btn-secondary" disabled={busy !== null}
                          onClick={() => void respond(request.request_id, false)}>
                          Decline
                        </button>
                      </div>
                    </>
                  ) : null}
                  <button type="button" className="btn-secondary"
                    onClick={() => setThread(thread === request.request_id ? null : request.request_id)}>
                    {thread === request.request_id ? 'Close conversation' : `Message ${request.player_name?.split(' ')[0] ?? 'player'}`}
                  </button>
                  {thread === request.request_id && user ? (
                    <CoachRequestThread request={request} viewerId={user.id} otherName={request.player_name ?? 'player'} />
                  ) : null}
                </article>
              ))}
            </section>
          </>
        )}
      </main>
    </AppShell>
  )
}
