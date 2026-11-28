import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { demoStore } from '../lib/demoStore'
import { setActiveClubId } from '../lib/clubContext'
import { ymdLocal } from '../types'
import { SuperadminPage } from './Superadmin'

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'user_superadmin', email: 'superadmin@brinely.info', full_name: 'Morgan Superadmin', role: 'superadmin', created_at: '2026-01-01T00:00:00.000Z' },
    loading: false,
    demo: true,
    clubs: [],
    activeClub: null,
    switchClub: vi.fn(),
    signOut: vi.fn(),
  }),
}))

function renderSection(section: 'overview' | 'clubs' | 'ledger' | 'requests', path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SuperadminPage section={section} />
    </MemoryRouter>,
  )
}

/** A club's row in the clubs list: a button named by the club, which opens its actions. */
function clubRow(name: string) {
  return screen.getByRole('button', { name: new RegExp(`^${name}`) })
}

/** Opens one club's row and returns its actions. */
async function openClub(user: ReturnType<typeof userEvent.setup>, name: string) {
  const row = await screen.findByRole('button', { name: new RegExp(`^${name}`) })
  if (row.getAttribute('aria-expanded') !== 'true') await user.click(row)
  expect(row).toHaveAttribute('aria-expanded', 'true')
  return screen.getByRole('article', { name })
}

/** The names of the clubs listed, in order; none is open in the tests that use it. */
function listedClubs() {
  return within(screen.getByRole('region', { name: 'All clubs' }))
    .getAllByRole('button', { expanded: false })
    .map((row) => row.querySelector('span span')?.textContent)
}

function setUpClubs(count: number, prefix = 'Test Club') {
  for (let index = 1; index <= count; index += 1) {
    const number = String(index).padStart(2, '0')
    demoStore.provisionClub({
      name: `${prefix} ${number}`,
      slug: `${prefix.toLowerCase().replace(/ /g, '-')}-${number}`,
      city: 'Cebu City',
      address: '',
      contact_email: '',
      contact_phone: '',
      booking_fee: 20,
      court_count: 2,
    })
  }
}

beforeEach(() => {
  setActiveClubId(null)
  demoStore.reset()
  demoStore.login('superadmin@brinely.info', 'superadmin123')
})

function askForCall() {
  return demoStore.requestOwnerCall({
    full_name: 'Ana Reyes',
    club_name: 'Lagao Smash Courts',
    city: 'General Santos City',
    court_count: 4,
    phone: '0917 555 0101',
    email: 'ana.owner@example.invalid',
    preferred_date: ymdLocal(new Date()),
    preferred_time: 'evening',
    message: 'Six indoor courts',
  })
}

describe('SuperadminPage', () => {
  it('shows platform totals and every club, labelled as recorded rather than collected money', async () => {
    renderSection('overview')
    expect(await screen.findByRole('heading', { name: 'Platform overview' })).toBeInTheDocument()
    const totals = screen.getByRole('region', { name: 'Platform totals' })
    expect(within(totals).getByText('Commission revenue')).toBeInTheDocument()
    expect(within(totals).getByText('Active clubs')).toBeInTheDocument()
    expect(within(totals).getByText('2')).toBeInTheDocument()
    expect(screen.getByText(/not collected money/)).toBeInTheDocument()
    const glance = screen.getByRole('region', { name: 'Clubs at a glance' })
    expect(within(glance).getByText('Rally Point Gensan')).toBeInTheDocument()
    expect(within(glance).getByText('Rally Point Davao')).toBeInTheDocument()
  })

  it('sets up a club in setup, refuses to activate it without an admin, then activates it once an admin is added', async () => {
    const user = userEvent.setup()
    renderSection('clubs')
    await user.click(await screen.findByRole('button', { name: /Set up a club/ }))
    const dialog = screen.getByRole('dialog', { name: 'Set up a club' })
    await user.type(within(dialog).getByLabelText('Club name'), 'Cebu Hub')
    expect(within(dialog).getByLabelText('Link name')).toHaveValue('cebu-hub')
    await user.click(within(dialog).getByRole('button', { name: 'Set up club' }))

    expect(await screen.findByText('Cebu Hub is set up. Assign an admin, then activate it.')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // The new club opens by itself, flagged as needing an admin.
    expect(clubRow('Cebu Hub')).toHaveAttribute('aria-expanded', 'true')
    expect(clubRow('Cebu Hub')).toHaveTextContent(/In setup.*Needs an admin/)
    const card = screen.getByRole('article', { name: 'Cebu Hub' })
    expect(within(card).getByText('#/join/cebu-hub')).toBeInTheDocument()

    await user.click(within(card).getByRole('button', { name: 'Activate' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Assign a club admin before activating this club')

    await user.type(within(card).getByLabelText('Add an admin by email'), 'member@brinely.info')
    await user.click(within(card).getByRole('button', { name: 'Add admin' }))
    expect(await screen.findByText('member@brinely.info is now an admin of Cebu Hub.')).toBeInTheDocument()

    await user.click(within(screen.getByRole('article', { name: 'Cebu Hub' })).getByRole('button', { name: 'Activate' }))
    expect(await screen.findByText('Cebu Hub is now active.')).toBeInTheDocument()
    await waitFor(() => expect(clubRow('Cebu Hub')).toHaveTextContent('Active'))
    expect(clubRow('Cebu Hub')).not.toHaveTextContent('Needs an admin')
  })

  it("sets a club's platform fee in pesos per booking, never as a percentage", async () => {
    const user = userEvent.setup()
    renderSection('clubs')
    const davao = await openClub(user, 'Rally Point Davao')
    const fee = within(davao).getByLabelText('Booking fee (₱)')
    expect(fee).toHaveValue(25)
    expect(within(davao).queryByText(/%/)).not.toBeInTheDocument()
    await user.clear(fee)
    await user.type(fee, '40')
    await user.click(within(davao).getByRole('button', { name: 'Save fee' }))
    expect(await screen.findByText('Rally Point Davao booking fee set to Php 40.00.')).toBeInTheDocument()
    await waitFor(() => expect(clubRow('Rally Point Davao')).toHaveTextContent('Php 40.00'))
    expect(demoStore.platformClubs().find((club) => club.name === 'Rally Point Davao')?.booking_fee).toBe(40)
    expect(demoStore.platformRecentActions(1)[0]).toMatchObject({ action: 'club.booking_fee', details: { from: 25, to: 40 } })
  })

  it('never offers to suspend the default sign-up club', async () => {
    const user = userEvent.setup()
    renderSection('clubs')
    const gensan = await openClub(user, 'Rally Point Gensan')
    expect(within(gensan).getByText('Default sign-up club')).toBeInTheDocument()
    expect(within(gensan).queryByRole('button', { name: 'Suspend' })).not.toBeInTheDocument()
    // One club is open at a time.
    const davao = await openClub(user, 'Rally Point Davao')
    expect(clubRow('Rally Point Gensan')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('article', { name: 'Rally Point Gensan' })).not.toBeInTheDocument()
    expect(within(davao).getByRole('button', { name: 'Suspend' })).toBeInTheDocument()
  })

  it('filters the commission ledger by club', async () => {
    const user = userEvent.setup()
    renderSection('ledger')
    expect(await screen.findByRole('heading', { name: 'Fee ledger' })).toBeInTheDocument()
    expect((await screen.findAllByText('Rally Point Davao')).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Recorded, not verified/).length).toBeGreaterThan(0)

    const davaoId = demoStore.platformClubs().find((club) => club.name === 'Rally Point Davao')!.club_id
    await user.selectOptions(screen.getByLabelText('Club'), davaoId)
    await waitFor(() => {
      const lines = screen.getAllByRole('listitem')
      expect(lines.length).toBeGreaterThan(0)
      lines.forEach((line) => expect(line).toHaveTextContent('Rally Point Davao'))
    })
  })

  it('opens a logged, read-only support view of a club and closes it again', async () => {
    const user = userEvent.setup()
    renderSection('clubs')
    const davao = await openClub(user, 'Rally Point Davao')
    await user.click(within(davao).getByRole('button', { name: /Open support view/ }))
    const dialog = screen.getByRole('dialog', { name: 'Support view of Rally Point Davao' })
    await user.type(within(dialog).getByLabelText('Reason'), 'Checking a court booking complaint')
    await user.click(within(dialog).getByRole('button', { name: 'Open support view' }))

    expect(await screen.findByText('Support view of Rally Point Davao is open for 30 minutes.')).toBeInTheDocument()
    const panel = within(screen.getByRole('region', { name: 'Rally Point Davao support view' }))
    expect(await panel.findByText(/Support view open until/)).toBeInTheDocument()
    expect(await panel.findByText(/^Members: \d+/)).toBeInTheDocument()
    // The button that opened the dialog is gone, so focus lands on the support area.
    await waitFor(() => expect(screen.getByRole('region', { name: 'Rally Point Davao support view' })).toHaveFocus())
    expect(demoStore.platformRecentActions(5).map((action) => action.action)).toEqual(expect.arrayContaining(['support.start', 'support.read']))

    await user.click(panel.getByRole('button', { name: 'End support view' }))
    expect(await screen.findByText('Support view of Rally Point Davao closed.')).toBeInTheDocument()
    expect(await within(screen.getByRole('article', { name: 'Rally Point Davao' })).findByRole('button', { name: /Open support view/ })).toBeInTheDocument()
  })

  it('refuses a support view without a real reason', async () => {
    const davaoId = demoStore.platformClubs().find((club) => club.name === 'Rally Point Davao')!.club_id
    expect(() => demoStore.startSupportSession(davaoId, 'short', 30)).toThrow('Give a reason of at least 10 characters')
    expect(() => demoStore.startSupportSession(davaoId, 'Checking a court complaint', 200)).toThrow('Choose between 5 and 120 minutes')
  })

  it('closes the set-up dialog with Escape', async () => {
    const user = userEvent.setup()
    renderSection('clubs')
    await user.click(await screen.findByRole('button', { name: /Set up a club/ }))
    expect(screen.getByRole('dialog', { name: 'Set up a club' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps Tab inside a dialog and returns focus to the button that opened it', async () => {
    const user = userEvent.setup()
    renderSection('clubs')
    const opener = await screen.findByRole('button', { name: /Set up a club/ })
    await user.click(opener)
    const dialog = screen.getByRole('dialog', { name: 'Set up a club' })
    expect(within(dialog).getByLabelText('Club name')).toHaveFocus()

    await user.tab({ shift: true })
    expect(within(dialog).getByRole('button', { name: 'Set up club' })).toHaveFocus()
    await user.tab()
    expect(within(dialog).getByLabelText('Club name')).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })

  it('shows a failed set-up inside the dialog, where a phone screen can still see it', async () => {
    const user = userEvent.setup()
    renderSection('clubs')
    await user.click(await screen.findByRole('button', { name: /Set up a club/ }))
    const dialog = screen.getByRole('dialog', { name: 'Set up a club' })
    await user.type(within(dialog).getByLabelText('Club name'), 'Rally Point Davao')
    await user.click(within(dialog).getByRole('button', { name: 'Set up club' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('That link name is already used by another club')
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(screen.getByRole('dialog', { name: 'Set up a club' })).toBeInTheDocument()
  })

  it('lists owner call requests, marks one as called, and sets up its club with the owner invited', async () => {
    askForCall()
    const user = userEvent.setup()
    renderSection('requests')
    expect(await screen.findByRole('heading', { level: 1, name: 'Owner requests' })).toBeInTheDocument()
    const card = await screen.findByRole('article', { name: 'Lagao Smash Courts' })
    expect(within(card).getByText('Ana Reyes')).toBeInTheDocument()
    expect(within(card).getByText('Six indoor courts')).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: /0917 555 0101/ })).toHaveAttribute('href', 'tel:09175550101')

    await user.click(within(card).getByRole('button', { name: 'Mark as called' }))
    expect(await screen.findByText('Marked Lagao Smash Courts as called.')).toBeInTheDocument()
    expect(await screen.findByText('No new requests.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^Called/ }))
    const called = await screen.findByRole('article', { name: 'Lagao Smash Courts' })
    await user.click(within(called).getByRole('button', { name: 'Set up this club' }))
    const dialog = screen.getByRole('dialog', { name: 'Set up a club' })
    expect(within(dialog).getByLabelText('Club name')).toHaveValue('Lagao Smash Courts')
    expect(within(dialog).getByLabelText('Link name')).toHaveValue('lagao-smash-courts')
    expect(within(dialog).getByLabelText('Courts')).toHaveValue(4)
    expect(within(dialog).getByLabelText('Owner’s email (optional)')).toHaveValue('ana.owner@example.invalid')
    await user.click(within(dialog).getByRole('button', { name: 'Set up club' }))

    expect(await screen.findByText(
      'Lagao Smash Courts is set up. ana.owner@example.invalid becomes its admin after signing up with that email and confirming it. Then activate the club.',
    )).toBeInTheDocument()
    const club = demoStore.platformClubs().find((row) => row.name === 'Lagao Smash Courts')!
    expect(club.status).toBe('provisioning')
    expect(demoStore.clubOwnerInvites(club.club_id).map((invite) => invite.email)).toEqual(['ana.owner@example.invalid'])
  })

  it('checks the owner email before setting anything up', async () => {
    const user = userEvent.setup()
    renderSection('clubs')
    await user.click(await screen.findByRole('button', { name: /Set up a club/ }))
    const dialog = screen.getByRole('dialog', { name: 'Set up a club' })
    await user.type(within(dialog).getByLabelText('Club name'), 'Iloilo Courts')
    // The browser accepts this address; the database would not, so the dialog stops it first.
    await user.type(within(dialog).getByLabelText('Owner’s email (optional)'), 'owner@localhost')
    await user.click(within(dialog).getByRole('button', { name: 'Set up club' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Enter the owner’s email like name@example.com')
    expect(demoStore.platformClubs().some((club) => club.name === 'Iloilo Courts')).toBe(false)
  })

  it('invites an owner who has no account yet from the club card, shows the invite, and cancels it', async () => {
    const user = userEvent.setup()
    renderSection('clubs')
    const davao = await openClub(user, 'Rally Point Davao')
    await user.click(within(davao).getByText('Admins and invites'))
    await user.type(within(davao).getByLabelText('Add an admin by email'), 'future.owner@example.invalid')
    await user.click(within(davao).getByRole('button', { name: 'Add admin' }))

    expect(await screen.findByText(
      'future.owner@example.invalid is invited. They become an admin of Rally Point Davao after signing up with that email and confirming it.',
    )).toBeInTheDocument()
    const invites = await screen.findByRole('list', { name: 'Rally Point Davao owner invites' })
    expect(within(invites).getByText('future.owner@example.invalid')).toBeInTheDocument()

    await user.click(within(invites).getByRole('button', { name: 'Cancel invite' }))
    expect(await screen.findByText('The invite for future.owner@example.invalid is cancelled.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Rally Point Davao owner invites' })).not.toBeInTheDocument())
  })

  it('opens the club with an open support view by itself, even when it is not on the first page', async () => {
    setUpClubs(25, 'Aaa Club')
    const davaoId = demoStore.platformClubs().find((club) => club.name === 'Rally Point Davao')!.club_id
    demoStore.startSupportSession(davaoId, 'Checking a court booking complaint', 30)
    renderSection('clubs')
    const panel = await screen.findByRole('region', { name: 'Rally Point Davao support view' })
    expect(await within(panel).findByText(/Support view open until/)).toBeInTheDocument()
    expect(clubRow('Rally Point Davao')).toHaveAttribute('aria-expanded', 'true')
    expect(clubRow('Rally Point Davao')).toHaveTextContent('Support view open')
  })

  it('finds clubs by name, link name or city', async () => {
    const user = userEvent.setup()
    renderSection('clubs')
    expect(await screen.findByText('2 of 2 clubs')).toBeInTheDocument()
    const search = screen.getByLabelText('Search clubs')

    await user.type(search, 'davao')
    expect(screen.getByText('1 of 2 clubs')).toBeInTheDocument()
    expect(listedClubs()).toEqual(['Rally Point Davao'])

    await user.clear(search)
    await user.type(search, 'rally-point-gensan')
    expect(listedClubs()).toEqual(['Rally Point Gensan'])

    await user.clear(search)
    await user.type(search, 'General Santos')
    expect(listedClubs()).toEqual(['Rally Point Gensan'])

    await user.clear(search)
    await user.type(search, 'Nowhere')
    expect(screen.getByText('No clubs match this search.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show all clubs' }))
    expect(search).toHaveValue('')
    expect(listedClubs()).toHaveLength(2)
  })

  it('counts clubs by status, filters by status, and finds the clubs that need an admin', async () => {
    setUpClubs(3)
    const davaoId = demoStore.platformClubs().find((club) => club.name === 'Rally Point Davao')!.club_id
    demoStore.setClubStatus(davaoId, 'suspended')
    const user = userEvent.setup()
    renderSection('clubs')
    const filters = within(await screen.findByRole('group', { name: 'Show clubs' }))
    expect(filters.getByRole('button', { name: 'All 5' })).toHaveAttribute('aria-pressed', 'true')
    expect(filters.getByRole('button', { name: 'Active 1' })).toBeInTheDocument()
    expect(filters.getByRole('button', { name: 'In setup 3' })).toBeInTheDocument()
    expect(filters.getByRole('button', { name: 'Suspended 1' })).toBeInTheDocument()
    expect(filters.getByRole('button', { name: 'Needs an admin 3' })).toBeInTheDocument()

    await user.click(filters.getByRole('button', { name: 'Suspended 1' }))
    expect(filters.getByRole('button', { name: 'Suspended 1' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('1 of 5 clubs')).toBeInTheDocument()
    expect(listedClubs()).toEqual(['Rally Point Davao'])

    await user.click(filters.getByRole('button', { name: 'Needs an admin 3' }))
    expect(listedClubs()).toEqual(['Test Club 01', 'Test Club 02', 'Test Club 03'])

    // The counts follow the search.
    await user.type(screen.getByLabelText('Search clubs'), 'club 02')
    expect(filters.getByRole('button', { name: 'All 1' })).toBeInTheDocument()
    expect(filters.getByRole('button', { name: 'In setup 1' })).toBeInTheDocument()
    expect(filters.getByRole('button', { name: 'Suspended 0' })).toBeInTheDocument()
    expect(listedClubs()).toEqual(['Test Club 02'])
  })

  it('starts on the status the overview link asks for', async () => {
    setUpClubs(2)
    renderSection('clubs', '/superadmin/clubs?show=provisioning')
    expect(await screen.findByText('2 of 4 clubs')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'In setup 2' })).toHaveAttribute('aria-pressed', 'true')
    expect(listedClubs()).toEqual(['Test Club 01', 'Test Club 02'])
  })

  it('sorts clubs by commission revenue, highest first', async () => {
    setUpClubs(2)
    const user = userEvent.setup()
    renderSection('clubs')
    expect(await screen.findByText('4 of 4 clubs')).toBeInTheDocument()
    expect(listedClubs()).toEqual(['Rally Point Davao', 'Rally Point Gensan', 'Test Club 01', 'Test Club 02'])

    await user.selectOptions(screen.getByLabelText('Sort by'), 'Commission revenue')
    const expected = demoStore
      .platformClubs()
      .sort((a, b) => b.commission_amount - a.commission_amount || a.name.localeCompare(b.name))
      .map((club) => club.name)
    expect(expected.slice(2)).toEqual(['Test Club 01', 'Test Club 02'])
    expect(expected[0]).toBe('Rally Point Gensan')
    expect(listedClubs()).toEqual(expected)
  })

  it('shows 20 clubs at a time and moves to the first new one after "Show more"', async () => {
    setUpClubs(25)
    const user = userEvent.setup()
    renderSection('clubs')
    expect(await screen.findByText('27 of 27 clubs')).toBeInTheDocument()
    expect(screen.getByText(/showing the first 20/)).toBeInTheDocument()
    expect(listedClubs()).toHaveLength(20)

    await user.click(screen.getByRole('button', { name: 'Show 7 more' }))
    expect(listedClubs()).toHaveLength(27)
    expect(clubRow('Test Club 19')).toHaveFocus()
    expect(screen.queryByRole('button', { name: /^Show \d+ more/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/showing the first/)).not.toBeInTheDocument()

    // A new search starts again from the first 20.
    await user.type(screen.getByLabelText('Search clubs'), 'test club')
    expect(screen.getByText('25 of 27 clubs')).toBeInTheDocument()
    expect(listedClubs()).toHaveLength(20)
  })

  it('points the overview at new owner requests', async () => {
    askForCall()
    renderSection('overview')
    expect(await screen.findByRole('link', { name: '1 court owner asked for a call' })).toHaveAttribute('href', '/superadmin/requests')
  })
})
