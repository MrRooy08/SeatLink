import { useCallback, useEffect } from 'react'
import type { SeatLinkClient } from '../../seat-data'
import { useQuery } from '../../use-query'
import { readDailySales } from './daily-sales-service'

export function useDailySales(client: SeatLinkClient, branchId: string) {
  const load = useCallback((signal: AbortSignal) => readDailySales(client, branchId, signal), [client, branchId])
  const { result, retry } = useQuery(load)
  useEffect(() => {
    let queued: number | undefined
    const invalidate = () => {
      if (queued !== undefined) return
      queued = window.setTimeout(() => { queued = undefined; retry() }, 200)
    }
    const refreshVisible = () => { if (document.visibilityState !== 'hidden') invalidate() }
    const channel = client.channel(`daily-sales-${branchId}-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders', filter: `branch_id=eq.${branchId}` }, payload => {
        if (['PAID','PAID_REVIEW'].includes(payload.new.status)) invalidate()
      }).subscribe()
    const timer = window.setInterval(refreshVisible, 60000)
    window.addEventListener('online', refreshVisible)
    document.addEventListener('visibilitychange', refreshVisible)
    return () => {
      window.clearTimeout(queued); window.clearInterval(timer)
      window.removeEventListener('online', refreshVisible)
      document.removeEventListener('visibilitychange', refreshVisible)
      void client.removeChannel(channel)
    }
  }, [branchId, client, retry])

  const data = result && 'data' in result ? result.data : undefined
  useEffect(() => {
    if (!data) return
    const delay = Date.parse(data.day_end) - Date.parse(data.server_now) + 1000
    const timer = window.setTimeout(retry, Math.min(2147483647, Math.max(1000, delay)))
    return () => window.clearTimeout(timer)
  }, [data, retry])
  return { result, retry, data }
}
