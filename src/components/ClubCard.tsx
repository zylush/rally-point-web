import { Link } from 'react-router-dom'
import { LoadingShapes } from './Skeleton'
import { ClubImage } from './ClubImage'
import { clubGrid, courtTypeCounts, plural, rateLines } from '../lib/clubFormat'
import type { PublicClubListing } from '../types'

/** A club in a list: its picture, where it is, how big it is and what an hour costs. The whole card opens the club. */
export function ClubCard({ club, lazy = true }: { club: PublicClubListing; lazy?: boolean }) {
  const rates = rateLines(club.min_rate, club.min_member_rate)
  const types = club.court_count === 0 ? null : courtTypeCounts(club.indoor_courts, club.outdoor_courts)
  return (
    <Link to={`/clubs/${club.slug}`} className="control-feedback club-card card flex h-full flex-col overflow-hidden">
      <ClubImage
        photos={[club.cover_photo]}
        seed={club.slug}
        alt={`Photo of ${club.name}`}
        className="club-card-media block aspect-[16/9] w-full"
        sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
        lazy={lazy}
      />
      <span className="flex flex-1 flex-col gap-0.5 p-4">
        <span className="text-title font-semibold text-ink">{club.name}</span>
        {club.cities.length ? <span className="text-body text-muted">{club.cities.join(' · ')}</span> : null}
        <span className="text-body text-muted">
          {club.court_count === 0
            ? 'Courts coming soon'
            : `${plural(club.venue_count, 'location')} · ${plural(club.court_count, 'court')}`}
        </span>
        {types ? <span className="text-body text-muted">{types}</span> : null}
        <span className="mt-1 text-body font-semibold text-brand-700">{rates.regular}</span>
        {rates.member ? <span className="text-body font-semibold text-brand-700">{rates.member}</span> : null}
      </span>
    </Link>
  )
}

/** Card-shaped placeholders in the same grid as the club list, so nothing jumps when clubs arrive. */
export function ClubCardsLoading({ count = 3 }: { count?: number }) {
  return (
    <LoadingShapes label="Loading clubs…">
      <div className="skeleton h-6 w-24" aria-hidden />
      <ul className={clubGrid} aria-hidden>
        {Array.from({ length: count }, (_, key) => (
          <li key={key} className="card overflow-hidden">
            <div className="skeleton aspect-[16/9] rounded-none!" />
            <div className="space-y-2 p-4">
              <div className="skeleton h-6 w-3/4" />
              <div className="skeleton h-5 w-1/2" />
              <div className="skeleton h-5 w-2/3" />
              <div className="skeleton h-5 w-3/5" />
            </div>
          </li>
        ))}
      </ul>
    </LoadingShapes>
  )
}
