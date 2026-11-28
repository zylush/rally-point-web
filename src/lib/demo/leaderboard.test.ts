import { beforeEach, describe, expect, it } from 'vitest'
import { demoStore } from '../demoStore'
import { setActiveClubId } from '../clubContext'
import { DEMO_CLUB_ID, DEMO_DAVAO_CLUB_ID } from '../tenant'

describe('leaderboard demo operations', () => {
  beforeEach(() => {
    demoStore.reset()
    setActiveClubId(null)
  })

  it('derives public rankings with points (+3/+1), tie-breakers, streaks, and zero private fields', () => {
    const board = demoStore.publicClubLeaderboard('rally-point-gensan', 'month', 'all', 50)
    expect(board).not.toBeNull()
    expect(board!.total_matches).toBe(6)
    expect(board!.entries.length).toBeGreaterThanOrEqual(6)

    // Jonah Cruz: 2W-1L = 7 pts, diff +4, streak +2 beats Kyla Tan (7 pts, diff +3)
    expect(board!.entries[0]).toMatchObject({
      member_id: 'mem_002',
      full_name: 'Jonah Cruz',
      rank: 1,
      points: 7,
      wins: 2,
      losses: 1,
      games_played: 3,
      win_pct: 67,
      score_diff: 4,
      streak: 2,
    })
    expect(board!.entries[1]).toMatchObject({
      member_id: 'mem_005',
      full_name: 'Kyla Tan',
      rank: 2,
      points: 7,
      score_diff: 3,
    })

    for (const entry of board!.entries) {
      const keys = Object.keys(entry)
      for (const forbidden of ['email', 'phone', 'member_code', 'qr_token', 'user_id', 'notes']) {
        expect(keys).not.toContain(forbidden)
      }
    }
  })

  it('filters by period (month vs all) and match format (doubles vs singles)', () => {
    const allTime = demoStore.publicClubLeaderboard('rally-point-gensan', 'all', 'all', 50)
    expect(allTime!.total_matches).toBe(8)

    const singlesOnly = demoStore.publicClubLeaderboard('rally-point-gensan', 'month', 'singles', 50)
    expect(singlesOnly!.total_matches).toBe(2)
    expect(singlesOnly!.recent_matches.every((m) => m.format === 'singles')).toBe(true)

    const doublesOnly = demoStore.publicClubLeaderboard('rally-point-gensan', 'month', 'doubles', 50)
    expect(doublesOnly!.total_matches).toBe(4)
    expect(doublesOnly!.recent_matches.every((m) => m.format === 'doubles')).toBe(true)
  })

  it('returns null for unknown or suspended clubs on public endpoints', () => {
    expect(demoStore.publicClubLeaderboard('does-not-exist', 'month', 'all', 20)).toBeNull()
    expect(demoStore.publicPlayerMatches('does-not-exist', 'mem_001', 10)).toBeNull()
    const matches = demoStore.publicPlayerMatches('rally-point-gensan', 'mem_001', 10)
    expect(matches).toHaveLength(3)
  })

  it('enforces designated scorer permissions and validates match inputs', () => {
    demoStore.login('member@brinely.info', 'member123')
    const memberBoard = demoStore.clubLeaderboard('month', 'all', 100)
    expect(memberBoard.can_score).toBe(false)
    expect(memberBoard.my_member_id).toBe('mem_001')
    expect(memberBoard.my_entry?.points).toBe(6)

    expect(() =>
      demoStore.recordClubMatch({
        format: 'singles',
        team_a: ['mem_001'],
        team_b: ['mem_002'],
        winner_side: 'a',
      }),
    ).toThrow(/designated scorers/i)

    // Designated staff (user_staff) can score 1-tap wins without scores
    demoStore.login('staff@brinely.info', 'staff123')
    expect(demoStore.clubLeaderboard('month', 'all', 100).can_score).toBe(true)

    expect(() =>
      demoStore.recordClubMatch({
        format: 'singles',
        team_a: ['mem_001'],
        team_b: ['mem_001'],
        winner_side: 'a',
      }),
    ).toThrow(/different players/i)

    expect(() =>
      demoStore.recordClubMatch({
        format: 'singles',
        team_a: ['mem_001'],
        team_b: ['mem_002'],
        winner_side: 'a',
        score_a: 6,
        score_b: 11,
      }),
    ).toThrow(/higher than the losing/i)

    const recorded = demoStore.recordClubMatch({
      format: 'singles',
      team_a: ['mem_001'],
      team_b: ['mem_003'],
      winner_side: 'a',
      notes: '  Tie break game  ',
    })
    expect(recorded.notes).toBe('Tie break game')

    // Mia Member went from 6 pts to 9 pts
    expect(demoStore.clubLeaderboard('month', 'all', 100).my_entry).toBeNull()
    const afterPublic = demoStore.publicClubLeaderboard('rally-point-gensan', 'month', 'all', 50)!
    expect(afterPublic.entries.find((e) => e.member_id === 'mem_001')?.points).toBe(9)

    // Voiding recalculates points back to 6, while retaining voided match for staff/admin
    demoStore.voidClubMatch(recorded.id, 'Entered by mistake')
    expect(
      demoStore.publicClubLeaderboard('rally-point-gensan', 'month', 'all', 50)!
        .entries.find((e) => e.member_id === 'mem_001')?.points,
    ).toBe(6)
    expect(
      demoStore.clubLeaderboard('month', 'all', 100).recent_matches.find((m) => m.id === recorded.id)?.status,
    ).toBe('voided')
  })

  it('lets club admins grant and revoke staff scoring and isolates clubs', () => {
    demoStore.login('admin@brinely.info', 'admin123')
    const initialScorers = demoStore.listLeaderboardScorers()
    expect(initialScorers).toHaveLength(1)
    expect(initialScorers[0]).toMatchObject({ user_id: 'user_staff', can_score: true })

    demoStore.setLeaderboardScorer('user_staff', false)
    expect(demoStore.listLeaderboardScorers()[0].can_score).toBe(false)

    demoStore.login('staff@brinely.info', 'staff123')
    expect(demoStore.clubLeaderboard('month', 'all', 100).can_score).toBe(false)
    expect(() =>
      demoStore.recordClubMatch({
        format: 'singles',
        team_a: ['mem_001'],
        team_b: ['mem_002'],
        winner_side: 'a',
      }),
    ).toThrow(/designated scorers/i)

    // Switch to Davao club: Gensan matches stay in Gensan, Davao stays isolated
    demoStore.login('davao.admin@brinely.info', 'davao123')
    setActiveClubId(DEMO_DAVAO_CLUB_ID)
    const davaoBoard = demoStore.clubLeaderboard('all', 'all', 100)
    expect(davaoBoard.club?.id).toBe(DEMO_DAVAO_CLUB_ID)
    expect(davaoBoard.total_matches).toBe(0)

    // Rejects cross-club player, invalid court, and mismatched score pairs
    const davaoMember = demoStore.members()[0]
    expect(davaoMember).toBeDefined()
    expect(() =>
      demoStore.recordClubMatch({
        format: 'singles',
        team_a: [davaoMember.id],
        team_b: ['mem_001'],
        winner_side: 'a',
      }),
    ).toThrow(/belong to this club/i)
    expect(() =>
      demoStore.recordClubMatch({
        format: 'singles',
        team_a: [davaoMember.id],
        team_b: [davaoMember.id],
        winner_side: 'a',
      }),
    ).toThrow(/different players/i)
    expect(() =>
      demoStore.recordClubMatch({
        format: 'doubles',
        team_a: [davaoMember.id],
        team_b: ['mem_002'],
        winner_side: 'a',
      }),
    ).toThrow(/2 player/i)
    expect(() =>
      demoStore.recordClubMatch({
        format: 'singles',
        team_a: [davaoMember.id],
        team_b: [davaoMember.id],
        winner_side: 'a',
        score_a: 11,
        score_b: null,
      }),
    ).toThrow(/different players/i)
    expect(() => demoStore.voidClubMatch('missing-match')).toThrow(/not found/i)

    setActiveClubId(DEMO_CLUB_ID)
  })

  it('validates score pairs, non-existent courts/venues, and non-staff scorer assignment', () => {
    demoStore.login('admin@brinely.info', 'admin123')
    expect(() => demoStore.setLeaderboardScorer('user_member', true)).toThrow(/Active staff member/i)
    expect(() =>
      demoStore.recordClubMatch({
        format: 'singles',
        team_a: ['mem_001'],
        team_b: ['mem_002'],
        winner_side: 'a',
        score_a: 11,
        score_b: null,
      }),
    ).toThrow(/scores for both teams/i)
    expect(() =>
      demoStore.recordClubMatch({
        format: 'singles',
        team_a: ['mem_001'],
        team_b: ['mem_002'],
        winner_side: 'a',
        score_a: 105,
        score_b: 5,
      }),
    ).toThrow(/between 0 and 99/i)
    expect(() =>
      demoStore.recordClubMatch({
        format: 'singles',
        team_a: ['mem_001'],
        team_b: ['mem_002'],
        winner_side: 'a',
        court_id: 'no-such-court',
      }),
    ).toThrow(/Court not found/i)
    expect(() =>
      demoStore.recordClubMatch({
        format: 'singles',
        team_a: ['mem_001'],
        team_b: ['mem_002'],
        winner_side: 'a',
        venue_id: 'no-such-venue',
      }),
    ).toThrow(/Venue not found/i)

    const withCourt = demoStore.recordClubMatch({
      format: 'doubles',
      team_a: ['mem_001', 'mem_002'],
      team_b: ['mem_004', 'mem_005'],
      winner_side: 'b',
      score_a: 9,
      score_b: 11,
      court_id: 'court_1',
    })
    expect(withCourt.court_name).toBe('Court A')
    expect(withCourt.winner_side).toBe('b')
  })
})
