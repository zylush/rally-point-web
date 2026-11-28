import type {
  Club,
  ClubLeaderboardSnapshot,
  ClubMatch,
  LeaderboardEntry,
  LeaderboardFormatFilter,
  LeaderboardPeriod,
  LeaderboardPlayerSummary,
  LeaderboardScorerStaff,
  RecordMatchInput,
} from '../../types'
import { ymdLocal } from '../../types'
import { activeClub, activeClubBySlug, clubRoleFor } from './access'
import { todayISO, uid } from './common'
import type { DemoClubMatch, DemoDB } from './model'
import { load, save } from './persistence'

export function tidyText(value: string | null | undefined) {
  return (value ?? '').replace(/\s+/g, ' ').trim()
}

export function activePublicClubBySlug(db: DemoDB, slug: string): Club | undefined {
  const club = activeClubBySlug(db, slug)
  if (!club) return undefined
  const account = db.clubAccounts.find((row) => row.club_id === club.id)
  return !account || account.status === 'active' ? club : undefined
}

export function canScoreClubMatches(db: DemoDB, clubId: string, userId: string | null | undefined) {
  if (!userId) return false
  const role = clubRoleFor(db, userId, clubId)
  if (role === 'admin') return true
  if (role !== 'staff') return false
  return (db.leaderboardScorers ?? []).some((row) => row.club_id === clubId && row.user_id === userId)
}

export function canScoreTournament(
  db: DemoDB,
  clubId: string,
  userId: string | null | undefined,
  tournamentId: string,
) {
  if (!userId || !tournamentId) return false
  if (canScoreClubMatches(db, clubId, userId)) return true
  const role = clubRoleFor(db, userId, clubId)
  if (role !== 'staff') return false
  return (db.clubTournamentScorers ?? []).some(
    (row) => row.club_id === clubId && row.tournament_id === tournamentId && row.user_id === userId,
  )
}

function requireScorer(db: DemoDB) {
  const club = activeClub(db)
  if (!club || !db.sessionUserId || !canScoreClubMatches(db, club.id, db.sessionUserId)) {
    throw new Error('Only club admins and designated scorers can record match results')
  }
  return club
}

function requireClubAdmin(db: DemoDB) {
  const club = activeClub(db)
  if (!club || !db.sessionUserId || clubRoleFor(db, db.sessionUserId, club.id) !== 'admin') {
    throw new Error('Only club admins can manage designated scorers')
  }
  return club
}

function manilaMonthStartMs(now = new Date()) {
  const ym = ymdLocal(now).slice(0, 7)
  return new Date(`${ym}-01T00:00:00+08:00`).getTime()
}

function clampLimit(limit: number | undefined, fallback: number, max: number) {
  const n = Number.isFinite(limit) ? Math.trunc(limit!) : fallback
  return Math.min(Math.max(n, 1), max)
}

export function toPlayerSummary(db: DemoDB, clubId: string, memberId: string): LeaderboardPlayerSummary {
  const member = db.members.find((m) => m.club_id === clubId && m.id === memberId)
  const profile = member?.user_id ? db.profiles.find((p) => p.id === member.user_id) : undefined
  const photoPath = profile?.photo_path ?? null
  return {
    member_id: memberId,
    full_name: member?.full_name ?? 'Player',
    nickname: profile?.nickname ?? null,
    photo_path: photoPath,
    photo_url: photoPath,
  }
}

function hydrateMatch(db: DemoDB, match: DemoClubMatch): ClubMatch {
  const venue = match.venue_id ? db.venues.find((v) => v.id === match.venue_id && v.club_id === match.club_id) : undefined
  const court = match.court_id ? db.courts.find((c) => c.id === match.court_id && c.club_id === match.club_id) : undefined
  const tournament = match.tournament_id
    ? (db.clubTournaments ?? []).find((t) => t.id === match.tournament_id && t.club_id === match.club_id)
    : undefined
  return {
    id: match.id,
    club_id: match.club_id,
    venue_id: match.venue_id,
    venue_name: venue?.name ?? null,
    court_id: match.court_id,
    court_name: court?.name ?? null,
    tournament_id: match.tournament_id,
    tournament_title: tournament?.title ?? null,
    format: match.format,
    winner_side: match.winner_side,
    score_a: match.score_a,
    score_b: match.score_b,
    notes: match.notes,
    status: match.status,
    void_reason: match.void_reason,
    played_at: match.played_at,
    created_at: match.created_at,
    team_a: match.team_a_ids.map((id) => toPlayerSummary(db, match.club_id, id)),
    team_b: match.team_b_ids.map((id) => toPlayerSummary(db, match.club_id, id)),
  }
}

function compareMatchesNewestFirst(a: DemoClubMatch, b: DemoClubMatch) {
  return b.played_at.localeCompare(a.played_at)
    || b.created_at.localeCompare(a.created_at)
    || b.id.localeCompare(a.id)
}

function buildPayload(
  db: DemoDB,
  club: Club,
  opts: {
    period: LeaderboardPeriod
    format: LeaderboardFormatFilter
    limit: number
    includeVoided: boolean
    myMemberId: string | null
  },
): ClubLeaderboardSnapshot {
  if (opts.period !== 'month' && opts.period !== 'all') throw new Error('Invalid leaderboard period')
  if (opts.format !== 'all' && opts.format !== 'doubles' && opts.format !== 'singles') {
    throw new Error('Invalid match format')
  }
  const monthStart = opts.period === 'month' ? manilaMonthStartMs() : null

  const scopedMatches = (db.clubMatches ?? [])
    .filter((m) =>
      m.club_id === club.id
      && (monthStart == null || new Date(m.played_at).getTime() >= monthStart)
      && (opts.format === 'all' || m.format === opts.format),
    )
    .slice()
    .sort(compareMatchesNewestFirst)

  const completed = scopedMatches.filter((m) => m.status === 'completed')

  const statsMap = new Map<string, {
    wins: number
    losses: number
    scoreDiff: number
    outcomes: boolean[]
  }>()

  const recordOutcome = (memberId: string, won: boolean, diff: number) => {
    const cur = statsMap.get(memberId) ?? { wins: 0, losses: 0, scoreDiff: 0, outcomes: [] }
    if (won) cur.wins += 1
    else cur.losses += 1
    cur.scoreDiff += diff
    cur.outcomes.push(won)
    statsMap.set(memberId, cur)
  }

  for (const match of completed) {
    const diffA = match.score_a != null && match.score_b != null ? match.score_a - match.score_b : 0
    for (const id of match.team_a_ids) recordOutcome(id, match.winner_side === 'a', diffA)
    for (const id of match.team_b_ids) recordOutcome(id, match.winner_side === 'b', -diffA)
  }

  const ranked: LeaderboardEntry[] = []
  for (const [memberId, stat] of statsMap.entries()) {
    const member = db.members.find((m) => m.club_id === club.id && m.id === memberId)
    if (!member) continue
    const gamesPlayed = stat.wins + stat.losses
    const firstWon = stat.outcomes[0]
    let streakLen = 0
    for (const outcome of stat.outcomes) {
      if (outcome !== firstWon) break
      streakLen += 1
    }
    const summary = toPlayerSummary(db, club.id, memberId)
    ranked.push({
      ...summary,
      rank: 0,
      points: stat.wins * 3 + stat.losses,
      wins: stat.wins,
      losses: stat.losses,
      games_played: gamesPlayed,
      win_pct: Math.round((stat.wins * 100) / Math.max(gamesPlayed, 1)),
      score_diff: stat.scoreDiff,
      streak: firstWon ? streakLen : -streakLen,
    })
  }

  ranked.sort((a, b) =>
    b.points - a.points
    || b.wins - a.wins
    || (b.wins / Math.max(b.games_played, 1)) - (a.wins / Math.max(a.games_played, 1))
    || b.score_diff - a.score_diff
    || b.games_played - a.games_played
    || a.full_name.toLowerCase().localeCompare(b.full_name.toLowerCase())
    || a.member_id.localeCompare(b.member_id),
  )

  ranked.forEach((entry, index) => {
    entry.rank = index + 1
  })

  const myEntry = opts.myMemberId
    ? ranked.find((entry) => entry.member_id === opts.myMemberId) ?? null
    : null

  const recentMatches = scopedMatches
    .filter((m) => opts.includeVoided || m.status === 'completed')
    .slice(0, 25)
    .map((m) => hydrateMatch(db, m))

  return {
    club: { id: club.id, slug: club.slug, name: club.name },
    period: opts.period,
    format: opts.format,
    entries: ranked.slice(0, opts.limit),
    recent_matches: recentMatches,
    total_players: ranked.length,
    total_matches: completed.length,
    my_member_id: opts.myMemberId,
    my_entry: myEntry,
  }
}

export const leaderboardOperations = {
  publicClubLeaderboard(
    slug: string,
    period: LeaderboardPeriod = 'month',
    format: LeaderboardFormatFilter = 'all',
    limit = 50,
  ): ClubLeaderboardSnapshot | null {
    const db = load()
    const club = activePublicClubBySlug(db, slug)
    if (!club) return null
    return buildPayload(db, club, {
      period,
      format,
      limit: clampLimit(limit, 50, 100),
      includeVoided: false,
      myMemberId: null,
    })
  },

  publicPlayerMatches(slug: string, memberId: string, limit = 15): ClubMatch[] | null {
    const db = load()
    const club = activePublicClubBySlug(db, slug)
    if (!club) return null
    const maxRows = clampLimit(limit, 15, 30)
    return (db.clubMatches ?? [])
      .filter((m) =>
        m.club_id === club.id
        && m.status === 'completed'
        && (m.team_a_ids.includes(memberId) || m.team_b_ids.includes(memberId)),
      )
      .slice()
      .sort(compareMatchesNewestFirst)
      .slice(0, maxRows)
      .map((m) => hydrateMatch(db, m))
  },

  clubLeaderboard(
    period: LeaderboardPeriod = 'month',
    format: LeaderboardFormatFilter = 'all',
    limit = 100,
  ): ClubLeaderboardSnapshot {
    const db = load()
    const club = activeClub(db)
    if (!db.sessionUserId || !club) throw new Error('Sign in to view club standings')
    const role = clubRoleFor(db, db.sessionUserId, club.id)
    if (!role) throw new Error('You do not belong to this club')

    const myMember = db.members.find((m) => m.club_id === club.id && m.user_id === db.sessionUserId)
    const payload = buildPayload(db, club, {
      period,
      format,
      limit: clampLimit(limit, 100, 100),
      includeVoided: role === 'staff' || role === 'admin',
      myMemberId: myMember?.id ?? null,
    })
    return {
      ...payload,
      can_score: canScoreClubMatches(db, club.id, db.sessionUserId),
    }
  },

  recordClubMatch(input: RecordMatchInput): ClubMatch {
    const db = load()
    const club = requireScorer(db)
    if (input.format !== 'doubles' && input.format !== 'singles') {
      throw new Error('Choose singles or doubles')
    }
    if (input.winner_side !== 'a' && input.winner_side !== 'b') {
      throw new Error('Choose which team won')
    }
    const expectedSize = input.format === 'singles' ? 1 : 2
    if (input.team_a.length !== expectedSize || input.team_b.length !== expectedSize) {
      throw new Error(`Choose ${expectedSize} player(s) per team for ${input.format}`)
    }
    const allPlayers = [...input.team_a, ...input.team_b].filter(Boolean)
    if (new Set(allPlayers).size !== expectedSize * 2) {
      throw new Error('Choose different players for each spot')
    }
    const clubMembers = new Set(db.members.filter((m) => m.club_id === club.id).map((m) => m.id))
    if (allPlayers.some((id) => !clubMembers.has(id))) {
      throw new Error('Every player must belong to this club')
    }

    const scoreA = input.score_a ?? null
    const scoreB = input.score_b ?? null
    if ((scoreA == null) !== (scoreB == null)) {
      throw new Error('Enter scores for both teams, or leave both blank')
    }
    if (scoreA != null && scoreB != null) {
      if (!Number.isInteger(scoreA) || !Number.isInteger(scoreB) || scoreA < 0 || scoreA > 99 || scoreB < 0 || scoreB > 99) {
        throw new Error('Scores must be between 0 and 99')
      }
      if ((input.winner_side === 'a' && scoreA <= scoreB) || (input.winner_side === 'b' && scoreB <= scoreA)) {
        throw new Error('Winning team score must be higher than the losing team score')
      }
    }

    const notes = tidyText(input.notes) || null
    if (notes && notes.length > 200) throw new Error('Notes are limited to 200 characters')

    let venueId = input.venue_id ?? null
    const courtId = input.court_id ?? null
    if (courtId) {
      const court = db.courts.find((c) => c.id === courtId && c.club_id === club.id)
      if (!court) throw new Error('Court not found in this club')
      if (venueId && court.venue_id !== venueId) throw new Error('Court belongs to another venue')
      venueId = court.venue_id ?? null
    } else if (venueId) {
      if (!db.venues.some((v) => v.id === venueId && v.club_id === club.id)) {
        throw new Error('Venue not found in this club')
      }
    }

    const now = todayISO()
    const match: DemoClubMatch = {
      id: uid('match'),
      club_id: club.id,
      venue_id: venueId,
      court_id: courtId,
      tournament_id: null,
      format: input.format,
      team_a_ids: [...input.team_a],
      team_b_ids: [...input.team_b],
      winner_side: input.winner_side,
      score_a: scoreA,
      score_b: scoreB,
      notes,
      status: 'completed',
      recorded_by: db.sessionUserId,
      voided_by: null,
      voided_at: null,
      void_reason: null,
      played_at: now,
      created_at: now,
    }
    db.clubMatches = [match, ...(db.clubMatches ?? [])]
    save(db)
    return hydrateMatch(db, match)
  },

  voidClubMatch(matchId: string, reason?: string): void {
    const db = load()
    const club = activeClub(db)
    const userId = db.sessionUserId
    if (!club || !userId) {
      throw new Error('Only club admins and designated scorers can record match results')
    }
    const cleanReason = tidyText(reason) || null
    if (cleanReason && cleanReason.length > 200) throw new Error('Reason is limited to 200 characters')

    const match = (db.clubMatches ?? []).find((m) => m.id === matchId && m.club_id === club.id && m.status === 'completed')
    if (!match) {
      const hasAnyTournamentScoreRole = (db.clubTournamentScorers ?? []).some(
        (row) => row.club_id === club.id && row.user_id === userId,
      )
      if (!canScoreClubMatches(db, club.id, userId) && !hasAnyTournamentScoreRole) {
        throw new Error('Only club admins and designated scorers can record match results')
      }
      throw new Error('Match not found or already voided')
    }

    const allowed = match.tournament_id
      ? canScoreTournament(db, club.id, userId, match.tournament_id)
      : canScoreClubMatches(db, club.id, userId)
    if (!allowed) {
      throw new Error('Only club admins and designated scorers can record match results')
    }

    const tm = (db.clubTournamentMatches ?? []).find(
      (row) => row.club_id === club.id && row.club_match_id === matchId,
    )
    if (tm) {
      const tournament = (db.clubTournaments ?? []).find((t) => t.id === tm.tournament_id && t.club_id === club.id)
      if (tournament?.format === 'single_elimination') {
        if (tm.next_match_id) {
          const nextMatch = (db.clubTournamentMatches ?? []).find(
            (nm) => nm.id === tm.next_match_id && nm.club_id === club.id,
          )
          if (nextMatch) {
            if (nextMatch.status === 'completed') {
              throw new Error('Cannot void a bracket match after the next round has been played')
            }
            if (tm.next_match_side === 'a') {
              nextMatch.team_a_id = null
              nextMatch.team_a_player_ids = []
            } else {
              nextMatch.team_b_id = null
              nextMatch.team_b_player_ids = []
            }
            nextMatch.status = 'pending'
          }
        } else if (tournament.status === 'completed') {
          tournament.status = 'live'
          tournament.completed_at = null
        }
        tm.status = 'ready'
        tm.winner_side = null
        tm.score_a = null
        tm.score_b = null
        tm.club_match_id = null
        tm.completed_at = null
      } else {
        tm.status = 'voided'
        tm.club_match_id = null
      }
    }

    match.status = 'voided'
    match.voided_by = userId
    match.voided_at = todayISO()
    match.void_reason = cleanReason
    save(db)
  },

  listLeaderboardScorers(): LeaderboardScorerStaff[] {
    const db = load()
    const club = requireClubAdmin(db)
    const scorers = new Set(
      (db.leaderboardScorers ?? []).filter((row) => row.club_id === club.id).map((row) => row.user_id),
    )
    return db.clubRoles
      .filter((row) => row.club_id === club.id && row.role === 'staff' && row.is_active)
      .map((row) => {
        const profile = db.profiles.find((p) => p.id === row.user_id)
        return {
          user_id: row.user_id,
          full_name: profile?.full_name ?? 'Staff',
          email: profile?.email ?? '',
          can_score: scorers.has(row.user_id),
        }
      })
      .sort((a, b) => a.full_name.toLowerCase().localeCompare(b.full_name.toLowerCase()) || a.user_id.localeCompare(b.user_id))
  },

  setLeaderboardScorer(userId: string, canScore: boolean): void {
    const db = load()
    const club = requireClubAdmin(db)
    const isStaff = db.clubRoles.some(
      (row) => row.club_id === club.id && row.user_id === userId && row.role === 'staff' && row.is_active,
    )
    if (!isStaff) throw new Error('Active staff member not found in this club')
    const current = db.leaderboardScorers ?? []
    if (canScore) {
      if (!current.some((row) => row.club_id === club.id && row.user_id === userId)) {
        db.leaderboardScorers = [
          ...current,
          { club_id: club.id, user_id: userId, granted_by: db.sessionUserId, created_at: todayISO() },
        ]
      }
    } else {
      db.leaderboardScorers = current.filter((row) => !(row.club_id === club.id && row.user_id === userId))
    }
    save(db)
  },
}
