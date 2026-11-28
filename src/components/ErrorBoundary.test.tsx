import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from './ErrorBoundary'

function Boom({ fail }: { fail: boolean }) {
  if (fail) throw new Error('broken screen')
  return <p>Working screen</p>
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ErrorBoundary', () => {
  it('shows its children while they draw', () => {
    render(
      <ErrorBoundary>
        <Boom fail={false} />
      </ErrorBoundary>,
    )
    expect(screen.getByText('Working screen')).toBeInTheDocument()
  })

  it('replaces a crashed screen with a message, and tries again on a new page', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { rerender } = render(
      <ErrorBoundary resetKey="/owners">
        <Boom fail />
      </ErrorBoundary>,
    )
    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument()

    rerender(
      <ErrorBoundary resetKey="/clubs">
        <Boom fail={false} />
      </ErrorBoundary>,
    )
    expect(screen.getByText('Working screen')).toBeInTheDocument()
  })

  it('reloads the page from its button', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const reload = vi.fn()
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload })
    render(
      <ErrorBoundary>
        <Boom fail />
      </ErrorBoundary>,
    )
    screen.getByRole('button', { name: 'Reload page' }).click()
    expect(reload).toHaveBeenCalled()
  })
})
