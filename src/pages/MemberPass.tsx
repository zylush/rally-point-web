import { useEffect, useMemo, useState } from 'react'
import { AppHeader, AppShell, SignOutButton } from '../components/Shell'
import { LoadingShapes, SkeletonBlock, SkeletonLine } from '../components/Skeleton'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import type { Member } from '../types'
import { qrPayload } from '../types'

import { QRCodeSVG } from 'qrcode.react'

/** The pass card's shape: name, member ID and the QR code square. */
function PassLoading() {
  return (
    <LoadingShapes label="Loading your QR code…">
      <div className="card p-6 flex flex-col items-center space-y-3" aria-hidden>
        <SkeletonLine className="w-36" />
        <SkeletonLine size="heading" className="w-3/5" />
        <SkeletonLine size="subtitle" className="w-28" />
        <SkeletonBlock className="h-[226px] w-[226px] rounded-2xl!" />
        <SkeletonLine size="caption" className="w-4/5" />
        <SkeletonLine size="subtitle" className="w-full max-w-xs" />
      </div>
    </LoadingShapes>
  )
}

export function MemberPass() {
  const { user } = useAuth()
  const [member, setMember] = useState<Member | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    void (async () => {
      setLoading(true)
      try {
        const m = await api.memberForUser(user.id)
        if (!m) {
          setMember(null)
          return
        }
        const withQr = await api.ensureMemberQr(m.id)
        setMember(withQr)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed')
      } finally {
        setLoading(false)
      }
    })()
  }, [user])

  const payload = useMemo(() => {
    if (!member?.qr_token) return ''
    return qrPayload(member.member_code, member.qr_token)
  }, [member])

  return (
    <AppShell role="member">
      <AppHeader title="My QR code" subtitle="Show this screen at the front desk" right={<SignOutButton />} />
      <main className="safe-bottom px-4 pt-4 space-y-4">
        {loading ? (
          <PassLoading />
        ) : !member ? (
          <section className="enter-rise card p-4 text-sm text-slate-500">
            No membership linked. Ask staff to connect your account.
          </section>
        ) : (
          <section className="enter-rise card p-6 flex flex-col items-center text-center space-y-3">
            <p className="text-sm font-bold text-slate-500">Your check-in code</p>
            <p className="font-extrabold text-2xl">{member.full_name}</p>
            <p className="font-mono text-base text-brand-800 font-bold">{member.member_code}</p>
            {payload ? (
              <div className="rounded-2xl border border-slate-100 bg-white p-3 inline-flex items-center justify-center shadow-xs">
                <QRCodeSVG
                  role="img"
                  value={payload}
                  size={200}
                  level="M"
                  aria-label="Check-in QR code"
                />
              </div>
            ) : null}
            <p className="text-[11px] text-slate-400 font-mono break-all max-w-xs">{payload}</p>
            <p className="text-base text-slate-600">Staff can scan this code, or type your ID number.</p>
          </section>
        )}
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </main>
    </AppShell>
  )
}
