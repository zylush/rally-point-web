import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePrivacyGate } from '../lib/usePrivacyGate'
import { PrivacyAcknowledgement } from './PrivacyAcknowledgement'

function Harness(props: { clubSlug?: string; clubName?: string | null; label?: string }) {
  const gate = usePrivacyGate()
  return (
    <MemoryRouter>
      <PrivacyAcknowledgement
        gate={gate}
        clubSlug={props.clubSlug}
        clubName={props.clubName}
        label={props.label}
      />
    </MemoryRouter>
  )
}

function setScrollGeometry(element: HTMLElement, metrics: { scrollHeight: number; clientHeight: number; scrollTop: number }) {
  Object.defineProperty(element, 'scrollHeight', { configurable: true, value: metrics.scrollHeight })
  Object.defineProperty(element, 'clientHeight', { configurable: true, value: metrics.clientHeight })
  Object.defineProperty(element, 'scrollTop', { configurable: true, writable: true, value: metrics.scrollTop })
}

describe('PrivacyAcknowledgement', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('starts locked and unchecked with an accessible unlock hint', () => {
    render(<Harness />)

    const toggle = screen.getByRole('button', { name: /Read the Privacy Notice/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveTextContent('Required first')

    const checkbox = screen.getByRole('checkbox', { name: /I have read and understood the Privacy Notice/ })
    expect(checkbox).toBeDisabled()
    expect(checkbox).not.toBeChecked()
    expect(checkbox).toHaveAccessibleDescription(
      'Open and scroll to the end of the Privacy Notice above to unlock this box.',
    )

    const link = screen.getByRole('link', { name: 'Privacy Notice' })
    expect(link).toHaveAttribute('href', '/privacy')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('opens and focuses the inline notice when clicking the locked checkbox label, adding no headings', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByText('I have read and understood the Privacy Notice.'))

    const reader = screen.getByRole('region', { name: 'Privacy Notice text' })
    expect(reader).toHaveFocus()
    expect(screen.getByRole('button', { name: /Read the Privacy Notice/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Scroll to the end')).toBeInTheDocument()
    expect(screen.getByRole('checkbox')).toBeDisabled()
    expect(screen.queryAllByRole('heading')).toHaveLength(0)
  })

  it('keeps the checkbox locked on partial scroll and unlocks unticked at the bottom', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: /Read the Privacy Notice/ }))
    const reader = screen.getByRole('region', { name: 'Privacy Notice text' })
    const checkbox = screen.getByRole('checkbox')

    setScrollGeometry(reader, { scrollHeight: 1000, clientHeight: 200, scrollTop: 300 })
    fireEvent.scroll(reader)
    expect(checkbox).toBeDisabled()
    expect(checkbox).not.toBeChecked()

    setScrollGeometry(reader, { scrollHeight: 1000, clientHeight: 200, scrollTop: 785 })
    fireEvent.scroll(reader)
    expect(checkbox).toBeEnabled()
    expect(checkbox).not.toBeChecked()
    expect(screen.getByText('Read')).toBeInTheDocument()
    expect(screen.getByText('End of Privacy Notice — you can now tick the box below.')).toBeInTheDocument()

    await user.click(checkbox)
    expect(checkbox).toBeChecked()
  })

  it('auto-unlocks on open when all content fits without overflowing, while leaving the checkbox unticked', async () => {
    const user = userEvent.setup()
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(800)
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(500)

    render(<Harness />)
    await user.click(screen.getByRole('button', { name: /Read the Privacy Notice/ }))

    const checkbox = screen.getByRole('checkbox')
    expect(checkbox).toBeEnabled()
    expect(checkbox).not.toBeChecked()
    expect(screen.getByText('Read')).toBeInTheDocument()
  })

  it('unlocks and focuses the checkbox via the end button for keyboard users', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: /Read the Privacy Notice/ }))
    await user.click(screen.getByRole('button', { name: 'Unlock checkbox' }))

    const checkbox = screen.getByRole('checkbox')
    expect(checkbox).toBeEnabled()
    expect(checkbox).not.toBeChecked()
    expect(checkbox).toHaveFocus()
    expect(screen.queryByRole('button', { name: 'Unlock checkbox' })).not.toBeInTheDocument()
  })

  it('shows club-specific notice details inside the inline reader without naming Gensan', async () => {
    const user = userEvent.setup()
    render(<Harness clubSlug="rally-point-davao" clubName="Rally Point Davao" />)

    expect(screen.getByRole('link', { name: 'Privacy Notice' })).toHaveAttribute(
      'href',
      '/privacy?club=rally-point-davao',
    )

    await user.click(screen.getByRole('button', { name: /Read the Privacy Notice/ }))

    expect(screen.getByText(/ask the staff at Rally Point Davao/)).toBeInTheDocument()
    expect(screen.queryByText(/Gensan/)).not.toBeInTheDocument()
  })
})
