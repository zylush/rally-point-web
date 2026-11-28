import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MemberPass as Pass, MyClub, Profile } from '../types'
import { api } from '../lib/api'
import { clearCachedPasses, readCachedPasses, writeCachedPasses } from '../lib/passCache'
import { MemberPass } from './MemberPass'

const state = vi.hoisted(() => ({
  user: null as Profile | null,
  activeClub: null as MyClub | null,
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: state.user, loading: false, demo: true, clubs: [], activeClub: state.activeClub }),
}))

vi.mock('../lib/api', () => ({ api: { myMemberPasses: vi.fn() } }))

const jamie: Profile = {
  id: 'u-member',
  email: 'jamie@example.invalid',
  full_name: 'Jamie Player',
  nickname: 'Jams',
  photo_path: null,
  role: 'member',
  created_at: '2026-01-01T00:00:00.000Z',
}

const gensan: Pass = {
  club_id: 'club-gensan',
  club_slug: 'gensan',
  club_name: 'Rally Point Gensan',
  member_id: 'm-1',
  member_code: 'BR-0001',
  full_name: 'Jamie Player',
  membership_type: null,
  status: 'active',
  expiry_date: null,
  is_active_member: false,
  qr_token: 'token-gensan',
  request: null,
}
const davao: Pass = {
  ...gensan,
  club_id: 'club-davao',
  club_slug: 'davao',
  club_name: 'Rally Point Davao',
  member_id: 'm-2',
  member_code: 'BR-0002',
  membership_type: 'premium',
  expiry_date: '2099-12-31',
  is_active_member: true,
  qr_token: 'token-davao',
}

function renderPass(route = '/member/pass') {
  return render(<MemoryRouter initialEntries={[route]}><MemberPass /></MemoryRouter>)
}

/** The QR image's encoded value is drawn, not written; the payload shows in the SVG's title-free path data, so check the code beside it. */
function panel() {
  return screen.getByText(/^Works only at/).closest('section') as HTMLElement
}

beforeEach(() => {
  state.user = { ...jamie }
  state.activeClub = null
  clearCachedPasses()
  vi.mocked(api.myMemberPasses).mockReset().mockResolvedValue([gensan, davao])
})

afterEach(() => clearCachedPasses())

describe('MemberPass wallet', () => {
  it('holds one QR per club and opens the active club first', async () => {
    state.activeClub = { club_id: 'club-gensan', slug: 'gensan', name: 'Rally Point Gensan', role: 'member' }
    renderPass()

    const tabs = await screen.findAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Rally Point Gensan', 'Rally Point Davao'])
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('img', { name: 'Check-in QR code for Rally Point Gensan' })).toBeInTheDocument()
    expect(within(panel()).getByText('BR-0001')).toBeInTheDocument()
    expect(within(panel()).getByText('Player')).toBeInTheDocument()
    expect(within(panel()).getByText('“Jams”')).toBeInTheDocument()
  })

  it('switches to another club pass with its own code and status', async () => {
    const user = userEvent.setup()
    renderPass()

    await user.click(await screen.findByRole('tab', { name: 'Rally Point Gensan' }))
    const gensanQr = screen.getByRole('img', { name: 'Check-in QR code for Rally Point Gensan' }).innerHTML
    await user.click(screen.getByRole('tab', { name: 'Rally Point Davao' }))

    expect(screen.getByRole('tab', { name: 'Rally Point Davao' })).toHaveAttribute('aria-selected', 'true')
    const davaoQr = screen.getByRole('img', { name: 'Check-in QR code for Rally Point Davao' }).innerHTML
    expect(davaoQr).not.toEqual(gensanQr)
    expect(within(panel()).getByText('BR-0002')).toBeInTheDocument()
    expect(within(panel()).getByText(/^Member until/)).toBeInTheDocument()
    expect(within(panel()).getByText('Works only at Rally Point Davao. Staff can scan it, or type your ID number.')).toBeInTheDocument()
  })

  it('opens the club named in the link from Account', async () => {
    renderPass('/member/pass?club=club-davao')
    expect(await screen.findByRole('img', { name: 'Check-in QR code for Rally Point Davao' })).toBeInTheDocument()
  })

  it('shows a single pass without club tabs', async () => {
    vi.mocked(api.myMemberPasses).mockResolvedValue([davao])
    renderPass()
    expect(await screen.findByRole('img', { name: 'Check-in QR code for Rally Point Davao' })).toBeInTheDocument()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
  })

  it('saves the passes on the phone and shows them, marked as saved, when offline', async () => {
    const first = renderPass()
    await screen.findByRole('img', { name: /Check-in QR code/ })
    expect(readCachedPasses('u-member')?.passes).toHaveLength(2)
    first.unmount()

    vi.mocked(api.myMemberPasses).mockRejectedValue(new Error('Failed to fetch'))
    renderPass()
    expect(await screen.findByText(/You are offline/)).toBeInTheDocument()
    expect(screen.getAllByRole('tab')).toHaveLength(2)
  })

  it('never shows another account’s saved passes', async () => {
    writeCachedPasses('someone-else', [gensan])
    vi.mocked(api.myMemberPasses).mockRejectedValue(new Error('Failed to fetch'))
    renderPass()
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to fetch')
    expect(screen.queryByRole('img', { name: /Check-in QR code/ })).not.toBeInTheDocument()
  })

  it('points a person with no club to Find a court', async () => {
    vi.mocked(api.myMemberPasses).mockResolvedValue([])
    renderPass()
    expect(await screen.findByText(/You have no club pass yet/)).toBeInTheDocument()
    expect(within(screen.getByRole('main')).getByRole('link', { name: 'Find a court' })).toHaveAttribute('href', '/clubs')
  })
})
