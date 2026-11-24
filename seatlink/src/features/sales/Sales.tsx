import { useEffect, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { SalesSnapshot } from '../../database.types'
import type { SeatLinkClient } from '../../seat-data'
import { salesFallbackStaleMs, salesLiveStaleMs, useSales } from '../../use-sales'
import { useCheckout } from '../checkout/useCheckout'
import GuidedCheckout from '../checkout/GuidedCheckout'
import OwnerTools from '../checkout/OwnerTools'
import './Sales.css'
import Icon from '../../components/Icon'
import type { IconName } from '../../components/Icon'

export type NavigationBlock = { branchId: string; message: string } | null
type View = 'CHECKOUT' | 'ACTIVE_SEATS' | 'HISTORY' | 'DISPLAY' | 'DEVELOPMENT'

function SalesWorkspace({ client, branchId, snapshot, now, disabled, refresh, setNavigationBlock }: {
  client: SeatLinkClient; branchId: string; snapshot: SalesSnapshot; now: number; disabled: boolean
  refresh: () => Promise<void>; setNavigationBlock: Dispatch<SetStateAction<NavigationBlock>>
}) {
  const checkout = useCheckout(client, snapshot, branchId, refresh)
  const [view, setView] = useState<View>('CHECKOUT')
  const development = import.meta.env.DEV && snapshot.development_enabled
  const nav: { view: View; label: string }[] = [
    { view: 'CHECKOUT', label: 'Checkout' }, { view: 'ACTIVE_SEATS', label: 'Active seats' },
    { view: 'HISTORY', label: 'Order history' }, { view: 'DISPLAY', label: 'Customer display settings' },
  ]
  if (development) nav.push({ view: 'DEVELOPMENT', label: 'Development tools' })
  const icons: Record<View, IconName> = { CHECKOUT: 'checkout', ACTIVE_SEATS: 'seats', HISTORY: 'history', DISPLAY: 'display', DEVELOPMENT: 'tools' }

  useEffect(() => {
    let message = ''
    if (checkout.step === 'PAYMENT') message = 'Cancel the pending order before changing branches. Its seats remain reserved until cancellation or expiry.'
    else if (checkout.working) message = 'Wait for the order request to finish before changing branches.'
    else if (checkout.step === 'MENU' && checkout.dirty) message = 'Wait for cart changes to save before changing branches.'
    else if (checkout.step === 'SEATS' && checkout.selected.length) message = 'Clear your seat selection before changing branches.'
    setNavigationBlock(message ? { branchId, message } : null)
    return () => setNavigationBlock(null)
  }, [branchId, checkout.dirty, checkout.selected.length, checkout.step, checkout.working, setNavigationBlock])

  return <>
    <nav className="owner-navigation" aria-label="Owner workspace">{nav.map((item) => <button type="button"
      key={item.view} className="with-icon" aria-current={view === item.view ? 'page' : undefined} onClick={() => setView(item.view)}><Icon name={icons[item.view]} />{item.label}</button>)}</nav>
    {view === 'CHECKOUT' ? <GuidedCheckout client={client} snapshot={snapshot} checkout={checkout}
      now={now} disabled={disabled} refresh={refresh} openSettings={() => setView('DISPLAY')} /> :
      <OwnerTools key={view} client={client} snapshot={snapshot} now={now} disabled={disabled} refresh={refresh} view={view} branchId={branchId} />}
  </>
}

export default function Sales({ client, branchId, setNavigationBlock, onPaymentCompleted }: {
  client: SeatLinkClient; branchId: string; setNavigationBlock: Dispatch<SetStateAction<NavigationBlock>>; onPaymentCompleted?: () => void
}) {
  const { result, failed, loadError, refreshing, live, refresh } = useSales(client, branchId)
  const [tick, setTick] = useState(() => performance.now())
  const loaded = !!result
  const paidOrderId = result?.snapshot.order && ['PAID','PAID_REVIEW'].includes(result.snapshot.order.status) ? result.snapshot.order.id : undefined
  useEffect(() => { if (paidOrderId) onPaymentCompleted?.() }, [paidOrderId, onPaymentCompleted])
  useEffect(() => {
    if (!loaded) setNavigationBlock({ branchId, message: 'Wait for the branch order to load before changing branches.' })
    return () => setNavigationBlock(null)
  }, [branchId, loaded, setNavigationBlock])
  useEffect(() => {
    const timer = window.setInterval(() => setTick(performance.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  if (!result) return <div className="notice">
    {failed ? <><p role="alert">{loadError || 'Couldn’t load branch sales. Check your connection and try again.'}</p>
      <button type="button" onClick={() => void refresh()}>Retry</button></> : <p role="status">Loading branch checkout…</p>}
  </div>
  const { snapshot, receivedAt } = result
  const now = Date.parse(snapshot.server_now) + Math.max(0, tick - receivedAt)
  const stale = failed || tick - receivedAt > (live ? salesLiveStaleMs : salesFallbackStaleMs)
  return <>
    {stale && <div role="alert"><p>Connection interrupted. Reconnect to continue.</p><button type="button" disabled={refreshing} onClick={() => void refresh()}>Retry connection</button></div>}
    {snapshot.cart_revision === undefined || !snapshot.station ? <p role="alert">
      Apply the guided-checkout database migrations to this Supabase project, then reload.
    </p> : <SalesWorkspace key={snapshot.order?.id ?? 'new'} client={client} branchId={branchId} snapshot={snapshot}
      now={now} disabled={stale} refresh={refresh} setNavigationBlock={setNavigationBlock} />}
  </>
}
