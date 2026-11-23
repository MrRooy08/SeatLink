import { useState } from 'react'
import DemoQr from './DemoQr'
import Icon from '../../components/Icon'
import { formatMoney } from '../../sales-data'
import './PaymentQr.css'

export default function PaymentQr({ mode, text, imageUrl, reference, amount, currency, deadline, providerDeadline, customer = false }: {
  mode: 'MOCK' | 'SANDBOX'; text?: string | null; imageUrl?: string | null; reference: string
  amount: number; currency: string; deadline: string; providerDeadline?: string | null; customer?: boolean
}) {
  const [failedImage, setFailedImage] = useState('')
  return <section className="payment-qr-card" aria-label="Current payment QR">
    <h3 className="with-icon"><Icon name="qr" />Scan to pay</h3>
    <p className="qr-mode-label">{mode === 'MOCK' ? 'Development mock · No real charge' : '2C2P sandbox · Test payment'}</p>
    <div className="qr-white-surface">{mode === 'MOCK' && text ? <DemoQr text={text} /> :
      imageUrl && failedImage !== imageUrl ? <img src={imageUrl} width="280" height="280" alt="2C2P sandbox payment QR" onError={() => setFailedImage(imageUrl)} /> :
        <p role="alert">{customer ? 'Payment QR unavailable. Please ask the seller for assistance.' : 'The QR image is missing or could not load. Check the provider image response and connection.'}</p>}</div>
    <p className="qr-amount">{formatMoney(amount, currency)}</p>
    <p>Order {reference}</p>
    <span className="state-badge pending"><Icon name="timer" />Waiting for payment</span>
    <p className="qr-expiry">{mode === 'MOCK' || providerDeadline ? 'QR expires' : 'QR display ends'} {new Date(providerDeadline ?? deadline).toLocaleTimeString()}</p>
    {providerDeadline && Date.parse(providerDeadline) > Date.parse(deadline) && <p className="qr-expiry">Display ends with the checkout session at {new Date(deadline).toLocaleTimeString()}.</p>}
  </section>
}
