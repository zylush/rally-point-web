import type {
  Club,
  CreateTournamentInput,
  LeaderboardEntry,
  PublicTournamentFilter,
  PublicTournamentSummary,
  ScoreTournamentMatchInput,
  TournamentDetail,
  TournamentFormat,
  TournamentMatch,
  TournamentScorerStaff,
  TournamentSummary,
  TournamentTeam,
} from '../../types'
import { activeClub, clubRoleFor } from './access'
import { todayISO, uid } from './common'
import {
  activePublicClubBySlug,
  canScoreTournament,
  leaderboardOperations,
  tidyText,
  toPlayerSummary,
} from './leaderboard'
import type {
  DemoClubMatch,
  DemoDB,
  DemoTournament,
  DemoTournamentMatch,
  DemoTournamentPlayer,
  DemoTournamentTeam,
} from './model'
import { load, save } from './persistence'

const STATUS_ORDER: Record<DemoTournament['status'], number> = {
  live: 0,
  setup: 1,
  completed: 2,
  cancelled: 3,
}

function clampLimit(limit: number | undefined, fallback: number, max: number) {
  const n = Number.isFinite(limit) ? Math.trunc(limit!) : fallback
  return Math.min(Math.max(n, 1), max)
}

function requireClubAdmin(db: DemoDB) {
  const club = activeClub(db)
  if (!club || !db.sessionUserId || clubRoleFor(db, db.sessionUserId, club.id) !== 'admin') {
    throw new Error('Only club admins can manage tournaments')
  }
  return club
}

function requireTournamentScorer(db: DemoDB, tournamentId: string) {
  const club = activeClub(db)
  if (
    !club
    || !db.sessionUserId
    || !tournamentId
    || !canScoreTournament(db, club.id, db.sessionUserId, tournamentId)
  ) {
    throw new Error('Only club admins and designated scorers can score this tournament')
  }
  const tournament = (db.clubTournaments ?? []).find((t) => t.id === tournamentId && t.club_id === club.id)
  if (!tournament) throw new Error('Tournament not found')
  return { club, tournament }
}

function roundLabel(format: TournamentFormat, round: number, totalRounds: number, matchOrder: number): string {
  if (format === 'random_queue') return `Game ${matchOrder}`
  if (round >= totalRounds) return 'Finals'
  if (round === totalRounds - 1 && totalRounds >= 2) return 'Semifinals'
  if (round === totalRounds - 2 && totalRounds >= 3) return 'Quarterfinals'
  return `Round ${round}`
}

function shuffle<T>(items: readonly T[]): T[] {
  const copy = items.slice()
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

function buildSeedOrder(bracketSize: number): number[] {
  let order = [1, 2]
  while (order.length < bracketSize) {
    const nextSize = order.length * 2
    const next: number[] = []
    for (const seed of order) {
      next.push(seed, nextSize + 1 - seed)
    }
    order = next
  }
  return order
}

function teamDisplayName(db: DemoDB, clubId: string, playerIds: string[]): string {
  return playerIds
    .map((id) => {
      const p = toPlayerSummary(db, clubId, id)
      return p.nickname?.trim() ? p.nickname.trim() : p.full_name
    })
    .join(' / ')
    .slice(0, 160)
}

function computeStandings(db: DemoDB, tournament: DemoTournament): LeaderboardEntry[] {
  const players = (db.clubTournamentPlayers ?? [])
    .filter((row) => row.club_id === tournament.club_id && row.tournament_id === tournament.id)
  const completed = (db.clubTournamentMatches ?? [])
    .filter((m) => m.club_id === tournament.club_id && m.tournament_id === tournament.id && m.status === 'completed')
    .slice()
    .sort((a, b) =>
      (b.completed_at ?? b.created_at).localeCompare(a.completed_at ?? a.created_at)
      || b.match_order - a.match_order
      || b.id.localeCompare(a.id),
    )

  const stats = new Map<string, { wins: number; losses: number; diff: number; outcomes: boolean[] }>()
  for (const p of players) {
    stats.set(p.member_id, { wins: 0, losses: 0, diff: 0, outcomes: [] })
  }

  const record = (memberId: string, won: boolean, diff: number) => {
    const cur = stats.get(memberId) ?? { wins: 0, losses: 0, diff: 0, outcomes: [] }
    if (won) cur.wins += 1
    else cur.losses += 1
    cur.diff += diff
    cur.outcomes.push(won)
    stats.set(memberId, cur)
  }

  for (const m of completed) {
    const diffA = m.score_a != null && m.score_b != null ? m.score_a - m.score_b : 0
    for (const id of m.team_a_player_ids) record(id, m.winner_side === 'a', diffA)
    for (const id of m.team_b_player_ids) record(id, m.winner_side === 'b', -diffA)
  }

  const entries: LeaderboardEntry[] = []
  for (const [memberId, stat] of stats.entries()) {
    const summary = toPlayerSummary(db, tournament.club_id, memberId)
    const gamesPlayed = stat.wins + stat.losses
    let streak = 0
    if (stat.outcomes.length > 0) {
      const first = stat.outcomes[0]
      let len = 0
      for (const out of stat.outcomes) {
        if (out !== first) break
        len += 1
      }
      streak = first ? len : -len
    }
    entries.push({
      ...summary,
      rank: 0,
      points: stat.wins * 3 + stat.losses,
      wins: stat.wins,
      losses: stat.losses,
      games_played: gamesPlayed,
      win_pct: gamesPlayed === 0 ? 0 : Math.round((stat.wins * 100) / gamesPlayed),
      score_diff: stat.diff,
      streak,
    })
  }

  entries.sort((a, b) =>
    b.points - a.points
    || b.wins - a.wins
    || (b.wins / Math.max(b.games_played, 1)) - (a.wins / Math.max(a.games_played, 1))
    || b.score_diff - a.score_diff
    || b.games_played - a.games_played
    || a.full_name.toLowerCase().localeCompare(b.full_name.toLowerCase())
    || a.member_id.localeCompare(b.member_id),
  )
  entries.forEach((entry, index) => {
    entry.rank = index + 1
  })
  return entries
}

function buildSummary(db: DemoDB, tournament: DemoTournament): TournamentSummary {
  const venue = tournament.venue_id
    ? db.venues.find((v) => v.id === tournament.venue_id && v.club_id === tournament.club_id)
    : undefined
  const playerCount = (db.clubTournamentPlayers ?? []).filter(
    (row) => row.club_id === tournament.club_id && row.tournament_id === tournament.id,
  ).length
  const teams = (db.clubTournamentTeams ?? []).filter(
    (row) => row.club_id === tournament.club_id && row.tournament_id === tournament.id,
  )
  const matches = (db.clubTournamentMatches ?? []).filter(
    (m) => m.club_id === tournament.club_id && m.tournament_id === tournament.id,
  )

  let championLabel: string | null = null
  if (tournament.status === 'completed') {
    if (tournament.format === 'single_elimination') {
      const finals = matches.find((m) => !m.next_match_id && m.status === 'completed')
      if (finals) {
        const winTeamId = finals.winner_side === 'a' ? finals.team_a_id : finals.team_b_id
        championLabel = teams.find((t) => t.id === winTeamId)?.name ?? null
      }
    } else {
      const standings = computeStandings(db, tournament)
      if (standings[0] && standings[0].games_played > 0) {
        championLabel = standings[0].nickname?.trim() || standings[0].full_name
      }
    }
  }

  return {
    id: tournament.id,
    club_id: tournament.club_id,
    venue_id: tournament.venue_id,
    venue_name: venue?.name ?? null,
    title: tournament.title,
    format: tournament.format,
    team_size: tournament.team_size,
    status: tournament.status,
    counts_for_leaderboard: tournament.counts_for_leaderboard,
    scheduled_at: tournament.scheduled_at,
    notes: tournament.notes,
    started_at: tournament.started_at,
    completed_at: tournament.completed_at,
    created_at: tournament.created_at,
    player_count: playerCount,
    team_count: teams.length,
    active_matches: matches.filter((m) => m.status === 'ready' || m.status === 'playing').length,
    completed_matches: matches.filter((m) => m.status === 'completed').length,
    total_matches: matches.filter((m) => m.status !== 'bye' && m.status !== 'voided').length,
    champion_label: championLabel,
  }
}

function buildDetail(
  db: DemoDB,
  club: Club,
  tournament: DemoTournament,
  opts: { myMemberId: string | null; canScore: boolean; canManage: boolean; includeAdmin: boolean },
): TournamentDetail {
  const playersRows = (db.clubTournamentPlayers ?? [])
    .filter((row) => row.club_id === club.id && row.tournament_id === tournament.id)
    .slice()
    .sort((a, b) => a.seed_order - b.seed_order || a.member_id.localeCompare(b.member_id))

  const players = playersRows.map((row) => toPlayerSummary(db, club.id, row.member_id))

  const teamRows = (db.clubTournamentTeams ?? [])
    .filter((row) => row.club_id === club.id && row.tournament_id === tournament.id)
    .slice()
    .sort((a, b) => a.seed - b.seed)

  const teamById = new Map(teamRows.map((t) => [t.id, t]))

  const teams: TournamentTeam[] = teamRows.map((t) => ({
    id: t.id,
    seed: t.seed,
    name: t.name,
    players: [t.player_1_id, t.player_2_id]
      .filter((id): id is string => Boolean(id))
      .map((id) => toPlayerSummary(db, club.id, id)),
  }))

  const visibleMatches = (db.clubTournamentMatches ?? [])
    .filter((m) => m.club_id === club.id && m.tournament_id === tournament.id && m.status !== 'voided')
    .slice()
    .sort((a, b) => a.round_number - b.round_number || a.match_order - b.match_order)

  const totalRounds = Math.max(1, ...visibleMatches.map((m) => m.round_number))

  const matches: TournamentMatch[] = visibleMatches.map((m) => {
    const teamA = m.team_a_id ? teamById.get(m.team_a_id) : undefined
    const teamB = m.team_b_id ? teamById.get(m.team_b_id) : undefined
    const court = m.court_id ? db.courts.find((c) => c.id === m.court_id && c.club_id === club.id) : undefined
    return {
      id: m.id,
      tournament_id: m.tournament_id,
      round_number: m.round_number,
      match_order: m.match_order,
      round_label: roundLabel(tournament.format, m.round_number, totalRounds, m.match_order),
      court_id: m.court_id,
      court_name: court?.name ?? null,
      team_a_id: m.team_a_id,
      team_b_id: m.team_b_id,
      team_a_name: teamA?.name ?? null,
      team_b_name: teamB?.name ?? null,
      team_a_seed: teamA?.seed ?? null,
      team_b_seed: teamB?.seed ?? null,
      team_a_players: m.team_a_player_ids.map((id) => toPlayerSummary(db, club.id, id)),
      team_b_players: m.team_b_player_ids.map((id) => toPlayerSummary(db, club.id, id)),
      status: m.status,
      winner_side: m.winner_side,
      score_a: m.score_a,
      score_b: m.score_b,
      next_match_id: m.next_match_id,
      next_match_side: m.next_match_side,
      club_match_id: m.club_match_id,
      completed_at: m.completed_at,
      created_at: m.created_at,
    }
  })

  let scorers: TournamentScorerStaff[] = []
  if (opts.includeAdmin) {
    const clubScorers = new Set(
      (db.leaderboardScorers ?? []).filter((s) => s.club_id === club.id).map((s) => s.user_id),
    )
    const tourScorers = new Set(
      (db.clubTournamentScorers ?? [])
        .filter((s) => s.club_id === club.id && s.tournament_id === tournament.id)
        .map((s) => s.user_id),
    )
    scorers = db.clubRoles
      .filter((r) => r.club_id === club.id && r.role === 'staff' && r.is_active)
      .map((r) => {
        const prof = db.profiles.find((p) => p.id === r.user_id)
        const isClubScorer = clubScorers.has(r.user_id)
        return {
          user_id: r.user_id,
          full_name: prof?.full_name ?? 'Staff',
          email: prof?.email ?? '',
          is_club_scorer: isClubScorer,
          can_score: isClubScorer || tourScorers.has(r.user_id),
        }
      })
      .sort((a, b) => a.full_name.toLowerCase().localeCompare(b.full_name.toLowerCase()) || a.user_id.localeCompare(b.user_id))
  }

  return {
    club: { id: club.id, slug: club.slug, name: club.name },
    tournament: buildSummary(db, tournament),
    players,
    teams,
    matches,
    standings: computeStandings(db, tournament),
    scorers,
    my_member_id: opts.myMemberId,
    can_score: opts.canScore,
    can_manage: opts.canManage,
  }
}

function buildBracketDrawInDb(db: DemoDB, tournament: DemoTournament) {
  if (tournament.format !== 'single_elimination') {
    throw new Error('Bracket draws apply only to single-elimination tournaments')
  }
  if (tournament.status !== 'setup') {
    throw new Error('Teams can only be randomized before the tournament starts')
  }
  const clubId = tournament.club_id
  const registered = (db.clubTournamentPlayers ?? []).filter(
    (p) => p.club_id === clubId && p.tournament_id === tournament.id,
  )
  const shuffledPlayers = shuffle(registered.map((p) => p.member_id))
  if (tournament.team_size === 1 && shuffledPlayers.length < 2) {
    throw new Error('Add at least 2 players to create a singles bracket')
  }
  if (tournament.team_size === 2 && (shuffledPlayers.length < 4 || shuffledPlayers.length % 2 !== 0)) {
    throw new Error('Doubles brackets need an even number of players (at least 4)')
  }
  const teamCount = shuffledPlayers.length / tournament.team_size
  if (teamCount > 32) {
    throw new Error('Brackets support up to 32 teams')
  }

  db.clubTournamentMatches = (db.clubTournamentMatches ?? []).filter(
    (m) => !(m.club_id === clubId && m.tournament_id === tournament.id),
  )
  db.clubTournamentTeams = (db.clubTournamentTeams ?? []).filter(
    (t) => !(t.club_id === clubId && t.tournament_id === tournament.id),
  )

  const createdAt = todayISO()
  const teams: DemoTournamentTeam[] = []
  for (let i = 0; i < teamCount; i++) {
    const p1 = shuffledPlayers[i * tournament.team_size]
    const p2 = tournament.team_size === 2 ? shuffledPlayers[i * 2 + 1] : null
    const playerIds = p2 ? [p1, p2] : [p1]
    teams.push({
      id: uid('tteam'),
      club_id: clubId,
      tournament_id: tournament.id,
      seed: i + 1,
      name: teamDisplayName(db, clubId, playerIds),
      player_1_id: p1,
      player_2_id: p2,
      created_at: createdAt,
    })
  }
  db.clubTournamentTeams.push(...teams)

  let bracketSize = 2
  let totalRounds = 1
  while (bracketSize < teamCount) {
    bracketSize *= 2
    totalRounds += 1
  }
  const seedOrder = buildSeedOrder(bracketSize)

  const newMatches: DemoTournamentMatch[] = []
  let nextRoundIds: string[] = []
  const byId = new Map<string, DemoTournamentMatch>()

  for (let round = totalRounds; round >= 1; round--) {
    const matchCount = 2 ** (totalRounds - round)
    const currentRoundIds: string[] = []

    for (let m = 1; m <= matchCount; m++) {
      const nextMatchId = round === totalRounds ? null : nextRoundIds[Math.floor((m - 1) / 2)]
      const nextSide = round === totalRounds ? null : m % 2 === 1 ? 'a' : 'b'
      const matchId = uid('tmatch')

      if (round === 1) {
        const seedA = seedOrder[(m - 1) * 2]
        const seedB = seedOrder[(m - 1) * 2 + 1]
        const teamA = teams[seedA - 1]
        const teamAPlayers = teamA.player_2_id ? [teamA.player_1_id, teamA.player_2_id] : [teamA.player_1_id]
        const teamB = seedB <= teamCount ? teams[seedB - 1] : undefined

        if (teamB) {
          const teamBPlayers = teamB.player_2_id ? [teamB.player_1_id, teamB.player_2_id] : [teamB.player_1_id]
          const row: DemoTournamentMatch = {
            id: matchId,
            club_id: clubId,
            tournament_id: tournament.id,
            round_number: round,
            match_order: m,
            court_id: null,
            team_a_id: teamA.id,
            team_b_id: teamB.id,
            team_a_player_ids: teamAPlayers,
            team_b_player_ids: teamBPlayers,
            status: 'ready',
            winner_side: null,
            score_a: null,
            score_b: null,
            next_match_id: nextMatchId,
            next_match_side: nextSide,
            club_match_id: null,
            recorded_by: null,
            completed_at: null,
            created_at: createdAt,
          }
          newMatches.push(row)
          byId.set(matchId, row)
        } else {
          const row: DemoTournamentMatch = {
            id: matchId,
            club_id: clubId,
            tournament_id: tournament.id,
            round_number: round,
            match_order: m,
            court_id: null,
            team_a_id: teamA.id,
            team_b_id: null,
            team_a_player_ids: teamAPlayers,
            team_b_player_ids: [],
            status: 'bye',
            winner_side: 'a',
            score_a: null,
            score_b: null,
            next_match_id: nextMatchId,
            next_match_side: nextSide,
            club_match_id: null,
            recorded_by: null,
            completed_at: createdAt,
            created_at: createdAt,
          }
          newMatches.push(row)
          byId.set(matchId, row)
          if (nextMatchId) {
            const target = byId.get(nextMatchId)
            if (target) {
              if (nextSide === 'a') {
                target.team_a_id = teamA.id
                target.team_a_player_ids = [...teamAPlayers]
              } else {
                target.team_b_id = teamA.id
                target.team_b_player_ids = [...teamAPlayers]
              }
            }
          }
        }
      } else {
        const row: DemoTournamentMatch = {
          id: matchId,
          club_id: clubId,
          tournament_id: tournament.id,
          round_number: round,
          match_order: m,
          court_id: null,
          team_a_id: null,
          team_b_id: null,
          team_a_player_ids: [],
          team_b_player_ids: [],
          status: 'pending',
          winner_side: null,
          score_a: null,
          score_b: null,
          next_match_id: nextMatchId,
          next_match_side: nextSide,
          club_match_id: null,
          recorded_by: null,
          completed_at: null,
          created_at: createdAt,
        }
        newMatches.push(row)
        byId.set(matchId, row)
      }

      currentRoundIds.push(matchId)
    }

    nextRoundIds = currentRoundIds
  }

  for (const row of newMatches) {
    if (row.status === 'pending' && row.team_a_id && row.team_b_id) {
      row.status = 'ready'
    }
  }
  db.clubTournamentMatches.push(...newMatches)
}

function samePartnerCount(matches: DemoTournamentMatch[], p1: string, p2: string): number {
  let count = 0
  for (const m of matches) {
    if (m.status === 'voided') continue
    if (m.team_a_player_ids.includes(p1) && m.team_a_player_ids.includes(p2)) count += 1
    if (m.team_b_player_ids.includes(p1) && m.team_b_player_ids.includes(p2)) count += 1
  }
  return count
}

function drawNextQueueMatchInDb(db: DemoDB, tournament: DemoTournament, requestedCourtId: string | null) {
  if (tournament.format !== 'random_queue') {
    throw new Error('Random match draws are only available for queue mixer tournaments')
  }
  if (tournament.status !== 'live') {
    throw new Error('Start the tournament before drawing queue matches')
  }
  const clubId = tournament.club_id
  const allMatches = (db.clubTournamentMatches ?? []).filter(
    (m) => m.club_id === clubId && m.tournament_id === tournament.id,
  )
  if (allMatches.length >= 300) {
    throw new Error('This tournament has reached its limit of 300 matches')
  }

  let courtId = requestedCourtId
  if (courtId) {
    const court = db.courts.find((c) => c.id === courtId && c.club_id === clubId)
    if (!court) throw new Error('Court not found in this club')
    if (tournament.venue_id && court.venue_id !== tournament.venue_id) {
      throw new Error('Court belongs to another venue')
    }
    assertCourtCanTake(db, clubId, courtId, null, 'ready')
  } else {
    const busyCourts = new Set(
      (db.clubTournamentMatches ?? [])
        .filter((m) => m.club_id === clubId && (m.status === 'ready' || m.status === 'playing') && m.court_id)
        .map((m) => m.court_id!),
    )
    const freeCourt = db.courts
      .filter(
        (c) =>
          c.club_id === clubId
          && c.status !== 'maintenance'
          && (!tournament.venue_id || c.venue_id === tournament.venue_id)
          && !busyCourts.has(c.id),
      )
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))[0]
    courtId = freeCourt?.id ?? null
  }

  const activePlayers = new Set<string>()
  const completedCount = new Map<string, number>()
  for (const m of allMatches) {
    if (m.status === 'ready' || m.status === 'playing') {
      for (const id of m.team_a_player_ids) activePlayers.add(id)
      for (const id of m.team_b_player_ids) activePlayers.add(id)
    } else if (m.status === 'completed') {
      for (const id of [...m.team_a_player_ids, ...m.team_b_player_ids]) {
        completedCount.set(id, (completedCount.get(id) ?? 0) + 1)
      }
    }
  }

  const freePlayers = (db.clubTournamentPlayers ?? [])
    .filter((tp) => tp.club_id === clubId && tp.tournament_id === tournament.id && !activePlayers.has(tp.member_id))
    .map((tp) => ({
      memberId: tp.member_id,
      games: completedCount.get(tp.member_id) ?? 0,
      tie: Math.random(),
    }))
    .sort((a, b) => a.games - b.games || a.tie - b.tie)

  const needed = tournament.team_size * 2
  if (freePlayers.length < needed) {
    throw new Error('Not enough free players for another match right now. Finish a current game or add more players.')
  }
  const picked = freePlayers.slice(0, needed).map((p) => p.memberId)

  let teamA: string[]
  let teamB: string[]
  if (tournament.team_size === 1) {
    teamA = [picked[0]]
    teamB = [picked[1]]
  } else {
    const options: Array<{ a: string[]; b: string[]; repeats: number; tie: number }> = [
      {
        a: [picked[0], picked[1]],
        b: [picked[2], picked[3]],
        repeats: samePartnerCount(allMatches, picked[0], picked[1]) + samePartnerCount(allMatches, picked[2], picked[3]),
        tie: Math.random(),
      },
      {
        a: [picked[0], picked[2]],
        b: [picked[1], picked[3]],
        repeats: samePartnerCount(allMatches, picked[0], picked[2]) + samePartnerCount(allMatches, picked[1], picked[3]),
        tie: Math.random(),
      },
      {
        a: [picked[0], picked[3]],
        b: [picked[1], picked[2]],
        repeats: samePartnerCount(allMatches, picked[0], picked[3]) + samePartnerCount(allMatches, picked[1], picked[2]),
        tie: Math.random(),
      },
    ].sort((x, y) => x.repeats - y.repeats || x.tie - y.tie)
    teamA = options[0].a
    teamB = options[0].b
  }

  const nextOrder = allMatches.reduce((max, m) => Math.max(max, m.match_order), 0) + 1
  db.clubTournamentMatches = db.clubTournamentMatches ?? []
  db.clubTournamentMatches.push({
    id: uid('tmatch'),
    club_id: clubId,
    tournament_id: tournament.id,
    round_number: 1,
    match_order: nextOrder,
    court_id: courtId,
    team_a_id: null,
    team_b_id: null,
    team_a_player_ids: teamA,
    team_b_player_ids: teamB,
    status: 'ready',
    winner_side: null,
    score_a: null,
    score_b: null,
    next_match_id: null,
    next_match_side: null,
    club_match_id: null,
    recorded_by: null,
    completed_at: null,
    created_at: todayISO(),
  })
}

function validateClubPlayers(db: DemoDB, clubId: string, playerIds: string[]): string[] {
  const clean = playerIds.filter(Boolean)
  if (new Set(clean).size !== clean.length) {
    throw new Error('Each player can only be added once')
  }
  if (clean.length > 64) {
    throw new Error('A tournament can have at most 64 players')
  }
  const clubMemberIds = new Set(db.members.filter((m) => m.club_id === clubId).map((m) => m.id))
  if (clean.some((id) => !clubMemberIds.has(id))) {
    throw new Error('Every player must belong to this club')
  }
  return clean
}

/** Same rule as the court trigger: no court out of service, and no two ready or playing matches on one court. */
function assertCourtCanTake(
  db: DemoDB,
  clubId: string,
  courtId: string,
  matchId: string | null,
  matchStatus: DemoTournamentMatch['status'],
) {
  const court = db.courts.find((c) => c.id === courtId && c.club_id === clubId)
  if (court?.status === 'maintenance') throw new Error('That court is out of service')
  const active = (status: DemoTournamentMatch['status']) => status === 'ready' || status === 'playing'
  if (
    active(matchStatus)
    && (db.clubTournamentMatches ?? []).some(
      (m) => m.club_id === clubId && m.court_id === courtId && m.id !== matchId && active(m.status),
    )
  ) {
    throw new Error('That court already has a match on it')
  }
}

function buildAuthenticatedDetail(db: DemoDB, club: Club, tournament: DemoTournament): TournamentDetail {
  const userId = db.sessionUserId!
  const role = clubRoleFor(db, userId, club.id)
  const myMember = db.members.find((m) => m.club_id === club.id && m.user_id === userId)
  return buildDetail(db, club, tournament, {
    myMemberId: myMember?.id ?? null,
    canScore: canScoreTournament(db, club.id, userId, tournament.id),
    canManage: role === 'admin',
    includeAdmin: role === 'admin',
  })
}

export const tournamentOperations = {
  /** Every active club's tournaments (not cancelled), each with its club, like list_public_tournaments. */
  listPublicTournaments(status: PublicTournamentFilter = null, limit = 30): PublicTournamentSummary[] {
    const db = load()
    const wanted = status ? String(status).trim().toLowerCase() : null
    if (wanted && !['live', 'setup', 'completed'].includes(wanted)) {
      throw Object.assign(new Error('Unknown tournament status'), { code: '22023' })
    }
    const max = clampLimit(limit, 30, 60)
    return (db.clubTournaments ?? [])
      .filter((t) => t.status !== 'cancelled' && (!wanted || t.status === wanted))
      .map((t) => {
        const club = db.clubs.find((c) => c.id === t.club_id)
        const open = club ? activePublicClubBySlug(db, club.slug) : undefined
        return open ? { tournament: t, club: open } : null
      })
      .filter((row): row is { tournament: DemoTournament, club: Club } => row !== null)
      .sort((a, b) =>
        STATUS_ORDER[a.tournament.status] - STATUS_ORDER[b.tournament.status]
        || b.tournament.created_at.localeCompare(a.tournament.created_at)
        || b.tournament.id.localeCompare(a.tournament.id),
      )
      .slice(0, max)
      .map(({ tournament, club }) => ({
        ...buildSummary(db, tournament),
        club: {
          slug: club.slug,
          name: club.name,
          city: db.clubAccounts.find((row) => row.club_id === club.id)?.city ?? null,
        },
      }))
  },

  listPublicClubTournaments(slug: string, limit = 20): TournamentSummary[] | null {
    const db = load()
    const club = activePublicClubBySlug(db, slug)
    if (!club) return null
    const max = clampLimit(limit, 20, 50)
    return (db.clubTournaments ?? [])
      .filter((t) => t.club_id === club.id && t.status !== 'cancelled')
      .slice()
      .sort((a, b) =>
        STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
        || b.created_at.localeCompare(a.created_at)
        || b.id.localeCompare(a.id),
      )
      .slice(0, max)
      .map((t) => buildSummary(db, t))
  },

  publicTournament(slug: string, tournamentId: string): TournamentDetail | null {
    const db = load()
    const club = activePublicClubBySlug(db, slug)
    if (!club || !tournamentId) return null
    const tournament = (db.clubTournaments ?? []).find(
      (t) => t.id === tournamentId && t.club_id === club.id && t.status !== 'cancelled',
    )
    if (!tournament) return null
    return buildDetail(db, club, tournament, {
      myMemberId: null,
      canScore: false,
      canManage: false,
      includeAdmin: false,
    })
  },

  listClubTournaments(limit = 50): TournamentSummary[] {
    const db = load()
    const club = activeClub(db)
    if (!db.sessionUserId || !club) throw new Error('Sign in to view club tournaments')
    const role = clubRoleFor(db, db.sessionUserId, club.id)
    if (!role) throw new Error('You do not belong to this club')
    const max = clampLimit(limit, 50, 100)
    return (db.clubTournaments ?? [])
      .filter((t) => t.club_id === club.id && (role === 'admin' || t.status !== 'cancelled'))
      .slice()
      .sort((a, b) =>
        STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
        || b.created_at.localeCompare(a.created_at)
        || b.id.localeCompare(a.id),
      )
      .slice(0, max)
      .map((t) => buildSummary(db, t))
  },

  clubTournament(tournamentId: string): TournamentDetail {
    const db = load()
    const club = activeClub(db)
    if (!db.sessionUserId || !club) throw new Error('Sign in to view tournament details')
    const role = clubRoleFor(db, db.sessionUserId, club.id)
    if (!role) throw new Error('You do not belong to this club')
    const tournament = (db.clubTournaments ?? []).find((t) => t.id === tournamentId && t.club_id === club.id)
    if (!tournament) throw new Error('Tournament not found')
    return buildAuthenticatedDetail(db, club, tournament)
  },

  createTournament(input: CreateTournamentInput): TournamentDetail {
    const db = load()
    const club = requireClubAdmin(db)
    const title = tidyText(input.title)
    if (!title || title.length > 120) {
      throw new Error('Enter a tournament title (up to 120 characters)')
    }
    if (input.format !== 'single_elimination' && input.format !== 'random_queue') {
      throw new Error('Choose bracket or random queue format')
    }
    if (input.team_size !== 1 && input.team_size !== 2) {
      throw new Error('Choose singles or doubles')
    }
    const notes = tidyText(input.notes) || null
    if (notes && notes.length > 240) throw new Error('Notes are limited to 240 characters')
    const venueId = input.venue_id ?? null
    if (venueId && !db.venues.some((v) => v.id === venueId && v.club_id === club.id)) {
      throw new Error('Venue not found in this club')
    }
    const playerIds = validateClubPlayers(db, club.id, input.player_ids ?? [])

    const now = todayISO()
    const tournament: DemoTournament = {
      id: uid('tour'),
      club_id: club.id,
      venue_id: venueId,
      title,
      format: input.format,
      team_size: input.team_size,
      status: 'setup',
      counts_for_leaderboard: input.counts_for_leaderboard ?? true,
      scheduled_at: input.scheduled_at ?? null,
      notes,
      created_by: db.sessionUserId,
      started_at: null,
      completed_at: null,
      created_at: now,
    }
    db.clubTournaments = [tournament, ...(db.clubTournaments ?? [])]
    db.clubTournamentPlayers = db.clubTournamentPlayers ?? []
    playerIds.forEach((memberId, index) => {
      db.clubTournamentPlayers!.push({
        club_id: club.id,
        tournament_id: tournament.id,
        member_id: memberId,
        seed_order: index + 1,
        created_at: now,
      })
    })
    save(db)
    return buildAuthenticatedDetail(db, club, tournament)
  },

  setTournamentPlayers(tournamentId: string, playerIds: string[]): TournamentDetail {
    const db = load()
    const club = requireClubAdmin(db)
    const tournament = (db.clubTournaments ?? []).find((t) => t.id === tournamentId && t.club_id === club.id)
    if (!tournament) throw new Error('Tournament not found')
    if (tournament.status === 'completed' || tournament.status === 'cancelled') {
      throw new Error('Finished or cancelled tournaments cannot be edited')
    }
    if (tournament.status === 'live' && tournament.format !== 'random_queue') {
      throw new Error('Bracket rosters cannot change after the tournament starts')
    }

    const clean = validateClubPlayers(db, club.id, playerIds)
    db.clubTournamentPlayers = db.clubTournamentPlayers ?? []
    const existing = db.clubTournamentPlayers.filter(
      (p) => p.club_id === club.id && p.tournament_id === tournament.id,
    )

    if (tournament.status === 'live') {
      const nextSet = new Set(clean)
      if (existing.some((p) => !nextSet.has(p.member_id))) {
        throw new Error('Players cannot be removed after the tournament starts')
      }
      const existingSet = new Set(existing.map((p) => p.member_id))
      let maxSeed = existing.reduce((max, p) => Math.max(max, p.seed_order), 0)
      const added: DemoTournamentPlayer[] = []
      for (const memberId of clean) {
        if (!existingSet.has(memberId)) {
          maxSeed += 1
          added.push({
            club_id: club.id,
            tournament_id: tournament.id,
            member_id: memberId,
            seed_order: maxSeed,
            created_at: todayISO(),
          })
        }
      }
      db.clubTournamentPlayers.push(...added)
    } else {
      db.clubTournamentMatches = (db.clubTournamentMatches ?? []).filter(
        (m) => !(m.club_id === club.id && m.tournament_id === tournament.id),
      )
      db.clubTournamentTeams = (db.clubTournamentTeams ?? []).filter(
        (t) => !(t.club_id === club.id && t.tournament_id === tournament.id),
      )
      db.clubTournamentPlayers = db.clubTournamentPlayers.filter(
        (p) => !(p.club_id === club.id && p.tournament_id === tournament.id),
      )
      const now = todayISO()
      clean.forEach((memberId, index) => {
        db.clubTournamentPlayers!.push({
          club_id: club.id,
          tournament_id: tournament.id,
          member_id: memberId,
          seed_order: index + 1,
          created_at: now,
        })
      })
    }

    save(db)
    return buildAuthenticatedDetail(db, club, tournament)
  },

  generateTournamentDraw(tournamentId: string): TournamentDetail {
    const db = load()
    const club = requireClubAdmin(db)
    const tournament = (db.clubTournaments ?? []).find((t) => t.id === tournamentId && t.club_id === club.id)
    if (!tournament) throw new Error('Tournament not found')
    buildBracketDrawInDb(db, tournament)
    save(db)
    return buildAuthenticatedDetail(db, club, tournament)
  },

  startTournament(tournamentId: string): TournamentDetail {
    const db = load()
    const club = requireClubAdmin(db)
    const tournament = (db.clubTournaments ?? []).find((t) => t.id === tournamentId && t.club_id === club.id)
    if (!tournament) throw new Error('Tournament not found')
    if (tournament.status !== 'setup') throw new Error('Tournament has already started or ended')

    if (tournament.format === 'single_elimination') {
      const hasTeams = (db.clubTournamentTeams ?? []).some(
        (t) => t.club_id === club.id && t.tournament_id === tournament.id,
      )
      if (!hasTeams) buildBracketDrawInDb(db, tournament)
      tournament.status = 'live'
      tournament.started_at = todayISO()
    } else {
      const count = (db.clubTournamentPlayers ?? []).filter(
        (p) => p.club_id === club.id && p.tournament_id === tournament.id,
      ).length
      if (count < tournament.team_size * 2) {
        throw new Error(`Add at least ${tournament.team_size * 2} players to start this queue mixer`)
      }
      tournament.status = 'live'
      tournament.started_at = todayISO()
      drawNextQueueMatchInDb(db, tournament, null)
    }

    save(db)
    return buildAuthenticatedDetail(db, club, tournament)
  },

  setTournamentScorer(tournamentId: string, userId: string, canScore: boolean): void {
    const db = load()
    const club = requireClubAdmin(db)
    const tournament = (db.clubTournaments ?? []).find((t) => t.id === tournamentId && t.club_id === club.id)
    if (!tournament) throw new Error('Tournament not found')
    const isStaff = db.clubRoles.some(
      (r) => r.club_id === club.id && r.user_id === userId && r.role === 'staff' && r.is_active,
    )
    if (!isStaff) throw new Error('Active staff member not found in this club')

    const current = db.clubTournamentScorers ?? []
    if (canScore) {
      if (!current.some((r) => r.club_id === club.id && r.tournament_id === tournamentId && r.user_id === userId)) {
        db.clubTournamentScorers = [
          ...current,
          { club_id: club.id, tournament_id: tournamentId, user_id: userId, granted_by: db.sessionUserId, created_at: todayISO() },
        ]
      }
    } else {
      db.clubTournamentScorers = current.filter(
        (r) => !(r.club_id === club.id && r.tournament_id === tournamentId && r.user_id === userId),
      )
    }
    save(db)
  },

  completeTournament(tournamentId: string): TournamentDetail {
    const db = load()
    const club = requireClubAdmin(db)
    const tournament = (db.clubTournaments ?? []).find((t) => t.id === tournamentId && t.club_id === club.id)
    if (!tournament) throw new Error('Tournament not found')
    if (tournament.status !== 'live') throw new Error('Only live tournaments can be marked finished')
    const hasActive = (db.clubTournamentMatches ?? []).some(
      (m) => m.club_id === club.id && m.tournament_id === tournament.id && (m.status === 'ready' || m.status === 'playing'),
    )
    if (hasActive) {
      throw new Error('Finish or cancel active court matches before ending the tournament')
    }
    tournament.status = 'completed'
    tournament.completed_at = todayISO()
    save(db)
    return buildAuthenticatedDetail(db, club, tournament)
  },

  cancelTournament(tournamentId: string): TournamentDetail {
    const db = load()
    const club = requireClubAdmin(db)
    const tournament = (db.clubTournaments ?? []).find((t) => t.id === tournamentId && t.club_id === club.id)
    if (!tournament) throw new Error('Tournament not found')
    if (tournament.status === 'completed' || tournament.status === 'cancelled') {
      throw new Error('Tournament has already ended')
    }
    tournament.status = 'cancelled'
    tournament.completed_at = todayISO()
    save(db)
    return buildAuthenticatedDetail(db, club, tournament)
  },

  drawTournamentQueueMatch(tournamentId: string, courtId?: string | null): TournamentDetail {
    const db = load()
    const { club, tournament } = requireTournamentScorer(db, tournamentId)
    drawNextQueueMatchInDb(db, tournament, courtId ?? null)
    save(db)
    return buildAuthenticatedDetail(db, club, tournament)
  },

  /** Undo a finished result, in any tournament (staff_void_tournament_match). */
  voidTournamentMatch(tournamentId: string, matchId: string, reason?: string): TournamentDetail {
    const db = load()
    const { club, tournament } = requireTournamentScorer(db, tournamentId)
    const cleanReason = tidyText(reason) || null
    if (cleanReason && cleanReason.length > 200) throw new Error('Reason is limited to 200 characters')
    if (tournament.status !== 'live' && tournament.status !== 'completed') {
      throw new Error('Results can only be undone in a running or finished tournament')
    }
    const match = (db.clubTournamentMatches ?? []).find(
      (m) => m.id === matchId && m.tournament_id === tournamentId && m.club_id === club.id,
    )
    if (!match) throw new Error('Tournament match not found')
    if (match.status !== 'completed') throw new Error('Only a finished match can be undone')

    // Counts for the leaderboard: the leaderboard void also resets the bracket or queue.
    if (match.club_match_id) {
      leaderboardOperations.voidClubMatch(match.club_match_id, cleanReason ?? undefined)
      const fresh = load()
      const updated = (fresh.clubTournaments ?? []).find((t) => t.id === tournamentId && t.club_id === club.id)!
      return buildAuthenticatedDetail(fresh, club, updated)
    }

    if (tournament.format === 'single_elimination') {
      if (match.next_match_id) {
        const nextMatch = (db.clubTournamentMatches ?? []).find(
          (m) => m.id === match.next_match_id && m.club_id === club.id,
        )
        if (nextMatch) {
          if (nextMatch.status === 'completed') {
            throw new Error('Cannot void a bracket match after the next round has been played')
          }
          if (match.next_match_side === 'a') {
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
      match.status = 'ready'
      match.winner_side = null
      match.score_a = null
      match.score_b = null
      match.club_match_id = null
      match.completed_at = null
    } else {
      match.status = 'voided'
      match.club_match_id = null
    }
    save(db)
    return buildAuthenticatedDetail(db, club, tournament)
  },

  assignTournamentMatchCourt(tournamentId: string, matchId: string, courtId?: string | null): TournamentDetail {
    const db = load()
    const { club, tournament } = requireTournamentScorer(db, tournamentId)
    const nextCourtId = courtId ?? null
    if (nextCourtId) {
      const court = db.courts.find((c) => c.id === nextCourtId && c.club_id === club.id)
      if (!court) throw new Error('Court not found in this club')
      if (tournament.venue_id && court.venue_id !== tournament.venue_id) {
        throw new Error('Court belongs to another venue')
      }
    }
    const match = (db.clubTournamentMatches ?? []).find(
      (m) =>
        m.id === matchId
        && m.tournament_id === tournamentId
        && m.club_id === club.id
        && (m.status === 'pending' || m.status === 'ready' || m.status === 'playing'),
    )
    if (!match) throw new Error('Tournament match not found')
    if (nextCourtId && nextCourtId !== match.court_id) {
      assertCourtCanTake(db, club.id, nextCourtId, match.id, match.status)
    }
    match.court_id = nextCourtId
    save(db)
    return buildAuthenticatedDetail(db, club, tournament)
  },

  cancelTournamentQueueMatch(tournamentId: string, matchId: string): TournamentDetail {
    const db = load()
    const { club, tournament } = requireTournamentScorer(db, tournamentId)
    if (tournament.format !== 'random_queue') {
      throw new Error('Only queued mixer matches can be cancelled')
    }
    const match = (db.clubTournamentMatches ?? []).find(
      (m) =>
        m.id === matchId
        && m.tournament_id === tournamentId
        && m.club_id === club.id
        && (m.status === 'ready' || m.status === 'playing'),
    )
    if (!match) throw new Error('Active queue match not found')
    match.status = 'voided'
    save(db)
    return buildAuthenticatedDetail(db, club, tournament)
  },

  scoreTournamentMatch(input: ScoreTournamentMatchInput): TournamentDetail {
    const db = load()
    const { club, tournament } = requireTournamentScorer(db, input.tournament_id)
    if (input.winner_side !== 'a' && input.winner_side !== 'b') {
      throw new Error('Choose which team won')
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
    if (tournament.status !== 'live') {
      throw new Error('Start the tournament before scoring matches')
    }

    const match = (db.clubTournamentMatches ?? []).find(
      (m) => m.id === input.match_id && m.tournament_id === tournament.id && m.club_id === club.id,
    )
    if (!match) throw new Error('Tournament match not found')
    if (match.status !== 'ready' && match.status !== 'playing') {
      throw new Error('This match is not ready to be scored')
    }
    if (match.team_a_player_ids.length !== tournament.team_size || match.team_b_player_ids.length !== tournament.team_size) {
      throw new Error('Both teams must be set before scoring')
    }

    const courtId = input.court_id === undefined ? match.court_id : input.court_id
    let courtVenueId: string | null = tournament.venue_id
    if (courtId) {
      const court = db.courts.find((c) => c.id === courtId && c.club_id === club.id)
      if (!court) throw new Error('Court not found in this club')
      if (tournament.venue_id && court.venue_id !== tournament.venue_id) {
        throw new Error('Court belongs to another venue')
      }
      courtVenueId = court.venue_id ?? tournament.venue_id
    }

    const totalRounds = Math.max(
      1,
      ...(db.clubTournamentMatches ?? [])
        .filter((m) => m.club_id === club.id && m.tournament_id === tournament.id)
        .map((m) => m.round_number),
    )

    const now = todayISO()
    let clubMatchId: string | null = null
    if (tournament.counts_for_leaderboard) {
      const clubMatch: DemoClubMatch = {
        id: uid('match'),
        club_id: club.id,
        venue_id: courtVenueId,
        court_id: courtId,
        tournament_id: tournament.id,
        format: tournament.team_size === 1 ? 'singles' : 'doubles',
        team_a_ids: [...match.team_a_player_ids],
        team_b_ids: [...match.team_b_player_ids],
        winner_side: input.winner_side,
        score_a: scoreA,
        score_b: scoreB,
        notes: `${tournament.title} · ${roundLabel(tournament.format, match.round_number, totalRounds, match.match_order)}`.slice(0, 200),
        status: 'completed',
        recorded_by: db.sessionUserId,
        voided_by: null,
        voided_at: null,
        void_reason: null,
        played_at: now,
        created_at: now,
      }
      db.clubMatches = [clubMatch, ...(db.clubMatches ?? [])]
      clubMatchId = clubMatch.id
    }

    match.status = 'completed'
    match.winner_side = input.winner_side
    match.score_a = scoreA
    match.score_b = scoreB
    match.court_id = courtId
    match.club_match_id = clubMatchId
    match.recorded_by = db.sessionUserId
    match.completed_at = now

    if (tournament.format === 'single_elimination') {
      const winTeamId = input.winner_side === 'a' ? match.team_a_id : match.team_b_id
      const winPlayers = input.winner_side === 'a' ? [...match.team_a_player_ids] : [...match.team_b_player_ids]
      if (match.next_match_id) {
        const nextMatch = (db.clubTournamentMatches ?? []).find(
          (nm) => nm.id === match.next_match_id && nm.club_id === club.id,
        )
        if (nextMatch) {
          if (match.next_match_side === 'a') {
            nextMatch.team_a_id = winTeamId
            nextMatch.team_a_player_ids = winPlayers
          } else {
            nextMatch.team_b_id = winTeamId
            nextMatch.team_b_player_ids = winPlayers
          }
          if (nextMatch.team_a_id && nextMatch.team_b_id) {
            nextMatch.status = 'ready'
          }
        }
      } else {
        tournament.status = 'completed'
        tournament.completed_at = now
      }
    }

    save(db)
    return buildAuthenticatedDetail(db, club, tournament)
  },
}
