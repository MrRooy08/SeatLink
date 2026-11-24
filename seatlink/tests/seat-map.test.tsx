// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import SeatMap from '../src/features/seats/SeatMap'
import type { MapTable } from '../src/features/seats/SeatMap'

afterEach(cleanup)
const tables: MapTable[] = [{ id: 'actual-table', table_number: 7, seats: [
  { id: 'seat-uuid-a', label: 'A', status: 'AVAILABLE' },
  { id: 'seat-uuid-b', label: 'B', status: 'LOCKED', current_order: true },
  { id: 'seat-uuid-c', label: 'C', status: 'UNAVAILABLE' },
  { id: 'seat-uuid-d', label: 'D', status: 'UNAVAILABLE', current_order: true },
] }, { id: 'partial-table', table_number: 8, seats: [{ id: 'only-seat', label: 'C', status: 'AVAILABLE' }] }]

it('preserves real IDs, labels, partial tables and keyboard selection', async () => {
  const toggle = vi.fn()
  const user = userEvent.setup()
  render(<SeatMap tables={tables} onToggle={toggle} />)
  expect(screen.getAllByRole('article')).toHaveLength(2)
  const available = screen.getByRole('button', { name: 'Table G · Seat 1' })
  available.focus()
  await user.keyboard('{Enter}')
  expect(toggle).toHaveBeenLastCalledWith('seat-uuid-a')
  await user.click(screen.getByRole('button', { name: 'Table H · Seat 3' }))
  expect(toggle).toHaveBeenLastCalledWith('only-seat')
  expect(screen.getByRole('button', { name: 'Table G · Seat 3' }).hasAttribute('disabled')).toBe(true)
})

it('shows current-order identity alongside actual reserved and occupied states without customer controls', () => {
  render(<SeatMap tables={tables} />)
  expect(screen.queryByRole('button')).toBeNull()
  const reserved = within(screen.getByRole('group', { name: 'Table G · Seat 2' }))
  expect(reserved.getByRole('tooltip', { hidden: true }).textContent).toMatch(/Awaiting payment.*This order/)
  const occupied = within(screen.getByRole('group', { name: 'Table G · Seat 4' }))
  expect(occupied.getByRole('tooltip', { hidden: true }).textContent).toMatch(/Occupied.*This order/)
  expect(screen.getByRole('list', { name: 'Seat status legend' }).textContent).toMatch(/Available.*Selected.*Awaiting payment.*Occupied.*This order/)
})

it('keeps partial table labels in the same compass position and supports Space to toggle', async () => {
  const user = userEvent.setup()
  const toggle = vi.fn()
  render(<SeatMap tables={tables} selectedIds={['only-seat']} onToggle={toggle} />)
  const partial = screen.getByRole('button', { name: 'Table H · Seat 3' })
  expect(partial.getAttribute('aria-pressed')).toBe('true')
  expect(partial.parentElement?.className).toMatch(/south/)
  partial.focus()
  await user.keyboard(' ')
  expect(toggle).toHaveBeenCalledWith('only-seat')
  expect(screen.getByRole('heading', { name: 'Table H' }).textContent).toBe('H')
})
