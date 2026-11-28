import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

// Both locations now open 6:00 AM to 10:00 PM.
const club: PublicClubDetail = {
  slug: 'rally-point-gensan', name: 'Rally Point Gensan', city: null, address: null,
  venues: [
    {
      id: 'v-main', name: 'Main Hall', open_hour: 6, close_hour: 22, address: null, city: null, latitude: null, longitude: null,
      courts: [{ id: 'c-a', name: 'Court A', hourly_rate: 500, member_rate: null, in_service: true }],
    },
    {
      id: 'v-lagao', name: 'Lagao', open_hour: 6, close_hour: 22, address: null, city: null, latitude: null, longitude: null,
      courts: [{ id: 'c-c', name: 'Court C', hourly_rate: 650, member_rate: null, in_service: true }],
    },
  ],
}

// Booked at 11:00 PM, before the hours changed.
const lateBooking = {
  id: 'blk-late', kind: 'booking', court_id: 'c-c', court_name: 'Court C', venue_id: 'v-lagao', venue_name: 'Lagao',
  title: 'Late booking', ...localRangeISO(ymdLocal(new Date()), 23, 1), status: 'confirmed',
} as unknown as ScheduleBlock

describe('schedule board with opening hours', () => {
  beforeEach(() => {
    vi.mocked(api.publicClub).mockReset().mockResolvedValue({ id: 'club-gensan', slug: 'rally-point-gensan', name: 'Rally Point Gensan' })
    vi.mocked(api.publicClubDetail).mockReset().mockResolvedValue(club)
    vi.mocked(api.publicDaySchedule).mockReset().mockResolvedValue([lateBooking])
  })

  it('still shows a booking outside the new hours, and marks closed hours', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/board/tv/rally-point-gensan']}>
        <Routes>
          <Route path="/board/tv/:slug" element={<TvBoard />} />
        </Routes>
      </MemoryRouter>,
    )
    await screen.findAllByText('Late booking')
    const grid = container.querySelector('.min-w-\\[720px\\]')
    if (!grid) throw new Error('Expected the time grid')
    expect(grid).toHaveTextContent('Late booking')
    expect(grid).toHaveTextContent('11:00 PM')
    expect(grid).toHaveTextContent('Closed')
  })

  describe('after closing time', () => {
    beforeEach(() => {
      // 9:30 PM in the Philippines (UTC+8); only the date is faked, so timers still run.
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-11-15T13:30:00Z'))
    })
    afterEach(() => vi.useRealTimers())

    it("shows today's whole day on the TV board instead of an empty grid", async () => {
      const closesAtEight = { ...club, venues: club.venues.map((venue) => ({ ...venue, close_hour: 20 })) }
      vi.mocked(api.publicClubDetail).mockResolvedValue(closesAtEight)
      vi.mocked(api.publicDaySchedule).mockResolvedValue([])
      const { container } = render(
        <MemoryRouter initialEntries={['/board/tv/rally-point-gensan']}>
          <Routes>
            <Route path="/board/tv/:slug" element={<TvBoard />} />
          </Routes>
        </MemoryRouter>,
      )
      await screen.findAllByText('Court C')
      const grid = container.querySelector('.min-w-\\[720px\\]')
      if (!grid) throw new Error('Expected the time grid')
      await waitFor(() => expect(grid).toHaveTextContent('6:00 AM'))
      expect(grid).toHaveTextContent('7:00 PM')
      expect(grid).not.toHaveTextContent('8:00 PM')
    })
  })
})
