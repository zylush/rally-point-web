import { render, screen } from '@testing-library/react'
import { CalendarCheck } from 'lucide-react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AttentionList, FactList, Section, StatCard, Trend, UpdatedStamp } from '.'

describe('Trend', () => {
  it('says up and colours a good rise green', () => {
    const { container } = render(<Trend current={112} previous={100} />)
    expect(container).toHaveTextContent('Up 12% vs previous period')
    expect(container.firstElementChild).toHaveClass('text-ok')
  })

  it('colours a rise red when fewer is better', () => {
    const { container } = render(<Trend current={6} previous={4} goodWhen="down" compareLabel="vs last week" />)
    expect(container).toHaveTextContent('Up 50% vs last week')
    expect(container.firstElementChild).toHaveClass('text-danger')
  })

  it('says down, green when fewer is better and red otherwise', () => {
    const good = render(<Trend current={3} previous={4} goodWhen="down" />)
    expect(good.container).toHaveTextContent('Down 25% vs previous period')
    expect(good.container.firstElementChild).toHaveClass('text-ok')
    good.unmount()
    const bad = render(<Trend current={3} previous={4} />)
    expect(bad.container.firstElementChild).toHaveClass('text-danger')
  })

  it('uses plain words for new, same and nothing', () => {
    expect(render(<Trend current={5} previous={0} />).container).toHaveTextContent('New this period')
    expect(render(<Trend current={100} previous={100} />).container).toHaveTextContent('Same as previous period')
    expect(render(<Trend current={0} previous={0} />).container).toHaveTextContent('Nothing yet')
  })
})

describe('StatCard', () => {
  it('is a plain card without a link', () => {
    render(<StatCard label="Bookings" value="42" icon={CalendarCheck} />)
    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('becomes one link with its trend when `to` is set', () => {
    render(
      <MemoryRouter>
        <StatCard label="Bookings" value="42" icon={CalendarCheck} current={42} previous={21} series={[1, 2, 3]} to="/admin/bookings" />
      </MemoryRouter>,
    )
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', '/admin/bookings')
    expect(link).toHaveClass('control-feedback')
    expect(link).toHaveTextContent('Bookings42Up 100% vs previous period')
    // The value appears once.
    expect(screen.getAllByText('42')).toHaveLength(1)
  })
})

describe('Section and FactList', () => {
  it('names the section by its title and lists facts once', () => {
    render(
      <Section title="Money in" description="Charges recorded">
        <FactList
          facts={[
            { label: 'Court bookings', value: '₱4,000', strong: true },
            { label: 'Of which online', value: '₱1,500', indent: true },
          ]}
        />
      </Section>,
    )
    expect(screen.getByRole('region', { name: 'Money in' })).toBeInTheDocument()
    expect(screen.getAllByText('₱1,500')).toHaveLength(1)
    expect(screen.getByText('Of which online')).toHaveClass('pl-4')
  })
})

describe('UpdatedStamp', () => {
  it('shows the time in Philippine time', () => {
    render(<UpdatedStamp at={new Date('2026-11-24T11:42:00Z')} />)
    expect(screen.getByText('Updated 7:42 PM')).toBeInTheDocument()
  })

  it('warns when the figures stopped updating', () => {
    render(<UpdatedStamp at={new Date('2026-11-24T11:42:00Z')} stale />)
    expect(screen.getByText('Not updated')).toHaveClass('pill-warn')
  })
})

describe('AttentionList', () => {
  it('links rows that have somewhere to go', () => {
    render(
      <MemoryRouter>
        <AttentionList
          empty="Nothing needs you"
          items={[
            { key: 'pay', tone: 'warn', title: 'Payments to check', count: 3, to: '/staff/payments' },
            { key: 'note', tone: 'brand', title: 'Two courts closed', detail: 'Maintenance' },
          ]}
        />
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: /Payments to check/ })).toHaveAttribute('href', '/staff/payments')
    expect(screen.getByText('3')).toHaveClass('pill-warn')
    expect(screen.getAllByRole('link')).toHaveLength(1)
  })

  it('says all is well when empty', () => {
    render(<AttentionList items={[]} empty="Nothing needs you" />)
    expect(screen.getByText('Nothing needs you')).toBeInTheDocument()
  })
})
