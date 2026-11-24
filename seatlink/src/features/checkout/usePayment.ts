import { useRef, useState } from 'react'
import type { SalesSnapshot } from '../../database.types'
import type { SeatLinkClient } from '../../seat-data'
import { salesError } from '../../sales-data'
import { checkoutOperation, qrFailure, qrErrors, sandboxPayment } from './checkout-service'
import { parseMinorUnits } from './money'

export function usePayment(client: SeatLinkClient, snapshot: SalesSnapshot, now: number, disabled: boolean, refresh: () => Promise<void>) {
  const [received, setReceived] = useState('')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const requestId = useRef(crypto.randomUUID())
  const cashRequest = useRef<{ received: number; id: string } | undefined>(undefined)
  const busyRef = useRef(false)
  const order = snapshot.order!
  const attempt = snapshot.attempts?.find((item) => item.order_id === order.id)
  const expired = Date.parse(order.session_expires_at!) <= now
  const busy = disabled || working || expired
  const receivedMinor = parseMinorUnits(received, order.currency)
  const unresolved = (snapshot.unresolved_qr ?? 0) > 0
  const configuration = snapshot.qr_configuration && snapshot.qr_configuration !== 'READY' ? snapshot.qr_configuration :
    snapshot.payment_mode === 'MOCK' && !snapshot.development_enabled ? 'MOCK_ACCESS_DISABLED' :
    snapshot.payment_mode === 'DISABLED' ? 'QR_DISABLED' : !['MOCK', 'SANDBOX'].includes(snapshot.payment_mode ?? '') ? 'UNCONFIGURED' : ''
  const validQr = attempt?.status === 'PENDING' && attempt.provider_state !== 'CLOSED' &&
    Date.parse(attempt.qr_expires_at) > now && !expired && !disabled &&
    (attempt.provider === 'MOCK' || attempt.provider === 'TWO_C2P' && !!attempt.qr_image_url)

  async function run(action: () => Promise<unknown>) {
    if (busy || busyRef.current) return
    busyRef.current = true
    setWorking(true); setError(''); setNotice('')
    try { await action() } catch (failure) {
      const message = salesError(failure)
      setError(Object.values(qrErrors).includes(message) ? 'QR unavailable. Check payment status or contact your administrator.' : message)
    }
    finally { try { await refresh() } finally { setWorking(false); busyRef.current = false } }
  }
  function select(method: 'QR' | 'CASH') {
    void run(() => checkoutOperation(client, 'select_payment_method', { p_order_id: order.id, p_method: method }))
  }
  function confirm() {
    if (order.payment_method === 'CASH') {
      if (unresolved || receivedMinor === null || receivedMinor < order.total_minor) return
      void run(async () => {
        if (cashRequest.current?.received !== receivedMinor) cashRequest.current = { received: receivedMinor, id: crypto.randomUUID() }
        await checkoutOperation(client, 'confirm_cash_payment', { p_order_id: order.id, p_request_id: cashRequest.current.id, p_received_minor: receivedMinor })
      })
    } else if (order.payment_method === 'QR') void run(async () => {
      if (configuration) throw qrFailure(configuration)
      if (snapshot.payment_mode === 'MOCK') {
        await checkoutOperation(client, 'prepare_mock_qr', { p_order_id: order.id, p_request_id: requestId.current })
      } else {
        const result = await sandboxPayment(client, { action: 'create', orderId: order.id, requestId: requestId.current })
        if (result?.status === 'CREATING') setNotice('The provider QR request is still processing. Check payment status before accepting cash.')
      }
      requestId.current = crypto.randomUUID()
    })
  }
  function inquire(attemptId: string) {
    void run(async () => {
      const result = await sandboxPayment(client, { action: 'inquire', attemptId })
      if (result?.status === 'PENDING') setNotice('Provider payment is still pending. Cash remains blocked until it is safely resolved.')
    })
  }
  return { received, setReceived, working, error, notice, attempt, expired, busy, receivedMinor, unresolved,
    configuration, validQr, select, confirm, inquire }
}
