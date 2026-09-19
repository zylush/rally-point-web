import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Clock3, Search, UserPlus } from 'lucide-react'
import { AppHeader, AppShell, LoadingBlock, SignOutButton } from '../components/Shell'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import type { CheckIn, Court, CourtSession, Member } from '../types'
import { fmtDateTime, fmtTime, peso } from '../types'

export function StaffHome() {
  const [sessions, setSessions] = useState<CourtSession[]>([])
  const [checkins, setCheckins] = useState<CheckIn[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void (async () => {
      const [s, c] = await Promise.all([api.playingSessions(), api.recentCheckins()])
      setSessions(s)
      setCheckins(c.slice(0, 5))
      setLoading(false)
    })()
  }, [])

  const playerNames = (session: CourtSession) => {
    const fallbackPlayers = [
      session.member ? { full_name: session.member.full_name } : null,
      session.guest_name ? { full_name: session.guest_name } : null,
    ].filter((player): player is { full_name: string } => Boolean(player))

    const names = (session.players?.length ? session.players : fallbackPlayers).map((p) => p.full_name)
    return names.length ? names.join(', ') : 'Guest'
  }

  return (
    <AppShell role="staff">
      <AppHeader title="Staff desk" subtitle="Live floor" right={<SignOutButton />} />
      <main className="safe-bottom px-4 pt-4 space-y-4">
        {loading ? (
          <LoadingBlock />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="stat-card">
                <p className="text-teal-100 text-xs font-bold uppercase">Playing now</p>
                <p className="text-3xl font-extrabold mt-1">{sessions.filter((s) => s.status === 'playing').length}</p>
              </div>
              <div className="card p-4">
                <p className="text-xs font-bold uppercase text-slate-400">Check-ins</p>
                <p className="text-3xl font-extrabold mt-1 text-slate-900">{checkins.length}</p>
                <p className="text-xs text-slate-500">recent</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Link to="/staff/checkin" className="btn-primary">
                Check in
              </Link>
              <Link to="/staff/courts" className="btn-secondary">
                Court ops
              </Link>
            </div>

            <section className="card p-4">
              <h2 className="font-extrabold mb-1">Currently playing</h2>
              {sessions.length === 0 ? (
                <p className="text-sm text-slate-500 py-3">No active sessions.</p>
              ) : (
                sessions.map((s) => (
                  <div key={s.id} className="list-row">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm">{s.court?.name ?? 'Court'}</p>
                      <p className="text-xs text-slate-500 truncate">
                        {playerNames(s)} · ends {fmtTime(s.end_at)}
                      </p>
                    </div>
                    <span className="pill pill-ok">Live</span>
                  </div>
                ))
              )}
            </section>

            <section className="card p-4">
              <h2 className="font-extrabold mb-1">Latest check-ins</h2>
              {checkins.map((c) => (
                <div key={c.id} className="list-row">
                  <div className="flex-1">
                    <p className="font-semibold text-sm">{c.member?.full_name ?? 'Member'}</p>
                    <p className="text-xs text-slate-400">{fmtDateTime(c.checked_in_at)}</p>
                  </div>
                  <span className="text-xs font-bold text-slate-400">{c.member?.member_code}</span>
                </div>
              ))}
            </section>
          </>
        )}
      </main>
      </AppShell>
  )
}

export function StaffMembers() {
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
        (m.phone ?? '').includes(s) ||
        (m.email ?? '').toLowerCase().includes(s),
    )
  }, [members, q])

  return (
    <AppShell role="staff">
      <AppHeader title="Members" subtitle={`${members.length} total`} right={<SignOutButton />} />
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
                    placeholder="Search name, code, phone…"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    aria-label="Search members"
                  />
                </div>
        {loading ? (
          <LoadingBlock />
        ) : (
          <section className="card p-2">
            {filtered.slice(0, 50).map((m) => (
              <div key={m.id} className="list-row px-2">
                <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center font-bold text-slate-600">
                  {m.full_name
                    .split(' ')
                    .map((p) => p[0])
                    .slice(0, 2)
                    .join('')}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm truncate">{m.full_name}</p>
                  <p className="text-xs text-slate-400">
                    {m.member_code} · <span className="capitalize">{m.membership_type}</span>
                  </p>
                </div>
                <span className={`pill ${m.status === 'active' ? 'pill-ok' : 'pill-warn'}`}>{m.status}</span>
              </div>
            ))}
          </section>
        )}
      </main>
      </AppShell>
  )
}

export function StaffCheckIn() {
  const { user } = useAuth()
  const [members, setMembers] = useState<Member[]>([])
  const [memberId, setMemberId] = useState('')
  const [note, setNote] = useState('')
  const [qr, setQr] = useState('')
  const [tab, setTab] = useState<'list' | 'qr'>('qr')
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [last, setLast] = useState<string | null>(null)

  useEffect(() => {
    void api.listMembers().then((m) => {
      setMembers(m.filter((x) => x.status === 'active'))
      if (m[0]) setMemberId(m[0].id)
    })
  }, [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await api.checkIn(memberId, user?.id, note || undefined)
      const name = members.find((m) => m.id === memberId)?.full_name
      setMsg('Checked in successfully')
      setLast(name ?? 'Member')
      setNote('')
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Failed')
    } finally {
      setBusy(false)
      setTimeout(() => setMsg(null), 2500)
    }
  }

  async function submitQr(e: FormEvent) {
    e.preventDefault()
    if (!qr.trim()) return
    setBusy(true)
    try {
      const r = await api.checkInByQr(qr.trim(), user?.id)
      setMsg(`Checked in ${r.member.full_name}`)
      setLast(r.member.full_name)
      setQr('')
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Failed')
    } finally {
      setBusy(false)
      setTimeout(() => setMsg(null), 2500)
    }
  }

  return (
    <AppShell role="staff">
      <AppHeader title="Check in" subtitle="QR or member list" right={<SignOutButton />} />
      <main className="safe-bottom px-4 pt-4 space-y-3">
        <div className="flex gap-2">
          <button
            type="button"
            className={`flex-1 min-h-12 rounded-xl font-bold border ${tab === 'qr' ? 'bg-brand-700 text-white border-brand-700' : 'bg-white border-slate-200'}`}
            onClick={() => setTab('qr')}
          >
            QR / code
          </button>
          <button
            type="button"
            className={`flex-1 min-h-12 rounded-xl font-bold border ${tab === 'list' ? 'bg-brand-700 text-white border-brand-700' : 'bg-white border-slate-200'}`}
            onClick={() => setTab('list')}
          >
            Member list
          </button>
        </div>

        {tab === 'qr' ? (
          <form className="card p-4 space-y-3" onSubmit={submitQr}>
            <div>
              <label className="label">Scan or paste QR payload / member code</label>
              <input
                className="input font-mono text-sm"
                value={qr}
                onChange={(e) => setQr(e.target.value)}
                placeholder="RP1|RP-1001|… or RP-1001"
                autoFocus
              />
            </div>
            <p className="text-xs text-slate-500">
              Point a hardware scanner here, or type the member code from their pass.
            </p>
            <button
              className="btn-primary"
              disabled={busy || !qr.trim()}
              aria-busy={busy}
            >
              {busy ? 'Checking…' : 'Check in via QR'}
            </button>
          </form>
        ) : (
          <form className="card p-4 space-y-3" onSubmit={submit}>
            <div>
              <label className="label">Member</label>
              <select className="input" value={memberId} onChange={(e) => setMemberId(e.target.value)}>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.full_name} ({m.member_code})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Note (optional)</label>
              <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Guest +1, etc." />
            </div>
            <button
              className="btn-primary"
              disabled={busy || !memberId}
              aria-busy={busy}
            >
              {busy ? 'Saving…' : 'Confirm check-in'}
            </button>
          </form>
        )}

        {last ? (
          <section className="card p-4 border-brand-200 bg-brand-50">
            <p className="text-xs font-bold uppercase text-brand-800">Last check-in</p>
            <p className="font-extrabold text-lg text-brand-950">{last}</p>
          </section>
        ) : null}
      </main>
      {msg ? <div className="toast">{msg}</div> : null}
    </AppShell>
  )
}

export function StaffCourts() {
  const { user } = useAuth()
  const [courts, setCourts] = useState<Court[]>([])
  const [sessions, setSessions] = useState<CourtSession[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [courtId, setCourtId] = useState('')
  const [memberId, setMemberId] = useState('')
  const [guest, setGuest] = useState('')
  const [hours, setHours] = useState(1)
  const [msg, setMsg] = useState<string | null>(null)
  const [tab, setTab] = useState<'rent' | 'playing' | 'extend' | 'walkin'>('playing')
  const [addSessionId, setAddSessionId] = useState<string | null>(null)
  const [addMemberId, setAddMemberId] = useState('')

  const sessionPlayers = (session: CourtSession) => {
    const fallbackPlayers = [
      session.member ? { full_name: session.member.full_name } : null,
      session.guest_name ? { full_name: session.guest_name } : null,
    ].filter(Boolean) as Array<{ full_name: string }>
    return (session.players?.length ? session.players : fallbackPlayers).map((player) => player.full_name)
  }

  const reload = useCallback(async () => {
    const [c, s, m] = await Promise.all([api.listCourts(), api.playingSessions(), api.listMembers()])
    setCourts(c)
    setSessions(s)
    setMembers(m)
    if (c[0]) setCourtId((current) => current || c.find((x) => x.status === 'available')?.id || c[0].id)
    if (m[0]) setMemberId((current) => current || m[0].id)
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  async function rent(e: FormEvent) {
    e.preventDefault()
    try {
      await api.createRental({
        court_id: courtId,
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
    try {
      await api.extendSession(sessionId, 1, user?.id)
      setMsg('Extended +1 hour')
      await reload()
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Failed')
    } finally {
      setTimeout(() => setMsg(null), 2500)
    }
  }

  async function saveAddedMember(e: FormEvent) {
    e.preventDefault()
    if (!addSessionId || !addMemberId) return
    try {
      await api.addMemberToSession(addSessionId, addMemberId, user?.id)
      setMsg('Member added to court')
      setAddSessionId(null)
      setAddMemberId('')
      await reload()
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Failed')
    } finally {
      setTimeout(() => setMsg(null), 2500)
    }
  }

  async function end(sessionId: string) {
    await api.endSession(sessionId)
    setMsg('Session ended')
    await reload()
    setTimeout(() => setMsg(null), 2000)
  }

  const [wiName, setWiName] = useState('')
  const [wiPhone, setWiPhone] = useState('')
  const [wiPurpose, setWiPurpose] = useState('Day pass')
  const [wiAmount, setWiAmount] = useState(350)

  async function walkIn(e: FormEvent) {
    e.preventDefault()
    await api.createWalkIn({
      full_name: wiName,
      phone: wiPhone,
      purpose: wiPurpose,
      amount: wiAmount,
      created_by: user?.id,
    })
    setMsg('Walk-in registered')
    setWiName('')
    setWiPhone('')
    setTimeout(() => setMsg(null), 2500)
  }

  return (
    <AppShell role="staff">
      <AppHeader title="Court ops" subtitle="Rent · play · extend" right={<SignOutButton />} />
      <main className="safe-bottom px-4 pt-3 space-y-3">
        <div className="flex gap-1 overflow-x-auto no-scrollbar pb-1">
          {(
            [
              ['playing', 'Playing'],
              ['rent', 'Rent'],
              ['extend', 'Extend'],
              ['walkin', 'Walk-in'],
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
              <Clock3 size={18} /> Live court sessions
            </h2>
            {sessions.length === 0 ? (
              <p className="text-sm text-slate-500">No live sessions.</p>
            ) : (
              sessions.map((s) => (
                <div key={s.id} className="list-row items-start">
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm">{s.court?.name}</p>
                    <p className="text-xs text-slate-500">
                      {sessionPlayers(s).join(', ') || 'Guest'} · until {fmtTime(s.end_at)}
                    </p>
                    <p className="text-xs font-semibold text-brand-800 mt-1">{peso(s.amount)}</p>
                  </div>
                  <div className="flex flex-col gap-1">
                    {addSessionId === s.id ? (
                      <form className="mt-2 space-y-2" onSubmit={saveAddedMember}>
                        <div>
                          <label className="label" htmlFor={`add-member-${s.id}`}>Member</label>
                          <select
                            id={`add-member-${s.id}`}
                            className="input"
                            value={addMemberId}
                            onChange={(e) => setAddMemberId(e.target.value)}
                            aria-label="Member"
                          >
                            <option value="">Select a member</option>
                            {members.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.full_name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="flex gap-2">
                          <button type="submit" className="btn-primary flex-1">
                            Save member
                          </button>
                          <button type="button" className="btn-secondary flex-1" onClick={() => {
                            setAddSessionId(null)
                            setAddMemberId('')
                          }}>
                            Cancel
                          </button>
                        </div>
                      </form>
                    ) : (
                      <button
                        type="button"
                        className="text-xs font-bold text-brand-700 px-2 py-1"
                        onClick={() => {
                          setAddSessionId(s.id)
                          setAddMemberId(members[0]?.id ?? '')
                        }}
                      >
                        Add member
                      </button>
                    )}
                    <button type="button" className="text-xs font-bold text-brand-700 px-2 py-1" onClick={() => void extend(s.id)}>
                      +1h
                    </button>
                    <button type="button" className="text-xs font-bold text-slate-500 px-2 py-1" onClick={() => void end(s.id)}>
                      End
                    </button>
                  </div>
                </div>
              ))
            )}
          </section>
        ) : null}

        {tab === 'rent' ? (
          <form className="card p-4 space-y-3" onSubmit={rent}>
            <div>
              <label className="label">Court</label>
              <select className="input" value={courtId} onChange={(e) => setCourtId(e.target.value)}>
                {courts.map((c) => (
                  <option key={c.id} value={c.id} disabled={c.status === 'maintenance'}>
                    {c.name} · {c.status} · {peso(c.hourly_rate)}/h
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Member (optional)</label>
              <select className="input" value={memberId} onChange={(e) => setMemberId(e.target.value)}>
                <option value="">Walk-in / guest only</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.full_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Guest name</label>
              <input className="input" value={guest} onChange={(e) => setGuest(e.target.value)} placeholder="If no member" />
            </div>
            <div>
              <label className="label">Hours</label>
              <input
                className="input"
                type="number"
                min={1}
                max={6}
                value={hours}
                onChange={(e) => setHours(Number(e.target.value))}
              />
            </div>
            <button className="btn-primary" type="submit">
              Start rental
            </button>
          </form>
        ) : null}

        {tab === 'extend' ? (
          <section className="card p-4 space-y-2">
            <p className="text-sm text-slate-500">Tap +1h on a live session to extend and bill.</p>
            {sessions.map((s) => (
              <button
                key={s.id}
                type="button"
                className="list-row w-full text-left"
                onClick={() => void extend(s.id)}
              >
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
            <div className="flex items-center gap-2 text-brand-800 font-bold">
              <UserPlus size={18} /> Walk-in registration
            </div>
            <div>
              <label className="label">Full name</label>
              <input className="input" required value={wiName} onChange={(e) => setWiName(e.target.value)} />
            </div>
            <div>
              <label className="label">Phone</label>
              <input className="input" value={wiPhone} onChange={(e) => setWiPhone(e.target.value)} />
            </div>
            <div>
              <label className="label">Purpose</label>
              <input className="input" value={wiPurpose} onChange={(e) => setWiPurpose(e.target.value)} />
            </div>
            <div>
              <label className="label">Amount (PHP)</label>
              <input
                className="input"
                type="number"
                min={0}
                value={wiAmount}
                onChange={(e) => setWiAmount(Number(e.target.value))}
              />
            </div>
            <button className="btn-primary" type="submit">
              Register walk-in
            </button>
          </form>
        ) : null}

        <section className="card p-4">
          <h2 className="font-extrabold mb-2">Courts</h2>
          <div className="grid grid-cols-2 gap-2">
            {courts.map((c) => (
              <div key={c.id} className="rounded-xl border border-slate-100 p-3">
                <p className="font-bold text-sm">{c.name}</p>
                <p className="text-xs text-slate-400 capitalize mt-1">{c.status}</p>
                <p className="text-xs font-semibold text-brand-800 mt-1">{peso(c.hourly_rate)}/h</p>
              </div>
            ))}
          </div>
        </section>
      </main>
      {msg ? <div className="toast">{msg}</div> : null}
      </AppShell>
  )
}
