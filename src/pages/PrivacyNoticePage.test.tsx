import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, type InitialEntry } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MyClub, Profile } from '../types'
import { PrivacyNoticePage } from './PrivacyNoticePage'

const auth = vi.hoisted(() => ({
  user: null as Profile | null,
  activeClub: null as MyClub | null,
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: auth.user,
    activeClub: auth.activeClub,
    clubs: auth.activeClub ? [auth.activeClub] : [],
    switchClub: vi.fn(),
    signOut: vi.fn(),
  }),
}))

vi.mock('../lib/api', () => ({
  api: { publicClub: vi.fn() },
}))

import { api } from '../lib/api'

const scrolledTo: string[] = []

const davao: MyClub = { club_id: 'club-davao', slug: 'rally-point-davao', name: 'Rally Point Davao', role: 'member' }

const member = {
  id: 'member-1',
  email: 'member@example.com',
  full_name: 'Mia Member',
  role: 'member',
  created_at: '2026-09-01T00:00:00.000Z',
} satisfies Profile

function renderNotice(entry: InitialEntry = '/privacy') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <PrivacyNoticePage />
    </MemoryRouter>,
  )
}

describe('PrivacyNoticePage', () => {
  beforeEach(() => {
    auth.user = null
    auth.activeClub = null
    vi.mocked(api.publicClub).mockReset().mockResolvedValue({ id: 'club-davao', slug: 'rally-point-davao', name: 'Rally Point Davao' })
    scrolledTo.length = 0
    // jsdom has no scrollIntoView; record which element asked to be shown.
    Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
      scrolledTo.push(this.id)
    })
  })

  it('shows the requested privacy topics, current app flows, and provisional contact details', () => {
    renderNotice()

    expect(screen.getByRole('heading', { level: 1, name: 'Privacy Notice' })).toBeInTheDocument()
    expect(screen.getByText('For bRineLy booking portal users')).toBeInTheDocument()
    // A legal page carries no marketing tagline; the site footer has it.
    expect(within(screen.getByRole('main')).queryByText('Stay in the brine. Play more.')).not.toBeInTheDocument()
    expect(screen.getByText('Last updated: November 27, 2026')).toBeInTheDocument()
    expect(screen.queryByText(/Rally Point Gensan/)).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'At a glance' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Who we are and club responsibilities' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Personal information we collect' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Why we use information and lawful bases' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Who can see information and service providers' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Club pages and public information' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Browser storage and cookies' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Minors and youth players' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Retention and security' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Your rights under RA 10173' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Privacy contact and notice updates' })).toBeInTheDocument()
    expect(screen.getByText(/whether that invitation was claimed or cancelled/)).toBeInTheDocument()
    expect(screen.getByText(/6-to-30-character GCash reference number/)).toBeInTheDocument()
    expect(screen.getByText(/Club membership requests are paid directly to the club/)).toBeInTheDocument()
    expect(screen.getByText(/linked coach account receives your full name, email address/)).toBeInTheDocument()
    expect(screen.getByText(/Ordinary members in the same club cannot view each other's private court bookings/)).toBeInTheDocument()
    expect(screen.getByText(/court-booking TV schedule views never display player names/i)).toBeInTheDocument()
    expect(screen.getByText(/public club leaderboards, tournament pages/)).toBeInTheDocument()
    expect(screen.getByText(/full name, nickname, profile photo, team pairing, scores, and win\/loss standings/)).toBeInTheDocument()
    expect(screen.getAllByText(/member-photos/).length).toBeGreaterThan(0)
    expect(screen.getByText(/update your full name, nickname, and profile photo directly on your Account page/)).toBeInTheDocument()
    expect(screen.getByText(/brinely\.passes/)).toBeInTheDocument()
    expect(screen.getByText(/cleared automatically when you sign out/)).toBeInTheDocument()
    expect(screen.getByText(/Rent a coach, and Tournaments/)).toBeInTheDocument()
    expect(screen.getByText(/open lesson times/)).toBeInTheDocument()
    expect(screen.getByText(/first-party aggregate operational totals only/)).toBeInTheDocument()
    expect(
      screen.getByText((_, node) => node?.tagName === 'LI' && /embeds OpenStreetMap/.test(node.textContent ?? '')),
    ).toBeInTheDocument()
    expect(screen.getByText(/6-digit sign-up verification codes and booking confirmation emails/)).toBeInTheDocument()
    expect(screen.getByText(/noreply@brinely\.info/)).toBeInTheDocument()
    expect(screen.getByText(/bookings@brinely\.info/)).toBeInTheDocument()
    expect(screen.getByText(/does not use advertising cookies/)).toBeInTheDocument()
    expect(screen.getAllByText(/localStorage/).length).toBeGreaterThan(0)
    expect(screen.getByText(/sessionStorage/)).toBeInTheDocument()
    expect(screen.getByText(/payment instructions, including an account name or number and a QR image/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'admin@brinely.info' })).toHaveAttribute(
      'href',
      'mailto:admin@brinely.info',
    )
    expect(screen.getByText(/provisional contact pending confirmation/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to login' })).toHaveAttribute('href', '/login')
    expect(api.publicClub).not.toHaveBeenCalled()
  })

  it("names a join link's club, keeps platform contact available, leaves out Gensan, and goes back to that join link", async () => {
    renderNotice('/privacy?club=rally-point-davao')

    expect(await screen.findByText('For Rally Point Davao players on the bRineLy booking portal')).toBeInTheDocument()
    expect(api.publicClub).toHaveBeenCalledWith('rally-point-davao')
    expect(screen.queryByText(/Gensan/)).not.toBeInTheDocument()
    expect(screen.getByText(/ask the staff at Rally Point Davao/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'admin@brinely.info' })).toHaveAttribute(
      'href',
      'mailto:admin@brinely.info',
    )
    expect(screen.getByRole('link', { name: 'Back to sign-up' })).toHaveAttribute('href', '/join/rally-point-davao')
  })

  it('stays neutral when a join link names a club that cannot be found', async () => {
    vi.mocked(api.publicClub).mockResolvedValue(null)
    renderNotice('/privacy?club=missing-club')

    expect(await screen.findByText(/ask the staff at your club/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'admin@brinely.info' })).toHaveAttribute(
      'href',
      'mailto:admin@brinely.info',
    )
    expect(screen.getByText('For bRineLy booking portal users')).toBeInTheDocument()
    expect(screen.queryByText(/Gensan/)).not.toBeInTheDocument()
  })

  it('keeps the account menu for a signed-in member and returns them to Help', () => {
    auth.user = member
    auth.activeClub = davao
    renderNotice({ pathname: '/privacy', state: { from: '/member/help' } })

    expect(screen.getByText('For Rally Point Davao players on the bRineLy booking portal')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Account menu for / })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to Help' })).toHaveAttribute('href', '/member/help')
    expect(screen.queryByRole('link', { name: 'Back to login' })).not.toBeInTheDocument()
    expect(api.publicClub).not.toHaveBeenCalled()
  })

  it('lists the sections on this page and jumps to the one chosen', async () => {
    const user = userEvent.setup()
    renderNotice({ pathname: '/privacy', state: { from: '/owners' } })

    const contents = screen.getByRole('navigation', { name: 'On this page' })
    const links = within(contents).getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual([
      'At a glance',
      'Who we are and club responsibilities',
      'Personal information we collect',
      'Why we use information and lawful bases',
      'Who can see information and service providers',
      'Club pages and public information',
      'Browser storage and cookies',
      'Minors and youth players',
      'Retention and security',
      'Your rights under RA 10173',
      'Privacy contact and notice updates',
      'Photo credits',
    ])
    expect(scrolledTo).toEqual([])

    await user.click(within(contents).getByRole('link', { name: 'Your rights under RA 10173' }))
    expect(scrolledTo).toEqual(['your-rights-under-ra-10173'])
    expect(screen.getByRole('heading', { name: 'Your rights under RA 10173' })).toHaveFocus()
    // The jump keeps the way back.
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/owners')
  })

  it('scrolls to the photo credits when the address names them', () => {
    renderNotice('/privacy#photo-credits')

    expect(scrolledTo).toEqual(['photo-credits'])
    const credits = screen.getByRole('region', { name: 'Photo credits' })
    expect(credits).toHaveAttribute('id', 'photo-credits')
    expect(within(credits).getByText('Sample photos stand in for clubs that have not added their own pictures yet.')).toBeInTheDocument()
  })

  it('ends with a link back to the top of the notice', async () => {
    const user = userEvent.setup()
    renderNotice()

    await user.click(screen.getByRole('link', { name: 'Back to top' }))
    // The whole page scrolls (the root element has no id) and focus returns to the notice's start.
    expect(scrolledTo).toEqual([''])
    expect(document.getElementById('privacy-notice')).toHaveFocus()
  })

  it('ignores a return path that points outside the app', () => {
    renderNotice({ pathname: '/privacy', state: { from: '//example.com/phish' } })

    expect(screen.getByRole('link', { name: 'Back to login' })).toHaveAttribute('href', '/login')
  })
})
