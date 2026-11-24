import { useCallback, useEffect, useRef, useState } from 'react'
import type { SalesSnapshot } from '../../database.types'
import type { SeatLinkClient } from '../../seat-data'
import { salesError } from '../../sales-data'
import { checkoutOperation } from './checkout-service'
import { checkoutStep } from './checkout-state'
import { validQuantities } from './quantity'

export type Cart = Record<string, number>
const signature = (cart: Cart) => JSON.stringify(Object.entries(cart).sort())
const itemsFor = (cart: Cart) => Object.entries(cart).sort().map(([menu_item_id, quantity]) => ({ menu_item_id, quantity }))

export function useCheckout(client: SeatLinkClient, snapshot: SalesSnapshot, branchId: string, refresh: () => Promise<void>) {
  const order = snapshot.order
  const step = checkoutStep(order)
  const initialItems = step === 'MENU' && snapshot.cart_preview !== undefined ? snapshot.cart_preview :
    order?.items.map((item) => ({ ...item, currency: order.currency })) ?? []
  const [cart, setCart] = useState<Cart>(() => Object.fromEntries(initialItems.map((item) => [item.menu_item_id, item.quantity])))
  const [selected, setSelected] = useState<string[]>(order?.draft_seat_ids ?? [])
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [invalidInputs, setInvalidInputs] = useState<string[]>([])
  const setQuantityValidity = useCallback((id: string, valid: boolean) => setInvalidInputs(previous =>
    valid ? previous.includes(id) ? previous.filter(entry => entry !== id) : previous : previous.includes(id) ? previous : [...previous,id]), [])
  const [previewError, setPreviewError] = useState('')
  const [baseRevision, setBaseRevision] = useState(order?.revision ?? 0)
  const [savedSignature, setSavedSignature] = useState(() => signature(cart))
  const [previewTotal, setPreviewTotal] = useState(snapshot.cart_total_minor ?? order?.total_minor ?? 0)
  const [previewCurrency, setPreviewCurrency] = useState(snapshot.cart_preview?.[0]?.currency ?? order?.currency)
  const previewRevision = useRef(snapshot.cart_revision ?? 0)
  const previewQueue = useRef<Promise<unknown>>(Promise.resolve())
  const selectionQueue = useRef<Promise<unknown>>(Promise.resolve())
  const mounted = useRef(false)
  const busy = useRef(false)
  const id = useRef(order?.id ?? crypto.randomUUID())
  const submission = useRef<{ signature: string; id: string } | undefined>(undefined)
  const cartSignature = signature(cart)
  const dirty = cartSignature !== savedSignature || invalidInputs.length > 0
  const changed = !!order && order.revision !== baseRevision
  const valid = !invalidInputs.length && validQuantities(cart, snapshot.menu) && Object.keys(cart).length > 0 && Object.entries(cart).every(([itemId, quantity]) =>
    Number.isInteger(quantity) && quantity > 0 && quantity <= 50 &&
    snapshot.menu.some((item) => item.id === itemId && item.available))
  const stationId = snapshot.station?.id
  const orderId = order?.id

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    if (step !== 'MENU' || working || dirty || snapshot.cart_revision === undefined || snapshot.cart_revision <= previewRevision.current) return
    const saved = Object.fromEntries((snapshot.cart_preview ?? []).map((item) => [item.menu_item_id, item.quantity]))
    previewRevision.current = snapshot.cart_revision
    setCart(saved)
    setSavedSignature(signature(saved))
    setPreviewTotal(snapshot.cart_total_minor ?? 0)
    setPreviewCurrency(snapshot.cart_preview?.[0]?.currency)
  }, [dirty, snapshot.cart_preview, snapshot.cart_revision, snapshot.cart_total_minor, step, working])

  const persistPreview = useCallback((nextCart: Cart) => {
    const task = previewQueue.current.catch(() => {}).then(async () => {
      if (!mounted.current || !stationId) return
      const result = await checkoutOperation(client, 'update_cart_preview', {
        p_station_id: stationId, p_revision: previewRevision.current, p_items: itemsFor(nextCart),
      })
      previewRevision.current = result.revision
      if (mounted.current) {
        setSavedSignature(signature(nextCart))
        setPreviewTotal(result.total_minor)
        setPreviewCurrency(result.currency ?? undefined)
        setPreviewError('')
      }
    })
    previewQueue.current = task
    return task
  }, [client, stationId])

  useEffect(() => {
    if (step !== 'MENU' || !dirty || working || invalidInputs.length || !validQuantities(cart,snapshot.menu)) return
    const timer = window.setTimeout(() => {
      void persistPreview(cart).catch((failure) => { if (mounted.current) setPreviewError(salesError(failure)) })
    }, 600)
    return () => window.clearTimeout(timer)
  }, [cart, dirty, persistPreview, step, working, invalidInputs.length, snapshot.menu])

  useEffect(() => {
    if (step !== 'SEATS' || !orderId || working) return
    const timer = window.setTimeout(() => {
      const task = selectionQueue.current.catch(() => {}).then(() => checkoutOperation(client, 'update_selected_seats', {
        p_order_id: orderId, p_seat_ids: selected,
      }))
      selectionQueue.current = task
      void task.catch((failure) => { if (mounted.current) setError(salesError(failure)) })
    }, 200)
    return () => window.clearTimeout(timer)
  }, [client, orderId, selected, step, working])

  async function run(action: () => Promise<unknown>) {
    if (busy.current) return
    busy.current = true
    setWorking(true)
    setError('')
    try { await action() } catch (failure) { if (mounted.current) setError(salesError(failure)) }
    finally {
      await refresh()
      busy.current = false
      if (mounted.current) setWorking(false)
    }
  }

  function continueToSeats() {
    if (!valid || changed) return
    void run(async () => {
      await persistPreview(cart)
      const payload = itemsFor(cart)
      const key = JSON.stringify({ payload, revision: baseRevision })
      if (submission.current?.signature !== key) submission.current = { signature: key, id: crypto.randomUUID() }
      const saved = await checkoutOperation(client, 'continue_to_seats', {
        p_order_id: id.current, p_branch_id: branchId, p_revision: baseRevision,
        p_request_id: submission.current.id, p_items: payload,
      })
      if (mounted.current) setBaseRevision(saved.revision)
    })
  }

  function reserveSeats(seatIds: string[]) {
    if (!order || seatIds.length > 4 || (changed && step === 'SEATS')) return
    void run(async () => {
      await selectionQueue.current.catch(() => {})
      await checkoutOperation(client, 'confirm_order_seats', { p_order_id: order.id, p_revision: order.revision, p_seat_ids: seatIds })
      if (mounted.current) setSelected(seatIds)
    })
  }

  function reloadCart() {
    setCart(Object.fromEntries(initialItems.map((item) => [item.menu_item_id, item.quantity])))
    setSavedSignature(signature(Object.fromEntries(initialItems.map((item) => [item.menu_item_id, item.quantity]))))
    previewRevision.current = snapshot.cart_revision ?? 0
    setBaseRevision(order?.revision ?? 0)
    setPreviewTotal(snapshot.cart_total_minor ?? order?.total_minor ?? 0)
    setPreviewCurrency(snapshot.cart_preview?.[0]?.currency ?? order?.currency)
    setPreviewError('')
    setError('')
  }

  return {
    cart, setCart, selected, setSelected, step, working, error: error || previewError, setQuantityValidity,
    dirty, valid, changed, previewTotal, previewCurrency, continueToSeats,
    reserve: () => reserveSeats(selected), skipSeats: () => reserveSeats([]), reloadCart, run,
  }
}
