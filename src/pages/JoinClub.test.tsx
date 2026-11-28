import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MyClub, Profile, PublicClub } from '../types'
import { JoinClubPage } from './JoinClub'

const davao: PublicClub = { id: 'club-davao', slug: 'rally-point-davao', name: 'Rally Point Davao' }
const gensanMembership: MyClub = { club_id: 'club-gensan', slug: 'rally-point-gensan', name: 'Rally Point Gensan', role: 'member' }
const davaoMembership: MyClub = { club_id: 'club-davao', slug: 'rally-point-davao', name: 'Rally Point Davao', role: 'member' }
const player: Profile = { id: 'user-1', email: 'player@example.invalid', full_name: 'Pat Player', role: 'member', created_at: '2026-01-01T00:00:00.000Z' }

const state = vi.hoisted(() => ({
  user: null as Profile | null,
  clubs: [] as MyClub[],
  publicClub: null as PublicClub | null,
  publicClubFails: false,
  joinClub: vi.fn(),
  switchClub: vi.fn(),
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: state.user,
    loading: false,
    demo: true,
    clubs: state.clubs,
    activeClub: state.clubs[0] ?? null,
    joinClub: state.joinClub,
    switchClub: state.switchClub,
    signIn: vi.fn(),
    signUpMember: vi.fn(),
    resetPassword: vi.fn(),
    signOut: vi.fn(),
    refresh: vi.fn(),
  }),
}))

vi.mock('../lib/api', () => ({
  api: {
    publicClub: vi.fn(async () => {
      if (state.publicClubFails) throw new Error('Failed to fetch')
      return state.publicClub
    }),
  },
}))

function Where() {
  return <p>At {useLocation().pathname}</p>
}

function renderJoin() {
  return render(
    <MemoryRouter initialEntries={['/join/rally-point-davao']}>
      <Routes>
        <Route path="/join/:slug" element={<JoinClubPage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  state.user = null
  state.clubs = []
  state.publicClub = davao
  state.publicClubFails = false
  state.joinClub.mockReset()
  state.switchClub.mockReset()
})

describe('JoinClubPage', () => {
  it('explains an invalid club link', async () => {
    state.publicClub = null
    renderJoin()
    expect(await screen.findByRole('heading', { name: 'This club link is not valid' })).toBeInTheDocument()
    const main = screen.getByRole('main')
    expect(within(main).getByRole('link', { name: 'Go to log in' })).toHaveAttribute('href', '/login')
    expect(within(main).getByRole('link', { name: 'Find a court' })).toHaveAttribute('href', '/clubs')
  })

  it('tells a failed lookup apart from an invalid link and tries again', async () => {
    state.publicClubFails = true
    const user = userEvent.setup()
    renderJoin()
    expect(await screen.findByRole('heading', { name: 'We could not load this link' })).toBeInTheDocument()
    expect(screen.queryByText('This club link is not valid')).not.toBeInTheDocument()
    state.publicClubFails = false
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Joining Rally Point Davao')).toBeInTheDocument()
  })

  it('offers sign-up into the named club when nobody is signed in', async () => {
    renderJoin()
    expect(await screen.findByText('Joining Rally Point Davao')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Create your player account' })).toBeInTheDocument()
  })

  it('lets a signed-in player confirm joining and lands them in the club', async () => {
    state.user = player
    state.clubs = [gensanMembership]
    state.joinClub.mockResolvedValue(davaoMembership)
    const user = userEvent.setup()
    renderJoin()
    expect(await screen.findByRole('heading', { name: 'Join Rally Point Davao?' })).toBeInTheDocument()
    // No club photos yet, so the banner is a labelled sample.
    expect(screen.getByText('Sample photo')).toBeInTheDocument()

    const privacyLink = screen.getByRole('link', { name: 'Privacy Notice' })
    expect(privacyLink).toHaveAttribute('href', '/privacy?club=rally-point-davao')
    expect(privacyLink).toHaveAttribute('target', '_blank')
    expect(screen.getByRole('button', { name: /Read the Privacy Notice/ })).toBeInTheDocument()

    const checkbox = screen.getByRole('checkbox', { name: /I have read and understood the Privacy Notice/ })
    expect(checkbox).toBeDisabled()
    expect(checkbox).not.toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Join Rally Point Davao' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Read to the end of the Privacy Notice first, then tick the box.')
    const reader = screen.getByRole('region', { name: 'Privacy Notice text' })
    expect(reader).toHaveFocus()
    expect(within(reader).getByText(/ask the staff at Rally Point Davao/)).toBeInTheDocument()
    expect(state.joinClub).not.toHaveBeenCalled()

    Object.defineProperty(reader, 'scrollHeight', { configurable: true, value: 1000 })
    Object.defineProperty(reader, 'clientHeight', { configurable: true, value: 200 })
    Object.defineProperty(reader, 'scrollTop', { configurable: true, writable: true, value: 790 })
    fireEvent.scroll(reader)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(checkbox).toBeEnabled()
    expect(checkbox).not.toBeChecked()

    await user.click(screen.getByRole('button', { name: 'Join Rally Point Davao' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Tick the box to confirm you have read the Privacy Notice.')
    expect(checkbox).toHaveFocus()
    expect(state.joinClub).not.toHaveBeenCalled()

    await user.click(checkbox)
    await user.click(screen.getByRole('button', { name: 'Join Rally Point Davao' }))
    expect(state.joinClub).toHaveBeenCalledWith('rally-point-davao')
    // Players land on the club's own page.
    expect(await screen.findByText('At /clubs/rally-point-davao')).toBeInTheDocument()
  })

  it('shows join errors without leaving the page', async () => {
    state.user = player
    state.clubs = [gensanMembership]
    state.joinClub.mockRejectedValue(new Error('This club link is not valid'))
    const user = userEvent.setup()
    renderJoin()
    await user.click(await screen.findByRole('button', { name: /Read the Privacy Notice/ }))
    await user.click(screen.getByRole('button', { name: 'Unlock checkbox' }))
    await user.click(screen.getByRole('checkbox', { name: /I have read and understood the Privacy Notice/ }))
    await user.click(screen.getByRole('button', { name: 'Join Rally Point Davao' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This club link is not valid')
  })

  it('switches to the club when the player already belongs to it', async () => {
    state.user = player
    state.clubs = [gensanMembership, davaoMembership]
    const user = userEvent.setup()
    renderJoin()
    await user.click(await screen.findByRole('button', { name: 'Go to Rally Point Davao' }))
    expect(state.switchClub).toHaveBeenCalledWith('club-davao')
    // Players land on the club's own page.
    expect(await screen.findByText('At /clubs/rally-point-davao')).toBeInTheDocument()
  })

  it('tells platform accounts they cannot join clubs', async () => {
    state.user = { ...player, role: 'superadmin' }
    renderJoin()
    expect(await screen.findByText(/cannot join a club as a player/)).toBeInTheDocument()
    expect(state.joinClub).not.toHaveBeenCalled()
  })
})
