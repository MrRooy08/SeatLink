import type { SalesSnapshot } from '../../database.types'
import { formatMoney } from '../../sales-data'
import { countdown } from './checkout-state'
import Icon from '../../components/Icon'

export default function ResultStep({ snapshot, now, disabled, start }: {
  snapshot: SalesSnapshot; now: number; disabled: boolean; start: () => void
}) {
  const order = snapshot.order!
  const allocations = snapshot.allocations?.filter((item) => item.order_id === order.id) ?? []
  return <section aria-labelledby="result-title">
    <h2 id="result-title" className="with-icon"><Icon name={order.status === 'PAID' ? 'success' : 'warning'} />{order.status === 'PAID' ? 'Payment confirmed' : order.status === 'PAID_REVIEW' ? 'Owner assistance required' :
      order.status === 'EXPIRED' ? 'Reservation expired' : 'Order cancelled'}</h2>
    <p>Order {order.id.slice(0, 8)}</p>
    <p>Payment method {order.paid_method ?? order.payment_method ?? 'Not paid'}</p>
    <p>{order.status === 'PAID' || order.status === 'PAID_REVIEW' ? 'Paid total' : 'Order total'} {formatMoney(order.total_minor, order.currency)}</p>
    {order.status === 'PAID_REVIEW' && <p role="alert">Payment was recorded. Review the exception in Order history and arrange assistance for the customer.</p>}
    <ul>{allocations.map((seat) => <li key={seat.id}>Table {seat.table_number} / Seat {seat.label} ·
      {countdown(seat.expires_at, now)} remaining · Ends {new Date(seat.expires_at).toLocaleTimeString()}</li>)}</ul>
    {order.status === 'PAID' && !allocations.length && <p>This order’s seat-use sessions have ended.</p>}
    <button type="button" className="primary" disabled={disabled} onClick={start}>Start new order</button>
  </section>
}
