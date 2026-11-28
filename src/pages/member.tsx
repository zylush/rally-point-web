import { useCallback, useEffect, useState } from 'react'
import {
  AppHeader,
  AppShell,
  SignOutButton,
} from '../components/Shell'
import {
  LoadingShapes,
  SkeletonCard,
  SkeletonRows,
} from '../components/Skeleton'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import { stagger } from '../lib/motion'
import { isDemoMode } from '../lib/supabase'
import type { Notification, Transaction } from '../types'
import { fmtDate, peso } from '../types'

// The member's own page (profile, clubs, memberships) is MemberAccount; these are its sub-pages.

/** The transactions list: one card of rows. */
function TransactionsLoading() {
  return (
    <LoadingShapes label="Loading your transactions…">
      <div aria-hidden>
        <SkeletonCard>
          <SkeletonRows count={4} />
        </SkeletonCard>
      </div>
    </LoadingShapes>
  )
}

export function MemberTransactions() {
  const { user } = useAuth()
  const [rows, setRows] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    void api.transactions(user.id, 'member').then((t) => {
      setRows(t)
      setLoading(false)
    })
  }, [user])

  return (
    <AppShell role="member">
      <AppHeader
        title="Transactions"
        subtitle={isDemoMode ? 'Your payments' : 'Recorded charges'}
        right={<SignOutButton />}
      />
      <main className="safe-bottom px-4 pt-4">
        {loading ? (
          <TransactionsLoading />
        ) : (
          <section className="enter-rise card p-4">
            {rows.map((t) => (
              <div key={t.id} className="list-row">
                <div className="flex-1 min-w-0">
                  <p className="text-body font-semibold">{t.description}</p>
                  <p className="text-xs text-slate-400 capitalize">
                    {t.type.replace('_', ' ')} · {fmtDate(t.created_at)}
                  </p>
                </div>
                <p className="text-body font-bold">{peso(t.amount)}{!isDemoMode || t.verification_status === 'unverified' ? ' recorded' : ''}</p>
              </div>
            ))}
          </section>
        )}
      </main>
    </AppShell>
  )
}

export function MemberNotifications() {
  const { user } = useAuth()
  const userId = user?.id
  const [rows, setRows] = useState<Notification[]>([])

  const load = useCallback(async () => {
    if (!userId) return
    setRows(await api.notifications(userId))
  }, [userId])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <AppShell role="member">
      <AppHeader title="Notifications" right={<SignOutButton />} />
      <main className="safe-bottom px-4 pt-4 space-y-2">
        {rows.map((n, index) => (
          <button
            key={n.id}
            type="button"
            className={`enter-rise control-feedback card p-4 w-full text-left ${n.read ? 'opacity-70' : 'ring-1 ring-brand-200'}`}
            style={stagger(index)}
            onClick={() => void api.markNotifRead(n.id).then(load)}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-body font-bold">{n.title}</p>
              {!n.read ? <span className="pill pill-brand">New</span> : null}
            </div>
            <p className="text-body font-normal text-slate-600 mt-1">
              {n.body}
            </p>
            <p className="text-xs text-slate-400 mt-2">
              {fmtDate(n.created_at)}
            </p>
          </button>
        ))}
      </main>
    </AppShell>
  )
}
