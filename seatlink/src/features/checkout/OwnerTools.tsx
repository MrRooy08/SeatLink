import { useState } from 'react'
import type { SalesSnapshot } from '../../database.types'
import type { SeatLinkClient } from '../../seat-data'
import { formatMoney, salesError } from '../../sales-data'
import { checkoutOperation } from './checkout-service'
import './OwnerTools.css'
import ActiveSeats from '../seats/ActiveSeats'
import { seatReference } from '../seats/seat-labels'

export default function OwnerTools({
  client, snapshot, now, disabled, refresh, view, branchId,
}: {
  client: SeatLinkClient; snapshot: SalesSnapshot; now: number; disabled: boolean; refresh: () => Promise<void>; branchId: string; view: 'ACTIVE_SEATS' | 'HISTORY' | 'DISPLAY' | 'DEVELOPMENT'
}) {
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [displayLink, setDisplayLink] = useState('')
  const [attemptId, setAttemptId] = useState('')
  const [minutes, setMinutes] = useState('1')
  const [notes, setNotes] = useState<Record<string, string>>({})
  const attempts = snapshot.attempts ?? []
  const allAttempts = (snapshot.recent_attempts ?? attempts).filter((attempt) => attempt.provider === 'MOCK')
  const allocations = snapshot.allocations ?? []
  const canSimulate = view === 'DEVELOPMENT' && import.meta.env.DEV && snapshot.development_enabled
  const busy = disabled || working
  const chosenAttempt = allAttempts.find((attempt) => attempt.id === attemptId) ?? allAttempts[0]

  async function run(action: () => Promise<unknown>) {
    if (busy) return
    setWorking(true)
    setError('')
    try {
      await action()
    } catch (failure) {
      setError(salesError(failure))
    } finally {
      await refresh()
      setWorking(false)
    }
  }

  function simulate(result: 'SUCCESS' | 'FAILURE') {
    if (!chosenAttempt) return
    void run(() => checkoutOperation(client, 'simulate_mock_payment', {
      p_attempt_id: chosenAttempt.id, p_event_id: crypto.randomUUID(), p_result: result,
    }))
  }

  return (
    <div className="checkout-panels">
      {view === 'DISPLAY' && snapshot.station && (
        <section className="checkout-panel" aria-labelledby="display-pairing-title">
          <h2 id="display-pairing-title">Customer display</h2>
          <details><summary>Connection diagnostics</summary><p>{snapshot.station.name}</p><p>Last display contact: {snapshot.display_last_seen_at ? new Date(snapshot.display_last_seen_at).toLocaleString() : 'None'}</p><button type="button" disabled={busy} onClick={() => void refresh()}>Refresh connection</button></details>
          <details><summary>Payment settings</summary><p>QR mode: {snapshot.payment_mode ?? 'Unavailable'}</p><p>Configuration: {snapshot.qr_configuration ?? 'Unavailable'}</p></details>
          <button type="button" disabled={busy} onClick={() => void run(async () => {
            const token = await checkoutOperation(client, 'pair_customer_display', { p_station_id: snapshot.station!.id })
            const url = new URL('/display', window.location.origin)
            url.hash = token
            setDisplayLink(url.toString())
          })}>Pair customer display</button>
          {displayLink && <p><a href={displayLink} target="_blank" rel="noopener noreferrer">Open paired display in a new window</a></p>}
          <p className="form-help">Pairing links last 24 hours. Pairing again replaces this counter’s previous link.</p>
        </section>
      )}

      {canSimulate && (
        <section className="checkout-panel development-panel" aria-labelledby="simulation-title">
          <h2 id="simulation-title">Development payment simulator</h2>
          <p>These scenarios record mock server events and make no real charge.</p>
          {allAttempts.length ? <>
            <label>Payment attempt
              <select value={chosenAttempt?.id ?? ''} onChange={(event) => setAttemptId(event.target.value)} disabled={busy}>
                {allAttempts.map((attempt) => <option key={attempt.id} value={attempt.id}>
                  {attempt.id.slice(0, 8)} · {attempt.status} · {formatMoney(attempt.amount_minor, attempt.currency)}
                </option>)}
              </select>
            </label>
            <div className="action-row">
              <button type="button" disabled={busy} onClick={() => simulate('SUCCESS')}>Simulate payment success</button>
              <button type="button" disabled={busy} onClick={() => simulate('FAILURE')}>Simulate payment failure</button>
              <button type="button" disabled={busy || !chosenAttempt || chosenAttempt.provider !== 'MOCK'} onClick={() => void run(() =>
                checkoutOperation(client, 'resolve_mock_attempt', { p_attempt_id: chosenAttempt!.id }))}>Resolve demo QR before cash</button>
            </div>
            <p className="form-help">An older attempt can test late or duplicate success. Server deadlines and allocation checks still apply.</p>
          </> : <p>Reserve seats and generate a demo payment to begin.</p>}
        </section>
      )}

      {canSimulate && allocations.length > 0 && <section className="checkout-panel">
        <h2>Development extension simulator</h2>
        <label>Extension minutes<input type="number" min="1" step="1" value={minutes} onChange={(event) => setMinutes(event.target.value)} /></label>
        {allocations.map((allocation) => <button type="button" key={allocation.id} disabled={busy} onClick={() => {
          const value = Number(minutes)
          if (!Number.isSafeInteger(value) || value <= 0 || !Number.isSafeInteger(value * 60)) { setError('Use positive whole minutes within safe numeric range.'); return }
          void run(() => checkoutOperation(client, 'simulate_extension', { p_session_id: allocation.id, p_request_id: crypto.randomUUID(), p_additional_seconds: value * 60 }))
        }}>Extend {seatReference(allocation.table_number,allocation.label)}</button>)}
      </section>}
      {view === 'HISTORY' && <section className="checkout-panel"><h2>Order history</h2>
        <ul>{snapshot.history.map((item) => <li key={item.id}>Order {item.id.slice(0, 8)} · {item.status} · {formatMoney(item.total_minor, item.currency)}{['MOCK','SANDBOX'].includes(item.payment_mode ?? '') ? ' · Test payment' : ''}</li>)}</ul>
        {!snapshot.history.length && <p>No completed orders yet.</p>}
      </section>}
      {view === 'ACTIVE_SEATS' && <ActiveSeats client={client} snapshot={snapshot} now={now} disabled={disabled} refresh={refresh} branchId={branchId} />}

      {view === 'HISTORY' && (snapshot.exceptions ?? []).length > 0 && (
        <section className="checkout-panel exception-panel" aria-labelledby="exceptions-title">
          <h2 id="exceptions-title">Payments needing owner attention</h2>
          {snapshot.exceptions!.map((exception) => <article key={exception.id}>
            <h3>{exception.kind === 'LATE_PAYMENT' ? 'Late payment received' : 'Additional successful payment'}</h3>
            <p>Order {exception.order_id.slice(0, 8)}. Arrange the next steps with the customer and record your follow-up.</p>
            {exception.owner_note && <p>Recorded follow-up — {exception.owner_note}</p>}
            <label>Owner follow-up
              <textarea value={notes[exception.id] ?? ''} onChange={(event) => setNotes((previous) =>
                ({ ...previous, [exception.id]: event.target.value }))} />
            </label>
            <button type="button" disabled={busy || !notes[exception.id]?.trim()} onClick={() => void run(() =>
              checkoutOperation(client, 'record_payment_follow_up', { p_exception_id: exception.id, p_note: notes[exception.id] }))}>
              Record follow-up
            </button>
          </article>)}
        </section>
      )}
      {view === 'HISTORY' && snapshot.audit && snapshot.audit.length > 0 && <details className="checkout-panel">
        <summary>Recent order activity</summary>
        <ul>{snapshot.audit.map((event) => <li key={event.id}>
          {new Date(event.created_at).toLocaleString()} · {event.action.toLowerCase().replaceAll('_', ' ')}
        </li>)}</ul>
      </details>}
      {error && <p className="notice" role="alert">{error}</p>}
    </div>
  )
}
