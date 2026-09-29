import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Notification, Profile, SupportInquiry } from '../types'
import { HelpPage } from './HelpPage'

const { authState } = vi.hoisted(() => ({
  authState: { user: null as Profile | null },
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: authState.user,
    signOut: vi.fn(),
  }),
}))

vi.mock('../lib/api', () => ({
  api: {
    createInquiry: vi.fn(),
    inquiries: vi.fn(),
    notifications: vi.fn(),
    updateInquiry: vi.fn(),
    markNotifRead: vi.fn(),
  },
}))

import { api } from '../lib/api'

const staffUser = {
  id: 'staff-1',
  email: 'staff@example.com',
  full_name: 'Sam Staff',
  role: 'staff',
  created_at: '2026-09-01T00:00:00.000Z',
} satisfies Profile

const adminUser = {
  id: 'admin-1',
  email: 'admin@example.com',
  full_name: 'Alex Admin',
  role: 'admin',
  created_at: '2026-09-01T00:00:00.000Z',
} satisfies Profile

const inquiry = {
  id: 'inquiry-1',
  club_id: 'club_rally_point',
  user_id: staffUser.id,
  category: 'booking',
  subject: 'Schedule access',
  message: 'Please help with the schedule.',
  status: 'open',
  created_at: '2026-09-27T08:00:00.000Z',
  response: null,
  responded_by: null,
  responded_at: null,
  sender: { id: staffUser.id, full_name: staffUser.full_name, email: staffUser.email },
} satisfies SupportInquiry

const updateNotification = {
  id: 'notification-1',
  user_id: staffUser.id,
  title: 'Inquiry update',
  body: 'Your inquiry "Schedule access" is now in progress.',
  read: false,
  created_at: '2026-09-27T09:00:00.000Z',
} satisfies Notification

function renderHelp() {
  return render(
    <MemoryRouter>
      <HelpPage />
    </MemoryRouter>,
  )
}

describe('Help inquiry workflow', () => {
  beforeEach(() => {
    authState.user = staffUser
    vi.mocked(api.createInquiry).mockReset()
    vi.mocked(api.inquiries).mockReset().mockResolvedValue([inquiry])
    vi.mocked(api.notifications).mockReset().mockResolvedValue([updateNotification])
    vi.mocked(api.updateInquiry).mockReset().mockResolvedValue(inquiry)
    vi.mocked(api.markNotifRead).mockReset().mockResolvedValue(undefined)
  })

  it('shows a staff member their own history, reply status, and readable in-app update', async () => {
    const user = userEvent.setup()
    renderHelp()

    expect(await screen.findByRole('heading', { name: 'Your inquiries' })).toBeInTheDocument()
    expect(await screen.findByText('Schedule access')).toBeInTheDocument()
    expect(screen.getByText(updateNotification.body)).toBeInTheDocument()
    expect(api.inquiries).toHaveBeenCalledWith(staffUser.id, 'staff')

    await user.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(api.inquiries).toHaveBeenCalledTimes(2))

    await user.click(screen.getByRole('button', { name: 'Mark read' }))
    expect(api.markNotifRead).toHaveBeenCalledWith(updateNotification.id)
  })

  it('lets an Admin change status and submit one reply', async () => {
    const user = userEvent.setup()
    authState.user = adminUser
    renderHelp()

    const inbox = await screen.findByRole('heading', { name: 'Inquiry inbox' })
    expect(inbox).toBeInTheDocument()
    expect(await screen.findByText((_, element) =>
      element?.tagName === 'P' &&
      (element.textContent?.includes(`${staffUser.full_name} · ${staffUser.email} · booking`) ?? false),
    )).toBeInTheDocument()
    expect(api.inquiries).toHaveBeenCalledWith(adminUser.id, 'admin')

    await user.selectOptions(screen.getByLabelText('Status'), 'in_progress')
    await user.type(screen.getByLabelText('Admin reply (one reply per inquiry)'), 'I updated your access.')
    await user.click(screen.getByRole('button', { name: 'Save update' }))

    await waitFor(() => {
      expect(api.updateInquiry).toHaveBeenCalledWith({
        id: inquiry.id,
        status: 'in_progress',
        response: 'I updated your access.',
      })
    })
    expect(await screen.findByRole('status')).toHaveTextContent('Inquiry update saved.')
  })

  it('keeps status editing enabled independently after resolving a different inquiry', async () => {
    const user = userEvent.setup()
    authState.user = adminUser
    const newerInquiry = {
      ...inquiry,
      id: 'inquiry-newer',
      subject: 'Newer schedule concern',
      created_at: '2026-09-28T10:00:00.000Z',
    }
    let currentInquiries: SupportInquiry[] = [newerInquiry, inquiry]
    vi.mocked(api.inquiries).mockImplementation(async () => currentInquiries)
    vi.mocked(api.updateInquiry).mockImplementation(async ({ id, status, response }) => {
      currentInquiries = currentInquiries.map((row) =>
        row.id === id
          ? {
              ...row,
              status,
              response: response ?? row.response,
              responded_by: response ? adminUser.id : row.responded_by,
              responded_at: response ? '2026-09-28T11:00:00.000Z' : row.responded_at,
            }
          : row,
      )
      return currentInquiries.find((row) => row.id === id)!
    })
    renderHelp()

    const firstHeading = await screen.findByRole('heading', { name: 'Newer schedule concern' })
    const firstCard = firstHeading.closest('article')
    const secondCard = screen.getByRole('heading', { name: 'Schedule access' }).closest('article')
    if (!firstCard || !secondCard) throw new Error('Expected two independent inquiry cards')

    expect(within(firstCard).getByRole('button', { name: 'Save update' })).toBeDisabled()
    expect(within(firstCard).getByRole('note')).toHaveTextContent(
      'Choose a different status or write a reply to enable Save update.',
    )

    await user.selectOptions(within(secondCard).getByLabelText('Status'), 'resolved')
    const resolveButton = within(secondCard).getByRole('button', { name: 'Save update' })
    expect(resolveButton).toBeEnabled()
    await user.click(resolveButton)
    await waitFor(() => expect(within(secondCard).getByLabelText('Status')).toHaveValue('resolved'))

    const newerStatus = within(firstCard).getByLabelText('Status')
    await user.selectOptions(newerStatus, 'in_progress')
    const newerSave = within(firstCard).getByRole('button', { name: 'Save update' })
    expect(newerSave).toBeEnabled()
    await user.click(newerSave)

    await waitFor(() => {
      expect(api.updateInquiry).toHaveBeenLastCalledWith({
        id: 'inquiry-newer',
        status: 'in_progress',
        response: undefined,
      })
    })
    await waitFor(() => expect(within(firstCard).getByLabelText('Status')).toHaveValue('in_progress'))
  })
})
