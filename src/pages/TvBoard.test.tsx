import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PublicClubDetail, ScheduleBlock } from '../types'
import { localRangeISO, ymdLocal } from '../types'
import { TvBoard } from './ScheduleBoard'

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: null, activeClub: null, clubs: [], switchClub: vi.fn(), signOut: vi.fn() }),
}))

vi.mock('../lib/api', () => ({
  api: { publicClub: vi.fn(), publicClubDetail: vi.fn(), publicDaySchedule: vi.fn() },
}))

import { api } from '../lib/api'

const club: PublicClubDetail = {
  slug: 'rally-point-gensan', name: 'Rally Point Gensan', city: 'General Santos City', address: null,
  venues: [
    {
      id: 'v-main', name: 'Main Hall', open_hour: 0, close_hour: 24, address: null, city: null, latitude: null, longitude: null,
      courts: [
        { id: 'c-a', name: 'Court A', hourly_rate: 500, member_rate: null, in_service: true },
        { id: 'c-b', name: 'Court B', hourly_rate: 500, member_rate: null, in_service: false },
      ],
    },
    {
      id: 'v-lagao', name: 'Lagao', open_hour: 0, close_hour: 24, address: null, city: null, latitude: null, longitude: null,
      courts: [{ id: 'c-c', name: 'Court C', hourly_rate: 650, member_rate: 550, in_service: true }],
    },
  ],
}

const today = ymdLocal(new Date())
const booked = {
  id: 'blk-1', kind: 'booking', court_id: 'c-c', court_name: 'Court C', venue_id: 'v-lagao', venue_name: 'Lagao',
  title: 'Reserved', ...localRangeISO(today, 23, 1), status: 'confirmed',
} as unknown as ScheduleBlock

function Where() {
  return <p data-testid="where">{useLocation().search}</p>
}

function renderBoard(path = '/board/tv/rally-point-gensan') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/board/tv/:slug" element={<><TvBoard /><Where /></>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('TV board', () => {
  beforeEach(() => {
    vi.mocked(api.publicClub).mockReset().mockResolvedValue({ id: 'club-gensan', slug: 'rally-point-gensan', name: 'Rally Point Gensan' })
    vi.mocked(api.publicClubDetail).mockReset().mockResolvedValue(club)
    vi.mocked(api.publicDaySchedule).mockReset().mockResolvedValue([booked])
  })

  it('lists every court of every location, free or booked, and marks courts out of service', async () => {
    renderBoard()

    expect(await screen.findByText('3 courts · 1 booking today')).toBeInTheDocument()
    for (const name of ['Court A', 'Court B', 'Court C']) {
      expect(screen.getAllByText(name).length).toBeGreaterThan(0)
    }
    expect(screen.getAllByText('Out of service').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Free').length).toBe(1)
    expect(screen.getAllByText('1 booked').length).toBe(1)
    expect(screen.getAllByText('Lagao').length).toBeGreaterThan(0)
    expect(api.publicDaySchedule).toHaveBeenCalledWith(today, undefined, 'club-gensan')
  })

  it('narrows to one location and keeps the choice in the link', async () => {
    const user = userEvent.setup()
    vi.mocked(api.publicDaySchedule).mockResolvedValue([])
    renderBoard()

    const picker = await screen.findByLabelText('Location')
    expect(within(picker).getAllByRole('option').map((o) => o.textContent)).toEqual(['All locations', 'Main Hall', 'Lagao'])
    await user.selectOptions(picker, 'v-lagao')

    await waitFor(() => expect(api.publicDaySchedule).toHaveBeenLastCalledWith(today, 'v-lagao', 'club-gensan'))
    expect(screen.getByTestId('where')).toHaveTextContent('?venue=v-lagao')
    expect(await screen.findByText('1 court · 0 bookings today')).toBeInTheDocument()
    expect(screen.queryAllByText('Court A')).toHaveLength(0)
  })

  it('opens on the location named in its link', async () => {
    vi.mocked(api.publicDaySchedule).mockResolvedValue([])
    renderBoard('/board/tv/rally-point-gensan?venue=v-main')

    expect(await screen.findByText('2 courts · 0 bookings today')).toBeInTheDocument()
    expect(screen.getByText(/Main Hall · Live board/)).toBeInTheDocument()
  })
})
