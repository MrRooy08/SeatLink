import type { SalesSnapshot } from '../../database.types'

export function currentOrderSeatIds(snapshot: SalesSnapshot) {
  const order = snapshot.order
  if (!order) return []
  if (order.status === 'DRAFT') return order.draft_seat_ids ?? []
  if (order.status === 'PENDING') return snapshot.tables.flatMap(table => table.seats
    .filter(seat => seat.locked_order_id === order.id && order.selected_seat_ids.includes(seat.id)).map(seat => seat.id))
  return (snapshot.allocations ?? []).filter(use => use.order_id === order.id && use.status === 'ACTIVE').map(use => use.seat_id)
}
