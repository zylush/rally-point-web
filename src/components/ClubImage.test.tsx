import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { stockPhotoFor, stockSrc } from '../lib/stockPhotos'
import { ClubImage } from './ClubImage'

const seed = 'rally-point-davao'
const stock = stockPhotoFor(seed)

function fail(img: HTMLElement) {
  fireEvent.error(img)
}

describe('ClubImage', () => {
  it("shows the club's own photo without a sample label", () => {
    render(<ClubImage photos={[null, 'https://example.test/cover.webp']} seed={seed} alt="Photo of Rally Point Davao" />)
    expect(screen.getByRole('img', { name: 'Photo of Rally Point Davao' })).toHaveAttribute('src', 'https://example.test/cover.webp')
    expect(screen.queryByText('Sample photo')).not.toBeInTheDocument()
  })

  it('tries the next own photo when one fails to load', () => {
    render(
      <ClubImage
        photos={['https://example.test/broken.webp', 'https://example.test/court.webp']}
        seed={seed}
        alt="Photo of Rally Point Davao"
      />,
    )
    fail(screen.getByRole('img', { name: 'Photo of Rally Point Davao' }))
    expect(screen.getByRole('img', { name: 'Photo of Rally Point Davao' })).toHaveAttribute('src', 'https://example.test/court.webp')
  })

  it('falls back to a labelled stock photo described as itself, not as the club', () => {
    render(<ClubImage photos={[]} seed={seed} alt="Photo of Rally Point Davao" />)
    const img = screen.getByRole('img', { name: stock.alt })
    expect(img).toHaveAttribute('src', stockSrc(stock, 'small'))
    expect(img.getAttribute('srcset')).toContain('1600w')
    expect(screen.getByText('Sample photo')).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /Rally Point Davao/ })).not.toBeInTheDocument()
  })

  it('moves from a broken own photo to the stock photo, then to the drawn court', () => {
    const { container } = render(
      <ClubImage photos={['https://example.test/broken.webp']} seed={seed} alt="Photo of Rally Point Davao" />,
    )
    fail(screen.getByRole('img', { name: 'Photo of Rally Point Davao' }))
    fail(screen.getByRole('img', { name: stock.alt }))
    expect(screen.queryByText('Sample photo')).not.toBeInTheDocument()
    expect(screen.getByText('Sample')).toBeInTheDocument()
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('skips the stock photo for a venue, going straight to the drawing', () => {
    render(<ClubImage photos={[]} seed={seed} alt="Cover photo of Davao Main" kind="venue" />)
    expect(screen.queryByText('Sample photo')).not.toBeInTheDocument()
    expect(screen.getByText('Sample')).toBeInTheDocument()
  })

  it('starts again when the club changes', () => {
    const { rerender } = render(
      <ClubImage photos={['https://example.test/broken.webp']} seed={seed} alt="Photo of Rally Point Davao" />,
    )
    fail(screen.getByRole('img', { name: 'Photo of Rally Point Davao' }))
    expect(screen.getByText('Sample photo')).toBeInTheDocument()
    rerender(<ClubImage photos={['https://example.test/gensan.webp']} seed="rally-point-gensan" alt="Photo of Rally Point Gensan" />)
    expect(screen.getByRole('img', { name: 'Photo of Rally Point Gensan' })).toHaveAttribute('src', 'https://example.test/gensan.webp')
  })

  it('loads early when asked to, for the first picture on a page', () => {
    render(<ClubImage photos={['https://example.test/cover.webp']} seed={seed} alt="Photo of Rally Point Davao" priority />)
    const img = screen.getByRole('img', { name: 'Photo of Rally Point Davao' })
    expect(img).toHaveAttribute('fetchpriority', 'high')
    expect(img).not.toHaveAttribute('loading')
  })
})
