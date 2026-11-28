import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Bell, ChevronRight, GraduationCap, MapPin, Pencil, QrCode, Receipt, Shuffle, Trash2, Trophy, UserRoundCog } from 'lucide-react'
import { AppHeader, AppShell, SignOutAction } from '../components/Shell'
import { LoadingShapes, SkeletonBlock, SkeletonCard, SkeletonLine, SkeletonRows } from '../components/Skeleton'
import { MemberAvatar } from '../components/MemberIdentity'
import { passStatus, passToneClass } from '../lib/memberPass'
import { memberPhotoUrl } from '../lib/photos'
import { PickPhotos } from './AdminPhotos'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import { stagger } from '../lib/motion'
import { isDemoMode } from '../lib/supabase'
import type { MemberPass, Transaction } from '../types'
import { fmtDate, peso } from '../types'

const FULL_NAME_MAX = 80
const NICKNAME_MAX = 30

function messageOf(error: unknown) {
  if (error instanceof Error) return error.message
  const message = (error as { message?: unknown } | null)?.message
  return typeof message === 'string' && message ? message : 'Something went wrong. Please try again.'
}

function AccountLoading() {
  return (
    <LoadingShapes label="Loading your account…">
      <div className="space-y-4" aria-hidden>
        <SkeletonCard>
          <div className="flex items-center gap-4">
            <SkeletonBlock className="h-24 w-24 shrink-0 rounded-3xl!" />
            <div className="flex-1 space-y-2">
              <SkeletonLine size="heading" className="w-3/5" />
              <SkeletonLine className="w-2/5" />
            </div>
          </div>
        </SkeletonCard>
        <SkeletonCard>
          <SkeletonLine size="subtitle" className="w-1/3" />
          <SkeletonRows count={2} />
        </SkeletonCard>
      </div>
    </LoadingShapes>
  )
}

/** The member's own page: who they are, their clubs and memberships, and everything else they own. */
export function MemberAccount() {
  const { user, refresh } = useAuth()
  const userId = user?.id
  const [passes, setPasses] = useState<MemberPass[]>([])
  const [txs, setTxs] = useState<Transaction[]>([])
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [busyClub, setBusyClub] = useState<string | null>(null)
  const [clubError, setClubError] = useState<{ clubId: string; message: string } | null>(null)

  const loadPasses = useCallback(async () => {
    if (!userId) return
    setPasses(await api.myMemberPasses(userId))
  }, [userId])

  useEffect(() => {
    if (!userId) return
    let current = true
    void (async () => {
      setLoading(true)
      setLoadError(null)
      try {
        const [list, notes, charges] = await Promise.all([
          api.myMemberPasses(userId),
          api.notifications(userId),
          api.transactions(userId, 'member'),
        ])
        if (!current) return
        setPasses(list)
        setUnread(notes.filter((note) => !note.read).length)
        setTxs(charges.slice(0, 3))
      } catch (error) {
        if (current) setLoadError(messageOf(error))
      } finally {
        if (current) setLoading(false)
      }
    })()
    return () => {
      current = false
    }
  }, [userId])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 4000)
    return () => window.clearTimeout(timer)
  }, [toast])

  async function clubAction(pass: MemberPass, action: 'request' | 'withdraw') {
    if (!userId) return
    setBusyClub(pass.club_id)
    setClubError(null)
    try {
      if (action === 'request') {
        await api.requestMembership(userId, pass.club_id)
        setToast(`Request sent to ${pass.club_name}.`)
      } else if (pass.request) {
        await api.cancelMembershipRequest(userId, pass.request.id)
        setToast('Request withdrawn.')
      }
      await loadPasses()
    } catch (error) {
      setClubError({ clubId: pass.club_id, message: messageOf(error) })
    } finally {
      setBusyClub(null)
    }
  }

  const greetingName = user?.nickname || user?.full_name.split(' ')[0] || 'there'

  return (
    <AppShell role="member">
      <AppHeader title="Account" subtitle={`Hi, ${greetingName}`} />
      <main className="safe-bottom px-4 pt-4 space-y-4">
        {user ? <ProfileCard onSaved={refresh} onToast={setToast} /> : null}

        {loading ? (
          <AccountLoading />
        ) : loadError ? (
          <section className="card p-4 border-red-200 bg-red-50 text-body text-red-800" role="alert">
            {loadError}
          </section>
        ) : (
          <>
            <section className="enter-rise space-y-3" aria-labelledby="my-clubs-heading">
              <h2 id="my-clubs-heading" className="text-title font-semibold px-1">My clubs</h2>
              {passes.length === 0 ? (
                <div className="card p-4 space-y-3">
                  <p className="text-body text-slate-600">You have not joined a club yet. Book a court at a club to join it as a player.</p>
                  <Link to="/clubs" className="btn-secondary">Find a court <ChevronRight size={16} aria-hidden /></Link>
                </div>
              ) : (
                passes.map((pass, index) => (
                  <ClubMembershipCard
                    key={pass.club_id}
                    pass={pass}
                    index={index}
                    busy={busyClub === pass.club_id}
                    error={clubError?.clubId === pass.club_id ? clubError.message : null}
                    onRequest={() => void clubAction(pass, 'request')}
                    onWithdraw={() => void clubAction(pass, 'withdraw')}
                  />
                ))
              )}
            </section>

            <nav className="card divide-y divide-slate-100" aria-label="More for you">
              <AccountRow to="/member/leaderboard" icon={<Trophy size={22} />} title="Leaderboard" detail="Club rankings, points and match results" />
              <AccountRow to="/member/tournaments" icon={<Shuffle size={22} />} title="Tournaments" detail="Live brackets, random queues and results" />
              <AccountRow to="/member/notifications" icon={<Bell size={22} />} title="Messages" detail="Bookings & reminders" badge={unread || undefined} />
              <AccountRow to="/member/transactions" icon={<Receipt size={22} />} title={isDemoMode ? 'Payments' : 'Charges'} detail={isDemoMode ? 'Everything you paid' : 'Recorded charges'} />
              <AccountRow to="/clubs" icon={<MapPin size={22} />} title="Find a court" detail="Browse clubs and book at any of them" />
              <AccountRow to="/member/coaches" icon={<GraduationCap size={22} />} title="Rent a coach" detail="Choose a lesson time with a coach at your club" />
              <AccountRow to="/coach" icon={<UserRoundCog size={22} />} title="Coach tools" detail="For coaches whose account is linked by a club admin" />
            </nav>

            <section className="enter-rise card p-4" style={stagger(2)}>
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-subtitle font-semibold">{isDemoMode ? 'Recent payments' : 'Recent charges'}</h2>
                <Link to="/member/transactions" className="control-feedback text-body font-semibold text-brand-800 min-h-12 px-2 inline-flex items-center">
                  See all
                </Link>
              </div>
              {txs.length === 0 ? (
                <p className="text-body font-normal text-slate-600 py-3">{isDemoMode ? 'No payments yet.' : 'No charges recorded yet.'}</p>
              ) : (
                txs.map((t) => (
                  <div key={t.id} className="list-row">
                    <div className="flex-1 min-w-0">
                      <p className="text-subtitle font-semibold truncate">{t.description}</p>
                      <p className="text-body font-normal text-slate-500">{fmtDate(t.created_at)}</p>
                    </div>
                    <p className="text-subtitle font-bold whitespace-nowrap">
                      {peso(t.amount)}{!isDemoMode || t.verification_status === 'unverified' ? ' recorded' : ''}
                    </p>
                  </div>
                ))
              )}
            </section>
          </>
        )}

        <section className="border-t border-slate-200 pt-4">
          <p className="text-body text-slate-600 mb-2">Finished for now?</p>
          <SignOutAction className="control-feedback min-h-14 w-full rounded-2xl border-2 border-red-200 bg-white px-4 text-subtitle font-semibold text-red-800 inline-flex items-center justify-center gap-2">
            Log out
          </SignOutAction>
        </section>
      </main>
      {toast ? <div className="toast" role="status">{toast}</div> : null}
    </AppShell>
  )
}

/** Photo, full name and nickname, each editable by the member. */
function ProfileCard({ onSaved, onToast }: { onSaved: () => Promise<void>; onToast: (message: string) => void }) {
  const { user } = useAuth()
  const [editing, setEditing] = useState(false)
  const [fullName, setFullName] = useState('')
  const [nickname, setNickname] = useState('')
  const [saving, setSaving] = useState(false)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!user) return null

  function startEditing() {
    setFullName(user!.full_name)
    setNickname(user!.nickname ?? '')
    setError(null)
    setEditing(true)
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!fullName.trim()) {
      setError('Please enter your name')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await api.updateMyAccount(user!.id, { full_name: fullName, nickname })
      await onSaved()
      setEditing(false)
      onToast('Your name is saved.')
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setSaving(false)
    }
  }

  async function changePhoto(file: File | null) {
    setPhotoBusy(true)
    setError(null)
    try {
      await api.setMyPhoto(user!.id, file, user!.photo_path ?? null)
      await onSaved()
      onToast(file ? 'Your photo is saved.' : 'Your photo is removed.')
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setPhotoBusy(false)
    }
  }

  return (
    <section className="enter-rise card p-4 space-y-4" aria-label="Your profile">
      <div className="flex items-center gap-4">
        <MemberAvatar name={user.full_name} photoUrl={user.photo_path ? memberPhotoUrl(user.photo_path) : null} size="lg" />
        <div className="min-w-0">
          <p className="text-title font-bold break-words">{user.full_name}</p>
          {user.nickname ? <p className="text-body text-slate-700">Goes by <span className="font-semibold">{user.nickname}</span></p> : null}
          <p className="text-body font-normal text-slate-500 truncate">{user.email}</p>
        </div>
      </div>

      {editing ? (
        <form className="space-y-3" onSubmit={(event) => void save(event)} noValidate>
          <div>
            <label className="label" htmlFor="account-full-name">Full name</label>
            <input
              id="account-full-name"
              className="input"
              value={fullName}
              maxLength={FULL_NAME_MAX}
              autoComplete="name"
              aria-describedby="account-full-name-hint"
              onChange={(event) => setFullName(event.target.value)}
            />
            <p id="account-full-name-hint" className="text-caption text-slate-500 mt-1">Your clubs see this name on your member card.</p>
          </div>
          <div>
            <label className="label" htmlFor="account-nickname">Nickname (optional)</label>
            <input
              id="account-nickname"
              className="input"
              value={nickname}
              maxLength={NICKNAME_MAX}
              autoComplete="nickname"
              aria-describedby="account-nickname-hint"
              onChange={(event) => setNickname(event.target.value)}
            />
            <p id="account-nickname-hint" className="text-caption text-slate-500 mt-1">What you like to be called in the app.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <button type="button" className="btn-secondary" onClick={() => setEditing(false)} disabled={saving}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving} aria-busy={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      ) : (
        <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2">
          <button type="button" className="btn-secondary" onClick={startEditing}>
            <Pencil size={18} aria-hidden /> Edit name
          </button>
          <PickPhotos label={photoBusy ? 'Saving photo…' : user.photo_path ? 'Change photo' : 'Add photo'} disabled={photoBusy} onPick={(files) => void changePhoto(files[0])} />
          {user.photo_path ? (
            <button type="button" className="btn-secondary min-[360px]:col-span-2" onClick={() => void changePhoto(null)} disabled={photoBusy}>
              <Trash2 size={18} aria-hidden /> Remove photo
            </button>
          ) : null}
        </div>
      )}
      {error ? <p className="text-body text-red-700" role="alert">{error}</p> : null}
    </section>
  )
}

/** One club: membership state, the request in progress, and what the member can do next. */
function ClubMembershipCard({
  pass,
  index,
  busy,
  error,
  onRequest,
  onWithdraw,
}: {
  pass: MemberPass
  index: number
  busy: boolean
  error: string | null
  onRequest: () => void
  onWithdraw: () => void
}) {
  const status = passStatus(pass)
  const pending = pass.request?.status === 'pending'
  const declined = pass.request?.status === 'declined' ? pass.request : null
  const askLabel = pass.membership_type ? 'Renew membership' : 'Become a member'
  return (
    <article className="enter-rise card p-4 space-y-3" style={stagger(index + 1)} aria-label={pass.club_name}>
      <div className="flex flex-col items-start gap-2 min-[440px]:flex-row min-[440px]:justify-between min-[440px]:gap-3">
        <div className="min-w-0">
          <h3 className="text-subtitle font-semibold break-words">{pass.club_name}</h3>
          <p className="text-body text-slate-600">{status.detail}</p>
          <p className="text-caption font-mono text-slate-500 mt-1">ID {pass.member_code}</p>
        </div>
        <span className={`pill ${passToneClass[status.tone]} shrink-0`}>{status.label}</span>
      </div>

      {pending ? (
        <div className="rounded-2xl bg-amber-50 border border-amber-200 p-3 text-body text-amber-950" role="status">
          <p className="font-semibold">Membership request sent {fmtDate(pass.request!.requested_at)}</p>
          <p className="mt-1">Pay {pass.club_name} at the front desk or by the club's GCash. Staff will confirm your membership.</p>
        </div>
      ) : declined ? (
        <div className="rounded-2xl bg-slate-50 border border-slate-200 p-3 text-body text-slate-800">
          <p className="font-semibold">Your last request was not approved</p>
          {declined.decline_reason ? <p className="mt-1">Reason: {declined.decline_reason}</p> : null}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 min-[440px]:grid-cols-2">
        <Link to={`/member/pass?club=${encodeURIComponent(pass.club_id)}`} className="btn-secondary">
          <QrCode size={18} aria-hidden /> Show my QR
        </Link>
        {pending ? (
          <button type="button" className="btn-secondary" onClick={onWithdraw} disabled={busy} aria-busy={busy}>
            {busy ? 'Withdrawing…' : 'Withdraw request'}
          </button>
        ) : (
          <button type="button" className="btn-primary" onClick={onRequest} disabled={busy} aria-busy={busy}>
            {busy ? 'Sending…' : askLabel}
          </button>
        )}
      </div>
      {error ? <p className="text-body text-red-700" role="alert">{error}</p> : null}
    </article>
  )
}

function AccountRow({ to, icon, title, detail, badge }: { to: string; icon: ReactNode; title: string; detail: string; badge?: number }) {
  return (
    <Link to={to} className="control-feedback p-4 flex items-center gap-3 min-h-[72px]">
      <span className="action-tile-icon shrink-0" aria-hidden>{icon}</span>
      <span className="flex-1 min-w-0">
        <span className="block text-subtitle font-semibold">{title}</span>
        <span className="block text-body font-normal text-slate-600">{detail}</span>
      </span>
      {badge ? (
        <span className="text-body font-bold bg-red-600 text-white rounded-full min-w-8 h-8 px-2 flex items-center justify-center" aria-label={`${badge} unread`}>
          {badge}
        </span>
      ) : (
        <ChevronRight className="text-slate-400" size={22} aria-hidden />
      )}
    </Link>
  )
}
