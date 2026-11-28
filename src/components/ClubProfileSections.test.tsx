import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { emptyClubProfile } from '../lib/clubProfile'
import type { PublicClubProfile } from '../types'
import {
  ClubAboutCard,
  ClubAddonsCard,
  ClubCoachesCard,
  ClubGallery,
  ClubPaymentCard,
  ClubPoliciesCard,
} from './ClubProfileSections'

const empty: PublicClubProfile = { ...emptyClubProfile(), payment_methods: [], addons: [], coaches: [], gallery: [] }

const full: PublicClubProfile = {
  ...empty,
  about: 'Six indoor courts.\nOpen to everyone.',
  phone: '0917 123 4567',
  email: 'hello@brinely.info',
  facebook_url: 'https://facebook.com/rallypointgensan',
  messenger_url: 'https://m.me/rallypointgensan',
  // A bad link that somehow got through is never made clickable.
  website_url: 'javascript:alert(1)',
  amenities: ['night_lights', 'parking'],
  payment_note: 'Pay at the desk.',
  house_rules: 'Non-marking shoes only.',
  terms: 'Play at your own risk.',
  payment_methods: [{ id: 'pay-1', label: 'GCash', account_name: 'Rally Point', account_number: '0917 111 1111', qr_url: 'https://example.test/qr.webp' }],
  addons: [{ id: 'addon-1', name: 'Paddle rental', description: 'Two paddles', price: 100, unit: 'per_hour' }],
  coaches: [{
    id: 'coach-1', full_name: 'Ana Reyes', headline: 'Beginners', bio: null, hourly_rate: 500,
    contact_phone: null, contact_url: 'https://m.me/coachana', photo_url: null,
  }],
  gallery: [{ id: 'g-1', url: 'https://example.test/g1.webp', caption: 'Our courts' }],
}

describe('club page profile sections', () => {
  it('shows nothing for a club that has not filled in its profile', () => {
    const { container } = render(
      <>
        <ClubAboutCard clubName="Club" profile={empty} index={0} />
        <ClubGallery clubName="Club" profile={empty} index={0} />
        <ClubAddonsCard profile={empty} index={0} />
        <ClubCoachesCard profile={empty} index={0} />
        <ClubPaymentCard clubName="Club" profile={empty} index={0} />
        <ClubPoliciesCard profile={empty} index={0} />
      </>,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the about text, amenities and contact links, opening outside links safely', () => {
    render(<ClubAboutCard clubName="Rally Point" profile={full} index={0} />)
    const card = within(screen.getByRole('region', { name: 'About Rally Point' }))
    expect(card.getByText(/Six indoor courts\./)).toBeInTheDocument()
    expect(card.getByText('Lights for night play')).toBeInTheDocument()
    expect(card.getByRole('link', { name: /Call 0917 123 4567/ })).toHaveAttribute('href', 'tel:09171234567')
    expect(card.getByRole('link', { name: /Email/ })).toHaveAttribute('href', 'mailto:hello@brinely.info')
    const facebook = card.getByRole('link', { name: /Facebook page/ })
    expect(facebook).toHaveAttribute('href', 'https://facebook.com/rallypointgensan')
    expect(facebook).toHaveAttribute('target', '_blank')
    expect(facebook).toHaveAttribute('rel', 'noopener noreferrer')
    expect(card.queryByRole('link', { name: /Website/ })).not.toBeInTheDocument()
  })

  it('links only a plain email address, so a stored value cannot add mail fields', () => {
    render(<ClubAboutCard clubName="Rally Point" profile={{ ...full, email: 'hello@brinely.info?bcc=someone@example.com' }} index={0} />)
    const card = within(screen.getByRole('region', { name: 'About Rally Point' }))
    expect(card.queryByRole('link', { name: /Email/ })).not.toBeInTheDocument()
    expect(card.getByRole('link', { name: /Facebook page/ })).toBeInTheDocument()
  })

  it('lists add-ons and coaches with their prices', () => {
    render(
      <>
        <ClubAddonsCard profile={full} index={0} />
        <ClubCoachesCard profile={full} index={0} />
      </>,
    )
    expect(screen.getByText('Paddle rental')).toBeInTheDocument()
    expect(screen.getByText('Php 100.00 per hour')).toBeInTheDocument()
    expect(screen.getByText('Add-ons are paid at the club.', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('Ana Reyes')).toBeInTheDocument()
    expect(screen.getByText('Php 500.00 per hour')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Contact Ana/ })).toHaveAttribute('href', 'https://m.me/coachana')
  })

  it('shows how to pay, with the QR code, and says bRineLy does not take the payment', () => {
    render(<ClubPaymentCard clubName="Rally Point" profile={full} index={0} />)
    const card = within(screen.getByRole('region', { name: 'How to pay Rally Point' }))
    expect(card.getByText('GCash')).toBeInTheDocument()
    expect(card.getByText('0917 111 1111')).toBeInTheDocument()
    expect(card.getByRole('img', { name: 'GCash QR code for paying Rally Point' })).toBeInTheDocument()
    expect(card.getByRole('note')).toHaveTextContent('bRineLy does not receive or check this payment.')
  })

  it('keeps rules and terms closed until tapped', async () => {
    render(<ClubPoliciesCard profile={full} index={0} />)
    const rules = screen.getByText('House rules').closest('details')
    expect(rules).not.toHaveAttribute('open')
    await userEvent.click(screen.getByText('House rules'))
    expect(rules).toHaveAttribute('open')
    expect(screen.queryByText('Cancellation and refunds')).not.toBeInTheDocument()
    expect(screen.getByText('Terms and conditions')).toBeInTheDocument()
  })

  it('links from ClubCoachesCard to the public Rent a coach page filtered to that club', () => {
    render(
      <MemoryRouter>
        <ClubCoachesCard clubSlug="rally-point-gensan" profile={full} index={0} />
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: 'See lesson times' })).toHaveAttribute(
      'href',
      '/coaches?club=rally-point-gensan',
    )
  })

  it('shows the gallery with captions', () => {
    render(<ClubGallery clubName="Rally Point" profile={full} index={0} />)
    expect(screen.getByRole('img', { name: 'Our courts' })).toHaveAttribute('src', 'https://example.test/g1.webp')
  })
})
