import { NavLink, useNavigate } from 'react-router-dom'
import {
  BarChart3,
  Building2,
  CalendarDays,
  Coins,
  Home,
  HelpCircle,
  LayoutDashboard,
  LogOut,
  PhoneCall,
  QrCode,
  Tv,
  Users,
} from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { ClubRole, Role } from '../types'
import { useAuth } from '../context/AuthContext'
import { homeFor } from '../lib/roleHome'
import { useDocumentTitle } from '../lib/useDocumentTitle'
import { useModalDialog } from '../lib/useModalDialog'
import { BrinelyLogo } from './BrinelyLogo'
import { LoadingShapes, SkeletonBlock, SkeletonCard, SkeletonRows } from './Skeleton'
import { SiteFooter } from './SiteFooter'
import { SiteHeader } from './SiteHeader'

// Players and members have no app menu: they use the public site and its account menu.

const staffTabs = [
  { to: '/staff', end: true, label: 'Home', icon: LayoutDashboard },
  { to: '/staff/checkin', label: 'Check in', icon: QrCode },
  { to: '/staff/board', label: 'Schedule', icon: Tv },
  { to: '/staff/open', label: 'Open play', icon: Users },
  { to: '/staff/courts', label: 'Courts', icon: Home },
  { to: '/staff/help', label: 'Help', icon: HelpCircle },
]

type NavTab = { to: string; end?: boolean; label: string; icon: typeof Home; sideOnly?: boolean }

// Phones keep six tabs; Analytics is in the desktop menu and opens from Home on a phone.
const adminTabs: NavTab[] = [
  { to: '/admin', end: true, label: 'Home', icon: LayoutDashboard },
  { to: '/admin/analytics', label: 'Analytics', icon: BarChart3, sideOnly: true },
  { to: '/admin/ops', label: 'Floor', icon: Home },
  { to: '/admin/board', label: 'Schedule', icon: Tv },
  { to: '/admin/open', label: 'Open play', icon: Users },
  { to: '/admin/bookings', label: 'Bookings', icon: CalendarDays },
  { to: '/admin/help', label: 'Help', icon: HelpCircle },
]

/**
 * The bRineLy platform emblem shows when viewing platform screens (no active club).
 * Clubs without their own uploaded logo show a clean initials badge.
 */
function ClubMark({ size }: { size: 'small' | 'large' }) {
  const { activeClub } = useAuth()
  const box = size === 'large' ? 'w-11 h-11' : 'w-8 h-8'
  if (!activeClub) return <BrinelyLogo variant="mark" className={`${box} object-contain`} />
  return <ClubBadge name={activeClub.name} size={size} />
}

/**
 * A club's initials badge, for any club by name (the sign-in dialog shows the club being
 * booked, which need not be the active one). Decorative: the club's name is always shown beside it.
 */
export function ClubBadge({ name, size = 'small' }: { name: string; size?: 'small' | 'large' }) {
  const box = size === 'large' ? 'w-11 h-11' : 'w-8 h-8'
  const words = name.split(/\s+/).filter(Boolean)
  const initials = `${words[0]?.[0] ?? ''}${words.length > 1 ? words[words.length - 1][0] : ''}`.toUpperCase()
  return (
    <span
      aria-hidden
      className={`${box} grid shrink-0 place-items-center rounded-xl bg-brand-700 font-bold text-white ${size === 'large' ? 'text-base' : 'text-caption'}`}
    >
      {initials}
    </span>
  )
}

// The platform portal only: superadmins have no club screens.
const superadminTabs: NavTab[] = [
  { to: '/superadmin', end: true, label: 'Overview', icon: LayoutDashboard },
  { to: '/superadmin/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/superadmin/clubs', label: 'Clubs', icon: Building2 },
  { to: '/superadmin/ledger', label: 'Ledger', icon: Coins },
  { to: '/superadmin/requests', label: 'Requests', icon: PhoneCall },
  { to: '/superadmin/help', label: 'Help', icon: HelpCircle },
]

// "Player" covers everyone who books at a club, with or without a membership.
const clubRoleLabel: Record<ClubRole, string> = { member: 'Player', staff: 'Staff', admin: 'Admin' }

/**
 * Lets someone who belongs to several clubs move between them. Hidden for
 * everyone else. Switching takes them to their home screen in that club.
 */
export function ClubSwitcher({ tone = 'light', className = '' }: { tone?: 'light' | 'dark'; className?: string }) {
  const auth = useAuth()
  const navigate = useNavigate()
  const clubs = auth.clubs ?? []
  const activeClub = auth.activeClub ?? null
  if (clubs.length < 2 || !activeClub) return null
  const selectClass =
    tone === 'dark'
      ? 'select-on-dark w-full min-h-12 rounded-xl border border-white/25 bg-white/10 px-3 text-body font-semibold text-white'
      : 'input min-h-12 w-full'
  return (
    <label className={`block ${className}`}>
      <span className={tone === 'dark' ? 'text-caption text-brand-100' : 'text-caption font-semibold text-slate-600'}>
        Club
      </span>
      <select
        className={selectClass}
        value={activeClub.club_id}
        onChange={(event) => {
          const next = clubs.find((club) => club.club_id === event.target.value)
          if (!next) return
          const stayHere = auth.user?.role === 'member' && next.role === 'member'
          auth.switchClub(next.club_id)
          // A player stays on the page they are on; staff and admins go to their desk in that club.
          if (!stayHere) navigate(homeFor(next.role), { replace: true })
        }}
      >
        {clubs.map((club) => (
          <option key={club.club_id} value={club.club_id} className="text-slate-900">
            {club.name} · {clubRoleLabel[club.role]}
          </option>
        ))}
      </select>
    </label>
  )
}

function tabsFor(role: Role): NavTab[] {
  if (role === 'superadmin') return superadminTabs
  if (role === 'admin') return adminTabs
  if (role === 'staff') return staffTabs
  return []
}

export function SideNav({ role }: { role: Role }) {
  const { user, activeClub } = useAuth()
  const tabs = tabsFor(role)
  const placeName = activeClub?.name ?? (role === 'superadmin' ? 'bRineLy platform' : 'bRineLy')
  // The 'member' account role is the player role; "member" alone means someone with a membership.
  const roleLabel =
    role === 'superadmin' ? 'Superadmin' : role === 'admin' ? 'Admin' : role === 'staff' ? 'Staff' : 'Player'

  return (
    <aside className="side-nav">
      <div className="px-2 mb-6">
        <div className="flex items-center gap-2.5 mb-1">
          <ClubMark size="large" />
          <div>
            <p className="text-caption font-normal text-brand-100">
              {placeName}
            </p>
            <p className="text-subtitle font-medium">{roleLabel}</p>
          </div>
        </div>
        {user ? (
          <p
            className="text-body font-normal text-slate-300 mt-2 truncate px-0.5"
            title={user.email}
          >
            {user.full_name}
          </p>
        ) : null}
        <ClubSwitcher tone="dark" className="mt-3" />
      </div>

      <nav className="flex flex-col gap-1.5 flex-1" aria-label="Main menu">
        {tabs.map(({ to, end, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `side-nav-link${isActive ? ' active' : ''}`
            }
          >
            <Icon size={22} strokeWidth={2.25} aria-hidden />
            {label}
          </NavLink>
        ))}
      </nav>

      <SignOutAction
        className="side-nav-link control-feedback mt-4 w-full border-0 bg-transparent cursor-pointer text-left"
      >
        <LogOut size={22} aria-hidden />
        Log out
      </SignOutAction>

      {/* The platform's own mark, kept apart from the club's badge at the top. */}
      <p className="mt-4 flex items-center gap-2 border-t border-white/10 px-2 pt-4 text-caption font-semibold text-brand-100">
        <BrinelyLogo variant="mark" title="" className="h-6 w-6 shrink-0 object-contain" />
        bRineLy
      </p>
    </aside>
  )
}

export function BottomNav({ role }: { role: Role }) {
  const tabs = tabsFor(role).filter((tab) => !tab.sideOnly)
  const cols =
    tabs.length >= 6
      ? 'grid-cols-6'
      : tabs.length === 5
        ? 'grid-cols-5'
        : tabs.length === 4
          ? 'grid-cols-4'
          : 'grid-cols-3'
  return (
    <nav className="bottom-nav" aria-label="Main menu">
      <div className={`grid ${cols} px-1 pt-1.5 pb-1.5`}>
        {tabs.map(({ to, end, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `control-feedback flex flex-col items-center justify-center gap-1 py-2 min-h-[56px] rounded-xl text-caption font-normal ${
                isActive ? 'text-brand-800 bg-brand-50' : 'text-slate-500'
              }`
            }
          >
            <Icon size={24} strokeWidth={2.25} aria-hidden />
            <span className="px-0.5 text-center">{label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  )
}

export function AppShell({
  role,
  children,
}: {
  role: Role
  children: ReactNode
}) {
  // Players and members: the public site's header (with the account menu) and footer.
  if (role === 'member') {
    return (
      <div className="app-shell app-shell-desktop app-shell-public flex flex-col">
        <SiteHeader />
        {children}
        <SiteFooter />
      </div>
    )
  }
  return (
    <div className="app-shell">
      <SideNav role={role} />
      <div className="app-shell-desktop min-h-[100dvh] md:min-h-0 flex-1 flex flex-col relative w-full">
        {children}
        <BottomNav role={role} />
      </div>
    </div>
  )
}

export function AppHeader({
  title,
  subtitle,
  left,
  right,
}: {
  title: string
  subtitle?: string
  left?: ReactNode
  right?: ReactNode
}) {
  const { activeClub, user } = useAuth()
  const clubName = activeClub?.name ?? 'bRineLy'
  useDocumentTitle(title)
  // On the public site (players and members) the page heading sits in the content, as on public pages.
  if (user?.role === 'member') {
    return (
      <div className="app-content-rail pt-6 pb-2 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          {left ? <div className="shrink-0 mt-1">{left}</div> : null}
          <div className="min-w-0">
            <h1 className="text-heading-1 font-semibold text-ink">{title}</h1>
            {subtitle ? <p className="mt-1 text-subtitle text-muted">{subtitle}</p> : null}
          </div>
        </div>
        {right ? <div className="shrink-0">{right}</div> : null}
      </div>
    )
  }
  return (
    <header className="sticky top-0 z-30 bg-white border-b border-line pt-4 pb-3.5">
      <div className="app-content-rail flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          {left ? <div className="shrink-0 mt-0.5">{left}</div> : null}
          <div className="min-w-0">
            <div className="flex items-center gap-2 md:hidden mb-1">
              <ClubMark size="small" />
              <p className="text-caption font-bold text-brand-800">{clubName}</p>
            </div>
            {title ? (
              <h1 className="text-heading-2 font-semibold text-slate-900 tracking-normal">
                {title}
              </h1>
            ) : null}
            {subtitle ? (
              <p className="text-subtitle font-medium text-slate-600 mt-1">
                {subtitle}
              </p>
            ) : null}
            <ClubSwitcher className="mt-2 md:hidden" />
          </div>
        </div>
        <div className="shrink-0">{right}</div>
      </div>
    </header>
  )
}

export function SignOutButton() {
  const { user } = useAuth()
  if (user?.role === 'member') return null

  return (
    <SignOutAction
      className="btn-compact min-w-12 px-3 md:hidden"
      iconOnly
    >
      <LogOut size={18} aria-hidden />
      <span className="sr-only">Log out</span>
    </SignOutAction>
  )
}

export function SignOutAction({
  className,
  children,
  iconOnly = false,
}: {
  className: string
  children: ReactNode
  iconOnly?: boolean
}) {
  const { signOut } = useAuth()
  const [confirming, setConfirming] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState<string | null>(null)
  const opener = useRef<HTMLButtonElement>(null)
  const cancelButton = useRef<HTMLButtonElement>(null)
  const dialog = useRef<HTMLDivElement>(null)
  const signingOutRef = useRef(false)

  function closeDialog() {
    if (signingOutRef.current) return
    setSignOutError(null)
    setConfirming(false)
  }

  async function confirmSignOut() {
    if (signingOutRef.current) return
    signingOutRef.current = true
    setSigningOut(true)
    setSignOutError(null)
    try {
      await signOut()
    } catch {
      setSignOutError('We could not log you out. Check your connection and try again.')
    } finally {
      signingOutRef.current = false
      setSigningOut(false)
    }
  }

  // Keep the page behind the dialog out of reach while it is open.
  useModalDialog(confirming, {
    dialogRef: dialog,
    initialFocusRef: cancelButton,
    returnFocusRef: opener,
    onEscape: closeDialog,
  })

  return (
    <>
      <button
        ref={opener}
        type="button"
        onClick={() => setConfirming(true)}
        className={className}
        aria-label={iconOnly ? 'Log out' : undefined}
        aria-haspopup="dialog"
        aria-expanded={confirming}
      >
        {children}
      </button>
      {confirming ? createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/50 p-4"
          onClick={(event) => {
            // A tap on the dimmed backdrop cancels, like the Cancel button.
            if (event.target === event.currentTarget) closeDialog()
          }}
        >
          <div
            ref={dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="sign-out-title"
            aria-describedby="sign-out-description"
            className="card w-full max-w-sm p-5"
          >
            <h2 id="sign-out-title" className="text-title font-bold text-slate-900">
              Log out?
            </h2>
            <p id="sign-out-description" className="text-body text-slate-600 mt-2">
              You can sign back in any time.
            </p>
            {signOutError ? (
              <p role="alert" className="text-body font-semibold text-red-700 mt-3">
                {signOutError}
              </p>
            ) : null}
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                ref={cancelButton}
                type="button"
                onClick={closeDialog}
                disabled={signingOut}
                className="control-feedback min-h-14 rounded-xl border border-slate-300 px-3 text-body font-semibold text-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmSignOut()}
                disabled={signingOut}
                aria-busy={signingOut}
                className="control-feedback min-h-14 rounded-xl bg-red-700 px-3 text-body font-semibold text-white"
              >
                {signingOut ? 'Logging out…' : 'Log out'}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  )
}

export function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <div className="card p-6 text-center">
      <p className="text-title font-bold text-slate-800">{title}</p>
      {body ? (
        <p className="text-body font-normal text-slate-600 mt-2">{body}</p>
      ) : null}
    </div>
  )
}

/** A general loading placeholder: a summary card and a short list. Screens with a known shape should build their own. */
export function LoadingBlock({ label = 'Loading…' }: { label?: string } = {}) {
  return (
    <LoadingShapes label={label} caption="always">
      <div className="space-y-3 p-4" aria-hidden>
        <SkeletonBlock className="h-24 w-full rounded-[18px]!" />
        <SkeletonCard>
          <SkeletonRows count={2} />
        </SkeletonCard>
      </div>
    </LoadingShapes>
  )
}

export function Toast({ message, fadingOut = false }: { message: string | null; fadingOut?: boolean }) {
  if (!message) return null
  return (
    <div
      className={`toast transition-opacity duration-300 ease-out motion-reduce:transition-none${fadingOut ? ' pointer-events-none opacity-0' : ''}`}
      role="status"
    >
      {message}
    </div>
  )
}

/**
 * A message that stays on screen until the person closes it (or the next one replaces it),
 * for screens whose messages must not vanish before they are read. A problem is announced
 * straight away.
 */
export function ClosableToast({ text, problem = false, onClose }: { text: string; problem?: boolean; onClose: () => void }) {
  return (
    <div className="toast flex items-start gap-2">
      <p className="flex-1" role={problem ? 'alert' : 'status'}>{text}</p>
      <button type="button" className="-my-3 -mr-2 min-h-12 shrink-0 rounded-xl px-3 font-semibold underline" onClick={onClose}>
        Close
      </button>
    </div>
  )
}
