import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { CalendarDays, ChevronDown, ChevronRight, ExternalLink, Search } from 'lucide-react'
import { OwnersStrip } from '../components/OwnersStrip'
import { Photo } from '../components/Photo'
import { PublicFrame } from '../components/PublicFrame'
import { LoadingShapes, SkeletonCard, SkeletonLine } from '../components/Skeleton'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import { callName, pesoKeep, plural } from '../lib/clubFormat'
import { isSafeLink } from '../lib/clubProfile'
import { useClubLiveRefresh } from '../lib/livePulse'
import { stagger } from '../lib/motion'
import type { PublicCoachListing, PublicCoachSlot } from '../types'
import { fmtDateTime, peso } from '../types'

type LessonFilter = '' | 'open' | 'private' | 'group'

const LESSON_FILTERS: { value: LessonFilter; label: string }[] = [
  { value: '', label: 'All coaches' },
  { value: 'open', label: 'With open times' },
  { value: 'private', label: 'Private' },
  { value: 'group', label: 'Group' },
]

const COACH_FLASH_KEY = 'brinely_coach_request_flash'
const COACH_FLASH_EVENT = 'brinely:coach-request-updated'

type CoachFlash = { kind: 'notice' | 'error'; text: string }

function writeFlash(flash: CoachFlash) {
  try {
    sessionStorage.setItem(COACH_FLASH_KEY, JSON.stringify(flash))
  } catch {
    // Ignore storage errors in restricted browsing modes.
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(COACH_FLASH_EVENT))
  }
}

function consumeFlash(): CoachFlash | null {
  try {
    const raw = sessionStorage.getItem(COACH_FLASH_KEY)
    if (!raw) return null
    sessionStorage.removeItem(COACH_FLASH_KEY)
    const parsed = JSON.parse(raw) as Partial<CoachFlash> | null
    if (parsed && (parsed.kind === 'notice' || parsed.kind === 'error') && typeof parsed.text === 'string') {
      return { kind: parsed.kind, text: parsed.text }
    }
    return null
  } catch {
    return null
  }
}

function clearFlash() {
  try {
    sessionStorage.removeItem(COACH_FLASH_KEY)
  } catch {
    // Ignore storage errors.
  }
}

function normalizeFilter(raw: string | null): LessonFilter {
  if (raw === 'open' || raw === 'private' || raw === 'group') return raw
  return ''
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message
  const message = (error as { message?: unknown } | null)?.message
  return typeof message === 'string' && message ? message : fallback
}

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

function telHref(phone: string) {
  return `tel:${phone.replace(/[^0-9+]/g, '')}`
}

function slotRate(slot: PublicCoachSlot, students = 1) {
  const durationHours = (new Date(slot.ends_at).getTime() - new Date(slot.starts_at).getTime()) / 3600000
  const safeHours = Number.isFinite(durationHours) && durationHours > 0 ? durationHours : 1
  const total = slot.pricing_model === 'per_student' ? slot.rate * students * safeHours : slot.rate
  return {
    label:
      slot.pricing_model === 'per_student'
        ? `${peso(slot.rate)} per player per hour`
        : `${peso(slot.rate)} per session`,
    total: Math.round(total * 100) / 100,
  }
}

function CoachesLoading() {
  return (
    <LoadingShapes label="Loading coaches…">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" aria-hidden>
        {[0, 1].map((key) => (
          <SkeletonCard key={key} className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="skeleton h-16 w-16 shrink-0 rounded-full!" />
              <div className="flex-1 space-y-2">
                <SkeletonLine size="subtitle" className="w-2/3" />
                <SkeletonLine className="w-1/2" />
              </div>
            </div>
            <SkeletonLine className="w-full" />
            <SkeletonLine className="w-4/5" />
          </SkeletonCard>
        ))}
      </div>
    </LoadingShapes>
  )
}

/**
 * Rent a coach: active coaches and open future lesson times across every active club.
 * Open to visitors; requesting a time requires signing in as a player (joining that club
 * as a player if needed, with no membership granted).
 */
export function PublicCoachesPage() {
  const { user, clubs = [], activeClub, joinClub, switchClub } = useAuth()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()

  const query = searchParams.get('q') ?? ''
  const city = searchParams.get('city') ?? ''
  const clubSlug = searchParams.get('club') ?? ''
  const lessonFilter = normalizeFilter(searchParams.get('type'))

  const [coaches, setCoaches] = useState<PublicCoachListing[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [students, setStudents] = useState<Record<string, number>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [busySlot, setBusySlot] = useState<string | null>(null)

  const latestRequest = useRef(0)
  const isMounted = useRef(true)

  const load = useCallback(async (quiet = false) => {
    const req = ++latestRequest.current
    if (!quiet) setLoadError(null)
    try {
      const rows = await api.listPublicCoaches()
      if (!isMounted.current || req !== latestRequest.current) return
      setCoaches(rows ?? [])
      setLoadError(null)
    } catch (cause) {
      if (isMounted.current && req === latestRequest.current) {
        setLoadError(errorMessage(cause, 'Could not load coaches.'))
      }
    }
  }, [])

  useEffect(() => {
    isMounted.current = true
    const applyFlash = () => {
      const flash = consumeFlash()
      if (!flash) return
      if (flash.kind === 'notice') {
        setSubmitError(null)
        setNotice(flash.text)
        void load(true)
      } else {
        setNotice(null)
        setSubmitError(flash.text)
      }
    }
    applyFlash()
    window.addEventListener(COACH_FLASH_EVENT, applyFlash)
    void load(false)
    return () => {
      isMounted.current = false
      window.removeEventListener(COACH_FLASH_EVENT, applyFlash)
    }
  }, [load])

  const clubSlugs = useMemo(
    () => [...new Set((coaches ?? []).map((coach) => coach.club.slug))].sort(),
    [coaches],
  )
  useClubLiveRefresh(['public-coaches', ...clubSlugs], () => {
    void load(true)
  }, 30000)

  const setFilter = useCallback(
    (name: 'q' | 'city' | 'club' | 'type', value: string) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current)
          if (value) next.set(name, value)
          else next.delete(name)
          return next
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  const clearFilters = () => {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current)
        next.delete('q')
        next.delete('city')
        next.delete('club')
        next.delete('type')
        return next
      },
      { replace: true },
    )
  }

  const cities = useMemo(
    () =>
      [...new Set((coaches ?? []).map((coach) => coach.club.city).filter((c): c is string => Boolean(c)))].sort(),
    [coaches],
  )

  const clubOptions = useMemo(() => {
    const seen = new Map<string, string>()
    for (const coach of coaches ?? []) {
      if (!seen.has(coach.club.slug)) seen.set(coach.club.slug, coach.club.name)
    }
    return [...seen.entries()]
      .map(([slug, name]) => ({ slug, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [coaches])

  const q = query.trim().toLowerCase()
  const filtering = Boolean(q || city || clubSlug || lessonFilter)

  const shown = useMemo(() => {
    return (coaches ?? [])
      .map((coach) => {
        const matchingSlots =
          lessonFilter === 'private' || lessonFilter === 'group'
            ? coach.slots.filter((slot) => slot.lesson_type === lessonFilter)
            : coach.slots
        return { coach, matchingSlots }
      })
      .filter(({ coach, matchingSlots }) => {
        if (
          q &&
          ![coach.full_name, coach.headline, coach.bio, coach.club.name, coach.club.city].some((field) =>
            field?.toLowerCase().includes(q),
          )
        ) {
          return false
        }
        if (city && coach.club.city !== city) return false
        if (clubSlug && coach.club.slug.toLowerCase() !== clubSlug.toLowerCase()) return false
        if (lessonFilter && matchingSlots.length === 0) return false
        return true
      })
  }, [coaches, q, city, clubSlug, lessonFilter])

  const loginFrom = `${location.pathname}${location.search}`
  const isMemberViewer = user?.role === 'member'
  const roleNotice =
    user && user.role !== 'member'
      ? user.role === 'superadmin'
        ? 'Platform accounts can look but cannot book.'
        : 'Staff and admin accounts cannot request lessons here. Sign in with a player account to book a coach.'
      : null

  async function requestSlot(event: FormEvent, coach: PublicCoachListing, slot: PublicCoachSlot) {
    event.preventDefault()
    if (busySlot || !isMemberViewer) return
    const membership = clubs.find((item) => item.club_id === coach.club.id)
    if (membership && membership.role !== 'member') {
      setSubmitError('Only player accounts at this club can request lessons.')
      return
    }

    const studentCount = slot.lesson_type === 'group' ? students[slot.slot_id] ?? 1 : 1
    const message = notes[slot.slot_id] ?? ''
    setBusySlot(slot.slot_id)
    setSubmitError(null)
    setNotice(null)
    clearFlash()

    try {
      if (!membership) {
        await joinClub(coach.club.slug, { asPlayer: true })
      } else if (activeClub?.club_id !== coach.club.id) {
        switchClub(coach.club.id)
      }

      await api.memberRequestCoachSlot({
        slot: {
          ...slot,
          coach_id: coach.id,
          club_id: coach.club.id,
          coach_name: coach.full_name,
        },
        student_count: studentCount,
        message,
      })

      const successText = `Lesson request sent to ${coach.full_name}. Wait for the coach to accept.`
      if (isMounted.current) {
        setNotes((current) => ({ ...current, [slot.slot_id]: '' }))
        setNotice(successText)
        await load(true)
      } else {
        writeFlash({ kind: 'notice', text: successText })
      }
    } catch (cause) {
      const text = errorMessage(cause, 'Could not request this lesson.')
      if (isMounted.current) {
        setSubmitError(text)
      } else {
        writeFlash({ kind: 'error', text })
      }
    } finally {
      if (isMounted.current) setBusySlot(null)
    }
  }

  return (
    <PublicFrame title="Rent a coach" subtitle="Private and group pickleball lessons at clubs near you.">
      <section className="card space-y-2 p-4">
        <p className="text-body text-ink">
          Request a lesson time and wait for the coach to accept. This books the coach only, not a court, and no
          lesson payment is collected in the app.
        </p>
        {isMemberViewer ? (
          <Link to="/member/coaches" className="text-link inline-flex min-h-12 items-center gap-1 text-subtitle">
            Your lesson requests <ChevronRight size={16} aria-hidden />
          </Link>
        ) : null}
      </section>

      {roleNotice ? (
        <p className="notice text-subtitle" role="note">
          {roleNotice}
        </p>
      ) : null}

      {notice ? (
        <div role="status" className="notice space-y-2">
          <p className="text-body font-semibold text-ink">{notice}</p>
          <Link to="/member/coaches" className="text-link inline-flex min-h-12 items-center gap-1 text-subtitle">
            Open your lesson requests <ChevronRight size={16} aria-hidden />
          </Link>
        </div>
      ) : null}

      {submitError ? (
        <div role="alert" className="notice notice-error">
          <p className="text-body font-semibold">{submitError}</p>
        </div>
      ) : null}

      <div className="space-y-3">
        <div role="search" aria-label="Search coaches" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <label className="label" htmlFor="coach-search">
              Search
            </label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted"
                size={18}
                aria-hidden
              />
              <input
                id="coach-search"
                type="search"
                className="input input-with-icon"
                value={query}
                onChange={(event) => setFilter('q', event.target.value)}
                placeholder="Coach name, skill, or club"
                autoComplete="off"
              />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="coach-city">
              City
            </label>
            <select
              id="coach-city"
              className="input"
              value={city}
              onChange={(event) => setFilter('city', event.target.value)}
            >
              <option value="">All cities</option>
              {cities.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
              {city && coaches && !cities.includes(city) ? <option value={city}>{city}</option> : null}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="coach-club">
              Club
            </label>
            <select
              id="coach-club"
              className="input"
              value={clubSlug}
              onChange={(event) => setFilter('club', event.target.value)}
            >
              <option value="">All clubs</option>
              {clubOptions.map((item) => (
                <option key={item.slug} value={item.slug}>
                  {item.name}
                </option>
              ))}
              {clubSlug && coaches && !clubOptions.some((item) => item.slug.toLowerCase() === clubSlug.toLowerCase()) ? (
                <option value={clubSlug}>{clubSlug}</option>
              ) : null}
            </select>
          </div>
        </div>

        <div>
          <p id="coach-lesson-label" className="label">Lessons</p>
          <div role="group" aria-labelledby="coach-lesson-label" className="segmented segmented-wrap">
            {LESSON_FILTERS.map((option) => (
              <button
                key={option.label}
                type="button"
                aria-pressed={lessonFilter === option.value}
                onClick={() => setFilter('type', option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loadError ? (
        <section role="alert" className="notice notice-error space-y-3">
          <p className="text-body font-semibold">{loadError}</p>
          <button type="button" onClick={() => void load(false)} className="btn-secondary sm:w-auto! sm:px-6">
            Try again
          </button>
        </section>
      ) : null}

      {coaches === null && !loadError ? <CoachesLoading /> : null}

      {coaches !== null && !loadError ? (
        <div className="space-y-3">
          <p className="enter-rise text-subtitle font-normal text-muted" aria-live="polite">
            {shown.length > 0
              ? plural(shown.length, 'coach', 'coaches')
              : filtering
                ? 'No coaches match. Try another name, club, or lesson filter.'
                : 'No clubs have listed coaches yet.'}
          </p>
          {shown.length === 0 && filtering ? (
            <button type="button" onClick={clearFilters} className="btn-secondary sm:w-auto! sm:px-6">
              Clear filters
            </button>
          ) : null}
        </div>
      ) : null}

      {shown.length > 0 ? (
        <ul className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
          {shown.map(({ coach, matchingSlots }, index) => {
            const clubMembership = clubs.find((item) => item.club_id === coach.club.id)
            const blockedAtClub = Boolean(clubMembership && clubMembership.role !== 'member')
            return (
              <li key={coach.id} className="enter-rise card space-y-4 p-4 sm:p-5" style={stagger(index)}>
                <div className="flex items-start gap-3">
                  {coach.photo_url ? (
                    <Photo
                      src={coach.photo_url}
                      alt={`Photo of ${coach.full_name}`}
                      className="h-16 w-16 shrink-0 rounded-full"
                      lazy
                    />
                  ) : (
                    <span
                      className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-brand-100 text-title font-semibold text-ink"
                      aria-hidden
                    >
                      {initials(coach.full_name)}
                    </span>
                  )}
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <h2 className="text-title font-semibold text-ink">{coach.full_name}</h2>
                    {coach.headline ? <p className="text-body text-muted">{coach.headline}</p> : null}
                    <p className="text-body">
                      <Link to={`/clubs/${coach.club.slug}`} className="text-link inline-flex min-h-12 items-center">
                        {coach.club.name}
                      </Link>
                    </p>
                    {coach.club.city ? <p className="-mt-2 text-body text-muted">{coach.club.city}</p> : null}
                    {coach.hourly_rate != null ? (
                      <p className="text-body font-semibold text-brand-700">
                        {coach.hourly_rate === 0 ? 'Free' : `${pesoKeep(coach.hourly_rate)} per hour`}
                      </p>
                    ) : null}
                  </div>
                </div>

                {coach.bio ? <p className="whitespace-pre-line text-body text-ink">{coach.bio}</p> : null}

                {coach.booking_policy ? (
                  <details className="group rounded-[10px] border border-line bg-canvas">
                    <summary className="control-feedback flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-3 text-body font-semibold text-ink [&::-webkit-details-marker]:hidden">
                      Coach booking policy
                      <ChevronDown
                        size={18}
                        className="shrink-0 text-muted transition-transform group-open:rotate-180"
                        aria-hidden
                      />
                    </summary>
                    <p className="whitespace-pre-line px-3 pb-3 text-body text-muted">{coach.booking_policy}</p>
                  </details>
                ) : null}

                {coach.contact_phone || isSafeLink(coach.contact_url) ? (
                  <div className="flex flex-wrap gap-2">
                    {coach.contact_phone ? (
                      <a className="btn-compact" href={telHref(coach.contact_phone)}>
                        Call {callName(coach.full_name)}
                      </a>
                    ) : null}
                    {isSafeLink(coach.contact_url) ? (
                      <a className="btn-compact" href={coach.contact_url!} target="_blank" rel="noopener noreferrer">
                        Contact {callName(coach.full_name)}
                        <ExternalLink size={14} className="text-muted" aria-hidden />
                        <span className="sr-only">(opens in a new tab)</span>
                      </a>
                    ) : null}
                  </div>
                ) : null}

                <div className="space-y-2 border-t border-line pt-3">
                  <h3 className="text-subtitle font-semibold text-ink">Available lesson times</h3>
                  {matchingSlots.length === 0 ? (
                    <p className="text-body text-muted">
                      {coach.accepts_requests
                        ? 'No open lesson times posted right now.'
                        : 'Contact the coach or club directly to arrange a lesson.'}
                    </p>
                  ) : (
                    <ul className="space-y-3">
                      {matchingSlots.map((slot) => {
                        const players = students[slot.slot_id] ?? 1
                        const price = slotRate(slot, players)
                        return (
                          <li key={slot.slot_id} className="space-y-3 rounded-[10px] border border-line bg-canvas p-3">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div className="space-y-0.5">
                                <p className="flex items-center gap-1.5 text-body font-semibold text-ink">
                                  <CalendarDays size={16} aria-hidden />
                                  <span>
                                    {fmtDateTime(slot.starts_at)} – {fmtDateTime(slot.ends_at)}
                                  </span>
                                </p>
                                <p className="text-body text-muted">
                                  {slot.lesson_type === 'private'
                                    ? 'Private lesson'
                                    : `Group lesson · ${plural(slot.remaining_students, 'place')} left`}
                                </p>
                              </div>
                              <p className="text-body font-semibold text-brand-700">{price.label}</p>
                            </div>

                            {!user ? (
                              <Link
                                to="/login"
                                state={{ from: loginFrom }}
                                className="btn-secondary sm:w-auto! sm:px-5"
                              >
                                Sign in to request
                              </Link>
                            ) : isMemberViewer ? (
                              blockedAtClub ? (
                                <p className="text-body text-muted">
                                  Only player accounts at this club can request lessons.
                                </p>
                              ) : (
                                <details className="rounded-[10px] border border-line bg-white p-3">
                                  <summary className="control-feedback flex min-h-12 cursor-pointer items-center justify-between text-body font-semibold text-brand-800">
                                    Request this time
                                  </summary>
                                  <form className="space-y-3 pt-3" onSubmit={(event) => void requestSlot(event, coach, slot)}>
                                    {slot.lesson_type === 'group' ? (
                                      <label className="block space-y-1 text-body font-semibold text-ink">
                                        Number of players
                                        <select
                                          className="input"
                                          value={players}
                                          onChange={(event) =>
                                            setStudents((current) => ({
                                              ...current,
                                              [slot.slot_id]: Number(event.target.value),
                                            }))
                                          }
                                        >
                                          {Array.from(
                                            { length: Math.max(1, slot.remaining_students) },
                                            (_, idx) => idx + 1,
                                          ).map((count) => (
                                            <option key={count} value={count}>
                                              {count}
                                            </option>
                                          ))}
                                        </select>
                                      </label>
                                    ) : null}
                                    <p className="text-body text-ink">
                                      Estimated lesson price: <strong>{peso(price.total)}</strong>
                                      {slot.pricing_model === 'per_session'
                                        ? ' for the session'
                                        : ` for ${plural(players, 'player')}`}
                                    </p>
                                    <label className="block space-y-1 text-body font-semibold text-ink">
                                      Note to the coach (optional)
                                      <textarea
                                        className="input min-h-24"
                                        maxLength={600}
                                        value={notes[slot.slot_id] ?? ''}
                                        onChange={(event) =>
                                          setNotes((current) => ({
                                            ...current,
                                            [slot.slot_id]: event.target.value,
                                          }))
                                        }
                                      />
                                    </label>
                                    <button type="submit" className="btn-primary" disabled={busySlot !== null}>
                                      {busySlot === slot.slot_id ? 'Sending request…' : 'Request coach time'}
                                    </button>
                                  </form>
                                </details>
                              )
                            ) : null}
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      ) : null}

      <div className="pt-4">
        <OwnersStrip />
      </div>
    </PublicFrame>
  )
}
