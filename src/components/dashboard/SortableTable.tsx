import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { useState } from 'react'
import type { ReactNode } from 'react'

export interface SortableColumn<T> {
  key: string
  header: string
  render: (row: T) => ReactNode
  /** Makes the column sortable. */
  sortValue?: (row: T) => string | number
  align?: 'left' | 'right'
}

export interface TableSort {
  key: string
  dir: 'asc' | 'desc'
}

export interface SortableTableProps<T> {
  caption: string
  rows: T[]
  rowKey: (row: T) => string
  columns: SortableColumn<T>[]
  initialSort?: TableSort
  empty?: ReactNode
}

function compare(a: string | number, b: string | number): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b), 'en', { numeric: true, sensitivity: 'base' })
}

/**
 * One real table. From tablet width it is a plain table with sortable headers; on a phone each
 * row becomes a small card of "header: value" lines. The labels on a phone are drawn by CSS from
 * `data-label`, so every value is in the page once.
 */
export function SortableTable<T>({ caption, rows, rowKey, columns, initialSort, empty }: SortableTableProps<T>) {
  const [sort, setSort] = useState<TableSort | null>(initialSort ?? null)

  if (rows.length === 0) {
    return <>{empty ?? <p className="text-body text-muted">Nothing to show yet.</p>}</>
  }

  const sortColumn = sort ? columns.find((column) => column.key === sort.key && column.sortValue) : undefined
  const sorted = sortColumn?.sortValue
    ? [...rows].sort((a, b) => {
        const order = compare(sortColumn.sortValue!(a), sortColumn.sortValue!(b))
        return sort!.dir === 'asc' ? order : -order
      })
    : rows

  const onSort = (column: SortableColumn<T>) => {
    if (sort?.key === column.key) {
      setSort({ key: column.key, dir: sort.dir === 'asc' ? 'desc' : 'asc' })
      return
    }
    // Figures start with the biggest; words start at A.
    const first = rows[0] && column.sortValue ? column.sortValue(rows[0]) : ''
    setSort({ key: column.key, dir: typeof first === 'number' ? 'desc' : 'asc' })
  }

  return (
    <div className="min-w-0 md:overflow-x-auto">
      <table className="w-full border-collapse text-body max-md:block">
        <caption className="sr-only">{caption}</caption>
        <thead className="max-md:hidden">
          <tr className="border-b border-line">
            {columns.map((column) => {
              const right = column.align === 'right'
              const active = sort?.key === column.key && Boolean(column.sortValue)
              const ariaSort = column.sortValue ? (active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none') : undefined
              const Icon = active ? (sort!.dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown
              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={ariaSort}
                  className={`p-0 text-status font-semibold whitespace-nowrap text-slate-600 ${right ? 'text-right' : 'text-left'}`}
                >
                  {column.sortValue ? (
                    <button
                      type="button"
                      onClick={() => onSort(column)}
                      className={`inline-flex h-12 w-full items-center gap-1.5 border-0 bg-transparent px-3 font-semibold ${
                        right ? 'justify-end' : 'justify-start'
                      } ${active ? 'text-ink' : 'text-slate-600'}`}
                    >
                      <span>{column.header}</span>
                      <Icon aria-hidden className={`size-4 shrink-0 ${active ? '' : 'text-slate-400'}`} />
                    </button>
                  ) : (
                    <span className="flex h-12 items-center px-3">{column.header}</span>
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody className="max-md:block max-md:space-y-3">
          {sorted.map((row) => (
            <tr
              key={rowKey(row)}
              className="border-b border-line last:border-b-0 max-md:block max-md:rounded-2xl max-md:border max-md:border-line max-md:bg-white max-md:px-4 max-md:py-2 max-md:last:border-b"
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  data-label={column.header}
                  className={`px-3 py-3 align-middle tabular-nums text-ink ${column.align === 'right' ? 'md:text-right' : ''} max-md:flex max-md:items-baseline max-md:justify-between max-md:gap-4 max-md:px-0 max-md:py-1.5 max-md:text-right max-md:before:shrink-0 max-md:before:text-left max-md:before:font-semibold max-md:before:text-muted max-md:before:content-[attr(data-label)]`}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
