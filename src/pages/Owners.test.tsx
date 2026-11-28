import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { addDaysYmd, callDayLabel, monthOfYmd, ownerCallDateRange } from '../lib/ownerRequests'
import { OWNERS_PHOTO } from '../lib/stockPhotos'
import { OwnersPage } from './Owners'

const requestOwnerCall = vi.hoisted(() => vi.fn())

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: null, loading: false, activeClub: null, clubs: [], switchClub: vi.fn(), signOut: vi.fn() }),
}))

vi.mock('../lib/api', () => ({ api: { requestOwnerCall } }))

function renderPage() {
  return render(
    <MemoryRouter>
      <OwnersPage />
    </MemoryRouter>,
  )
}

async function fillIn(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Your name'), 'Ana Reyes')
  await user.type(screen.getByLabelText('Club or venue name'), 'Lagao Smash Courts')
  await user.type(screen.getByLabelText('City'), 'General Santos City')
  await user.clear(screen.getByLabelText('Number of courts'))
  await user.type(screen.getByLabelText('Number of courts'), '4')
  await user.type(screen.getByLabelText('Mobile number (optional)'), '0917 555 0101')
  await user.click(screen.getByRole('radio', { name: /Afternoon/ }))
}

function scrollPrivacyReaderToEnd() {
  const reader = screen.getByRole('region', { name: 'Privacy Notice text' })
  Object.defineProperty(reader, 'scrollHeight', { configurable: true, value: 1000 })
  Object.defineProperty(reader, 'clientHeight', { configurable: true, value: 200 })
  Object.defineProperty(reader, 'scrollTop', { configurable: true, writable: true, value: 790 })
  fireEvent.scroll(reader)
}

async function unlockAndTickConsent(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /Read the Privacy Notice/ }))
  scrollPrivacyReaderToEnd()
  await user.click(screen.getByRole('checkbox', { name: /bRineLy may contact me/ }))
}

beforeEach(() => {
  requestOwnerCall.mockReset()
  requestOwnerCall.mockResolvedValue('request-1')
})

describe('OwnersPage', () => {
  it('explains how listing works and offers a call and an owner account', () => {
    renderPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Take court bookings online, paid straight to your GCash' })).toBeInTheDocument()
    expect(document.title).toContain('List your club')
    const steps = screen.getByRole('heading', { name: 'How listing works' }).closest('section')!
    expect(within(steps).getAllByRole('listitem').map((item) => within(item).getByRole('heading').textContent)).toEqual([
      'Ask us for a call',
      'We set up your club with you',
      'Start taking bookings',
    ])
    // The hero's second button and the note beside the form both lead to the owner sign-up.
    const accountLinks = screen.getAllByRole('link', { name: /Create my owner account/ })
    expect(accountLinks.map((link) => link.textContent)).toEqual(['Already set up? Create my owner account', 'Create my owner account'])
    for (const link of accountLinks) expect(link).toHaveAttribute('href', '/login')
    // The call day starts on today (Philippine time), in a calendar instead of the browser's date box.
    const { min } = ownerCallDateRange()
    const calendar = screen.getByRole('grid', { name: /Day for the call/ })
    expect(within(calendar).getByRole('gridcell', { selected: true })).toHaveAccessibleName(`${callDayLabel(min)}, today`)
    expect(document.querySelector('input[type="date"]')).toBeNull()
  })

  it('takes visitors from the hero straight to the call form', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Pick a time for a call' }))
    expect(screen.getByRole('heading', { name: 'Ask us for a call', level: 2 })).toHaveFocus()
  })

  it('shows what owners get beside a general owners photo', () => {
    renderPage()
    const main = screen.getByRole('main')
    const benefits = within(main).getByRole('heading', { name: 'What you get' }).closest('section')!
    expect(within(benefits).getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual([
      'Your own club page',
      'GCash straight to you',
      'Confirm payments on your phone',
      'A TV board for your courts',
    ])
    const hero = within(main).getByRole('heading', { level: 1 }).closest('section')!
    expect(within(hero).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Your own club page with photos, hours and a map',
      'Players pay your GCash directly',
      'Staff confirm payments from their phone',
      'A TV board for your courts',
    ])
    expect(within(hero).getByText(/Players near you find your courts, book an open hour and pay your club directly\./)).toBeInTheDocument()
    const photo = within(main).getByRole('img', { name: OWNERS_PHOTO.alt })
    expect(photo.getAttribute('srcset')).toContain('800w')
    expect(within(main).queryByText('Sample photo')).not.toBeInTheDocument()
  })

  it('shows the first problem in plain words before sending anything', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Ask for a call' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Enter your name (2 to 80 characters)')

    await fillIn(user)
    const checkbox = screen.getByRole('checkbox', { name: /bRineLy may contact me/ })
    expect(checkbox).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Ask for a call' }))
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Read to the end of the Privacy Notice first, then tick the box.',
    )
    expect(screen.getByRole('region', { name: 'Privacy Notice text' })).toHaveFocus()
    expect(screen.getByRole('link', { name: 'Privacy Notice' })).toHaveAttribute('target', '_blank')
    expect(requestOwnerCall).not.toHaveBeenCalled()

    scrollPrivacyReaderToEnd()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(checkbox).toBeEnabled()
    expect(checkbox).not.toBeChecked()

    await user.click(screen.getByRole('button', { name: 'Ask for a call' }))
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Tick the box so we may contact you and confirm you have read the Privacy Notice.',
    )
    expect(checkbox).toHaveFocus()
    expect(requestOwnerCall).not.toHaveBeenCalled()
  })

  it('sends the request and confirms when we will call', async () => {
    const user = userEvent.setup()
    renderPage()
    await fillIn(user)
    await unlockAndTickConsent(user)
    await user.click(screen.getByRole('button', { name: 'Ask for a call' }))

    expect(requestOwnerCall).toHaveBeenCalledWith({
      full_name: 'Ana Reyes',
      club_name: 'Lagao Smash Courts',
      city: 'General Santos City',
      court_count: 4,
      phone: '0917 555 0101',
      email: '',
      preferred_date: ownerCallDateRange().min,
      preferred_time: 'afternoon',
      message: '',
    })
    const thanks = await screen.findByRole('status')
    expect(thanks).toHaveTextContent('Thank you, Ana')
    expect(thanks).toHaveTextContent(
      `We'll call you today, ${callDayLabel(ownerCallDateRange().min)}, in the afternoon (12 noon to 5 PM), Philippine time.`,
    )
    expect(thanks).toHaveTextContent('Lagao Smash Courts')
    expect(thanks).toHaveTextContent('We will use 0917 555 0101')
    // The form is gone, so focus lands on the thank-you note.
    expect(within(thanks).getByRole('heading', { name: 'Thank you, Ana' })).toHaveFocus()
    expect(screen.queryByRole('button', { name: 'Ask for a call' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'See your call time' })).toBeInTheDocument()
  })

  it('sends the day picked on the calendar and says it back in plain words', async () => {
    const user = userEvent.setup()
    renderPage()
    const { min } = ownerCallDateRange()
    const tomorrow = addDaysYmd(min, 1)
    await fillIn(user)
    if (monthOfYmd(tomorrow) !== monthOfYmd(min)) await user.click(screen.getByRole('button', { name: /^Next month/ }))
    await user.click(screen.getByRole('gridcell', { name: callDayLabel(tomorrow) }))
    expect(
      screen.getByText(`We'll call you tomorrow, ${callDayLabel(tomorrow)}, in the afternoon (12 noon to 5 PM), Philippine time.`),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: /Evening/ }))
    expect(screen.getByText(/in the evening \(5 PM to 8 PM\), Philippine time\.$/)).toBeInTheDocument()
    await unlockAndTickConsent(user)
    await user.click(screen.getByRole('button', { name: 'Ask for a call' }))
    expect(requestOwnerCall).toHaveBeenCalledWith(expect.objectContaining({ preferred_date: tomorrow, preferred_time: 'evening' }))
    expect(await screen.findByRole('status')).toHaveTextContent(`We'll call you tomorrow, ${callDayLabel(tomorrow)}, in the evening`)
  })

  it('shows the database message when a request is refused', async () => {
    requestOwnerCall.mockRejectedValue(new Error('You already asked us to call. We will contact you soon.'))
    const user = userEvent.setup()
    renderPage()
    await fillIn(user)
    await unlockAndTickConsent(user)
    await user.click(screen.getByRole('button', { name: 'Ask for a call' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('You already asked us to call. We will contact you soon.')
    expect(screen.getByRole('button', { name: 'Ask for a call' })).toBeEnabled()
  })

  it('quietly drops a request when the hidden field was filled in by a bot', async () => {
    const user = userEvent.setup()
    const { container } = renderPage()
    await fillIn(user)
    await unlockAndTickConsent(user)
    await user.type(container.querySelector('input[name="website"]')!, 'http://spam.example')
    await user.click(screen.getByRole('button', { name: 'Ask for a call' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Thank you, Ana')
    expect(requestOwnerCall).not.toHaveBeenCalled()
  })
})
