import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BookingSteps } from './BookingSteps'

function stepTexts() {
  return within(screen.getByRole('list', { name: 'Booking steps' }))
    .getAllByRole('listitem')
    .map((item) => item.textContent)
}

describe('BookingSteps', () => {
  it('shows a visitor the log-in step and marks the current step', () => {
    render(<BookingSteps current="login" visitor />)
    expect(stepTexts()).toEqual(['1.Choose a time(done)', '2.Log in', '3.Pay', '4.Confirmed'])
    const current = screen.getByText('Log in').closest('li')
    expect(current).toHaveAttribute('aria-current', 'step')
    expect(screen.getAllByRole('listitem').filter((item) => item.getAttribute('aria-current') === 'step')).toHaveLength(1)
  })

  it('leaves the log-in step out for a signed-in player', () => {
    render(<BookingSteps current="pay" visitor={false} />)
    expect(stepTexts()).toEqual(['1.Choose a time(done)', '2.Pay', '3.Confirmed'])
    expect(screen.queryByText('Log in')).not.toBeInTheDocument()
    expect(screen.getByText('Pay').closest('li')).toHaveAttribute('aria-current', 'step')
  })

  it('gives phones one short line naming the step', () => {
    const { rerender } = render(<BookingSteps current="login" visitor />)
    expect(screen.getByText('Step 2 of 4 · Log in')).toBeInTheDocument()
    rerender(<BookingSteps current="choose" visitor={false} />)
    expect(screen.getByText('Step 1 of 3 · Choose a time')).toHaveClass('sm:hidden')
    // The full list is for wider screens; only one of the two shows at any width.
    expect(screen.getByRole('list', { name: 'Booking steps' })).toHaveClass('hidden', 'sm:flex')
  })

  it('starts on choosing a time and ends on confirmed', () => {
    const { rerender } = render(<BookingSteps current="choose" visitor={false} />)
    expect(screen.getByText('Choose a time').closest('li')).toHaveAttribute('aria-current', 'step')
    expect(screen.getByText('Confirmed').closest('li')).not.toHaveAttribute('aria-current')

    rerender(<BookingSteps current="confirmed" visitor={false} />)
    expect(screen.getByText('Confirmed').closest('li')).toHaveAttribute('aria-current', 'step')
    expect(screen.getByText('Choose a time').closest('li')).not.toHaveAttribute('aria-current')
  })
})
