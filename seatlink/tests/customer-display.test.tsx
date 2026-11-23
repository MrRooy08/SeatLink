// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from '../src/App'
import type { DisplaySnapshot } from '../src/database.types'

const api = vi.hoisted(() => ({ readDisplay: vi.fn(), ownerSession: vi.fn(), removeChannel: vi.fn() }))
const channel = { on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis() }
const client = { channel: () => channel, removeChannel: api.removeChannel }
vi.mock('../src/supabase', () => ({
  supabase: { auth: { getSession: api.ownerSession } },
  createDisplayClient: () => client,
}))
vi.mock('../src/features/display/display-data', () => ({ readDisplay: api.readDisplay }))
vi.mock('qrcode', () => ({ default: { toDataURL: async () => 'data:image/png;base64,ZGVtbw==' } }))

let data: DisplaySnapshot
let broadcast: () => void

beforeEach(() => {
  window.history.replaceState(null, '', '/display#' + 'a'.repeat(64))
  data = {
    server_now: new Date().toISOString(), station_id: 'station-one', station_name: 'Counter one', branch: 'Riverside',
    tables: [{ table_number: 1, seats: [{ label: 'A', status: 'LOCKED' }] }],
    order: {
      reference: 'order-1', status: 'PENDING', total_minor: 180, currency: 'SGD',
      session_expires_at: new Date(Date.now() + 300000).toISOString(),
      payment_status: 'PENDING', qr_expires_at: new Date(Date.now() + 60000).toISOString(),
      qr_text: 'seatlink-demo:attempt-1', items: [{ name: 'Iced tea', quantity: 1, unit_price_minor: 180 }],
      selected_seats: [{ label: 'A', table_number: 1 }], allocations: [],
    },
  }
  api.readDisplay.mockImplementation(async () => structuredClone(data))
  channel.on.mockImplementation((_event, _options, callback) => { broadcast = callback; return channel })
  channel.subscribe.mockImplementation((callback) => { callback('SUBSCRIBED'); return channel })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

it('renders the paired checkout with a demo QR and no owner controls or owner session access', async () => {
  window.history.replaceState(null, '', '/display/#' + 'a'.repeat(64))
  render(<App />)
  await screen.findByRole('heading', { name: 'Riverside' })
  expect(screen.getByText('Counter one')).toBeTruthy()
  expect(await screen.findByAltText('Demo payment QR, no real charge')).toBeTruthy()
  expect(screen.queryByRole('button', { name: /Select|Add|Cancel|Simulate|Sign out/ })).toBeNull()
  expect(api.ownerSession).not.toHaveBeenCalled()
  expect(api.readDisplay).toHaveBeenCalledWith(client, 'a'.repeat(64), expect.any(AbortSignal))
})

it('loads the display directly and restores it after remount without losing query parameters or fragment', async () => {
  const path = '/display/?source=pairing&station=counter-one#' + 'a'.repeat(64)
  window.history.replaceState(null, '', path)
  const first = render(<App />)
  await screen.findByText('Counter one')
  expect(api.ownerSession).not.toHaveBeenCalled()
  first.unmount()
  render(<App />)
  await screen.findByText('Counter one')
  expect(window.location.pathname + window.location.search + window.location.hash).toBe(path)
  expect(api.readDisplay).toHaveBeenLastCalledWith(client, 'a'.repeat(64), expect.any(AbortSignal))
  expect(api.ownerSession).not.toHaveBeenCalled()
})

it('clears the QR when payment completes and cleans its subscription on unmount', async () => {
  const view = render(<App />)
  await screen.findByAltText('Demo payment QR, no real charge')
  data.order!.status = 'PAID'
  data.order!.qr_text = null
  data.order!.payment_status = 'SUCCEEDED'
  act(() => broadcast())
  await screen.findByText(/Payment confirmed/)
  expect(screen.queryByAltText('Demo payment QR, no real charge')).toBeNull()
  view.unmount()
  expect(api.removeChannel).toHaveBeenCalledWith(channel)
})

it('switches to cash instructions and removes the QR without exposing receipt controls', async () => {
  render(<App />)
  await screen.findByAltText('Demo payment QR, no real charge')
  data.order!.payment_method = 'CASH'
  data.order!.checkout_step = 'PAYMENT'
  act(() => broadcast())
  await screen.findByText('Please pay at the counter.')
  expect(screen.queryByAltText('Demo payment QR, no real charge')).toBeNull()
  expect(screen.queryByRole('button', { name: /Confirm cash/ })).toBeNull()
})

it('removes the previous counter immediately when the pairing token changes', async () => {
  render(<App />)
  await screen.findByText('Counter one')
  let finish!: (snapshot: DisplaySnapshot) => void
  api.readDisplay.mockImplementationOnce(() => new Promise<DisplaySnapshot>((resolve) => { finish = resolve }))
  act(() => {
    window.history.replaceState(null, '', '/display#' + 'b'.repeat(64))
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  })
  expect(screen.queryByText('Counter one')).toBeNull()
  expect(screen.queryByAltText('Demo payment QR, no real charge')).toBeNull()
  const next = structuredClone(data)
  next.station_id = 'station-two'
  next.station_name = 'Counter two'
  next.order = null
  await act(async () => finish(next))
  await screen.findByText('Counter two')
  expect(screen.getByRole('heading', { name: 'Welcome' })).toBeTruthy()
  expect(api.removeChannel).toHaveBeenCalledWith(channel)
})

it('hides an expired QR and reports invalid pairing links clearly', async () => {
  data.order!.qr_expires_at = new Date(Date.now() - 1000).toISOString()
  const view = render(<App />)
  await screen.findByRole('heading', { name: 'Your order' })
  expect(screen.queryByAltText('Demo payment QR, no real charge')).toBeNull()
  view.unmount()
  api.readDisplay.mockRejectedValueOnce({ code: '42501' })
  render(<App />)
  expect((await screen.findByRole('alert')).textContent).toMatch(/invalid or expired/)
})

it('hides stale QR content after a failed read and restores authoritative results on reconnect', async () => {
  render(<App />)
  await screen.findByAltText('Demo payment QR, no real charge')
  api.readDisplay.mockRejectedValueOnce(new Error('offline'))
  act(() => window.dispatchEvent(new Event('online')))
  await screen.findByText(/Connection interrupted/)
  expect(screen.queryByAltText('Demo payment QR, no real charge')).toBeNull()
  data.order!.status = 'PAID'
  data.order!.qr_text = null
  act(() => window.dispatchEvent(new Event('online')))
  await screen.findByText(/Payment confirmed/)
  expect(screen.queryByText(/Connection interrupted/)).toBeNull()
})

it('discards an in-flight snapshot invalidated by a newer order update', async () => {
  render(<App />)
  await screen.findByAltText('Demo payment QR, no real charge')
  const obsolete = structuredClone(data)
  obsolete.order!.items[0].name = 'Obsolete pending response'
  let finish!: (snapshot: DisplaySnapshot) => void
  api.readDisplay.mockImplementationOnce(() => new Promise<DisplaySnapshot>(resolve => { finish = resolve }))
  act(() => broadcast())
  await waitFor(() => expect(api.readDisplay).toHaveBeenCalledTimes(2))
  data.order!.status = 'PAID'
  data.order!.qr_text = null
  act(() => broadcast())
  await act(async () => finish(obsolete))
  await screen.findByText(/Payment confirmed/)
  expect(api.readDisplay).toHaveBeenCalledTimes(3)
  expect(screen.queryByText('Obsolete pending response')).toBeNull()
  expect(screen.queryByAltText('Demo payment QR, no real charge')).toBeNull()
})
