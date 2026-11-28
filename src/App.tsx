import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import { AuthProvider } from './context/AuthProvider'
import type { Role } from './types'
import LoginPage from './pages/LoginPage'
import {
  MemberNotifications,
  MemberTransactions,
} from './pages/member'
import { MemberAccount } from './pages/MemberAccount'
import { MemberBook } from './pages/MemberBook'
import { MemberCoaches } from './pages/MemberCoaches'
import { CoachPortal } from './pages/CoachPortal'
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
import { AdminProfile } from './pages/AdminProfile'
import { AdminAnalytics } from './pages/AdminAnalytics'
import { LoadingBlock } from './components/Shell'
import { useEffect } from 'react'
import { api } from './lib/api'
import { HelpPage } from './pages/HelpPage'
import { SuperadminPage } from './pages/Superadmin'

import { JoinClubPage } from './pages/JoinClub'
import {
  AdminLeaderboardPage,
  MemberLeaderboardPage,
  PublicClubLeaderboardPage,
  StaffLeaderboardPage,
} from './pages/Leaderboard'
import {
  AdminTournamentDetailPage,
  AdminTournamentsPage,
  MemberTournamentDetailPage,
  MemberTournamentsPage,
  PublicClubTournamentsPage,
  PublicTournamentsPage,
  PublicTournamentDetailPage,
  StaffTournamentDetailPage,
  StaffTournamentsPage,
} from './pages/Tournaments'
import { homeFor } from './lib/roleHome'
import { PrivacyNoticePage } from './pages/PrivacyNoticePage'
import { ClubDetailPage, ClubDirectory } from './pages/Clubs'
import { PublicCoachesPage } from './pages/Coaches'
import { WelcomePage } from './pages/Welcome'
import { OwnersPage } from './pages/Owners'
import { NotFoundPage } from './pages/NotFound'
import { ErrorBoundary } from './components/ErrorBoundary'

function Protected({ roles }: { roles?: Role[] }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  useEffect(() => {
    if (user) void api.processDueReminders()
  }, [user])
  if (loading) {
    return (
      <div className="app-shell">
        <LoadingBlock label="Checking your sign-in…" />
      </div>
    )
  }
  // Remember the page, so signing in comes back to it.
  if (!user) return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />
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
  const { pathname } = useLocation()
  // Switching clubs remounts the screens, so replies still in flight for the
  // previous club are dropped instead of showing up in the new one.
  // A screen that crashes shows a way out; moving to another page tries again.
  return (
    <ErrorBoundary resetKey={pathname}>
      <Routes key={activeClub?.club_id ?? 'no-club'}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/privacy" element={<PrivacyNoticePage />} />
        {/* Find a court & court booking environment: open to visitors; payment asks them to sign in. */}
        <Route path="/clubs" element={<ClubDirectory />} />
        <Route path="/clubs/:slug" element={<ClubDetailPage />} />
        <Route path="/clubs/:slug/leaderboard" element={<PublicClubLeaderboardPage />} />
        <Route path="/clubs/:slug/tournaments" element={<PublicClubTournamentsPage />} />
        {/* Coaches from every active club, open to visitors; requesting a time asks them to sign in. */}
        <Route path="/coaches" element={<PublicCoachesPage />} />
        {/* Tournaments from every club, each naming its club. Open to visitors. */}
        <Route path="/tournaments" element={<PublicTournamentsPage />} />
        <Route path="/clubs/:slug/tournaments/:tournamentId" element={<PublicTournamentDetailPage />} />
        <Route path="/clubs/:slug/book" element={<MemberBook />} />
        {/* Court owners: how listing works, and a request for a call. Open to visitors. */}
        <Route path="/owners" element={<OwnersPage />} />
        <Route path="/" element={<RootRedirect />} />
        {/* Club join links: sign up, or join while signed in */}
        <Route path="/join/:slug" element={<JoinClubPage />} />
        {/* Public TV board — open on club screens. Without a club link it shows Rally Point Gensan. */}
        <Route path="/board/tv" element={<TvBoard />} />
        <Route path="/board/tv/:slug" element={<TvBoard />} />

        <Route element={<Protected roles={['member', 'admin']} />}>
          {/* No member dashboard: the member's home is their Account. */}
          <Route path="/member" element={<MemberAccount />} />
          <Route path="/member/book" element={<MemberBook />} />
          <Route path="/member/open" element={<MemberOpenPlay />} />
          <Route path="/member/leaderboard" element={<MemberLeaderboardPage />} />
          <Route path="/member/tournaments" element={<MemberTournamentsPage />} />
          <Route path="/member/tournaments/:tournamentId" element={<MemberTournamentDetailPage />} />
          <Route path="/member/pass" element={<MemberPass />} />
          {/* Memberships are asked for on Account and confirmed by club staff; old links land there. */}
          <Route path="/member/pay" element={<Navigate to="/member" replace />} />
          <Route path="/member/transactions" element={<MemberTransactions />} />
          <Route path="/member/notifications" element={<MemberNotifications />} />
          <Route path="/member/profile" element={<Navigate to="/member" replace />} />
          <Route path="/member/help" element={<HelpPage />} />
        </Route>

        <Route element={<Protected roles={['member']} />}>
          <Route path="/member/coaches" element={<MemberCoaches />} />
        </Route>

        <Route element={<Protected roles={['member', 'staff', 'admin']} />}>
          <Route path="/coach" element={<CoachPortal />} />
        </Route>

        <Route element={<Protected roles={['staff', 'admin']} />}>
          <Route path="/staff" element={<StaffHome />} />
          <Route path="/staff/members" element={<StaffMembers />} />
          <Route path="/staff/checkin" element={<StaffCheckIn />} />
          <Route path="/staff/bookings" element={<StaffBookings />} />
          <Route path="/staff/board" element={<StaffBoard />} />
          <Route path="/staff/open" element={<StaffOpenPlay />} />
          <Route path="/staff/leaderboard" element={<StaffLeaderboardPage />} />
          <Route path="/staff/tournaments" element={<StaffTournamentsPage />} />
          <Route path="/staff/tournaments/:tournamentId" element={<StaffTournamentDetailPage />} />
          <Route path="/staff/courts" element={<StaffCourts />} />
          <Route path="/staff/help" element={<HelpPage />} />
        </Route>

        {/* Club admin screens. Platform superadmins have their own portal, not club access. */}
        <Route element={<Protected roles={['admin']} />}>
          <Route path="/admin" element={<AdminHome />} />
          <Route path="/admin/analytics" element={<AdminAnalytics />} />
          <Route path="/admin/members" element={<AdminMembers />} />
          <Route path="/admin/members/new" element={<AdminMemberForm />} />
          <Route path="/admin/members/:id" element={<AdminMemberForm />} />
          <Route path="/admin/ops" element={<AdminOps />} />
          <Route path="/admin/board" element={<AdminBoard />} />
          <Route path="/admin/open" element={<AdminOpenPlay />} />
          <Route path="/admin/leaderboard" element={<AdminLeaderboardPage />} />
          <Route path="/admin/tournaments" element={<AdminTournamentsPage />} />
          <Route path="/admin/tournaments/:tournamentId" element={<AdminTournamentDetailPage />} />
          <Route path="/admin/bookings" element={<AdminBookings />} />
          <Route path="/admin/transactions" element={<AdminTransactions />} />
          <Route path="/admin/users" element={<AdminUsers />} />
          <Route path="/admin/venues" element={<AdminVenues />} />
          <Route path="/admin/profile" element={<AdminProfile />} />
          <Route path="/admin/help" element={<HelpPage />} />
        </Route>

        <Route element={<Protected roles={['superadmin']} />}>
          <Route path="/superadmin" element={<SuperadminPage section="overview" />} />
          <Route path="/superadmin/analytics" element={<SuperadminPage section="analytics" />} />
          <Route path="/superadmin/clubs" element={<SuperadminPage section="clubs" />} />
          <Route path="/superadmin/ledger" element={<SuperadminPage section="ledger" />} />
          <Route path="/superadmin/requests" element={<SuperadminPage section="requests" />} />
          {/* Platform FAQs and contacts only; Help loads no club data for superadmins. */}
          <Route path="/superadmin/help" element={<HelpPage />} />
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </ErrorBoundary>
  )
}

function RootRedirect() {
  const { user, loading } = useAuth()
  if (loading) {
    return (
      <div className="app-shell">
        <LoadingBlock label="Checking your sign-in…" />
      </div>
    )
  }
  // Visitors, players and members see the welcome page (members with their account menu);
  // staff, admins and superadmins go to their own desk.
  if (!user || user.role === 'member') return <WelcomePage />
  return <Navigate to={homeFor(user.role)} replace />
}
