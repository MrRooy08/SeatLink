import { useEffect, useState } from 'react'
import { createDisplayClient } from '../../supabase'
import { formatMoney } from '../../sales-data'
import PaymentQr from '../checkout/PaymentQr'
import Icon from '../../components/Icon'
import { useDisplay } from './useDisplay'
import OrderSeatSummary from './OrderSeatSummary'
import './CustomerDisplay.css'

export default function CustomerDisplay() {
  const [client] = useState(createDisplayClient)
  const [token, setToken] = useState(() => window.location.hash.slice(1))
  const { state, error, live, retry } = useDisplay(client, token)
  const [tick, setTick] = useState(() => performance.now())
  useEffect(() => {
    const changePairing = () => setToken(window.location.hash.slice(1))
    window.addEventListener('hashchange', changePairing)
    return () => window.removeEventListener('hashchange', changePairing)
  }, [])
  useEffect(() => {
    const timer = window.setInterval(() => setTick(performance.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  if (!client) return <main className="customer-display"><h1>Display configuration required</h1><p>Ask the owner to configure SeatLink’s Supabase connection.</p></main>
  if (!token) return <main className="customer-display"><h1>Pair this display</h1><p>Open a pairing link from the owner’s checkout counter.</p></main>
  if (!state) return <main className="customer-display">
    <h1>Customer display</h1>
    <p role={error ? 'alert' : 'status'}>{error || 'Loading current checkout…'}</p>
    {error && <button type="button" onClick={retry}>Retry connection</button>}
  </main>

  const { data, receivedAt } = state
  const now = Date.parse(data.server_now) + Math.max(0, tick - receivedAt)
  const stale = !!error || tick - receivedAt > (live ? 45000 : 15000)
  const order = data.order
  const sessionExpired = order?.status === 'PENDING' && Date.parse(order.session_expires_at!) <= now
  const qrMethod = order?.payment_method === 'QR' || order?.payment_method === undefined
  const showQr = !stale && qrMethod && order?.status === 'PENDING' && !sessionExpired && order.payment_status === 'PENDING' &&
    !!(order.qr_text || order.qr_image_url) && Date.parse(order.qr_expires_at!) > now

  return (
    <main className="customer-display">
      <header><p className="display-brand">SeatLink</p><h1>{data.branch}</h1><p>{data.station_name}</p></header>
      <p className="display-connection" role="status">{stale ? error || 'Reconnecting. Showing the last received information.' :
        live ? 'Connected to your checkout counter' : 'Updating checkout information periodically'}</p>
      {stale && <button type="button" onClick={retry}>Retry connection</button>}
      {!order ? <section className="display-current"><h2>Welcome</h2><p>Your order will appear here when the owner starts checkout.</p></section> : (
        <section className="display-current" aria-label="Current customer checkout">
          <h2>Your order</h2>
          {['PAID','PAID_REVIEW'].includes(order.status) && ['MOCK','SANDBOX'].includes(order.payment_mode ?? '') && <small>Test payment · No real charge</small>}
          <ul>{order.items.map((item) => <li key={item.name}><span>{item.quantity} × {item.name}</span>
            <span>{formatMoney(item.unit_price_minor * item.quantity, order.currency)}</span></li>)}</ul>
          <p className="display-total">Total {formatMoney(order.total_minor, order.currency)}</p>
          <OrderSeatSummary order={order} tables={data.tables} />
          {order.status === 'DRAFT' && <p>The seller is preparing your order.</p>}
          {order.status === 'PENDING' && !sessionExpired && <p>Complete payment before {new Date(order.session_expires_at!).toLocaleTimeString()}.</p>}
          {order.payment_method && <p>Payment method {(order.paid_method ?? order.payment_method) === 'CASH' ? 'Cash & Card' : 'QR payment'}</p>}
          {order.status === 'PENDING' && order.payment_method === 'CASH' && !sessionExpired && <p role="status" className="display-cash with-icon"><Icon name="cash" />Please pay at the counter.</p>}
          {showQr && <PaymentQr key={order.payment_attempt_id ?? order.qr_text ?? order.qr_image_url} customer
            mode={order.qr_text ? 'MOCK' : 'SANDBOX'} text={order.qr_text} imageUrl={order.qr_image_url}
            reference={order.reference} amount={order.total_minor} currency={order.currency}
            deadline={order.qr_expires_at!} providerDeadline={order.provider_qr_expires_at} />}
          {qrMethod && order.status === 'PENDING' && order.payment_status === 'FAILED' && !sessionExpired && <p role="status">Payment failed. Please wait for the seller to retry.</p>}
          {qrMethod && order.status === 'PENDING' && !showQr && !sessionExpired && order.payment_status !== 'FAILED' &&
            <p>{stale ? 'Waiting for a current payment QR.' : 'Waiting for the owner to generate or renew the payment QR.'}</p>}
          {(order.status === 'EXPIRED' || sessionExpired) && <p role="status">The order session has expired. Please ask the owner for assistance.</p>}
          {order.status === 'CANCELLED' && <p role="status">This order was cancelled.</p>}
          {order.status === 'PAID' && <p role="status" className="display-success with-icon"><Icon name="success" />Payment confirmed.</p>}
          {order.status === 'PAID_REVIEW' && <p role="alert" className="with-icon"><Icon name="warning" />Payment received. Please ask the owner for assistance.</p>}
        </section>
      )}
    </main>
  )
}
