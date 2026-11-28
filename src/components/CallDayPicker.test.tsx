import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { CallDayPicker } from './CallDayPicker'

// Today is Thursday 26 Nov 2026; calls can be asked for up to Monday 25 Jan 2027.
const MIN = '2026-11-26'
const MAX = '2027-01-25'

function Picker({ start = MIN, onPick = vi.fn() }: { start?: string; onPick?: (ymd: string) => void }) {
  const [value, setValue] = useState(start)
  return (
    <>
      <CallDayPicker
        value={value}
        min={MIN}
        max={MAX}
        onChange={(ymd) => {
          setValue(ymd)
          onPick(ymd)
        }}
      />
      <p data-testid="value">{value}</p>
    </>
  )
}

const grid = () => screen.getByRole('grid', { name: /Day for the call/ })
const day = (name: string) => within(grid()).getByRole('gridcell', { name })

describe('CallDayPicker', () => {
  it('shows the month of the chosen day, with today marked and earlier days unavailable', () => {
    render(<Picker />)
    expect(screen.getByRole('group', { name: 'Day for the call' })).toBeInTheDocument()
    expect(grid()).toHaveAccessibleName('Day for the call November 2026')
    expect(screen.getByRole('columnheader', { name: 'Sunday' })).toBeInTheDocument()

    const today = day('Thursday, November 26, today')
    expect(today).toHaveAttribute('aria-current', 'date')
    expect(today).toHaveAttribute('aria-selected', 'true')
    expect(today).toHaveAttribute('tabindex', '0')

    const past = day('Wednesday, November 25, not available')
    expect(past).toHaveAttribute('aria-disabled', 'true')
    expect(past).not.toHaveAttribute('tabindex')
    expect(past).not.toHaveAttribute('aria-selected')

    expect(day('Friday, November 27')).toHaveAttribute('aria-selected', 'false')
    expect(day('Friday, November 27')).toHaveAttribute('tabindex', '-1')
  })

  it('chooses a day by click, and ignores days that cannot be chosen', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    render(<Picker onPick={onPick} />)
    await user.click(day('Wednesday, November 25, not available'))
    expect(onPick).not.toHaveBeenCalled()

    await user.click(day('Monday, November 30'))
    expect(onPick).toHaveBeenCalledWith('2026-11-30')
    expect(day('Monday, November 30')).toHaveAttribute('aria-selected', 'true')
    expect(day('Thursday, November 26, today')).toHaveAttribute('aria-selected', 'false')
  })

  it('moves between months with the buttons, only within the range', async () => {
    const user = userEvent.setup()
    render(<Picker />)
    const back = screen.getByRole('button', { name: 'Previous month, October 2026' })
    expect(back).toHaveAttribute('aria-disabled', 'true')
    await user.click(back)
    expect(grid()).toHaveAccessibleName('Day for the call November 2026')

    await user.click(screen.getByRole('button', { name: 'Next month, December 2026' }))
    expect(grid()).toHaveAccessibleName('Day for the call December 2026')
    // Nothing is chosen in December, so its first day is the one in the Tab order.
    expect(day('Tuesday, December 1')).toHaveAttribute('tabindex', '0')

    await user.click(screen.getByRole('button', { name: 'Next month, January 2027' }))
    expect(day('Monday, January 25')).not.toHaveAttribute('aria-disabled')
    expect(day('Tuesday, January 26, not available')).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('button', { name: 'Next month, February 2027' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('works from the keyboard: arrows, Home and End, Page Up and Down, Enter and Space', async () => {
    const user = userEvent.setup()
    render(<Picker />)
    await user.tab() // Previous month
    await user.tab() // Next month
    await user.tab()
    expect(day('Thursday, November 26, today')).toHaveFocus()

    await user.keyboard('{ArrowLeft}')
    // Earlier days cannot be reached.
    expect(day('Thursday, November 26, today')).toHaveFocus()

    await user.keyboard('{ArrowRight}')
    expect(day('Friday, November 27')).toHaveFocus()
    await user.keyboard('{End}')
    expect(day('Saturday, November 28')).toHaveFocus()
    await user.keyboard('{Home}')
    expect(day('Sunday, November 22, not available').getAttribute('tabindex')).toBeNull()
    // Home stops at the first day that can be chosen.
    expect(day('Thursday, November 26, today')).toHaveFocus()

    await user.keyboard('{ArrowDown}')
    expect(day('Thursday, December 3')).toHaveFocus()
    expect(grid()).toHaveAccessibleName('Day for the call December 2026')
    expect(screen.getByTestId('value')).toHaveTextContent('2026-11-26')

    await user.keyboard('{Enter}')
    expect(screen.getByTestId('value')).toHaveTextContent('2026-12-03')
    expect(day('Thursday, December 3')).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{PageDown}')
    expect(day('Sunday, January 3')).toHaveFocus()
    await user.keyboard('{PageDown}')
    // February is past the last day, so focus stops on it.
    expect(day('Monday, January 25')).toHaveFocus()
    await user.keyboard(' ')
    expect(screen.getByTestId('value')).toHaveTextContent('2027-01-25')

    await user.keyboard('{ArrowUp}')
    expect(day('Monday, January 18')).toHaveFocus()
    await user.keyboard('{PageUp}')
    expect(day('Friday, December 18')).toHaveFocus()
  })

  it('does not pull focus back into the grid after a key that moves nowhere', async () => {
    const user = userEvent.setup()
    render(<Picker />)
    await user.tab()
    await user.tab()
    await user.tab()
    expect(day('Thursday, November 26, today')).toHaveFocus()
    await user.keyboard('{ArrowLeft}') // already the first day: nothing changes
    expect(day('Thursday, November 26, today')).toHaveFocus()

    await user.tab({ shift: true })
    const next = screen.getByRole('button', { name: 'Next month, December 2026' })
    expect(next).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(grid()).toHaveAccessibleName('Day for the call December 2026')
    expect(screen.getByRole('button', { name: 'Next month, January 2027' })).toHaveFocus()
  })

  it('keeps the chosen day as the Tab stop when coming back to its month', async () => {
    const user = userEvent.setup()
    render(<Picker start="2026-12-10" />)
    expect(grid()).toHaveAccessibleName('Day for the call December 2026')
    expect(day('Thursday, December 10')).toHaveAttribute('tabindex', '0')
    await user.click(screen.getByRole('button', { name: 'Previous month, November 2026' }))
    // Nothing chosen in November: today is the Tab stop.
    expect(day('Thursday, November 26, today')).toHaveAttribute('tabindex', '0')
    await user.click(screen.getByRole('button', { name: 'Next month, December 2026' }))
    expect(day('Thursday, December 10')).toHaveAttribute('tabindex', '0')
  })
})
