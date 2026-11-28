import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { WEEKDAY_SHORT } from '../../lib/analytics'
import { BarChart, HeatGrid, Meter, Sparkline, StackedBar } from '.'

const peso = (n: number) => `₱${n.toLocaleString('en-US')}`
const points = [
  { key: 'd1', label: 'Nov 22', value: 1200 },
  { key: 'd2', label: 'Nov 23', value: 0 },
  { key: 'd3', label: 'Nov 24', value: 3400 },
]

describe('BarChart', () => {
  it('lists every point in a hidden table captioned with its label', () => {
    render(<BarChart label="Charges per day" points={points} format={peso} />)
    const table = screen.getByRole('table', { name: 'Charges per day' })
    const rows = within(table).getAllByRole('row')
    expect(rows).toHaveLength(3)
    expect(rows[2]).toHaveTextContent('Nov 24₱3,400')
  })

  it('shows a tooltip on focus and moves with the arrow keys', async () => {
    const user = userEvent.setup()
    render(<BarChart label="Charges per day" points={points} format={peso} />)
    const bars = screen.getAllByRole('button')
    // One tab stop: the latest bar.
    expect(bars.map((bar) => bar.tabIndex)).toEqual([-1, -1, 0])
    await user.tab()
    expect(bars[2]).toHaveFocus()
    expect(screen.getByRole('tooltip')).toHaveTextContent('Nov 24 · ₱3,400')
    await user.keyboard('{ArrowLeft}')
    expect(bars[1]).toHaveFocus()
    expect(screen.getByRole('tooltip')).toHaveTextContent('Nov 23 · ₱0')
  })

  it('shows the tooltip on mouse hover', () => {
    render(<BarChart label="Charges per day" points={points} format={peso} />)
    fireEvent.pointerEnter(screen.getByRole('button', { name: 'Nov 22: ₱1,200' }), { pointerType: 'mouse' })
    expect(screen.getByRole('tooltip')).toHaveTextContent('Nov 22 · ₱1,200')
  })

  it('says there is no data instead of drawing empty bars', () => {
    render(<BarChart label="Charges per day" points={points.map((p) => ({ ...p, value: 0 }))} format={peso} />)
    expect(screen.getByText('No data in this period')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('StackedBar', () => {
  it('shows each part with its share, once', () => {
    render(
      <StackedBar
        label="How players paid"
        format={(n) => String(n)}
        segments={[
          { key: 'online', label: 'GCash', value: 3, tone: 'brand' },
          { key: 'desk', label: 'At the desk', value: 1, tone: 'muted' },
        ]}
      />,
    )
    const table = screen.getByRole('table', { name: 'How players paid' })
    expect(within(table).getByRole('row', { name: /GCash/ })).toHaveTextContent('GCash375%')
    expect(within(table).getByRole('row', { name: /At the desk/ })).toHaveTextContent('At the desk125%')
    expect(screen.getAllByText('75%')).toHaveLength(1)
  })

  it('has an empty line for a zero total', () => {
    render(<StackedBar label="How players paid" format={String} segments={[{ key: 'a', label: 'GCash', value: 0, tone: 'brand' }]} />)
    expect(screen.getByText('No data in this period')).toBeInTheDocument()
  })
})

describe('Meter', () => {
  it('exposes its values to assistive tech', () => {
    render(<Meter label="Court 1" value={30} max={120} detail="30 of 120 hours" />)
    const meter = screen.getByRole('meter', { name: 'Court 1' })
    expect(meter).toHaveAttribute('aria-valuenow', '30')
    expect(meter).toHaveAttribute('aria-valuemin', '0')
    expect(meter).toHaveAttribute('aria-valuemax', '120')
    expect(meter).toHaveAttribute('aria-valuetext', '25%, 30 of 120 hours')
  })

  it('stays valid with nothing open', () => {
    render(<Meter label="Court 2" value={0} max={0} />)
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuetext', '0%')
  })
})

describe('HeatGrid', () => {
  it('summarises the five busiest slots for screen readers', () => {
    const grid = Array.from({ length: 7 }, () => Array<number>(24).fill(0))
    grid[0][18] = 3
    grid[5][9] = 7
    grid[5][10] = 5
    grid[6][9] = 1
    grid[2][20] = 2
    grid[3][7] = 1
    const hours = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`)
    const { container } = render(<HeatGrid label="Busy hours" grid={grid} rowLabels={[...WEEKDAY_SHORT]} colLabels={hours} />)
    const rows = within(screen.getByRole('table', { name: 'Busy hours: busiest times' })).getAllByRole('row')
    expect(rows.map((row) => row.textContent)).toEqual([
      'Sat 09:007 bookings',
      'Sat 10:005 bookings',
      'Mon 18:003 bookings',
      'Wed 20:002 bookings',
      'Thu 07:001 booking',
    ])
    expect(container.querySelector('[title="Mon 18:00 · 3 bookings"]')).not.toBeNull()
  })
})

describe('Sparkline', () => {
  it('draws nothing for no values and a flat line for one or all-zero values', () => {
    expect(render(<Sparkline values={[]} />).container.querySelector('svg')).toBeNull()
    const one = render(<Sparkline values={[4]} />).container.querySelector('polyline')
    expect(one?.getAttribute('points')).toBe('0.00,4.00 100.00,4.00')
    const zeros = render(<Sparkline values={[0, 0, 0]} />).container.querySelector('polyline')
    expect(zeros?.getAttribute('points')).toBe('0.00,30.00 50.00,30.00 100.00,30.00')
  })
})
