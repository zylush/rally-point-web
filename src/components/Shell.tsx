import { NavLink } from 'react-router-dom'
import {
  CalendarDays,
  Home,
  HelpCircle,
  LayoutDashboard,
  LogOut,
  QrCode,
  Tv,
  UserRound,
  Users,
} from 'lucide-react'
import type { ReactNode } from 'react'
import type { Role } from '../types'
import { useAuth } from '../context/AuthContext'
import { RallyPointLogo } from './RallyPointLogo'

/** Plain-language nav — short words players of any age recognize */
const memberTabs = [
  { to: '/member', end: true, label: 'Home', icon: Home },
  { to: '/member/book', label: 'Book', icon: CalendarDays },
  { to: '/member/open', label: 'Play', icon: Users },
  { to: '/member/pass', label: 'My QR', icon: QrCode },
  { to: '/member/profile', label: 'Account', icon: UserRound },
  { to: '/member/help', label: 'Help', icon: HelpCircle },
]

const staffTabs = [
  { to: '/staff', end: true, label: 'Home', icon: LayoutDashboard },
  { to: '/staff/checkin', label: 'Check in', icon: QrCode },
  { to: '/staff/board', label: 'Schedule', icon: Tv },
  { to: '/staff/open', label: 'Open play', icon: Users },
  { to: '/staff/courts', label: 'Courts', icon: Home },
  { to: '/staff/help', label: 'Help', icon: HelpCircle },
]

const adminTabs = [
  { to: '/admin', end: true, label: 'Home', icon: LayoutDashboard },
  { to: '/admin/ops', label: 'Floor', icon: Home },
  { to: '/admin/board', label: 'Schedule', icon: Tv },
  { to: '/admin/open', label: 'Open play', icon: Users },
  { to: '/admin/bookings', label: 'Bookings', icon: CalendarDays },
  { to: '/admin/help', label: 'Help', icon: HelpCircle },
]

function tabsFor(role: Role) {
  if (role === 'admin') return adminTabs
  if (role === 'staff') return staffTabs
  return memberTabs
}

export function SideNav({ role }: { role: Role }) {
  const { user, signOut } = useAuth()
  const tabs = tabsFor(role)
  const roleLabel =
    role === 'admin' ? 'Admin' : role === 'staff' ? 'Staff' : 'Member'

  return (
    <aside className="side-nav">
      <div className="px-2 mb-6">
        <div className="flex items-center gap-2.5 mb-1">
          <RallyPointLogo variant="mark" className="w-11 h-11 object-contain" />
          <div>
            <p className="text-caption font-normal text-teal-200/90">
              Rally Point
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

      <button
        type="button"
        onClick={() => void signOut()}
        className="side-nav-link control-feedback mt-4 w-full border-0 bg-transparent cursor-pointer text-left"
      >
        <LogOut size={22} aria-hidden />
        Log out
      </button>
    </aside>
  )
}

export function BottomNav({ role }: { role: Role }) {
  const tabs = tabsFor(role)
  const cols =
    tabs.length >= 6
      ? 'grid-cols-6'
      : tabs.length === 5
        ? 'grid-cols-5'
        : 'grid-cols-4'
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
  right,
}: {
  title: string
  subtitle?: string
  right?: ReactNode
}) {
  return (
    <header className="sticky top-0 z-30 bg-white/98 backdrop-blur border-b border-slate-200 pt-4 pb-3.5">
      <div className="app-content-rail flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 md:hidden mb-1">
            <RallyPointLogo variant="mark" className="w-8 h-8 object-contain" />
            <p className="text-caption font-bold text-brand-800">Rally Point</p>
          </div>
          <h1 className="text-heading-2 font-semibold text-slate-900 tracking-normal">
            {title}
          </h1>
          {subtitle ? (
            <p className="text-subtitle font-medium text-slate-600 mt-1">
              {subtitle}
            </p>
          ) : null}
        </div>
        <div className="shrink-0">{right}</div>
      </div>
    </header>
  )
}

export function SignOutButton() {
  const { signOut } = useAuth()
  return (
    <button
      type="button"
      onClick={() => void signOut()}
      className="control-feedback min-h-12 min-w-12 px-3 rounded-2xl border-2 border-slate-200 flex items-center justify-center gap-1.5 text-slate-700 text-body font-bold md:hidden"
      aria-label="Log out"
    >
      <LogOut size={18} aria-hidden />
      <span className="sr-only">Log out</span>
    </button>
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

export function LoadingBlock() {
  return (
    <div className="space-y-3 p-4" aria-busy="true" aria-label="Loading">
      <div className="skeleton h-24" />
      <div className="skeleton h-16" />
      <div className="skeleton h-16" />
      <p className="text-center text-body font-semibold text-slate-500 pt-1">
        Loading…
      </p>
    </div>
  )
}

export function Toast({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <div className="toast" role="status">
      {message}
    </div>
  )
}
