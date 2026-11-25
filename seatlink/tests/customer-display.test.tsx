// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from '../src/App'
import type { DisplaySnapshot } from '../src/database.types'
import { formatMoney } from '../src/sales-data'

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

function expectNoSeatMap() {
  const display = screen.getByRole('main')
  expect(display.textContent).not.toMatch(/\b(?:seating|selected|available|occupied)\b|awaiting payment|use until|seats available/i)
  expect(screen.queryByText('This order')).toBeNull()
  expect(screen.queryByRole('list', { name: 'Seat status legend' })).toBeNull()
  expect(screen.queryByRole('region', { name: /seat|table/i })).toBeNull()
  expect(screen.queryByLabelText(/Seat time remaining/)).toBeNull()
}

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
  expect(screen.queryByRole('region',{name:"Today's sales"})).toBeNull()
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

it('updates from idle to completed checkout with only the current order seat summary', async () => {
  const pendingOrder = data.order!
  data.order = null
  const view = render(<App />)
  await screen.findByRole('heading', { name: 'Welcome' })
  expect(screen.getByText('Connected to your checkout counter')).toBeTruthy()
  expect(screen.queryByRole('status', { name: 'Your seats' })).toBeNull()
  expectNoSeatMap()

  data.order = {
    ...pendingOrder, status: 'DRAFT', checkout_step: 'SEATS',
    total_minor: 360, items: [{ name: 'Iced tea', quantity: 2, unit_price_minor: 180 }],
  }
  act(() => broadcast())
  await screen.findByText('The seller is preparing your order.')
  expect(screen.getByText('2 × Iced tea')).toBeTruthy()
  expect(screen.getByRole('listitem').textContent).toContain(formatMoney(360, 'SGD'))
  expect(screen.getByText(/^Total /).textContent).toBe(`Total ${formatMoney(360, 'SGD')}`)
  expectNoSeatMap()

  data.order = pendingOrder
  act(() => broadcast())
  await screen.findByAltText('Demo payment QR, no real charge')
  expect(screen.getByText('1 × Iced tea')).toBeTruthy()
  expect(screen.getByText(/^Complete payment before/)).toBeTruthy()
  expectNoSeatMap()

  data.order!.status = 'PAID'
  data.order!.qr_text = null
  data.order!.payment_status = 'SUCCEEDED'
  data.order!.allocations = [{ label: 'A', table_number: 1, expires_at: new Date(Date.now() + 600000).toISOString() }]
  act(() => broadcast())
  await screen.findByText('Payment confirmed.')
  expect(screen.queryByAltText('Demo payment QR, no real charge')).toBeNull()
  expectNoSeatMap()
  view.unmount()
  expect(api.removeChannel).toHaveBeenCalledWith(channel)
})

it('shows a generic assistance message for a payment under review', async () => {
  data.order!.status = 'PAID_REVIEW'
  render(<App />)
  expect((await screen.findByRole('alert')).textContent).toBe('Payment received. Please ask the owner for assistance.')
  expectNoSeatMap()
})

it.each(['MENU', 'SEATS', 'PAYMENT', 'RESULT'] as const)('keeps the full map hidden in draft step %s', async step => {
  data.order!.status = 'DRAFT'
  data.order!.checkout_step = step
  render(<App />)
  await screen.findByText('The seller is preparing your order.')
  expect(screen.getByText('1 × Iced tea')).toBeTruthy()
  expect(!!screen.queryByRole('status', { name: 'Your seats' })).toBe(step !== 'MENU')
  expectNoSeatMap()
})

it.each([
  { status: 'EXPIRED', message: 'The order session has expired. Please ask the owner for assistance.' },
  { status: 'CANCELLED', message: 'This order was cancelled.' },
  { status: 'PAID', message: 'Payment confirmed.' },
] as const)('shows only order/payment content for $status with ended seat sessions', async ({ status, message }) => {
  data.order!.status = status
  data.order!.allocations = []
  render(<App />)
  await screen.findByText(message)
  expect(!!screen.queryByRole('status', { name: 'Your seats' })).toBe(status === 'PAID')
  expect(screen.getByText('1 × Iced tea')).toBeTruthy()
  expect(screen.queryByAltText('Demo payment QR, no real charge')).toBeNull()
  expectNoSeatMap()
})

it('keeps zero-seat checkout and failed payment updates free of seating information', async () => {
  data.order!.selected_seats = []
  data.order!.payment_method = 'QR'
  render(<App />)
  await screen.findByAltText('Demo payment QR, no real charge')
  expectNoSeatMap()
  data.order!.payment_status = 'FAILED'
  act(() => broadcast())
  await screen.findByText('Payment failed. Please wait for the seller to retry.')
  expect(screen.queryByAltText('Demo payment QR, no real charge')).toBeNull()
  expectNoSeatMap()
})

it('switches to cash instructions and removes the QR without exposing receipt controls', async () => {
  render(<App />)
  await screen.findByAltText('Demo payment QR, no real charge')
  data.order!.payment_method = 'CASH'
  data.order!.checkout_step = 'PAYMENT'
  act(() => broadcast())
  await screen.findByText('Please pay at the counter.')
  expectNoSeatMap()
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
  data.order!.selected_seats = [{ table_number: 2, label: 'B' }]
  act(() => window.dispatchEvent(new Event('online')))
  await screen.findByText(/Payment confirmed/)
  expect(screen.getByRole('status', { name: 'Your seats' }).textContent).toContain('Table B · Seat 2')
  expect(screen.queryByText(/Connection interrupted/)).toBeNull()
})

it('updates grouped draft seats on broadcasts and clears them on deselect, cancel, idle and a new order', async () => {
  data.order!.status = 'DRAFT'
  data.order!.checkout_step = 'SEATS'
  data.order!.selected_seats = []
  render(<App />)
  await screen.findByText('The seller is preparing your order.')
  expect(screen.queryByRole('status', { name: 'Your seats' })).toBeNull()
  const update = async (seats: NonNullable<DisplaySnapshot['order']>['selected_seats']) => {
    data.order!.selected_seats = seats
    act(() => broadcast())
    await waitFor(() => expect(api.readDisplay).toHaveBeenCalled())
  }
  await update([{ table_number: 1, label: 'A' }])
  expect((await screen.findByRole('status', { name: 'Your seats' })).textContent).toContain('Table A · Seat 1')
  await update([{ table_number: 2, label: 'D' }, { table_number: 1, label: 'B' }, { table_number: 1, label: 'A' }])
  await waitFor(() => expect(screen.getByRole('status', { name: 'Your seats' }).textContent).toBe('Your seats:Table A · Seat 1, Seat 2Table B · Seat 4'))
  await update([{ table_number: 1, label: 'B' }])
  await waitFor(() => expect(screen.getByRole('status', { name: 'Your seats' }).textContent).toBe('Your seats:Table A · Seat 2'))
  await update([])
  await waitFor(() => expect(screen.queryByRole('status', { name: 'Your seats' })).toBeNull())
  await update([{ table_number: 1, label: 'A' }])
  await screen.findByRole('status', { name: 'Your seats' })
  data.order!.status = 'CANCELLED'
  act(() => broadcast())
  await screen.findByText('This order was cancelled.')
  expect(screen.queryByRole('status', { name: 'Your seats' })).toBeNull()
  const previous = structuredClone(data.order!)
  data.order = null
  act(() => broadcast())
  await screen.findByRole('heading', { name: 'Welcome' })
  expect(screen.queryByRole('status', { name: 'Your seats' })).toBeNull()
  data.order = { ...previous, reference: 'new-order', status: 'DRAFT', checkout_step: 'SEATS', selected_seats: [] }
  act(() => broadcast())
  await screen.findByText('The seller is preparing your order.')
  expect(screen.queryByRole('status', { name: 'Your seats' })).toBeNull()
  expectNoSeatMap()
})

it('uses only the current order selection, with configured labels and no map or seat controls', async () => {
  data.tables = [{ table_number: 1, display_label: 'Garden', seats: [
    { label: 'A', display_number: 7, status: 'LOCKED' },
    { label: 'B', display_number: 8, status: 'UNAVAILABLE', current_order: true },
  ] }]
  data.order!.allocations = [{ table_number: 9, label: 'D', expires_at: new Date().toISOString() }]
  render(<App />)
  const summary = await screen.findByRole('status', { name: 'Your seats' })
  expect(summary.textContent).toBe('Your seats:Table Garden · Seat 7')
  expect(summary.querySelector('button,input,select')).toBeNull()
  data.tables[0].seats[1].status = 'AVAILABLE'
  act(() => broadcast())
  await waitFor(() => expect(api.readDisplay).toHaveBeenCalledTimes(2))
  expect(summary.textContent).toBe('Your seats:Table Garden · Seat 7')
  expectNoSeatMap()
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
