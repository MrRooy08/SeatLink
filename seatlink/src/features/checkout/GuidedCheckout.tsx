import { useState } from 'react'
import type { SalesSnapshot } from '../../database.types'
import type { SeatLinkClient } from '../../seat-data'
import type { useCheckout } from './useCheckout'
import { checkoutSteps } from './checkout-state'
import { checkoutOperation } from './checkout-service'
import MenuCart from './MenuCart'
import SeatSelection from './SeatSelection'
import PaymentStep from './PaymentStep'
import ResultStep from './ResultStep'
import OrderSummary from './OrderSummary'
import './GuidedCheckout.css'
import Icon from '../../components/Icon'

export default function GuidedCheckout({ client, snapshot, checkout, now, disabled, refresh }: {
  client: SeatLinkClient; snapshot: SalesSnapshot; checkout: ReturnType<typeof useCheckout>
  now: number; disabled: boolean; refresh: () => Promise<void>
}) {
  const [cancel, setCancel] = useState(false)
  const stepIndex = checkoutSteps.findIndex((step) => step.id === checkout.step)
  const busy = disabled || checkout.working
  function start() {
    if (snapshot.station) void checkout.run(() => checkoutOperation(client, 'start_next_sale', { p_station_id: snapshot.station!.id }))
  }
  return <>
    <ol className="checkout-steps" aria-label="Checkout steps">{checkoutSteps.map((step, index) => (
      <li key={step.id} aria-current={step.id === checkout.step ? 'step' : undefined}>
        {index < stepIndex && <span aria-label="Completed"><Icon name="success" /> </span>}{step.label}
      </li>
    ))}</ol>
    <div className="guided-layout">
      <div className="step-workspace">
        {checkout.step === 'MENU' && <MenuCart snapshot={snapshot} checkout={checkout} disabled={disabled} />}
        {checkout.step === 'SEATS' && <SeatSelection snapshot={snapshot} checkout={checkout} disabled={disabled}
          back={() => void checkout.run(() => checkoutOperation(client, 'change_draft_step', { p_order_id: snapshot.order!.id, p_step: 'MENU' }))} />}
        {checkout.step === 'PAYMENT' && <PaymentStep client={client} snapshot={snapshot} now={now}
          disabled={busy} refresh={refresh} cancel={() => setCancel(true)} skipSeats={checkout.skipSeats} />}
        {checkout.step === 'RESULT' && <ResultStep snapshot={snapshot} now={now} disabled={busy} start={start} />}
        {checkout.error && <p role="alert">{checkout.error}</p>}
        {cancel && <section className="confirmation-panel" role="region" aria-label="Cancel and start again">
          <h2>Release this reservation and start again?</h2>
          <p>The reserved seats will be released. Order and payment history will be kept. Any late payment will need owner review.</p>
          <div className="action-row">
            <button type="button" disabled={busy} onClick={() => void checkout.run(async () => {
              await checkoutOperation(client, 'cancel_order', { p_order_id: snapshot.order!.id })
              if (snapshot.station) await checkoutOperation(client, 'start_next_sale', { p_station_id: snapshot.station.id })
              setCancel(false)
            })}>Confirm cancellation and restart</button>
            <button type="button" disabled={busy} onClick={() => setCancel(false)}>Keep reservation</button>
          </div>
        </section>}
      </div>
      <OrderSummary snapshot={snapshot} checkout={checkout} now={now} />
    </div>
  </>
}
