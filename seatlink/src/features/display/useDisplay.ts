import { useEffect, useState } from 'react'
import type { DisplaySnapshot } from '../../database.types'
import type { SeatLinkClient } from '../../seat-data'
import { readDisplay } from './display-data'

export function useDisplay(client: SeatLinkClient | null, token: string) {
  const [state, setState] = useState<{ token: string; data: DisplaySnapshot; receivedAt: number }>()
  const [failure, setFailure] = useState({ token: '', message: '' })
  const [connection, setConnection] = useState({ token: '', live: false })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!client || !token) return
    let active = true
    let busy = false
    let invalidated = false
    let connected = false
    let lastRead = 0
    let channel: ReturnType<SeatLinkClient['channel']> | null = null
    let stationId = ''
    let controller: AbortController | null = null
    let queued: number | undefined

    const invalidate = () => {
      if (busy) { invalidated = true; return }
      if (queued !== undefined) return
      queued = window.setTimeout(() => { queued = undefined; void load() }, 200)
    }
    const load = async () => {
      if (!active) return
      if (busy) { invalidated = true; return }
      busy = true
      do {
        invalidated = false
        controller = new AbortController()
        try {
          const data = await readDisplay(client, token, AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]))
          if (!active) return
          // A newer invalidation arrived while this snapshot was in flight.
          // Read again before publishing an obsolete order/attempt to the screen.
          if (invalidated) continue
          lastRead = performance.now()
          setState({ token, data, receivedAt: lastRead })
          setFailure({ token, message: '' })
          if (stationId !== data.station_id) {
            if (channel) void client.removeChannel(channel)
            stationId = data.station_id
            let joined = false
            channel = client.channel(`seatlink-display-${stationId}`)
              .on('broadcast', { event: 'changed' }, invalidate)
              .subscribe((status) => {
                if (!active) return
                connected = status === 'SUBSCRIBED'
                setConnection({ token, live: connected })
                if (connected && joined) invalidate()
                if (connected) joined = true
              })
          }
        } catch (failure) {
          if (!active) return
          const code = failure && typeof failure === 'object' && 'code' in failure ? String(failure.code) : ''
          if (code === '42501') setState(undefined)
          setFailure({ token, message: code === '42501' ? 'This display link is invalid or expired. Ask the owner to pair this counter again.' :
            'Connection interrupted. Waiting for current checkout information.' })
        }
      } while (invalidated && active)
      busy = false
    }
    const check = () => {
      if (document.visibilityState !== 'hidden' && !busy &&
          performance.now() - lastRead >= (connected ? 30000 : 5000)) void load()
    }
    const reconnect = () => { void load() }
    const focus = () => {
      if (document.visibilityState !== 'hidden' && performance.now() - lastRead >= 5000) void load()
    }
    void load()
    const timer = window.setInterval(check, 5000)
    window.addEventListener('online', reconnect)
    window.addEventListener('focus', focus)
    document.addEventListener('visibilitychange', focus)
    return () => {
      active = false
      controller?.abort()
      window.clearInterval(timer)
      window.clearTimeout(queued)
      window.removeEventListener('online', reconnect)
      window.removeEventListener('focus', focus)
      document.removeEventListener('visibilitychange', focus)
      if (channel) void client.removeChannel(channel)
    }
  }, [attempt, client, token])

  return {
    state: state?.token === token ? state : undefined,
    error: failure.token === token ? failure.message : '',
    live: connection.token === token && connection.live,
    retry: () => setAttempt((value) => value + 1),
  }
}
