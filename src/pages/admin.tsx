import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Clock3, Pencil, Plus, Search, UserPlus, Users } from 'lucide-react'
import { AppHeader, AppShell, LoadingBlock, SignOutButton } from '../components/Shell'
import { BackButton } from '../components/BackButton'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import { isDemoMode } from '../lib/supabase'
import type {
  Court,
  CourtSession,
  DashboardStats,
  Member,
  MembershipType,
  MemberStatus,
  Profile,
  Transaction,
  Venue,
} from '../types'
import { fmtDate, fmtTime, peso } from '../types'

export function AdminHome() {
  const { user } = useAuth()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [txs, setTxs] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void (async () => {
      const [s, t] = await Promise.all([api.stats(), api.transactions()])
      setStats(s)
      setTxs(t.slice(0, 5))
      setLoading(false)
    })()
  }, [])

  return (
    <AppShell role="admin">
      <AppHeader title="Admin home" subtitle={user?.full_name} right={<SignOutButton />} />
      <main className="safe-bottom px-4 pt-4 space-y-4">
        {loading || !stats ? (
          <LoadingBlock />
        ) : (
          <>
            <section className="grid grid-cols-2 gap-3">
              <div className="stat-card col-span-2">
                <p className="text-teal-100 text-xs font-bold uppercase">{isDemoMode ? 'Revenue today' : 'Recorded charges today'}</p>
                <p className="text-3xl font-extrabold mt-1">{peso(stats.revenue_today)}</p>
              </div>
              <div className="card p-4">
                <p className="text-xs font-bold uppercase text-slate-400">Members</p>
                <p className="text-3xl font-extrabold mt-1">{stats.members}</p>
              </div>
              <div className="card p-4">
                <p className="text-xs font-bold uppercase text-slate-400">Active now</p>
                <p className="text-3xl font-extrabold mt-1">{stats.active_now}</p>
              </div>
            </section>

            <div className="grid grid-cols-2 gap-3">
                          <Link to="/admin/members" className="btn-secondary text-sm">
                            <Users size={16} /> Members
                          </Link>
                          <Link to="/admin/ops" className="btn-primary text-sm">
                            Floor ops
                          </Link>
                          <Link to="/admin/board" className="btn-secondary text-sm">
                            Schedule board
                          </Link>
                          <Link to="/admin/open" className="btn-secondary text-sm">
                            Open play
                          </Link>
                          <Link to="/admin/bookings" className="btn-secondary text-sm">
                            Bookings
                          </Link>
                          <Link to="/admin/users" className="btn-secondary text-sm">
                            Users
                          </Link>
                          <Link to="/admin/venues" className="btn-secondary text-sm">
                            Venues & access
                          </Link>
                        </div>

            <section className="card p-4">
              <div className="flex items-center justify-between mb-1">
                <h2 className="font-extrabold">Latest transactions</h2>
                <Link
                  to="/admin/transactions"
                  className="control-feedback px-2 text-xs font-bold text-brand-700 inline-flex items-center"
                >
                  All
                </Link>
              </div>
              {txs.map((t) => (
                <div key={t.id} className="list-row">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate">{t.description}</p>
                    <p className="text-xs text-slate-400">{fmtDate(t.created_at)}</p>
                  </div>
                  <p className="font-bold text-sm">{peso(t.amount)}{!isDemoMode || t.verification_status === 'unverified' ? ' recorded' : ''}</p>
                </div>
              ))}
            </section>
          </>
        )}
      </main>
      </AppShell>
  )
}

export function AdminMembers() {
  const nav = useNavigate()
  const [members, setMembers] = useState<Member[]>([])
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void api.listMembers().then((m) => {
      setMembers(m)
      setLoading(false)
    })
  }, [])

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return members
    return members.filter(
      (m) =>
        m.full_name.toLowerCase().includes(s) ||
        m.member_code.toLowerCase().includes(s) ||
        (m.email ?? '').toLowerCase().includes(s),
    )
  }, [members, q])

  return (
    <AppShell role="admin">
      <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-4 pt-3 pb-2 flex items-center justify-between">
        <BackButton />
        <h1 className="text-lg font-bold flex-1 text-center">{members.length} on file</h1>
        <button
          type="button"
          className="w-10 h-10 rounded-full bg-brand-700 text-white flex items-center justify-center"
          onClick={() => nav('/admin/members/new')}
          aria-label="New member"
        >
          <Plus size={20} />
        </button>
      </div>
      <AppHeader title="Members" />
      <main className="safe-bottom px-4 pt-4 space-y-3">
        <div className="relative">
                  <Search
                    size={16}
                    className="pointer-events-none absolute left-3.5 top-1/2 z-10 -translate-y-1/2 text-slate-400"
                    aria-hidden
                  />
                  <input
                    className="input input-with-icon"
                    type="search"
                    placeholder="Search members…"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    aria-label="Search members"
                  />
                </div>
        {loading ? (
          <LoadingBlock />
        ) : (
          <section className="card p-2">
            {filtered.map((m) => (
              <button
                key={m.id}
                type="button"
                className="list-row px-2 w-full text-left"
                onClick={() => nav(`/admin/members/${m.id}`)}
              >
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm truncate">{m.full_name}</p>
                  <p className="text-xs text-slate-400">
                    {m.member_code} · <span className="capitalize">{m.membership_type}</span>
                  </p>
                </div>
                <span className={`pill ${m.status === 'active' ? 'pill-ok' : 'pill-warn'}`}>{m.status}</span>
              </button>
            ))}
          </section>
        )}
      </main>
      </AppShell>
  )
}

export function AdminMemberForm() {
  const { id } = useParams()
  const nav = useNavigate()
  const isNew = !id || id === 'new'
  const [loading, setLoading] = useState(!isNew)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [type, setType] = useState<MembershipType>('standard')
  const [status, setStatus] = useState<MemberStatus>('active')
  const [expiry, setExpiry] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isNew) return
    void api.getMember(id!).then((m) => {
      if (!m) {
        setError('Member not found')
        setLoading(false)
        return
      }
      setFullName(m.full_name)
      setEmail(m.email ?? '')
      setPhone(m.phone ?? '')
      setType(m.membership_type)
      setStatus(m.status)
      setExpiry(m.expiry_date)
      setNotes(m.notes ?? '')
      setLoading(false)
    })
  }, [id, isNew])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.saveMember({
        id: isNew ? undefined : id,
        full_name: fullName,
        email,
        phone,
        membership_type: type,
        status,
        expiry_date: expiry || undefined,
        notes,
      })
      nav('/admin/members')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AppShell role="admin">
      <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-4 pt-3 pb-2 flex items-center gap-3">
        <BackButton />
        <h1 className="text-lg font-bold">{isNew ? 'New member' : 'Update member'}</h1>
      </div>
      <AppHeader title="" />
      <main className="safe-bottom px-4 pt-4">
        {loading ? (
          <LoadingBlock />
        ) : (
          <form className="card p-4 space-y-3" onSubmit={submit}>
            <div>
              <label className="label">Full name</label>
              <input className="input" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
            <div>
              <label className="label">Email</label>
              <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <label className="label">Phone</label>
              <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div>
              <label className="label">Membership type</label>
              <select className="input" value={type} onChange={(e) => setType(e.target.value as MembershipType)}>
                <option value="basic">Basic</option>
                <option value="standard">Standard</option>
                <option value="premium">Premium</option>
              </select>
            </div>
            <div>
              <label className="label">Status</label>
              <select className="input" value={status} onChange={(e) => setStatus(e.target.value as MemberStatus)}>
                <option value="active">Active</option>
                <option value="pending">Pending</option>
                <option value="expired">Expired</option>
                <option value="suspended">Suspended</option>
              </select>
            </div>
            <div>
              <label className="label">Expiry date</label>
              <input className="input" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
            </div>
            <div>
              <label className="label">Notes</label>
              <textarea className="input min-h-24" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            {error ? <p className="text-sm font-semibold text-red-600">{error}</p> : null}
            <button className="btn-primary" disabled={busy} aria-busy={busy}>
              {busy ? 'Saving…' : isNew ? 'Create member' : 'Save changes'}
            </button>
            {!isNew ? (
              <p className="text-xs text-slate-400 flex items-center gap-1 justify-center">
                <Pencil size={12} /> Editing existing record
              </p>
            ) : null}
          </form>
        )}
      </main>
      </AppShell>
  )
}

export function AdminOps() {
  const { user } = useAuth()
  const [venues, setVenues] = useState<Venue[]>([])
  const [venueId, setVenueId] = useState('')
  const [courts, setCourts] = useState<Court[]>([])
  const [sessions, setSessions] = useState<CourtSession[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [courtId, setCourtId] = useState('')
  const [memberId, setMemberId] = useState('')
  const [guest, setGuest] = useState('')
  const [hours, setHours] = useState(1)
  const [msg, setMsg] = useState<string | null>(null)
  const [tab, setTab] = useState<'rent' | 'playing' | 'extend' | 'walkin' | 'checkin'>('playing')
  const [checkMemberId, setCheckMemberId] = useState('')
  const [checkNote, setCheckNote] = useState('')
  const [wiName, setWiName] = useState('')
  const [wiPhone, setWiPhone] = useState('')
  const [wiPurpose, setWiPurpose] = useState('Day pass')
  const [wiAmount, setWiAmount] = useState(350)

  async function reload() {
    let selectedVenueId = venueId
    if (typeof api.listVenues === 'function') {
      const accessibleVenues = await api.listVenues(user?.id, 'admin')
      setVenues(accessibleVenues)
      selectedVenueId = venueId && accessibleVenues.some((venue) => venue.id === venueId) ? venueId : accessibleVenues[0]?.id ?? ''
      if (selectedVenueId !== venueId) setVenueId(selectedVenueId)
    }
    const [c, s, m] = await Promise.all([
      selectedVenueId ? api.listCourts(selectedVenueId) : api.listCourts(),
      selectedVenueId ? api.playingSessions(selectedVenueId) : api.playingSessions(),
      api.listMembers(),
    ])
    setCourts(c)
    setSessions(s)
    setMembers(m)
    if (!courtId && c[0]) setCourtId(c.find((x) => x.status === 'available')?.id ?? c[0].id)
    if (!memberId && m[0]) setMemberId(m[0].id)
    if (!checkMemberId && m[0]) setCheckMemberId(m.find((x) => x.status === 'active')?.id ?? m[0].id)
  }

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueId])

  async function rent(e: FormEvent) {
    e.preventDefault()
    try {
      await api.createRental({
        court_id: courtId,
        ...(venueId ? { venue_id: venueId } : {}),
        member_id: memberId || undefined,
        guest_name: guest || undefined,
        hours,
        created_by: user?.id,
      })
      setMsg('Court rental started')
      setTab('playing')
      await reload()
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Failed')
    } finally {
      setTimeout(() => setMsg(null), 2500)
    }
  }

  async function extend(sessionId: string) {
    await api.extendSession(sessionId, 1, user?.id)
    setMsg('Extended +1 hour')
    await reload()
    setTimeout(() => setMsg(null), 2000)
  }

  async function end(sessionId: string) {
    await api.endSession(sessionId)
    setMsg('Session ended')
    await reload()
    setTimeout(() => setMsg(null), 2000)
  }

  async function walkIn(e: FormEvent) {
    e.preventDefault()
    await api.createWalkIn({
      full_name: wiName,
      phone: wiPhone,
      purpose: wiPurpose,
      amount: wiAmount,
      ...(venueId ? { venue_id: venueId } : {}),
      created_by: user?.id,
    })
    setMsg('Walk-in registered')
    setWiName('')
    setTimeout(() => setMsg(null), 2500)
  }

  async function checkIn(e: FormEvent) {
    e.preventDefault()
    if (venueId) await api.checkIn(checkMemberId, user?.id, checkNote || undefined, venueId)
    else await api.checkIn(checkMemberId, user?.id, checkNote || undefined)
    setMsg('Checked in')
    setCheckNote('')
    setTimeout(() => setMsg(null), 2000)
  }

  return (
    <AppShell role="admin">
      <AppHeader title="Floor ops" subtitle="Check-in · courts · walk-in" right={<SignOutButton />} />
      <main className="safe-bottom px-4 pt-3 space-y-3">
        {venues.length > 1 ? (
          <section className="card p-3">
            <label className="label" htmlFor="admin-ops-venue">Venue</label>
            <select id="admin-ops-venue" className="input" value={venueId} onChange={(event) => setVenueId(event.target.value)}>
              {venues.map((venue) => <option key={venue.id} value={venue.id}>{venue.name}</option>)}
            </select>
          </section>
        ) : null}
        <div className="flex gap-1 overflow-x-auto pb-1">
          {(
            [
              ['playing', 'Playing'],
              ['rent', 'Rent'],
              ['extend', 'Extend'],
              ['walkin', 'Walk-in'],
              ['checkin', 'Check-in'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={`shrink-0 px-3 py-2 rounded-full text-xs font-bold border ${
                tab === k ? 'bg-brand-700 text-white border-brand-700' : 'bg-white text-slate-600 border-slate-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'playing' ? (
          <section className="card p-4">
            <h2 className="font-extrabold mb-2 flex items-center gap-2">
              <Clock3 size={18} /> Currently playing
            </h2>
            {sessions.length === 0 ? <p className="text-sm text-slate-500">No live sessions.</p> : null}
            {sessions.map((s) => {
              const fallbackPlayers = [
                s.member ? { full_name: s.member.full_name } : null,
                s.guest_name ? { full_name: s.guest_name } : null,
              ].filter((player): player is { full_name: string } => Boolean(player))
              const names = (s.players?.length ? s.players : fallbackPlayers).map((p) => p.full_name)
              const playerLabel = names.length ? names.join(', ') : 'Guest'

              return (
                <div key={s.id} className="list-row items-start">
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm">{s.court?.name}</p>
                    <p className="text-xs text-slate-500">
                      {playerLabel} · until {fmtTime(s.end_at)}
                    </p>
                    <p className="text-xs font-semibold text-brand-800 mt-1">{peso(s.amount)}</p>
                  </div>
                  <div className="flex flex-col gap-1">
                    <button type="button" className="text-xs font-bold text-brand-700 px-2 py-1" onClick={() => void extend(s.id)}>
                      +1h
                    </button>
                    <button type="button" className="text-xs font-bold text-slate-500 px-2 py-1" onClick={() => void end(s.id)}>
                      End
                    </button>
                  </div>
                </div>
              )
            })}
          </section>
        ) : null}

        {tab === 'rent' ? (
          <form className="card p-4 space-y-3" onSubmit={rent}>
            <div>
              <label className="label">Court</label>
              <select className="input" value={courtId} onChange={(e) => setCourtId(e.target.value)}>
                {courts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {c.status} · {peso(c.hourly_rate)}/h
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Member</label>
              <select className="input" value={memberId} onChange={(e) => setMemberId(e.target.value)}>
                <option value="">Guest only</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.full_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Guest name</label>
              <input className="input" value={guest} onChange={(e) => setGuest(e.target.value)} />
            </div>
            <div>
              <label className="label">Hours</label>
              <input className="input" type="number" min={1} max={6} value={hours} onChange={(e) => setHours(Number(e.target.value))} />
            </div>
            <button className="btn-primary" type="submit">
              Start rental
            </button>
          </form>
        ) : null}

        {tab === 'extend' ? (
          <section className="card p-4">
            {sessions.map((s) => (
              <button key={s.id} type="button" className="list-row w-full text-left" onClick={() => void extend(s.id)}>
                <div className="flex-1">
                  <p className="font-semibold text-sm">{s.court?.name}</p>
                  <p className="text-xs text-slate-400">Ends {fmtTime(s.end_at)}</p>
                </div>
                <span className="pill pill-brand">+1 hour</span>
              </button>
            ))}
          </section>
        ) : null}

        {tab === 'walkin' ? (
          <form className="card p-4 space-y-3" onSubmit={walkIn}>
            <div className="flex items-center gap-2 font-bold text-brand-800">
              <UserPlus size={18} /> Walk-in
            </div>
            <input className="input" required placeholder="Full name" value={wiName} onChange={(e) => setWiName(e.target.value)} />
            <input className="input" placeholder="Phone" value={wiPhone} onChange={(e) => setWiPhone(e.target.value)} />
            <input className="input" value={wiPurpose} onChange={(e) => setWiPurpose(e.target.value)} />
            <input className="input" type="number" value={wiAmount} onChange={(e) => setWiAmount(Number(e.target.value))} />
            <button className="btn-primary" type="submit">
              Register
            </button>
          </form>
        ) : null}

        {tab === 'checkin' ? (
          <form className="card p-4 space-y-3" onSubmit={checkIn}>
            <select className="input" value={checkMemberId} onChange={(e) => setCheckMemberId(e.target.value)}>
              {members
                .filter((m) => m.status === 'active')
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.full_name} ({m.member_code})
                  </option>
                ))}
            </select>
            <input className="input" placeholder="Note" value={checkNote} onChange={(e) => setCheckNote(e.target.value)} />
            <button className="btn-primary" type="submit">
              Confirm check-in
            </button>
          </form>
        ) : null}
      </main>
      {msg ? <div className="toast">{msg}</div> : null}
      </AppShell>
  )
}

export function AdminTransactions() {
  const [rows, setRows] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void api.transactions().then((t) => {
      setRows(t)
      setLoading(false)
    })
  }, [])

  return (
    <AppShell role="admin">
      <AppHeader title="Transactions" subtitle={isDemoMode ? 'All revenue' : 'Recorded charges'} right={<SignOutButton />} />
      <main className="safe-bottom px-4 pt-4">
        {loading ? (
          <LoadingBlock />
        ) : (
          <section className="card p-4">
            {rows.map((t) => (
              <div key={t.id} className="list-row">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm truncate">{t.description}</p>
                  <p className="text-xs text-slate-400">
                    {t.member?.full_name ?? 'Walk-in / club'} · {fmtDate(t.created_at)}
                  </p>
                </div>
                <p className="font-bold text-sm">{peso(t.amount)}{!isDemoMode || t.verification_status === 'unverified' ? ' recorded' : ''}</p>
              </div>
            ))}
          </section>
        )}
      </main>
      </AppShell>
  )
}

export function AdminUsers() {
  const [users, setUsers] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void api.users().then((u) => {
      setUsers(u)
      setLoading(false)
    })
  }, [])

  return (
    <AppShell role="admin">
      <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-4 pt-3 pb-2 flex items-center gap-3">
        <BackButton />
        <h1 className="text-lg font-bold">Users</h1>
      </div>
      <AppHeader title="" subtitle="Staff & accounts" />
      <main className="safe-bottom px-4 pt-4">
        {loading ? (
          <LoadingBlock />
        ) : (
          <section className="card p-4">
            {users.map((u) => (
              <div key={u.id} className="list-row">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm">{u.full_name}</p>
                  <p className="text-xs text-slate-400 truncate">{u.email}</p>
                </div>
                <span className="pill pill-brand capitalize">{u.role}</span>
              </div>
            ))}
          </section>
        )}
      </main>
      </AppShell>
  )
}
