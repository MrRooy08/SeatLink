import type { SalesSnapshot } from '../../database.types'
import { formatMoney } from '../../sales-data'
import type { useCheckout } from './useCheckout'
import { countdown } from './checkout-state'
import { useState } from 'react'
import Icon from '../../components/Icon'
import './OrderSummary.css'

export default function OrderSummary({ snapshot, checkout, now }: {
  snapshot: SalesSnapshot; checkout: ReturnType<typeof useCheckout>; now: number
}) {
  const order = snapshot.order
  const menuStep = checkout.step === 'MENU'
  const [expanded, setExpanded] = useState(() => !window.matchMedia?.('(max-width: 800px)').matches)
  const items = menuStep ? Object.entries(checkout.cart).map(([id, quantity]) => ({
    menu_item_id: id, quantity, name: snapshot.menu.find((item) => item.id === id)?.name ?? 'Unavailable item',
    unit_price_minor: checkout.dirty ? undefined : snapshot.cart_preview?.find((item) => item.menu_item_id === id)?.unit_price_minor,
  })) : order?.items ?? []
  const seatIds = checkout.step === 'SEATS' ? checkout.selected : order?.selected_seat_ids ?? []
  const seats = snapshot.tables.flatMap((table) => table.seats.filter((seat) => seatIds.includes(seat.id))
    .map((seat) => `Table ${table.table_number} / Seat ${seat.label}`))
  const total = menuStep ? checkout.previewTotal : order?.total_minor
  const currency = menuStep ? checkout.previewCurrency : order?.currency
  const method = order?.paid_method ?? order?.payment_method
  const paid = order?.status === 'PAID'
  const problem = ['PAID_REVIEW', 'EXPIRED', 'CANCELLED'].includes(order?.status ?? '')
  const status = paid ? 'Payment confirmed' : order?.status === 'PAID_REVIEW' ? 'Owner review required' :
    order?.status === 'PENDING' ? 'Awaiting payment' : order?.status === 'EXPIRED' ? 'Reservation expired' :
    order?.status === 'CANCELLED' ? 'Order cancelled' : 'Order being prepared'
  return <aside className="order-summary" aria-labelledby="summary-title">
    <details open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}>
      <summary className="summary-heading"><h2 id="summary-title" className="with-icon"><Icon name="cart" />Order summary</h2>
        <span>{currency && total !== undefined ? formatMoney(total, currency) : 'View order'} <span aria-hidden="true">⌄</span></span></summary>
      <div className="summary-body">
        <div className="summary-reference"><span>Order reference</span><strong>{order ? order.id.slice(0, 8).toUpperCase() : 'New order'}</strong></div>
        <ul className="summary-items">{items.map((item) => <li key={item.menu_item_id}><span><b className="quantity-badge">{item.quantity}×</b> {item.name}</span>
          <strong>{currency && item.unit_price_minor !== undefined ? formatMoney(item.quantity * item.unit_price_minor, currency) : '—'}</strong></li>)}</ul>
        {!items.length && <p className="summary-empty">Your items will appear here.</p>}
        <div className="summary-total"><span>{menuStep ? 'Validated total' : 'Total'}</span><strong>{currency && total !== undefined ? formatMoney(total, currency) : '—'}</strong></div>
        {menuStep && checkout.dirty && <p className="summary-note" role="status">Updating the validated total…</p>}
        <section className="summary-section"><h3 className="with-icon"><Icon name="seats" />{checkout.step === 'SEATS' ? 'Selected seats' : 'Seats'}</h3>
          <div className="seat-badges">{seats.length ? seats.map((seat) => <span className="seat-badge" key={seat}>{seat}</span>) : <span>No seats selected</span>}</div></section>
        <section className="summary-section"><h3 className="with-icon"><Icon name={method === 'CASH' ? 'cash' : 'qr'} />Payment method</h3>
          <p>{method === 'CASH' ? 'Cash' : method === 'QR' ? 'QR payment' : 'Not selected'}</p>
          <span className={`state-badge ${paid ? 'success' : problem ? 'error' : 'pending'}`}><Icon name={paid ? 'success' : problem ? 'warning' : 'timer'} />{status}</span></section>
        {order?.status === 'PENDING' && <div className="summary-countdown"><Icon name="timer" /><span>{order.selected_seat_ids.length ? 'Reservation remaining' : 'Checkout remaining'}</span><strong>{countdown(order.session_expires_at, now)}</strong></div>}
      </div>
    </details>
  </aside>
}
