import { beforeEach, describe, expect, it } from 'vitest'
import { setActiveClubId } from '../clubContext'
import { demoStore } from '../demoStore'
import { load, save } from './persistence'
import { DEMO_CLUB_ID, DEMO_DAVAO_CLUB_ID, DEMO_VENUE_ID } from '../tenant'

describe('tournaments demo operations (Phase 2)', () => {
  beforeEach(() => {
    demoStore.reset()
    setActiveClubId(null)
  })

  it('exposes seeded live bracket & queue tournaments without private member fields', () => {
    const publicList = demoStore.listPublicClubTournaments('rally-point-gensan', 20)
    expect(publicList).not.toBeNull()
    expect(publicList!).toHaveLength(2)
    expect(publicList![0]).toMatchObject({
      id: 'tour_live_bracket',
      format: 'single_elimination',
      status: 'live',
      active_matches: 1,
      completed_matches: 1,
    })

    expect(demoStore.listPublicClubTournaments('missing-club')).toBeNull()
    expect(demoStore.publicTournament('missing-club', 'tour_live_bracket')).toBeNull()
    expect(demoStore.publicTournament('rally-point-gensan', 'missing-tournament')).toBeNull()

    const bracket = demoStore.publicTournament('rally-point-gensan', 'tour_live_bracket')!
    expect(bracket.can_score).toBe(false)
    expect(bracket.can_manage).toBe(false)
    expect(bracket.scorers).toEqual([])
    expect(bracket.teams).toHaveLength(4)
    expect(bracket.matches.find((m) => m.round_number === 2)?.round_label).toBe('Finals')

    for (const player of [...bracket.players, ...bracket.standings]) {
      const keys = Object.keys(player)
      for (const forbidden of ['email', 'phone', 'member_code', 'qr_token', 'user_id', 'notes']) {
        expect(keys).not.toContain(forbidden)
      }
    }

    const queue = demoStore.publicTournament('rally-point-gensan', 'tour_live_queue')!
    expect(queue.tournament.format).toBe('random_queue')
    expect(queue.matches.some((m) => m.round_label === 'Game 2' && m.status === 'ready')).toBe(true)
  })

  it('supports single-elimination creation, odd-doubles validation, 5-player BYE draw, reshuffle, scoring to champion, and safe voiding', () => {
    demoStore.login('member@brinely.info', 'member123')
    expect(() =>
      demoStore.createTournament({
        title: 'Member attempt',
        format: 'single_elimination',
        team_size: 1,
        player_ids: ['mem_001', 'mem_002'],
      }),
    ).toThrow(/club admins/i)

    demoStore.login('admin@brinely.info', 'admin123')

    // Rejects odd players for doubles bracket
    const badDoubles = demoStore.createTournament({
      title: 'Odd Doubles Draft',
      format: 'single_elimination',
      team_size: 2,
      player_ids: ['mem_001', 'mem_002', 'mem_003'],
    })
    expect(() => demoStore.generateTournamentDraw(badDoubles.tournament.id)).toThrow(/even number/i)
    const cancelled = demoStore.cancelTournament(badDoubles.tournament.id)
    expect(cancelled.tournament.status).toBe('cancelled')

    // Create 5-player Singles Bracket -> 8 slots -> 3 Round 1 BYEs -> 1 Round 1 match + 2 SF + 1 Finals = 4 playable games
    const fiveIds = ['mem_001', 'mem_002', 'mem_003', 'mem_004', 'mem_005']
    const singles = demoStore.createTournament({
      title: 'Gensan Singles Cup',
      format: 'single_elimination',
      team_size: 1,
      venue_id: DEMO_VENUE_ID,
      counts_for_leaderboard: true,
      notes: '  Play to 11  ',
      player_ids: fiveIds.slice(0, 4),
    })
    expect(singles.tournament.notes).toBe('Play to 11')

    const updatedRoster = demoStore.setTournamentPlayers(singles.tournament.id, fiveIds)
    expect(updatedRoster.players).toHaveLength(5)

    const draw1 = demoStore.generateTournamentDraw(singles.tournament.id)
    expect(draw1.teams).toHaveLength(5)
    expect(draw1.matches).toHaveLength(7)
    expect(draw1.matches.filter((m) => m.status === 'bye')).toHaveLength(3)
    expect(draw1.matches.filter((m) => m.status === 'ready')).toHaveLength(2) // QF (4 vs 5) + SF2 (2 vs 3)

    // Reshuffle again before starting
    const draw2 = demoStore.generateTournamentDraw(singles.tournament.id)
    expect(draw2.teams).toHaveLength(5)

    const live = demoStore.startTournament(singles.tournament.id)
    expect(live.tournament.status).toBe('live')

    // Assign court on ready match
    const firstReady = live.matches.find((m) => m.status === 'ready')!
    const withCourt = demoStore.assignTournamentMatchCourt(singles.tournament.id, firstReady.id, 'court_1')
    expect(withCourt.matches.find((m) => m.id === firstReady.id)?.court_name).toBe('Court A')

    // Per-tournament scorer can score ONLY when granted
    demoStore.login('admin@brinely.info', 'admin123')
    // Wait: remove club-wide access from staff first to test per-tournament isolation
    demoStore.setLeaderboardScorer('user_staff', false)
    demoStore.login('staff@brinely.info', 'staff123')
    expect(demoStore.clubTournament(singles.tournament.id).can_score).toBe(false)
    expect(() =>
      demoStore.scoreTournamentMatch({
        tournament_id: singles.tournament.id,
        match_id: firstReady.id,
        winner_side: 'a',
      }),
    ).toThrow(/designated scorers/i)

    demoStore.login('admin@brinely.info', 'admin123')
    demoStore.setTournamentScorer(singles.tournament.id, 'user_staff', true)

    demoStore.login('staff@brinely.info', 'staff123')
    expect(demoStore.clubTournament(singles.tournament.id).can_score).toBe(true)
    expect(demoStore.clubTournament('tour_live_queue').can_score).toBe(false)

    // Score every ready match through Finals
    let current = demoStore.clubTournament(singles.tournament.id)
    let guard = 0
    while (current.tournament.status === 'live' && guard < 10) {
      const next = current.matches.find((m) => m.status === 'ready')
      if (!next) break
      current = demoStore.scoreTournamentMatch({
        tournament_id: singles.tournament.id,
        match_id: next.id,
        winner_side: 'a',
        score_a: 11,
        score_b: 8,
      })
      guard += 1
    }

    expect(current.tournament.status).toBe('completed')
    expect(current.tournament.champion_label).toBeTruthy()
    expect(current.tournament.completed_matches).toBe(4)

    // Voiding a Semifinal after Finals is completed is blocked
    const sfMatch = current.matches.find((m) => m.round_number === 2 && m.status === 'completed')!
    expect(() => demoStore.voidClubMatch(sfMatch.club_match_id!, 'Invalid')).toThrow(/next round/i)

    // Voiding Finals succeeds and restores tournament back to live
    const finals = current.matches.find((m) => !m.next_match_id && m.status === 'completed')!
    demoStore.voidClubMatch(finals.club_match_id!, 'Mistap')
    const reopened = demoStore.clubTournament(singles.tournament.id)
    expect(reopened.tournament.status).toBe('live')
    expect(reopened.matches.find((m) => m.id === finals.id)?.status).toBe('ready')
  })

  it('runs random queue mixer with lowest-games fairness, late player addition, leaderboard opt-out, and club isolation', () => {
    demoStore.login('admin@brinely.info', 'admin123')
    const mixer = demoStore.createTournament({
      title: 'Friendly Random Queue',
      format: 'random_queue',
      team_size: 2,
      counts_for_leaderboard: false,
      player_ids: ['mem_001', 'mem_002', 'mem_003', 'mem_004', 'mem_005', 'mem_006'],
    })

    const started = demoStore.startTournament(mixer.tournament.id)
    expect(started.tournament.status).toBe('live')
    expect(started.matches).toHaveLength(1)
    expect(started.matches[0].status).toBe('ready')

    const boardBefore = demoStore.publicClubLeaderboard('rally-point-gensan', 'month', 'all', 50)!
    const matchesBefore = boardBefore.total_matches

    // Score Game 1 -> counts_for_leaderboard is false, so club leaderboard total_matches stays unchanged
    const afterGame1 = demoStore.scoreTournamentMatch({
      tournament_id: mixer.tournament.id,
      match_id: started.matches[0].id,
      winner_side: 'b',
      score_a: 9,
      score_b: 11,
    })
    expect(afterGame1.standings.find((s) => s.games_played === 1)?.points).toBeTruthy()
    expect(demoStore.publicClubLeaderboard('rally-point-gensan', 'month', 'all', 50)!.total_matches).toBe(matchesBefore)

    // Draw Game 2 -> the 2 sitting players MUST be drafted into Game 2 (lowest games played = 0)
    // court_2 and court_4 hold the seeded live matches; a busy court is now refused.
    const afterDraw2 = demoStore.drawTournamentQueueMatch(mixer.tournament.id, 'court_3')
    const game2 = afterDraw2.matches.find((m) => m.match_order === 2)!
    const satOut = new Set(afterGame1.standings.filter((s) => s.games_played === 0).map((s) => s.member_id))
    expect(satOut.size).toBe(2)
    const game2Players = new Set([...game2.team_a_players, ...game2.team_b_players].map((p) => p.member_id))
    for (const id of satOut) {
      expect(game2Players.has(id)).toBe(true)
    }

    // Add a late-arriving player while live; removing an existing player fails
    expect(() => demoStore.setTournamentPlayers(mixer.tournament.id, ['mem_001'])).toThrow(/cannot be removed/i)
    const withLate = demoStore.setTournamentPlayers(mixer.tournament.id, [
      'mem_001',
      'mem_002',
      'mem_003',
      'mem_004',
      'mem_005',
      'mem_006',
      'mem_007',
    ])
    expect(withLate.players).toHaveLength(7)

    // Cannot finish while Game 2 is active
    expect(() => demoStore.completeTournament(mixer.tournament.id)).toThrow(/active court matches/i)

    // Cancel Game 2 -> finish tournament succeeds -> champion_label set
    demoStore.cancelTournamentQueueMatch(mixer.tournament.id, game2.id)
    const finished = demoStore.completeTournament(mixer.tournament.id)
    expect(finished.tournament.status).toBe('completed')
    expect(finished.tournament.champion_label).toBeTruthy()

    // Two-club isolation: Davao sees 0 Gensan tournaments
    demoStore.login('davao.admin@brinely.info', 'davao123')
    setActiveClubId(DEMO_DAVAO_CLUB_ID)
    expect(demoStore.listClubTournaments(20)).toEqual([])
    expect(() => demoStore.clubTournament(mixer.tournament.id)).toThrow(/not found/i)

    setActiveClubId(DEMO_CLUB_ID)
  })

  it('validates edge inputs, singles queues, queue voiding, and scorer revocations', () => {
    demoStore.login('admin@brinely.info', 'admin123')

    expect(() =>
      demoStore.createTournament({
        title: '   ',
        format: 'random_queue',
        team_size: 1,
      }),
    ).toThrow(/title/i)
    expect(() =>
      demoStore.createTournament({
        title: 'Bad Notes',
        format: 'random_queue',
        team_size: 1,
        notes: 'x'.repeat(245),
      }),
    ).toThrow(/240/i)
    expect(() =>
      demoStore.createTournament({
        title: 'Duplicate players',
        format: 'random_queue',
        team_size: 1,
        player_ids: ['mem_001', 'mem_001'],
      }),
    ).toThrow(/once/i)
    expect(() =>
      demoStore.createTournament({
        title: 'Foreign player',
        format: 'random_queue',
        team_size: 1,
        player_ids: ['mem_davao_001'],
      }),
    ).toThrow(/club/i)

    // Singles random queue with leaderboard enabled + voiding queued match
    const singlesQueue = demoStore.createTournament({
      title: 'Singles Mixer',
      format: 'random_queue',
      team_size: 1,
      counts_for_leaderboard: true,
      player_ids: ['mem_001', 'mem_002'],
    })
    const liveQueue = demoStore.startTournament(singlesQueue.tournament.id)
    expect(liveQueue.matches[0].round_label).toBe('Game 1')

    // Rejects drawing again when all players are busy
    expect(() => demoStore.drawTournamentQueueMatch(singlesQueue.tournament.id)).toThrow(/Not enough free players/i)

    // Rejects malformed scores
    expect(() =>
      demoStore.scoreTournamentMatch({
        tournament_id: singlesQueue.tournament.id,
        match_id: liveQueue.matches[0].id,
        winner_side: 'a',
        score_a: 11,
        score_b: null,
      }),
    ).toThrow(/both teams/i)
    expect(() =>
      demoStore.scoreTournamentMatch({
        tournament_id: singlesQueue.tournament.id,
        match_id: liveQueue.matches[0].id,
        winner_side: 'a',
        score_a: 7,
        score_b: 11,
      }),
    ).toThrow(/higher/i)

    const scored = demoStore.scoreTournamentMatch({
      tournament_id: singlesQueue.tournament.id,
      match_id: liveQueue.matches[0].id,
      winner_side: 'a',
    })
    expect(scored.matches[0].club_match_id).toBeTruthy()
    demoStore.voidClubMatch(scored.matches[0].club_match_id!, 'Mistap')
    expect(demoStore.clubTournament(singlesQueue.tournament.id).matches).toHaveLength(0)

    // Revoking per-tournament scorer blocks scoring
    demoStore.setLeaderboardScorer('user_staff', false)
    demoStore.setTournamentScorer(singlesQueue.tournament.id, 'user_staff', true)
    demoStore.setTournamentScorer(singlesQueue.tournament.id, 'user_staff', false)
    demoStore.login('staff@brinely.info', 'staff123')
    expect(demoStore.clubTournament(singlesQueue.tournament.id).can_score).toBe(false)

    // Team B advancement in single-elimination, wrong-venue court guard, and invalid transitions
    demoStore.login('admin@brinely.info', 'admin123')
    const smallSingles = demoStore.createTournament({
      title: 'Two Player Cup',
      format: 'single_elimination',
      team_size: 1,
      venue_id: DEMO_VENUE_ID,
      player_ids: ['mem_001'],
    })
    expect(() => demoStore.generateTournamentDraw(smallSingles.tournament.id)).toThrow(/at least 2/i)
    demoStore.setTournamentPlayers(smallSingles.tournament.id, ['mem_001', 'mem_002'])
    const startedSmall = demoStore.startTournament(smallSingles.tournament.id)
    expect(() => demoStore.assignTournamentMatchCourt(smallSingles.tournament.id, startedSmall.matches[0].id, 'court_3')).toThrow(/another venue/i)
    expect(() => demoStore.cancelTournamentQueueMatch(smallSingles.tournament.id, startedSmall.matches[0].id)).toThrow(/queue/i)
    const finishedSmall = demoStore.scoreTournamentMatch({
      tournament_id: smallSingles.tournament.id,
      match_id: startedSmall.matches[0].id,
      winner_side: 'b',
      score_a: 6,
      score_b: 11,
    })
    expect(finishedSmall.tournament.status).toBe('completed')
    expect(() =>
      demoStore.scoreTournamentMatch({
        tournament_id: smallSingles.tournament.id,
        match_id: startedSmall.matches[0].id,
        winner_side: 'b',
      }),
    ).toThrow(/before scoring/i)

    // Additional guardrails: non-staff scorer, completed/cancelled edit blocks, wrong-club/missing courts, auth guards
    expect(() => demoStore.setTournamentScorer(smallSingles.tournament.id, 'user_member', true)).toThrow(/Active staff member/i)
    expect(() => demoStore.cancelTournament(smallSingles.tournament.id)).toThrow(/already ended/i)
    expect(() => demoStore.completeTournament(smallSingles.tournament.id)).toThrow(/live tournaments/i)
    expect(() => demoStore.setTournamentPlayers(smallSingles.tournament.id, ['mem_001'])).toThrow(/cannot be edited/i)

    const anotherQueue = demoStore.createTournament({
      title: 'Court Guard Test',
      format: 'random_queue',
      team_size: 1,
      venue_id: DEMO_VENUE_ID,
      player_ids: ['mem_001', 'mem_002'],
    })
    const liveAnother = demoStore.startTournament(anotherQueue.tournament.id)
    expect(() => demoStore.assignTournamentMatchCourt(anotherQueue.tournament.id, liveAnother.matches[0].id, 'missing-court')).toThrow(/not found/i)
    expect(() =>
      demoStore.scoreTournamentMatch({
        tournament_id: anotherQueue.tournament.id,
        match_id: liveAnother.matches[0].id,
        winner_side: 'a',
        court_id: 'court_3',
      }),
    ).toThrow(/another venue/i)

    demoStore.logout()
    expect(() => demoStore.listClubTournaments()).toThrow(/Sign in/i)
    expect(() => demoStore.clubTournament('tour_live_bracket')).toThrow(/Sign in/i)

    // Already-started tournament cannot restart; cancelled tournament is hidden from public
    demoStore.login('admin@brinely.info', 'admin123')
    expect(() => demoStore.startTournament('tour_live_bracket')).toThrow(/already started/i)
    expect(() => demoStore.setTournamentScorer('missing-tour', 'user_staff', true)).toThrow(/not found/i)
    const draftCancelled = demoStore.createTournament({ title: 'To Cancel', format: 'random_queue', team_size: 1, player_ids: ['mem_001', 'mem_002'] })
    demoStore.cancelTournament(draftCancelled.tournament.id)
    expect(demoStore.publicTournament('rally-point-gensan', draftCancelled.tournament.id)).toBeNull()
  })
})

describe('tournaments across clubs (demo)', () => {
  beforeEach(() => {
    demoStore.reset()
    setActiveClubId(null)
  })

  it('lists every active club\'s tournaments with the club, live first', () => {
    const rows = demoStore.listPublicTournaments()
    const club = demoStore.listPublicClubTournaments('rally-point-gensan', 50)!
    expect(rows.map((row) => row.id).sort()).toEqual(club.map((row) => row.id).sort())
    expect(rows.every((row) => row.club.slug === 'rally-point-gensan' && row.club.name.length > 0)).toBe(true)
    expect(rows[0].status).toBe('live')
    for (const row of rows) {
      for (const forbidden of ['email', 'phone', 'member_code', 'qr_token', 'user_id', 'created_by']) {
        expect(Object.keys(row)).not.toContain(forbidden)
      }
      expect(Object.keys(row.club).sort()).toEqual(['city', 'name', 'slug'])
    }
  })

  it('filters by status, applies the limit and refuses unknown statuses', () => {
    expect(demoStore.listPublicTournaments('live').every((row) => row.status === 'live')).toBe(true)
    expect(demoStore.listPublicTournaments('completed')).toEqual(
      demoStore.listPublicTournaments().filter((row) => row.status === 'completed'))
    expect(demoStore.listPublicTournaments(null, 1)).toHaveLength(1)
    expect(() => demoStore.listPublicTournaments('cancelled' as never)).toThrow('Unknown tournament status')
  })
})

describe('tournament review fixes (demo)', () => {
  beforeEach(() => {
    demoStore.reset()
    setActiveClubId(null)
    demoStore.login('admin@brinely.info', 'admin123')
  })

  function startedBracket(countsForLeaderboard: boolean) {
    const created = demoStore.createTournament({
      title: countsForLeaderboard ? 'Counted Final' : 'Practice Final',
      format: 'single_elimination',
      team_size: 1,
      counts_for_leaderboard: countsForLeaderboard,
      player_ids: ['mem_005', 'mem_006'],
    })
    demoStore.generateTournamentDraw(created.tournament.id)
    const live = demoStore.startTournament(created.tournament.id)
    return { id: created.tournament.id, final: live.matches.find((m) => m.status === 'ready')! }
  }

  it('undoes a result in a tournament that does not count for the leaderboard', () => {
    const { id, final } = startedBracket(false)
    expect(() => demoStore.voidTournamentMatch(id, final.id)).toThrow('Only a finished match can be undone')
    const done = demoStore.scoreTournamentMatch({ tournament_id: id, match_id: final.id, winner_side: 'a', score_a: 11, score_b: 4 })
    expect(done.tournament.status).toBe('completed')

    const undone = demoStore.voidTournamentMatch(id, final.id, 'Wrong winner')
    expect(undone.tournament.status).toBe('live')
    expect(undone.matches.find((m) => m.id === final.id)).toMatchObject({ status: 'ready', winner_side: null, score_a: null })
  })

  it('voids a counted result on the leaderboard as well', () => {
    const before = demoStore.publicClubLeaderboard('rally-point-gensan', 'month', 'all', 50)!.total_matches
    const { id, final } = startedBracket(true)
    demoStore.scoreTournamentMatch({ tournament_id: id, match_id: final.id, winner_side: 'b', score_a: 6, score_b: 11 })
    expect(demoStore.publicClubLeaderboard('rally-point-gensan', 'month', 'all', 50)!.total_matches).toBe(before + 1)

    const undone = demoStore.voidTournamentMatch(id, final.id)
    expect(undone.matches.find((m) => m.id === final.id)?.status).toBe('ready')
    expect(demoStore.publicClubLeaderboard('rally-point-gensan', 'month', 'all', 50)!.total_matches).toBe(before)
  })

  it('only lets scorers undo results', () => {
    const { id, final } = startedBracket(false)
    demoStore.scoreTournamentMatch({ tournament_id: id, match_id: final.id, winner_side: 'a' })
    demoStore.login('member@brinely.info', 'member123')
    expect(() => demoStore.voidTournamentMatch(id, final.id)).toThrow(/designated scorers/i)
  })

  it('refuses a busy court and an out-of-service court', () => {
    const { id, final } = startedBracket(false)
    // court_2 holds the seeded live bracket match.
    expect(() => demoStore.assignTournamentMatchCourt(id, final.id, 'court_2')).toThrow('That court already has a match on it')
    expect(demoStore.assignTournamentMatchCourt(id, final.id, 'court_3').matches.find((m) => m.id === final.id)?.court_id).toBe('court_3')

    const db = load()
    db.courts.find((c) => c.id === 'court_1')!.status = 'maintenance'
    save(db)
    expect(() => demoStore.assignTournamentMatchCourt(id, final.id, 'court_1')).toThrow('That court is out of service')
  })

  it('allows at most 64 players', () => {
    const tooMany = Array.from({ length: 65 }, (_, i) => `mem_x${i}`)
    expect(() => demoStore.createTournament({ title: 'Too Big', format: 'random_queue', team_size: 2, player_ids: tooMany }))
      .toThrow('A tournament can have at most 64 players')
  })
})
