import { seatReference } from '../seats/seat-labels'
import type { SalesSnapshot } from '../../database.types'
import { formatMoney } from '../../sales-data'
import { countdown } from './checkout-state'
import Icon from '../../components/Icon'
import SeatMap from '../seats/SeatMap'
import { currentOrderSeatIds } from '../seats/order-seat-map'

export default function ResultStep({ snapshot, now, disabled, start }: {
  snapshot: SalesSnapshot; now: number; disabled: boolean; start: () => void
}) {
  const order = snapshot.order!
  const allocations = snapshot.allocations?.filter((item) => item.order_id === order.id) ?? []
  const paidAttempt = snapshot.attempts?.find(item => item.id === order.paid_attempt_id)
  return <section aria-labelledby="result-title">
    <h2 id="result-title" className="with-icon"><Icon name={order.status === 'PAID' ? 'success' : 'warning'} />{order.status === 'PAID' ? 'Payment confirmed' : order.status === 'PAID_REVIEW' ? 'Owner assistance required' :
      order.status === 'EXPIRED' ? 'Checkout expired' : 'Order cancelled'}</h2>
    <p>Order {order.id.slice(0, 8)}</p>
    {paidAttempt && ['MOCK','SANDBOX'].includes(paidAttempt.mode ?? paidAttempt.provider) && <small>Test payment · No real charge</small>}
    <p>Payment method {(order.paid_method ?? order.payment_method) === 'CASH' ? 'Cash & Card' : order.payment_method === 'QR' ? 'QR payment' : 'Not paid'}</p>
    <p>{order.status === 'PAID' || order.status === 'PAID_REVIEW' ? 'Paid total' : 'Order total'} {formatMoney(order.total_minor, order.currency)}</p>
    {order.status === 'PAID_REVIEW' && <p role="alert">Payment was recorded. Review the exception in Order history and arrange assistance for the customer.</p>}
    <ul>{allocations.map((seat) => <li key={seat.id}>{seatReference(seat.table_number,seat.label)} ·
      {countdown(seat.expires_at, now)} remaining · Ends {new Date(seat.expires_at).toLocaleTimeString()}</li>)}</ul>
    {!order.selected_seat_ids.length && <p>No seats selected</p>}
    {order.status === 'PAID' && !allocations.length && order.selected_seat_ids.length > 0 && <p>This order’s seat-use sessions have ended.</p>}
    {allocations.length > 0 && <SeatMap tables={snapshot.tables} selectedIds={currentOrderSeatIds(snapshot)} ownerNow={now} stale={disabled} />}
    <button type="button" className="primary" disabled={disabled} onClick={start}>Start new order</button>
  </section>
}
