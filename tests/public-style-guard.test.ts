import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/*
 * The public site keeps the calm "quiet court" look: flat surfaces, hairlines and real photos.
 * This stops the decorative styling the overhaul removed from creeping back into the pages
 * visitors see first.
 */
const publicFiles = [
  'src/lib/privacyNoticeContent.tsx',
  'src/lib/usePrivacyGate.ts',
  'src/components/PublicFrame.tsx',
  'src/components/CourtSymbolsBackdrop.tsx',
  'src/components/PrivacyAcknowledgement.tsx',
  'src/components/SiteFooter.tsx',
  'src/components/ClubCard.tsx',
  'src/components/OwnersStrip.tsx',
  'src/components/ClubImage.tsx',
  'src/components/ClubProfileSections.tsx',
  'src/components/BookingSteps.tsx',
  'src/components/CallDayPicker.tsx',
  'src/components/LeaderboardView.tsx',
  'src/components/TournamentView.tsx',
  'src/components/PhotoCredits.tsx',
  'src/components/ErrorBoundary.tsx',
  'src/pages/Welcome.tsx',
  'src/pages/Clubs.tsx',
  'src/pages/Coaches.tsx',
  'src/pages/Leaderboard.tsx',
  'src/pages/Tournaments.tsx',
  'src/pages/MemberBook.tsx',
  'src/pages/LoginPage.tsx',
  'src/pages/JoinClub.tsx',
  'src/pages/Owners.tsx',
  'src/pages/PrivacyNoticePage.tsx',
  'src/pages/NotFound.tsx',
]

const banned: [RegExp, string][] = [
  [/\bbg-gradient-/, 'gradient backgrounds'],
  [/\bbackdrop-blur/, 'frosted glass'],
  [/\bbg-clip-text\b/, 'gradient text'],
  [/\buppercase\b/, 'shouty uppercase labels'],
  [/\bdrop-shadow/, 'glowing text'],
  [/\bshadow-(xl|2xl)\b|shadow-\[/, 'heavy or custom shadows'],
  [/<video\b/, 'background video'],
  // © ® ™ count as pictographic in Unicode; they are ordinary text here.
  [/(?![©®™])\p{Extended_Pictographic}/u, 'emoji'],
]

describe('public pages stay calm', () => {
  for (const file of publicFiles) {
    it(`${file} uses no decorative effects`, () => {
      const source = readFileSync(file, 'utf8')
      for (const [pattern, what] of banned) {
        const line = source.split(/\r?\n/).findIndex((text) => pattern.test(text))
        expect(line, `${file}:${line + 1} adds ${what}`).toBe(-1)
      }
    })
  }
})
