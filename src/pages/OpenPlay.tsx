import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Users } from 'lucide-react'
import { AppHeader, AppShell, LoadingBlock, SignOutButton } from '../components/Shell'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import type { Court, Member, OpenPlaySession, Role, SkillLevel } from '../types'
import { fmtDateTime, peso, ymdLocal } from '../types'

export function MemberOpenPlay() {
  const { user } = useAuth()
  const userId = user?.id
  const [list, setList] = useState<OpenPlaySession[]>([])
  const [member, setMember] = useState<Member | null>(null)
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!userId) return
    setLoading(true)
    const [ops, m] = await Promise.all([api.listOpenPlays(), api.memberForUser(userId)])
    setList(ops)
    setMember(m)
    setLoading(false)
  }, [userId])

  useEffect(() => {
    void reload()
  }, [reload])

  async function join(id: string) {
    if (!user || !member) {
      setMsg('No membership linked')
      return
    }
    setBusyId(id)
    try {
      const r = await api.joinOpenPlay(id, member.id, user.id)
      setMsg(r.signup.status === 'joined' ? 'Joined open play!' : 'Added to waitlist')
      await reload()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusyId(null)
      setTimeout(() => setMsg(null), 2500)
    }
  }

  async function leave(id: string) {
    if (!member) return
    setBusyId(id)
    try {
      await api.leaveOpenPlay(id, member.id)
      setMsg('Left session')
      await reload()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusyId(null)
      setTimeout(() => setMsg(null), 2000)
    }
  }

  return (
    <AppShell role="member">
      <AppHeader title="Open play" subtitle="Join a drop-in game — no private court needed" right={<SignOutButton />} />
      <main className="safe-bottom px-4 pt-4 space-y-3">
        {loading ? (
          <LoadingBlock />
        ) : list.length === 0 ? (
          <section className="card p-4 text-sm text-slate-500">No open play sessions right now.</section>
        ) : (
          list.map((op) => {
            const mine = op.signups?.find((s) => s.member_id === member?.id && s.status !== 'cancelled')
            const seats = op.seats_taken ?? 0
            return (
              <section key={op.id} className="card p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-extrabold text-lg">{op.title}</p>
                    <p className="text-sm text-slate-500">{fmtDateTime(op.start_at)}</p>
                    <p className="text-xs text-slate-400 mt-1 capitalize">
                      {op.court?.name ?? 'Open floor'} · {op.skill_level} · {seats}/{op.capacity}
                    </p>
                  </div>
                  <span className="pill bg-brand-50 text-brand-800 capitalize">{op.status}</span>
                </div>
                <p className="text-sm font-bold text-brand-800">{op.fee > 0 ? peso(op.fee) : 'Free'}</p>
                {op.notes ? <p className="text-xs text-slate-500">{op.notes}</p> : null}
                {mine ? (
                  <div className="flex gap-2">
                    <span className="btn-secondary flex-1 text-sm pointer-events-none capitalize">
                      {mine.status}
                    </span>
                    <button
                      type="button"
                      className="btn-secondary text-sm"
                      disabled={busyId === op.id}
                      aria-busy={busyId === op.id}
                      onClick={() => void leave(op.id)}
                    >
                      Leave
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="btn-primary w-full"
                    disabled={!member || busyId === op.id || op.status === 'cancelled'}
                    aria-busy={busyId === op.id}
                    onClick={() => void join(op.id)}
                  >
                    {busyId === op.id ? 'Please wait…' : seats >= op.capacity ? 'Join waitlist' : 'Join this game'}
                  </button>
                )}
              </section>
            )
          })
        )}
      </main>
      {msg ? <div className="toast">{msg}</div> : null}
    </AppShell>
  )
}

export function OpenPlayManage({ role }: { role: 'staff' | 'admin' }) {
  const { user } = useAuth()
  const [list, setList] = useState<OpenPlaySession[]>([])
  const [courts, setCourts] = useState<Court[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [title, setTitle] = useState('Evening Open Play')
  const [courtId, setCourtId] = useState('')
  const [date, setDate] = useState(ymdLocal(new Date()))
  const [startH, setStartH] = useState(18)
  const [hours, setHours] = useState(2)
  const [capacity, setCapacity] = useState(8)
  const [fee, setFee] = useState(250)
  const [skill, setSkill] = useState<SkillLevel>('all')
  const [msg, setMsg] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    const [ops, c] = await Promise.all([api.listOpenPlays(true), api.listCourts()])
    setList(ops)
    setCourts(c)
    if (c[0]) setCourtId((current) => current || c[0].id)
    setLoading(false)
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  async function create(e: FormEvent) {
    e.preventDefault()
    const [y, m, d] = date.split('-').map(Number)
    const start = new Date(y, m - 1, d, startH, 0, 0, 0)
    const end = new Date(start.getTime() + hours * 3600000)
    try {
      await api.createOpenPlay({
        title,
        court_id: courtId || undefined,
        start_at: start.toISOString(),
        end_at: end.toISOString(),
        capacity,
        fee,
        skill_level: skill,
        created_by: user?.id,
      })
      setMsg('Open play created')
      setShowForm(false)
      await reload()
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Failed')
    }
    setTimeout(() => setMsg(null), 2500)
  }

  return (
    <AppShell role={role as Role}>
      <AppHeader
        title="Open play"
        subtitle="Create & manage drop-ins"
        right={
          <button type="button" className="btn-primary text-xs px-3" onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Close' : 'New'}
          </button>
        }
      />
      <main className="safe-bottom px-4 pt-4 space-y-3">
        {showForm ? (
          <form className="card p-4 space-y-3" onSubmit={create}>
            <div>
              <label className="label">Title</label>
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} required />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label">Date</label>
                <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div>
                <label className="label">Start hour</label>
                <input
                  className="input"
                  type="number"
                  min={6}
                  max={21}
                  value={startH}
                  onChange={(e) => setStartH(Number(e.target.value))}
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="label">Hours</label>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={4}
                  value={hours}
                  onChange={(e) => setHours(Number(e.target.value))}
                />
              </div>
              <div>
                <label className="label">Capacity</label>
                <input
                  className="input"
                  type="number"
                  min={2}
                  max={40}
                  value={capacity}
                  onChange={(e) => setCapacity(Number(e.target.value))}
                />
              </div>
              <div>
                <label className="label">Fee</label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  value={fee}
                  onChange={(e) => setFee(Number(e.target.value))}
                />
              </div>
            </div>
            <div>
              <label className="label">Court</label>
              <select className="input" value={courtId} onChange={(e) => setCourtId(e.target.value)}>
                {courts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Skill</label>
              <select className="input" value={skill} onChange={(e) => setSkill(e.target.value as SkillLevel)}>
                <option value="all">All levels</option>
                <option value="beginner">Beginner</option>
                <option value="intermediate">Intermediate</option>
                <option value="advanced">Advanced</option>
              </select>
            </div>
            <button className="btn-primary w-full" type="submit">
              Publish session
            </button>
          </form>
        ) : null}

        {loading ? (
          <LoadingBlock />
        ) : (
          list.map((op) => (
            <section key={op.id} className="card p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="font-extrabold">{op.title}</p>
                <span className="text-xs font-bold capitalize text-slate-500">{op.status}</span>
              </div>
              <p className="text-sm text-slate-500 mt-1">{fmtDateTime(op.start_at)}</p>
              <p className="text-xs text-slate-400 mt-1 flex items-center gap-1">
                <Users size={12} /> {op.seats_taken ?? 0}/{op.capacity} · {op.court?.name ?? '—'} ·{' '}
                {op.fee > 0 ? peso(op.fee) : 'Free'}
              </p>
              {(op.signups ?? []).filter((s) => s.status !== 'cancelled').length > 0 ? (
                <div className="mt-2 border-t border-slate-100 pt-2 space-y-1">
                  {(op.signups ?? [])
                    .filter((s) => s.status !== 'cancelled')
                    .map((s) => (
                      <p key={s.id} className="text-xs text-slate-600">
                        {s.member?.full_name ?? s.member_id}{' '}
                        <span className="text-slate-400 capitalize">· {s.status}</span>
                      </p>
                    ))}
                </div>
              ) : null}
            </section>
          ))
        )}
      </main>
      {msg ? <div className="toast">{msg}</div> : null}
    </AppShell>
  )
}

export function StaffOpenPlay() {
  return <OpenPlayManage role="staff" />
}

export function AdminOpenPlay() {
  return <OpenPlayManage role="admin" />
}
