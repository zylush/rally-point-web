import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, type InitialEntry } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MyClub, Profile } from '../types'
import { TermsPage } from './TermsPage'

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

const scrolledTo: string[] = []

const sectionTitles = [
  'About these terms',
  'Who does what',
  'Paying for a booking',
  'How a booking works',
  'Cancellations and refunds',
  'Your account',
  'Public information',
  'Clubs listed on bRineLy',
  'Changes to these terms',
  'Contact',
]

const member = {
  id: 'member-1',
  email: 'member@example.com',
  full_name: 'Mia Member',
  role: 'member',
  created_at: '2026-09-01T00:00:00.000Z',
} satisfies Profile

function renderTerms(entry: InitialEntry = '/terms') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <TermsPage />
    </MemoryRouter>,
  )
}

describe('TermsPage', () => {
  beforeEach(() => {
    auth.user = null
    auth.activeClub = null
    scrolledTo.length = 0
    // jsdom has no scrollIntoView; record which element asked to be shown.
    Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
      scrolledTo.push(this.id)
    })
  })

  it('shows every section, the contact address and the Privacy Notice link to a visitor', () => {
    renderTerms()

    expect(screen.getByRole('heading', { level: 1, name: 'Terms of use' })).toBeInTheDocument()
    expect(screen.getByText('For bRineLy booking portal users')).toBeInTheDocument()
    expect(screen.getByText('Last updated: November 28, 2026')).toBeInTheDocument()
    for (const title of sectionTitles) {
      expect(screen.getByRole('heading', { level: 2, name: title })).toBeInTheDocument()
    }
    expect(screen.getByText(/never receives, holds or forwards your money/)).toBeInTheDocument()
    expect(screen.getByText(/cannot cancel or refund a confirmed booking/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'admin@brinely.info' })).toHaveAttribute('href', 'mailto:admin@brinely.info')
    expect(screen.getByRole('link', { name: 'Privacy Notice' })).toHaveAttribute('href', '/privacy')
    expect(screen.getByRole('link', { name: 'Back to home' })).toHaveAttribute('href', '/')
  })

  it('lists the sections on this page and jumps to the one chosen', async () => {
    const user = userEvent.setup()
    renderTerms()

    const contents = screen.getByRole('navigation', { name: 'On this page' })
    expect(within(contents).getAllByRole('link').map((link) => link.textContent)).toEqual(sectionTitles)

    await user.click(within(contents).getByRole('link', { name: 'Cancellations and refunds' }))
    expect(scrolledTo).toEqual(['cancellations-and-refunds'])
    expect(screen.getByRole('heading', { name: 'Cancellations and refunds' })).toHaveFocus()
  })

  it('ends with a link back to the top of the terms', async () => {
    const user = userEvent.setup()
    renderTerms()

    await user.click(screen.getByRole('link', { name: 'Back to top' }))
    expect(scrolledTo).toEqual([''])
    expect(document.getElementById('terms-of-use')).toHaveFocus()
  })

  it('keeps the account menu for a signed-in person and goes back to their home', () => {
    auth.user = member
    renderTerms()

    expect(screen.getByRole('heading', { level: 1, name: 'Terms of use' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Account menu for / })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to Find a court' })).toHaveAttribute('href', '/clubs')
  })
})
