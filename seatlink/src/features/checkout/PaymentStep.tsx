import type { SalesSnapshot } from '../../database.types'
import type { SeatLinkClient } from '../../seat-data'
import { formatMoney } from '../../sales-data'
import { countdown } from './checkout-state'
import { qrErrors } from './checkout-service'
import { usePayment } from './usePayment'
import PaymentQr from './PaymentQr'
import Icon from '../../components/Icon'
import './PaymentStep.css'
import SeatMap from '../seats/SeatMap'
import { currentOrderSeatIds } from '../seats/order-seat-map'

export default function PaymentStep({ client, snapshot, now, disabled, refresh, cancel, skipSeats }: {
  client: SeatLinkClient; snapshot: SalesSnapshot; now: number; disabled: boolean; refresh: () => Promise<void>; cancel: () => void; skipSeats: () => void
}) {
  const payment = usePayment(client, snapshot, now, disabled, refresh)
  const { attempt, busy, expired, receivedMinor, unresolved } = payment
  const order = snapshot.order!
  const cash = order.payment_method === 'CASH'
  const qr = order.payment_method === 'QR'
  const cannotConfirm = busy || !order.payment_method || (cash && (unresolved || receivedMinor === null || receivedMinor < order.total_minor)) ||
    (qr && (!!payment.configuration || payment.validQr))
  return <section aria-labelledby="payment-title">
    <h2 id="payment-title" className="with-icon"><Icon name="checkout" />Payment</h2>
    <p className="payment-reservation with-icon"><Icon name="timer" />{order.selected_seat_ids.length ? 'Reservation remaining' : 'Checkout remaining'} <strong>{countdown(order.session_expires_at, now)}</strong></p>
    {expired && <p role="alert" className="payment-message"><Icon name="warning" />The checkout session expired. Start a new order to continue.</p>}
    <fieldset className="payment-methods" disabled={busy}><legend>Choose payment method</legend>
      {(['QR', 'CASH'] as const).map((method) => <label key={method} className={`payment-method-card ${order.payment_method === method ? 'selected' : ''}`}>
        <input type="radio" name="payment-method" aria-label={method === 'QR' ? 'QR payment' : 'Cash'} value={method} checked={order.payment_method === method} onChange={() => payment.select(method)} />
        <Icon name={method === 'QR' ? 'qr' : 'cash'} /><span><strong>{method === 'QR' ? 'QR payment' : 'Cash'}</strong>
          <small>{method === 'QR' ? 'Show a QR for the customer to scan' : 'Receive cash at the counter'}</small>
          {order.payment_method === method && <small className="method-selected">Selected</small>}</span>
      </label>)}
    </fieldset>
    {cash && <div className="cash-form">
      <div className="cash-total"><span>Total due</span><strong>{formatMoney(order.total_minor, order.currency)}</strong></div>
      <label>Amount received ({order.currency})<input type="text" inputMode="decimal" value={payment.received}
        disabled={busy} onChange={(event) => payment.setReceived(event.target.value)} /></label>
      <p className="cash-change">Change due <strong>{receivedMinor !== null && receivedMinor >= order.total_minor ? formatMoney(receivedMinor - order.total_minor, order.currency) : '—'}</strong></p>
      {payment.received && (receivedMinor === null || receivedMinor < order.total_minor) && <p role="alert" className="payment-message"><Icon name="error" />Enter an amount that covers the total with valid currency precision.</p>}
      {unresolved && <p role="alert" className="payment-message warning-message"><Icon name="warning" />A QR attempt may still accept payment. Check its status or verified cancellation before confirming cash.</p>}
      {unresolved && (snapshot.attempts ?? []).filter((item) => item.provider === 'TWO_C2P' && item.status !== 'SUCCEEDED' && item.provider_state !== 'CLOSED')
        .map((item) => <button type="button" key={item.id} disabled={busy} onClick={() => payment.inquire(item.id)}>Check QR payment status · {item.id.slice(0, 8)}</button>)}
    </div>}
    {qr && <div className="qr-payment">
      <p className="payment-mode">{snapshot.payment_mode === 'MOCK' ? 'Development mock · No real charge' : snapshot.payment_mode === 'SANDBOX' ? 'Provider sandbox · Test payment' : 'QR payment unavailable'}</p>
      {payment.configuration && <p role="alert" className="payment-message warning-message"><Icon name="warning" />{qrErrors[payment.configuration]}</p>}
      {attempt?.qr_issue && <p role="alert" className="payment-message"><Icon name="error" />{qrErrors[attempt.qr_issue] ?? qrErrors.INVALID_QR_DATA}</p>}
      {attempt?.status === 'FAILED' && <p role="status">Payment failed. You can retry within the original reservation.</p>}
      {payment.validQr && <PaymentQr key={attempt!.id} mode={attempt!.provider === 'MOCK' ? 'MOCK' : 'SANDBOX'}
        text={attempt!.provider === 'MOCK' ? `seatlink-demo:${attempt!.id}` : null} imageUrl={attempt!.qr_image_url}
        reference={order.id.slice(0, 8)} amount={order.total_minor} currency={order.currency}
        deadline={attempt!.qr_expires_at} providerDeadline={attempt!.provider_qr_expires_at} />}
      {attempt && !payment.validQr && !payment.configuration && <p className="form-help">{attempt.provider_state === 'CREATING' ?
        'The QR request is processing. Check payment status if it does not appear.' :
        'No current QR is available. An expired or hidden QR may still accept payment; verify its status before cash.'}</p>}
      {attempt?.provider === 'TWO_C2P' && <button type="button" disabled={busy} onClick={() => payment.inquire(attempt.id)}>Check payment status</button>}
      <p className="form-help">QR renewal keeps the original checkout-session deadline.</p>
    </div>}
    {order.payment_method && <div className="payment-confirmation"><p>{cash ? 'Confirm only after receiving the cash.' : 'Confirm to display the payment QR code.'}</p>
      <button type="button" className="primary with-icon" disabled={cannotConfirm} onClick={payment.confirm}>
        <Icon name={cash ? 'cash' : 'qr'} />{payment.working ? 'Processing...' : 'Confirm'}</button></div>}
    {payment.notice && <p role="status" className="payment-message warning-message"><Icon name="timer" />{payment.notice}</p>}
    {payment.error && <p role="alert" className="payment-message"><Icon name="error" />{payment.error}</p>}
    {order.selected_seat_ids.length > 0 && <section aria-label="This order’s reserved seats">
      <h3>Reserved seats</h3><SeatMap tables={snapshot.tables} selectedIds={currentOrderSeatIds(snapshot)} />
      <p className="form-help">Continue without seats releases only this order’s reservation. The checkout deadline and payment attempts stay unchanged.</p>
      <button type="button" disabled={busy} onClick={skipSeats}>Continue without seats</button>
    </section>}
    <button type="button" className="cancel-reservation" disabled={payment.working || disabled} onClick={cancel}>Cancel and start again</button>
  </section>
}
