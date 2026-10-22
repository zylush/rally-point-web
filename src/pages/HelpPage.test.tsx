import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

const superadminUser = {
  id: 'superadmin-1',
  email: 'superadmin@example.com',
  full_name: 'Alex Superadmin',
  role: 'superadmin',
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

  it('starts member Help sections collapsed and lets multiple sections stay open', async () => {
    const user = userEvent.setup()
    authState.user = null
    renderHelp()

    const faqHeading = screen.getByRole('heading', { name: 'Quick answers' })
    const contactHeading = screen.getByRole('heading', { name: 'Contact staff' })
    const faqSection = faqHeading.closest('details')
    const contactSection = contactHeading.closest('details')
    if (!faqSection || !contactSection) throw new Error('Expected Help section disclosures')

    expect(faqSection.open).toBe(false)
    expect(contactSection.open).toBe(false)
    expect(screen.getByText('How do I book a court?')).not.toBeVisible()
    const contactLink = screen.getByRole('link', { name: /support@rallypointgensan\.com/ })
    expect(contactLink).not.toBeVisible()

    await user.click(faqHeading)
    await user.click(contactHeading)

    expect(faqSection.open).toBe(true)
    expect(contactSection.open).toBe(true)
    expect(screen.getByText('How do I book a court?')).toBeVisible()
    expect(contactLink).toBeVisible()
    await user.click(screen.getByText('How do I book a court?'))
    expect(screen.getByRole('link', { name: 'Go to Book' })).toHaveAttribute('href', '/member/book')
  })

  it('places Contact after all role-specific Help sections', () => {
    authState.user = null
    let view = renderHelp()
    const sectionTitles = () =>
      Array.from(document.querySelectorAll('main > details > summary [role="heading"]'))
        .map((heading) => heading.textContent)

    expect(sectionTitles()).toEqual(['Quick answers', 'Contact staff'])

    view.unmount()
    authState.user = staffUser
    view = renderHelp()
    expect(sectionTitles()).toEqual([
      'Quick answers',
      'Ask a question or submit an inquiry',
      'Your inquiries',
      'Contact admin',
    ])

    view.unmount()
    authState.user = adminUser
    view = renderHelp()
    expect(sectionTitles()).toEqual([
      'Quick answers',
      'Ask a question or submit an inquiry',
      'Inquiry inbox',
      'Contact superadmin',
    ])

    view.unmount()
    authState.user = superadminUser
    view = renderHelp()
    expect(sectionTitles()).toEqual(['Quick answers', 'Platform operations'])
  })

  it('places a Privacy Notice link after Contact Us for members only', () => {
    authState.user = null
    const view = renderHelp()
    const contact = screen.getByRole('heading', { name: 'Contact staff' }).closest('details')
    const privacySection = screen.getByRole('heading', { name: 'Privacy Notice' }).closest('section')

    expect(contact).not.toBeNull()
    expect(privacySection).not.toBeNull()
    expect(contact!.compareDocumentPosition(privacySection!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Read the Privacy Notice' })).toHaveAttribute('href', '/privacy')
    view.unmount()
    authState.user = staffUser
    renderHelp()
    expect(screen.queryByRole('link', { name: 'Read the Privacy Notice' })).not.toBeInTheDocument()
  })

  it('shows role-specific quick answers with links to existing destinations', async () => {
    const user = userEvent.setup()
    authState.user = staffUser
    const { unmount } = renderHelp()

    await user.click(screen.getByRole('heading', { name: 'Quick answers' }))
    expect(screen.getByText('Where can I check in a member?')).toBeVisible()
    expect(screen.queryByText('How do I book a court?')).not.toBeInTheDocument()
    await user.click(screen.getByText('Where can I check in a member?'))
    expect(screen.getByRole('link', { name: 'Go to Check in' })).toHaveAttribute('href', '/staff/checkin')

    unmount()
    authState.user = adminUser
    renderHelp()
    await user.click(screen.getByRole('heading', { name: 'Quick answers' }))
    expect(screen.getByText('Where can I review bookings?')).toBeVisible()
    expect(screen.queryByText('Where can I check in a member?')).not.toBeInTheDocument()
  })

  it('keeps superadmin platform contacts but hides inquiry tools and does not load inquiries', async () => {
    const user = userEvent.setup()
    authState.user = superadminUser
    renderHelp()

    const contactHeading = await screen.findByRole('heading', { name: 'Platform operations' })
    expect(screen.queryByRole('heading', { name: 'Ask a question or submit an inquiry' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Your inquiries' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Inquiry inbox' })).not.toBeInTheDocument()
    expect(api.inquiries).not.toHaveBeenCalled()

    await user.click(contactHeading)
    expect(screen.getByRole('link', { name: /ops@rallypoint\.ph/ })).toBeVisible()
    expect(screen.getByRole('link', { name: /\+63 917 555 0199/ })).toBeVisible()

    expect(api.createInquiry).not.toHaveBeenCalled()
    expect(api.inquiries).not.toHaveBeenCalled()
    expect(api.notifications).not.toHaveBeenCalled()
  })

  it('shows a staff member their own history, reply status, and readable in-app update', async () => {
    const user = userEvent.setup()
    renderHelp()

    const inquiriesHeading = await screen.findByRole('heading', { name: 'Your inquiries' })
    const inquiryFormHeading = screen.getByRole('heading', { name: 'Ask a question or submit an inquiry' })
    const inquiryFormSection = inquiryFormHeading.closest('details')
    if (!inquiryFormSection) throw new Error('Expected inquiry form disclosure')
    expect(inquiryFormSection.open).toBe(false)
    expect(api.inquiries).not.toHaveBeenCalled()
    // The unread count shows on the collapsed section, before history is loaded.
    expect(await screen.findByText('1 unread update')).toBeInTheDocument()
    expect(api.notifications).toHaveBeenCalledWith(staffUser.id)
    expect(api.inquiries).not.toHaveBeenCalled()
    await user.click(inquiriesHeading)
    expect(await screen.findByText('Schedule access')).toBeInTheDocument()
    expect(screen.getByText(updateNotification.body)).toBeInTheDocument()
    expect(api.inquiries).toHaveBeenCalledWith(staffUser.id, 'staff')
    expect(screen.getByText('1 unread update')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(api.inquiries).toHaveBeenCalledTimes(2))

    await user.click(screen.getByRole('button', { name: 'Mark read' }))
    expect(api.markNotifRead).toHaveBeenCalledWith(updateNotification.id)
  })

  it('reloads after a submit even while an earlier load is still running, and keeps the newer result', async () => {
    const user = userEvent.setup()
    let finishFirstLoad: (rows: SupportInquiry[]) => void = () => {}
    const sentInquiry = { ...inquiry, id: 'inquiry-2', subject: 'New question' }
    vi.mocked(api.inquiries)
      .mockImplementationOnce(() => new Promise((resolve) => { finishFirstLoad = resolve }))
      .mockResolvedValueOnce([sentInquiry, inquiry])
    vi.mocked(api.createInquiry).mockResolvedValue(sentInquiry)
    renderHelp()

    await user.click(await screen.findByRole('heading', { name: 'Your inquiries' }))
    expect(api.inquiries).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('heading', { name: 'Ask a question or submit an inquiry' }))
    await user.type(screen.getByLabelText('Subject'), 'New question')
    await user.type(screen.getByLabelText('Your question or details'), 'Please check my booking.')
    await user.click(screen.getByRole('button', { name: 'Send inquiry' }))

    await waitFor(() => expect(api.inquiries).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole('heading', { name: 'New question' })).toBeInTheDocument()

    // The slower first load finishes last with older rows; they must not replace the newer list.
    await act(async () => finishFirstLoad([inquiry]))
    expect(screen.getByRole('heading', { name: 'New question' })).toBeInTheDocument()
  })

  it('fades and removes a successful inquiry confirmation after four seconds', async () => {
    const user = userEvent.setup()
    const view = renderHelp()
    try {
      await user.click(screen.getByRole('heading', { name: 'Ask a question or submit an inquiry' }))
      await user.type(screen.getByLabelText('Subject'), 'Court booking question')
      await user.type(screen.getByLabelText('Your question or details'), 'Please check my booking.')

      vi.useFakeTimers()
      const form = screen.getByRole('button', { name: 'Send inquiry' }).closest('form')
      if (!form) throw new Error('Expected inquiry form')
      await act(async () => {
        fireEvent.submit(form)
        await Promise.resolve()
      })
      const toast = screen.getByRole('status')
      expect(toast).toHaveTextContent('Your inquiry was sent. The team will follow up.')
      expect(toast).not.toHaveClass('opacity-0')

      act(() => vi.advanceTimersByTime(4000))
      expect(screen.getByRole('status')).toHaveClass('opacity-0')

      act(() => vi.advanceTimersByTime(300))
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    } finally {
      view.unmount()
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })

  it('keeps inquiry submission errors visible after the success timeout', async () => {
    const user = userEvent.setup()
    vi.mocked(api.createInquiry).mockRejectedValue(new Error('Unable to reach the server.'))
    const view = renderHelp()
    try {
      await user.click(screen.getByRole('heading', { name: 'Ask a question or submit an inquiry' }))
      await user.type(screen.getByLabelText('Subject'), 'Court booking question')
      await user.type(screen.getByLabelText('Your question or details'), 'Please check my booking.')

      vi.useFakeTimers()
      const form = screen.getByRole('button', { name: 'Send inquiry' }).closest('form')
      if (!form) throw new Error('Expected inquiry form')
      await act(async () => {
        fireEvent.submit(form)
        await Promise.resolve()
      })
      expect(screen.getByRole('status')).toHaveTextContent('Unable to reach the server.')

      act(() => vi.advanceTimersByTime(10000))
      expect(screen.getByRole('status')).toHaveTextContent('Unable to reach the server.')
      expect(screen.getByRole('status')).not.toHaveClass('opacity-0')
    } finally {
      view.unmount()
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })

  it('lets an Admin change status and submit one reply', async () => {
    const user = userEvent.setup()
    authState.user = adminUser
    renderHelp()

    const inbox = await screen.findByRole('heading', { name: 'Inquiry inbox' })
    const inquiryFormHeading = screen.getByRole('heading', { name: 'Ask a question or submit an inquiry' })
    const inboxSection = inbox.closest('details')
    const inquiryFormSection = inquiryFormHeading.closest('details')
    if (!inboxSection || !inquiryFormSection) throw new Error('Expected Admin Help disclosures')
    expect(inboxSection.open).toBe(false)
    expect(inquiryFormSection.open).toBe(false)
    expect(inbox).toBeInTheDocument()
    expect(api.inquiries).not.toHaveBeenCalled()
    await user.click(inbox)
    expect(await screen.findByText((_, element) =>
      element?.tagName === 'P' &&
      (element.textContent?.includes(`${staffUser.full_name} · ${staffUser.email} · booking`) ?? false),
    )).toBeInTheDocument()
    expect(api.inquiries).toHaveBeenCalledWith(adminUser.id, 'admin')
    expect(await screen.findByText('1 open inquiry')).toBeInTheDocument()

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

    await user.click(await screen.findByRole('heading', { name: 'Inquiry inbox' }))
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
