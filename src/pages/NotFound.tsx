import { Link } from 'react-router-dom'
import { PublicFrame } from '../components/PublicFrame'
import { useAuth } from '../context/AuthContext'
import { homeFor } from '../lib/roleHome'

/** An address the app does not know: say so, and offer the likely next step. */
export function NotFoundPage() {
  const { user } = useAuth()
  return (
    <PublicFrame title="Page not found">
      <p className="text-subtitle text-muted">This page does not exist or has moved. Check the link, or carry on from here.</p>
      <div className="flex flex-wrap gap-3">
        {/* Staff and admins have a desk to go back to; players and members use the public site. */}
        {user && user.role !== 'member' ? (
          <Link to={homeFor(user.role)} className="btn-primary w-auto! px-6">
            Go to my home
          </Link>
        ) : (
          <Link to="/" className="btn-primary w-auto! px-6">
            Go to the home page
          </Link>
        )}
        <Link to="/clubs" className="btn-secondary w-auto! px-6">
          Find a court
        </Link>
      </div>
    </PublicFrame>
  )
}
