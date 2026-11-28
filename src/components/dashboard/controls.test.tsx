import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PeriodSwitch, SortableTable } from '.'

describe('PeriodSwitch', () => {
  it('changes period on click', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<PeriodSwitch value={30} onChange={onChange} rangeText="Oct 26 – Nov 24, 2026" />)
    expect(screen.getByRole('radio', { name: '30 days' })).toHaveAttribute('aria-checked', 'true')
    await user.click(screen.getByRole('radio', { name: '90 days' }))
    expect(onChange).toHaveBeenCalledWith(90)
    expect(screen.getByText('Oct 26 – Nov 24, 2026')).toBeInTheDocument()
  })

  it('moves with the arrow keys and wraps around', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<PeriodSwitch value={30} onChange={onChange} />)
    await user.tab()
    expect(screen.getByRole('radio', { name: '30 days' })).toHaveFocus()
    await user.keyboard('{ArrowRight}')
    expect(onChange).toHaveBeenLastCalledWith(90)
    expect(screen.getByRole('radio', { name: '90 days' })).toHaveFocus()
    await user.keyboard('{ArrowRight}')
    expect(onChange).toHaveBeenLastCalledWith(7)
    await user.keyboard('{ArrowLeft}')
    expect(onChange).toHaveBeenLastCalledWith(90)
  })
})

interface Row {
  id: string
  name: string
  hours: number
}

const rows: Row[] = [
  { id: 'a', name: 'Court 2', hours: 10 },
  { id: 'b', name: 'Court 1', hours: 30 },
  { id: 'c', name: 'Court 10', hours: 20 },
]

function renderTable() {
  render(
    <SortableTable
      caption="Courts"
      rows={rows}
      rowKey={(row) => row.id}
      columns={[
        { key: 'name', header: 'Court', render: (row) => row.name, sortValue: (row) => row.name },
        { key: 'hours', header: 'Hours', render: (row) => `${row.hours} h`, sortValue: (row) => row.hours, align: 'right' },
      ]}
      initialSort={{ key: 'hours', dir: 'desc' }}
    />,
  )
  const table = screen.getByRole('table', { name: 'Courts' })
  const names = () => within(table).getAllByRole('row').slice(1).map((row) => (row as HTMLTableRowElement).cells[0].textContent)
  return { table, names }
}

describe('SortableTable', () => {
  it('starts with the initial sort and sorts both ways', async () => {
    const user = userEvent.setup()
    const { names } = renderTable()
    expect(names()).toEqual(['Court 1', 'Court 10', 'Court 2'])
    expect(screen.getByRole('columnheader', { name: /Hours/ })).toHaveAttribute('aria-sort', 'descending')

    await user.click(screen.getByRole('button', { name: 'Hours' }))
    expect(names()).toEqual(['Court 2', 'Court 10', 'Court 1'])
    expect(screen.getByRole('columnheader', { name: /Hours/ })).toHaveAttribute('aria-sort', 'ascending')

    await user.click(screen.getByRole('button', { name: 'Court' }))
    expect(names()).toEqual(['Court 1', 'Court 2', 'Court 10'])
    expect(screen.getByRole('columnheader', { name: /Court/ })).toHaveAttribute('aria-sort', 'ascending')
    expect(screen.getByRole('columnheader', { name: /Hours/ })).toHaveAttribute('aria-sort', 'none')

    await user.click(screen.getByRole('button', { name: 'Court' }))
    expect(names()).toEqual(['Court 10', 'Court 2', 'Court 1'])
    expect(screen.getByRole('columnheader', { name: /Court/ })).toHaveAttribute('aria-sort', 'descending')
  })

  it('renders each value once and labels cells for the phone layout', () => {
    renderTable()
    expect(screen.getAllByText('30 h')).toHaveLength(1)
    expect(screen.getByText('30 h')).toHaveAttribute('data-label', 'Hours')
  })

  it('shows the empty content when there are no rows', () => {
    render(<SortableTable caption="Courts" rows={[]} rowKey={() => ''} columns={[]} empty={<p>No courts yet</p>} />)
    expect(screen.getByText('No courts yet')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})
