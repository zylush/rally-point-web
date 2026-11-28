import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { dataMode } from '../lib/dataMode'
import { DataModeBanner } from './DataModeBanner'

describe('dataMode', () => {
  it('is the demo whenever the browser demo runs, whatever the build target', () => {
    expect(dataMode(true, 'Production')).toBe('demo')
    expect(dataMode(true, undefined)).toBe('demo')
  })

  it('is live only for an explicit production build', () => {
    expect(dataMode(false, 'Production')).toBe('live')
  })

  it('labels staging and any unknown target a test site', () => {
    expect(dataMode(false, 'Staging')).toBe('test')
    expect(dataMode(false, undefined)).toBe('test')
    expect(dataMode(false, 'production')).toBe('test')
  })
})

describe('DataModeBanner', () => {
  it('warns that demo data is made up', () => {
    render(<DataModeBanner mode="demo" />)
    expect(screen.getByRole('note', { name: 'About this site' })).toHaveTextContent(/Demo site\..*made up.*Don’t pay anything\./)
  })

  it('tells people not to pay on a test site', () => {
    render(<DataModeBanner mode="test" />)
    expect(screen.getByRole('note', { name: 'About this site' })).toHaveTextContent(/Test site\..*not real.*Don’t send any GCash payment\./)
  })

  it('shows nothing in production', () => {
    const { container } = render(<DataModeBanner mode="live" />)
    expect(container).toBeEmptyDOMElement()
  })
})
