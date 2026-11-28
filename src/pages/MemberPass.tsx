import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import { AppHeader, AppShell } from '../components/Shell'
import { LoadingShapes, SkeletonBlock, SkeletonLine } from '../components/Skeleton'
import { MemberAvatar } from '../components/MemberIdentity'
import { passStatus, passToneClass } from '../lib/memberPass'
import { memberPhotoUrl } from '../lib/photos'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import { readCachedPasses, writeCachedPasses } from '../lib/passCache'
import type { MemberPass as Pass } from '../types'
import { fmtDateTime, qrPayload } from '../types'

/** The pass card's shape: name, member ID and the QR code square. */
function PassLoading() {
  return (
    <LoadingShapes label="Loading your QR codes…">
      <div className="card p-6 flex flex-col items-center space-y-3" aria-hidden>
        <SkeletonLine className="w-36" />
        <SkeletonLine size="heading" className="w-3/5" />
        <SkeletonLine size="subtitle" className="w-28" />
        <SkeletonBlock className="h-[226px] w-[226px] rounded-2xl!" />
        <SkeletonLine size="caption" className="w-4/5" />
      </div>
    </LoadingShapes>
  )
}

/** Active club first, then the rest by name, so the pass for where you are opens first. */
function orderPasses(passes: Pass[], activeClubId: string | undefined) {
  return [...passes].sort((a, b) => {
    if (a.club_id === activeClubId) return -1
    if (b.club_id === activeClubId) return 1
    return a.club_name.localeCompare(b.club_name)
  })
}

/**
 * The QR wallet: one check-in pass per club. Each club's code works only at that club,
 * so a person who belongs to several clubs picks the club they are at.
 */
export function MemberPass() {
  const { user, activeClub } = useAuth()
  const userId = user?.id
  const [params, setParams] = useSearchParams()
  const [passes, setPasses] = useState<Pass[]>([])
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!userId) return
    let current = true
    void (async () => {
      setLoading(true)
      setError(null)
      try {
        const list = await api.myMemberPasses(userId)
        if (!current) return
        setPasses(list)
        setSavedAt(null)
        writeCachedPasses(userId, list)
      } catch (e) {
        if (!current) return
        // No signal at the desk: show the codes saved on this phone, and say so.
        const cached = readCachedPasses(userId)
        if (cached?.passes.length) {
          setPasses(cached.passes)
          setSavedAt(cached.saved_at)
        } else {
          setError(e instanceof Error ? e.message : 'Your QR codes could not be loaded. Check your connection and try again.')
        }
      } finally {
        if (current) setLoading(false)
      }
    })()
    return () => {
      current = false
    }
  }, [userId])

  const ordered = useMemo(() => orderPasses(passes, activeClub?.club_id), [passes, activeClub?.club_id])
  const wanted = params.get('club')
  const selected = ordered.find((pass) => pass.club_id === wanted) ?? ordered[0] ?? null

  function choose(clubId: string) {
    setParams((next) => {
      next.set('club', clubId)
      return next
    }, { replace: true })
  }

  return (
    <AppShell role="member">
      <AppHeader title="My QR" subtitle="Show this screen at the front desk" />
      <main className="safe-bottom px-4 pt-4 space-y-4">
        {loading ? (
          <PassLoading />
        ) : error ? (
          <section className="enter-rise card p-4 border-red-200 bg-red-50 text-body text-red-800" role="alert">{error}</section>
        ) : !selected ? (
          <section className="enter-rise card p-4 space-y-3">
            <p className="text-body text-slate-600">You have no club pass yet. Book a court at a club to join it, then your QR code shows here.</p>
            <Link to="/clubs" className="btn-secondary">Find a court</Link>
          </section>
        ) : (
          <>
            {savedAt ? (
              <p className="card p-3 border-amber-200 bg-amber-50 text-body text-amber-950" role="status">
                You are offline. These are the codes saved on this phone on {fmtDateTime(savedAt)}.
              </p>
            ) : null}
            {ordered.length > 1 ? (
              <div role="tablist" aria-label="Choose a club" className="text-tabs">
                {ordered.map((pass) => {
                  const isSelected = pass.club_id === selected.club_id
                  return (
                    <button
                      key={pass.club_id}
                      type="button"
                      role="tab"
                      id={`pass-tab-${pass.club_id}`}
                      aria-selected={isSelected}
                      aria-controls="pass-panel"
                      onClick={() => choose(pass.club_id)}
                    >
                      {pass.club_name}
                    </button>
                  )
                })}
              </div>
            ) : null}
            <PassCard pass={selected} labelledBy={ordered.length > 1 ? `pass-tab-${selected.club_id}` : undefined} />
          </>
        )}
      </main>
    </AppShell>
  )
}

function PassCard({ pass, labelledBy }: { pass: Pass; labelledBy?: string }) {
  const { user } = useAuth()
  const status = passStatus(pass)
  const payload = qrPayload(pass.member_code, pass.qr_token)
  const pending = pass.request?.status === 'pending'
  return (
    <section
      id="pass-panel"
      role={labelledBy ? 'tabpanel' : undefined}
      aria-labelledby={labelledBy}
      className="enter-rise card p-6 flex flex-col items-center text-center space-y-3"
    >
      <p className="text-subtitle font-bold text-brand-800">{pass.club_name}</p>
      <MemberAvatar name={pass.full_name} photoUrl={user?.photo_path ? memberPhotoUrl(user.photo_path) : null} size="lg" />
      <div>
        <p className="font-extrabold text-2xl break-words">{pass.full_name}</p>
        {user?.nickname ? <p className="text-body text-slate-700">“{user.nickname}”</p> : null}
      </div>
      <p className="font-mono text-base text-brand-800 font-bold">{pass.member_code}</p>
      <span className={`pill ${passToneClass[status.tone]}`}>{status.label}</span>
      {pending ? <p className="text-body text-amber-900">Membership request waiting for staff</p> : null}
      <div className="rounded-2xl border border-slate-100 bg-white p-3 inline-flex items-center justify-center shadow-xs">
        <QRCodeSVG role="img" value={payload} size={200} level="M" aria-label={`Check-in QR code for ${pass.club_name}`} />
      </div>
      <p className="text-base text-slate-600">Works only at {pass.club_name}. Staff can scan it, or type your ID number.</p>
    </section>
  )
}
