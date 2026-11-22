// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useSales } from '../src/use-sales'
import type { SalesSnapshot } from '../src/database.types'
import type { SeatLinkClient } from '../src/seat-data'

const api = vi.hoisted(() => ({ readSales: vi.fn() }))
vi.mock('../src/sales-data', async (original) => ({
  ...await original<typeof import('../src/sales-data')>(),
  readSales: api.readSales,
}))

const snapshot: SalesSnapshot = {
  server_now: '2026-11-18T00:00:00Z', menu: [], order: null, history: [],
  tables: [{ id: 'table-a', table_number: 1, seats: [] }],
}
let visibility: DocumentVisibilityState
let onStatus: (status: string) => void
let onOrder: () => void
let onSeat: (payload: { new: { table_id: string } }) => void
const channel = {
  on: vi.fn().mockReturnThis(),
  subscribe: vi.fn().mockReturnThis(),
}
const client = {
  channel: vi.fn(() => channel),
  removeChannel: vi.fn(),
} as unknown as SeatLinkClient

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'performance'] })
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
  api.readSales.mockResolvedValue(snapshot)
  vi.mocked(client.channel).mockReturnValue(channel as never)
  channel.on.mockImplementation((_event, options, callback) => {
    if (options.table === 'orders') onOrder = callback
    if (options.table === 'seats') onSeat = callback
    return channel
  })
  channel.subscribe.mockImplementation((callback) => { onStatus = callback; return channel })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.resetAllMocks()
})

async function advance(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
}

it('shares the initial read with subscription setup and polls connected screens every thirty seconds', async () => {
  const view = renderHook(() => useSales(client, 'branch-a'))
  await act(async () => {})
  await act(async () => onStatus('SUBSCRIBED'))
  expect(api.readSales).toHaveBeenCalledTimes(1)
  await advance(25000)
  expect(api.readSales).toHaveBeenCalledTimes(1)
  await advance(5000)
  expect(api.readSales).toHaveBeenCalledTimes(2)
  view.unmount()
  await advance(30000)
  expect(api.readSales).toHaveBeenCalledTimes(2)
  expect(client.removeChannel).toHaveBeenCalledWith(channel)
})

it('batches seat and order changes and ignores seat events for another branch', async () => {
  renderHook(() => useSales(client, 'branch-a'))
  await act(async () => {})
  act(() => {
    onSeat({ new: { table_id: 'other-branch-table' } })
  })
  await advance(200)
  expect(api.readSales).toHaveBeenCalledTimes(1)
  act(() => {
    onOrder()
    for (let index = 0; index < 4; index += 1) onSeat({ new: { table_id: 'table-a' } })
  })
  expect(api.readSales).toHaveBeenCalledTimes(1)
  await advance(200)
  expect(api.readSales).toHaveBeenCalledTimes(2)
})

it('does not restart a slow read and queues one follow-up for changes received during it', async () => {
  let finish!: (value: SalesSnapshot) => void
  api.readSales.mockImplementationOnce(() => new Promise<SalesSnapshot>((resolve) => { finish = resolve }))
  const view = renderHook(() => useSales(client, 'branch-a'))
  const signal = api.readSales.mock.calls[0][2] as AbortSignal
  act(() => onStatus('SUBSCRIBED'))
  await advance(5000)
  expect(api.readSales).toHaveBeenCalledTimes(1)
  expect(signal.aborted).toBe(false)
  act(() => { onOrder(); onOrder() })
  await advance(200)
  await act(async () => finish(snapshot))
  expect(api.readSales).toHaveBeenCalledTimes(2)
  expect(view.result.current.refreshing).toBe(false)
})

it('awaits a fresh snapshot after a mutation even if an older read is still running', async () => {
  const view = renderHook(() => useSales(client, 'branch-a'))
  await act(async () => {})
  let finish!: (value: SalesSnapshot) => void
  api.readSales.mockImplementationOnce(() => new Promise<SalesSnapshot>((resolve) => { finish = resolve }))
  let pending!: Promise<void>
  act(() => { pending = view.result.current.refresh() })
  let mutationRefresh!: Promise<void>
  act(() => { mutationRefresh = view.result.current.refresh() })
  expect(api.readSales).toHaveBeenCalledTimes(2)
  await act(async () => { finish(snapshot); await Promise.all([pending, mutationRefresh]) })
  expect(api.readSales).toHaveBeenCalledTimes(3)
})

it('throttles window-focus checks and polls every five seconds while disconnected', async () => {
  renderHook(() => useSales(client, 'branch-a'))
  await act(async () => {})
  act(() => {
    window.dispatchEvent(new FocusEvent('focus'))
    window.dispatchEvent(new FocusEvent('focus'))
  })
  expect(api.readSales).toHaveBeenCalledTimes(1)
  await advance(5000)
  expect(api.readSales).toHaveBeenCalledTimes(2)
  act(() => window.dispatchEvent(new FocusEvent('focus')))
  expect(api.readSales).toHaveBeenCalledTimes(2)
})

it('pauses polling in a hidden tab and refreshes once when it becomes visible', async () => {
  renderHook(() => useSales(client, 'branch-a'))
  await act(async () => {})
  visibility = 'hidden'
  await advance(30000)
  expect(api.readSales).toHaveBeenCalledTimes(1)
  visibility = 'visible'
  await act(async () => document.dispatchEvent(new Event('visibilitychange')))
  expect(api.readSales).toHaveBeenCalledTimes(2)
})

it('refetches on reconnect and cancels queued events when unmounted', async () => {
  const view = renderHook(() => useSales(client, 'branch-a'))
  await act(async () => {})
  await act(async () => onStatus('SUBSCRIBED'))
  act(() => onStatus('CHANNEL_ERROR'))
  await act(async () => onStatus('SUBSCRIBED'))
  expect(api.readSales).toHaveBeenCalledTimes(2)
  act(() => onOrder())
  view.unmount()
  await advance(200)
  expect(api.readSales).toHaveBeenCalledTimes(2)
})
