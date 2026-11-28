import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BrinelyLogo } from './BrinelyLogo'

const BASE = import.meta.env.BASE_URL || '/'

describe('BrinelyLogo', () => {
  it('shows the flat vector mark and names it bRineLy', () => {
    render(<BrinelyLogo variant="mark" />)
    expect(screen.getByRole('img', { name: 'bRineLy' })).toHaveAttribute('src', `${BASE}logo-mark.svg`)
  })

  it('shows the animated mark under the same name', () => {
    render(<BrinelyLogo variant="animated" />)
    expect(screen.getByRole('img', { name: 'bRineLy' })).toHaveAttribute('src', `${BASE}logo-mark-animated.svg`)
  })

  it('shows the wordmark with an accessible name', () => {
    render(<BrinelyLogo variant="wordmark" className="h-8" />)
    const logo = screen.getByRole('img', { name: 'bRineLy' })
    expect(logo).toHaveAttribute('src', `${BASE}logo-wordmark.svg`)
    expect(logo).toHaveClass('h-8')
  })

  it('stays out of the accessibility tree when decorative', () => {
    const { container } = render(<BrinelyLogo variant="mark" title="" />)
    expect(screen.queryByRole('img')).toBeNull()
    expect(container.querySelector('img')).toHaveAttribute('alt', '')
  })

  it('keeps the full colour logo as the default', () => {
    render(<BrinelyLogo />)
    expect(screen.getByRole('img', { name: 'bRineLy' })).toHaveAttribute('src', `${BASE}logo.png`)
  })
})
