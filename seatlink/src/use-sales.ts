import { useCallback, useEffect, useRef, useState } from 'react'
import type { SalesSnapshot } from './database.types'
import type { SeatLinkClient } from './seat-data'
import { readSales, salesLoadError } from './sales-data'

type Result = { snapshot: SalesSnapshot; receivedAt: number }
type Request = { controller: AbortController; promise: Promise<void>; invalidated: boolean }

export const salesLiveRefreshMs = 30000
export const salesFallbackRefreshMs = 5000
export const salesLiveStaleMs = 45000
export const salesFallbackStaleMs = 15000

export function useSales(client: SeatLinkClient, branchId: string) {
  const [result, setResult] = useState<Result>()
  const [failed, setFailed] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [refreshing, setRefreshing] = useState(true)
  const [live, setLive] = useState(false)
  const request = useRef<Request | null>(null)
  const mounted = useRef(false)
  const lastSuccess = useRef<number | null>(null)
  const liveConnected = useRef(false)
  const tableIds = useRef(new Set<string>())

  // Explicit reloads and mutations invalidate a read already in flight. Background
  // checks share it. A change during a read queues one follow-up snapshot.
  const refresh = useCallback((invalidate = true): Promise<void> => {
    if (!mounted.current) return Promise.resolve()
    if (request.current) {
      if (invalidate) request.current.invalidated = true
      return request.current.promise
    }

    const controller = new AbortController()
    const current: Request = { controller, promise: Promise.resolve(), invalidated: false }
    request.current = current
    setRefreshing(true)

    current.promise = (async () => {
      try {
        do {
          current.invalidated = false
          try {
            const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10000)])
            const snapshot = await readSales(client, branchId, signal)
            if (!mounted.current || controller.signal.aborted) return
            const receivedAt = performance.now()
            lastSuccess.current = receivedAt
            tableIds.current = new Set(snapshot.tables.map((table) => table.id))
            setResult({ snapshot, receivedAt })
            setFailed(false)
            setLoadError('')
          } catch (error) {
            if (!mounted.current || controller.signal.aborted) return
            lastSuccess.current = null
            setFailed(true)
            setLoadError(salesLoadError(error))
          }
        } while (current.invalidated && mounted.current && !controller.signal.aborted)
      } finally {
        if (request.current === current) {
          request.current = null
          if (mounted.current) setRefreshing(false)
        }
      }
    })()
    return current.promise
  }, [client, branchId])

  useEffect(() => {
    mounted.current = true
    lastSuccess.current = null
    tableIds.current = new Set()
    liveConnected.current = false
    let subscribed = false
    let invalidationTimer: number | undefined

    const invalidate = () => {
      if (!mounted.current || invalidationTimer !== undefined) return
      invalidationTimer = window.setTimeout(() => {
        invalidationTimer = undefined
        void refresh()
      }, 200)
    }
    const checkFreshness = (maximumAge: number) => {
      if (document.visibilityState === 'hidden' || request.current) return
      if (lastSuccess.current === null || performance.now() - lastSuccess.current >= maximumAge) {
        void refresh(false)
      }
    }
    const onWindowFocus = (event: FocusEvent) => {
      if (event.target === window) checkFreshness(salesFallbackRefreshMs)
    }
    const onVisibilityChange = () => checkFreshness(salesFallbackRefreshMs)
    const onOnline = () => { void refresh() }

    void refresh(false)
    const timer = window.setInterval(() => {
      checkFreshness(liveConnected.current ? salesLiveRefreshMs : salesFallbackRefreshMs)
    }, salesFallbackRefreshMs)
    window.addEventListener('online', onOnline)
    window.addEventListener('focus', onWindowFocus)
    document.addEventListener('visibilitychange', onVisibilityChange)

    const channel = client.channel(`sales-${branchId}-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'menu_items', filter: `branch_id=eq.${branchId}` }, invalidate)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `branch_id=eq.${branchId}` }, invalidate)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payment_attempts' }, invalidate)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'seat_use_sessions' }, invalidate)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payment_exceptions' }, invalidate)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'seats' }, (payload) => {
        if (tableIds.current.has(payload.new.table_id)) invalidate()
      })
      .subscribe((status) => {
        if (!mounted.current) return
        liveConnected.current = status === 'SUBSCRIBED'
        setLive(liveConnected.current)
        if (status === 'SUBSCRIBED') {
          if (subscribed) void refresh()
          else checkFreshness(salesFallbackRefreshMs)
          subscribed = true
        }
      })

    return () => {
      mounted.current = false
      request.current?.controller.abort()
      request.current = null
      window.clearInterval(timer)
      window.clearTimeout(invalidationTimer)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('focus', onWindowFocus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      void client.removeChannel(channel)
    }
  }, [branchId, client, refresh])

  return { result, failed, loadError, refreshing, live, refresh }
}
