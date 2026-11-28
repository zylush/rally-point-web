import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { STOCK_PHOTOS } from '../lib/stockPhotos'
import { PhotoCredits } from './PhotoCredits'

describe('PhotoCredits', () => {
  it('credits every stock photo with its photographer, licence and source page', () => {
    render(<PhotoCredits />)

    expect(screen.getByText('Sample photos stand in for clubs that have not added their own pictures yet.')).toBeInTheDocument()
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(STOCK_PHOTOS.length)

    STOCK_PHOTOS.forEach((photo, index) => {
      const item = items[index]
      expect(item).toHaveTextContent(`${photo.alt} — photo by ${photo.photographer}, ${photo.license}`)
      const site = photo.license.replace(/ License$/, '')
      const link = within(item).getByRole('link', {
        name: `View “${photo.title}” by ${photo.photographer} on ${site} (opens in a new tab)`,
      })
      expect(link).toHaveAttribute('href', photo.sourceUrl)
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    })
  })

  it('gives every source link a different accessible name', () => {
    render(<PhotoCredits />)

    const names = screen.getAllByRole('link').map((link) => link.textContent)
    expect(names).toHaveLength(STOCK_PHOTOS.length)
    expect(new Set(names).size).toBe(names.length)
  })
})
