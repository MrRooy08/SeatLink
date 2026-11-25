import type { DisplaySnapshot } from '../../database.types'
import { seatNumber, tableLabel } from '../seats/seat-labels'
import styles from './OrderSeatSummary.module.css'

export default function OrderSeatSummary({ order, tables }: Pick<DisplaySnapshot, 'order' | 'tables'>) {
  if (!order || !order.selected_seats.length || ['CANCELLED', 'EXPIRED'].includes(order.status) ||
    order.status === 'DRAFT' && order.checkout_step === 'MENU') return null

  // Membership comes only from this order, never availability/current_order map flags or allocations.
  const grouped = new Map<number, Set<string>>()
  for (const seat of order.selected_seats) {
    const labels = grouped.get(seat.table_number) ?? new Set<string>()
    labels.add(seat.label)
    grouped.set(seat.table_number, labels)
  }
  return <div className={styles.summary} role="status" aria-label="Your seats" aria-atomic="true">
    <strong>Your seats:</strong>
    <div className={styles.tables}>{[...grouped].sort(([a], [b]) => a - b).map(([number, labels]) => {
      const table = tables.find(table => table.table_number === number)
      const displayNumber = (label: string) => table?.seats.find(seat => seat.label === label)?.display_number ?? seatNumber(label)
      return <p key={number}>Table {table?.display_label ?? tableLabel(number)} · {[...labels]
        .sort((a, b) => String(displayNumber(a)).localeCompare(String(displayNumber(b)), undefined, { numeric: true }))
        .map(label => `Seat ${displayNumber(label)}`).join(', ')}</p>
    })}</div>
  </div>
}
