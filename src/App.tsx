import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import { AuthProvider } from './context/AuthProvider'
import type { Role } from './types'
import LoginPage from './pages/LoginPage'
import {
  MemberHome,
  MemberNotifications,
  MemberPay,
  MemberProfile,
  MemberTransactions,
} from './pages/member'
import { MemberBook } from './pages/MemberBook'
import { MemberPass } from './pages/MemberPass'
import { AdminOpenPlay, MemberOpenPlay, StaffOpenPlay } from './pages/OpenPlay'
import { AdminBoard, StaffBoard, TvBoard } from './pages/ScheduleBoard'
import { StaffCheckIn, StaffCourts, StaffHome, StaffMembers } from './pages/staff'
import {
  AdminHome,
  AdminMemberForm,
  AdminMembers,
  AdminOps,
  AdminTransactions,
  AdminUsers,
} from './pages/admin'
import { AdminBookings, StaffBookings } from './pages/BookingsDesk'
import { AdminVenues } from './pages/AdminVenues'
import { LoadingBlock } from './components/Shell'
import { useEffect } from 'react'
import { api } from './lib/api'
import { HelpPage } from './pages/HelpPage'
import { SuperadminPage } from './pages/Superadmin'

import { JoinClubPage } from './pages/JoinClub'
import { homeFor } from './lib/roleHome'
import { PrivacyNoticePage } from './pages/PrivacyNoticePage'

function Protected({ roles }: { roles?: Role[] }) {
  const { user, loading } = useAuth()
  useEffect(() => {
    if (user) void api.processDueReminders()
  }, [user])
  if (loading) {
    return (
      <div className="app-shell">
        <LoadingBlock />
      </div>
    )
  }
  if (!user) return <Navigate to="/login" replace />
  if (roles && !roles.includes(user.role)) {
    return <Navigate to={homeFor(user.role)} replace />
  }
  return <Outlet />
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  )
}

function AppRoutes() {
  const { activeClub } = useAuth()
  // Switching clubs remounts the screens, so replies still in flight for the
  // previous club are dropped instead of showing up in the new one.
  return (
      <Routes key={activeClub?.club_id ?? 'no-club'}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/privacy" element={<PrivacyNoticePage />} />
        <Route path="/" element={<RootRedirect />} />
        {/* Club join links: sign up, or join while signed in */}
        <Route path="/join/:slug" element={<JoinClubPage />} />
        {/* Public TV board — open on club screens. Without a club link it shows Rally Point Gensan. */}
        <Route path="/board/tv" element={<TvBoard />} />
        <Route path="/board/tv/:slug" element={<TvBoard />} />

        <Route element={<Protected roles={['member', 'admin']} />}>
          <Route path="/member" element={<MemberHome />} />
          <Route path="/member/book" element={<MemberBook />} />
          <Route path="/member/open" element={<MemberOpenPlay />} />
          <Route path="/member/pass" element={<MemberPass />} />
          <Route path="/member/pay" element={<MemberPay />} />
          <Route path="/member/transactions" element={<MemberTransactions />} />
          <Route path="/member/notifications" element={<MemberNotifications />} />
          <Route path="/member/profile" element={<MemberProfile />} />
          <Route path="/member/help" element={<HelpPage />} />
        </Route>

        <Route element={<Protected roles={['staff', 'admin']} />}>
          <Route path="/staff" element={<StaffHome />} />
          <Route path="/staff/members" element={<StaffMembers />} />
          <Route path="/staff/checkin" element={<StaffCheckIn />} />
          <Route path="/staff/bookings" element={<StaffBookings />} />
          <Route path="/staff/board" element={<StaffBoard />} />
          <Route path="/staff/open" element={<StaffOpenPlay />} />
          <Route path="/staff/courts" element={<StaffCourts />} />
          <Route path="/staff/help" element={<HelpPage />} />
        </Route>

        {/* Club admin screens. Platform superadmins have their own portal, not club access. */}
        <Route element={<Protected roles={['admin']} />}>
          <Route path="/admin" element={<AdminHome />} />
          <Route path="/admin/members" element={<AdminMembers />} />
          <Route path="/admin/members/new" element={<AdminMemberForm />} />
          <Route path="/admin/members/:id" element={<AdminMemberForm />} />
          <Route path="/admin/ops" element={<AdminOps />} />
          <Route path="/admin/board" element={<AdminBoard />} />
          <Route path="/admin/open" element={<AdminOpenPlay />} />
          <Route path="/admin/bookings" element={<AdminBookings />} />
          <Route path="/admin/transactions" element={<AdminTransactions />} />
          <Route path="/admin/users" element={<AdminUsers />} />
          <Route path="/admin/venues" element={<AdminVenues />} />
          <Route path="/admin/help" element={<HelpPage />} />
        </Route>

        <Route element={<Protected roles={['superadmin']} />}>
          <Route path="/superadmin" element={<SuperadminPage section="overview" />} />
          <Route path="/superadmin/clubs" element={<SuperadminPage section="clubs" />} />
          <Route path="/superadmin/ledger" element={<SuperadminPage section="ledger" />} />
          {/* Platform FAQs and contacts only; Help loads no club data for superadmins. */}
          <Route path="/superadmin/help" element={<HelpPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
  )
}

function RootRedirect() {
  const { user, loading } = useAuth()
  if (loading) {
    return (
      <div className="app-shell">
        <LoadingBlock />
      </div>
    )
  }
  if (!user) return <Navigate to="/login" replace />
  return <Navigate to={homeFor(user.role)} replace />
}
