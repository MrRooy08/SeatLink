// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Owner from '../src/Owner'
import CustomerDisplay from '../src/features/display/CustomerDisplay'
import type { SalesOrder, SalesSnapshot } from '../src/database.types'
import type { SeatLinkClient } from '../src/seat-data'

const api = vi.hoisted(() => ({ readSales: vi.fn(), loadBranches: vi.fn(), readDisplay: vi.fn(), readDailySales: vi.fn() }))
vi.mock('../src/features/display/display-data', () => ({ readDisplay: api.readDisplay }))
vi.mock('../src/supabase', () => ({ createDisplayClient: () => client }))
vi.mock('../src/features/daily-sales/daily-sales-service', () => ({
  readDailySales: api.readDailySales,
  formatDailyMoney: () => 'SGD 0.00',
}))
vi.mock('../src/sales-data', async (original) => ({
  ...await original<typeof import('../src/sales-data')>(),
  readSales: api.readSales,
}))
vi.mock('../src/seat-data', () => ({ loadBranches: api.loadBranches }))
vi.mock('qrcode', () => ({ default: { toDataURL: async () => 'data:image/png;base64,ZGVtbw==' } }))

let snapshot: SalesSnapshot
const subscription = {
  on: vi.fn().mockReturnThis(),
  subscribe: vi.fn().mockReturnThis(),
}
const client = {
  rpc: vi.fn(),
  channel: vi.fn(() => subscription),
  removeChannel: vi.fn(),
} as unknown as SeatLinkClient

function draft(): SalesOrder & { items: { order_id: string; menu_item_id: string; name: string; unit_price_minor: number; quantity: number }[] } {
  return {
    id: 'order-1', branch_id: 'riverside', created_by: 'owner-a', status: 'DRAFT',
    currency: 'SGD', total_minor: 180, revision: 1, session_expires_at: null,
    selected_seat_ids: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    items: [{ order_id: 'order-1', menu_item_id: 'tea', name: 'Iced tea', unit_price_minor: 180, quantity: 1 }],
  }
}

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open','') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
  api.readDailySales.mockImplementation(async (_client: unknown, branchId: string) => ({ branch_id: branchId, total_minor: '0', currency: 'SGD', paid_orders: 0,
    sandbox_orders: 0, timezone: 'Asia/Singapore', day_end: new Date(Date.now()+86400000).toISOString(), server_now: new Date().toISOString() }))
  window.history.replaceState(null, '', '/owner?branch=riverside')
  snapshot = {
    server_now: new Date().toISOString(), order: null, history: [], cart_preview: [], cart_revision: 0, cart_total_minor: 0,
    station: { id: 'station-one', name: 'Counter one' }, payment_mode: 'MOCK', development_enabled: true, unresolved_qr: 0,
    menu: [
      { id: 'tea', branch_id: 'riverside', name: 'Iced tea', price_minor: 180, currency: 'SGD', available: true },
      { id: 'sold-out', branch_id: 'riverside', name: 'Daily special', price_minor: 650, currency: 'SGD', available: false },
    ],
    tables: [{
      id: 'table-1', table_number: 1,
      seats: ['A', 'B', 'C', 'D'].map((label) => ({
        id: label, label: label as 'A' | 'B' | 'C' | 'D', status: 'AVAILABLE', locked_order_id: null,
      })),
    }, {
      id: 'table-2', table_number: 2,
      seats: [{ id: '2A', label: 'A', status: 'AVAILABLE', locked_order_id: null }],
    }],
  }
  api.readSales.mockImplementation(async () => structuredClone(snapshot))
  api.readDisplay.mockImplementation(async () => {
    const order = snapshot.order
    const attempt = snapshot.attempts?.find(item => item.order_id === order?.id)
    return { server_now: snapshot.server_now, station_id: 'station-one', station_name: 'Counter one', branch: 'Riverside', tables: snapshot.tables,
      order: order && { ...order, reference: order.id.slice(0, 8), payment_attempt_id: attempt?.id, payment_status: attempt?.status ?? null,
        qr_expires_at: attempt?.qr_expires_at ?? null, qr_text: attempt?.status === 'PENDING' ? `seatlink-demo:${attempt.id}` : null,
        selected_seats: snapshot.tables.flatMap(table => table.seats.filter(seat =>
          (order.status === 'DRAFT' ? order.draft_seat_ids ?? [] : order.selected_seat_ids).includes(seat.id))
          .map(seat => ({ id: seat.id, label: seat.label, table_number: table.table_number }))), allocations: snapshot.allocations ?? [] } }
  })
  api.loadBranches.mockResolvedValue([
    { id: 'riverside', name: 'Riverside', organisation: { name: 'Demo' } },
    { id: 'market', name: 'Market Square', organisation: { name: 'Demo' } },
  ])
  vi.mocked(client.rpc).mockImplementation(async (name, args) => {
    if (name === 'update_cart_preview') {
      const input = args as { p_revision: number; p_items: { menu_item_id: string; quantity: number }[] }
      if (input.p_revision !== snapshot.cart_revision) return { data: null, error: { code: 'P0001', message: 'The cart changed in another screen.' } } as never
      snapshot.cart_revision! += 1
      snapshot.cart_preview = input.p_items.map((item) => ({ ...item, name: 'Iced tea', currency: 'SGD', unit_price_minor: 180 }))
      snapshot.cart_total_minor = input.p_items.reduce((sum, item) => sum + item.quantity * 180, 0)
      return { data: { revision: snapshot.cart_revision, total_minor: snapshot.cart_total_minor, currency: 'SGD' }, error: null } as never
    }
    if (name === 'continue_to_seats') {
      const input = args as { p_items: { menu_item_id: string; quantity: number }[] }
      snapshot.order = { ...draft(), checkout_step: 'SEATS', draft_seat_ids: [] }
      snapshot.order.total_minor = 180 * input.p_items[0].quantity
      snapshot.order.items[0].quantity = input.p_items[0].quantity
    }
    if (name === 'confirm_order_seats') {
      const input = args as { p_seat_ids: string[] }
      snapshot.order = {
        ...snapshot.order!, status: 'PENDING', checkout_step: 'PAYMENT', revision: snapshot.order!.revision + 1,
        selected_seat_ids: input.p_seat_ids,
        draft_seat_ids: input.p_seat_ids,
        session_expires_at: snapshot.order?.session_expires_at ?? new Date(Date.now() + 300000).toISOString(),
      }
      for (const table of snapshot.tables) {
        for (const seat of table.seats) {
          if (seat.locked_order_id === snapshot.order.id && !input.p_seat_ids.includes(seat.id)) { seat.status = 'AVAILABLE'; seat.locked_order_id = null }
          if (input.p_seat_ids.includes(seat.id)) {
            seat.status = 'LOCKED'
            seat.locked_order_id = snapshot.order.id
          }
        }
      }
    }
    if (name === 'cancel_order') {
      snapshot.order = null
      for (const table of snapshot.tables) {
        for (const seat of table.seats) { seat.status = 'AVAILABLE'; seat.locked_order_id = null }
      }
    }
    if (name === 'select_payment_method') snapshot.order!.payment_method = (args as { p_method: 'QR' | 'CASH' }).p_method
    if (name === 'start_next_sale') { snapshot.order = null; snapshot.cart_preview = []; snapshot.cart_revision! += 1; snapshot.cart_total_minor = 0 }
    if (name === 'update_selected_seats') snapshot.order!.draft_seat_ids = (args as { p_seat_ids: string[] }).p_seat_ids
    if (name === 'change_draft_step') {
      snapshot.order!.checkout_step = (args as { p_step: 'MENU' | 'SEATS' }).p_step
      snapshot.cart_revision! += 1
    }
    if (name === 'confirm_cash_payment') {
      snapshot.order!.status = 'PAID'; snapshot.order!.checkout_step = 'RESULT'; snapshot.order!.paid_method = 'CASH'
      snapshot.allocations = snapshot.order!.selected_seat_ids.length ? [{ id: 'use-A', order_id: snapshot.order!.id, seat_id: 'A', started_at: new Date().toISOString(), expires_at: new Date(Date.now() + 600000).toISOString(), status: 'ACTIVE', ended_at: null, label: 'A', table_number: 1 }] : []
      if (snapshot.order!.selected_seat_ids.length) snapshot.tables[0].seats[0].status = 'UNAVAILABLE'
    }
    if (name === 'prepare_mock_qr') {
      const input = args as { p_request_id: string }
      const attempt = {
        id: input.p_request_id, order_id: snapshot.order!.id, provider: 'MOCK' as const,
        amount_minor: snapshot.order!.total_minor, currency: 'SGD', status: 'PENDING' as const,
        created_at: new Date().toISOString(), qr_expires_at: new Date(Date.now() + 60000).toISOString(), succeeded_at: null,
      }
      if (!snapshot.attempts?.some(item => item.status === 'PENDING')) snapshot.attempts = [attempt, ...(snapshot.attempts ?? [])]
      snapshot.recent_attempts = snapshot.attempts
      return { data: attempt, error: null } as never
    }
    if (name === 'simulate_mock_payment') {
      const input = args as { p_attempt_id: string; p_result: 'SUCCESS' | 'FAILURE' }
      const attempt = snapshot.attempts!.find((item) => item.id === input.p_attempt_id)!
      attempt.status = input.p_result === 'SUCCESS' ? 'SUCCEEDED' : 'FAILED'
      if (input.p_result === 'SUCCESS') {
        snapshot.order!.status = 'PAID'
        snapshot.order!.revision += 1
        snapshot.allocations = snapshot.tables.flatMap((table) => table.seats
          .filter((seat) => snapshot.order!.selected_seat_ids.includes(seat.id)).map((seat) => {
            seat.status = 'UNAVAILABLE'
            return { id: `use-${seat.id}`, order_id: snapshot.order!.id, seat_id: seat.id,
              started_at: new Date().toISOString(), expires_at: new Date(Date.now() + 600000).toISOString(),
              status: 'ACTIVE' as const, ended_at: null, label: seat.label, table_number: table.table_number }
          }))
      }
    }
    if (name === 'release_seat_use') {
      const input = args as { p_session_ids: string[] }
      snapshot.allocations = snapshot.allocations!.filter((use) => {
        if (!input.p_session_ids.includes(use.id)) return true
        for (const table of snapshot.tables) for (const seat of table.seats) if (seat.id === use.seat_id) seat.status = 'AVAILABLE'
        return false
      })
    }
    return { data: snapshot.order, error: null } as never
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

async function seats(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Add Iced tea' }))
  await user.click(screen.getByRole('button', { name: 'Next' }))
  await screen.findByRole('heading', { name: 'Choose individual seats' })
}

async function payment(user: ReturnType<typeof userEvent.setup>) {
  await seats(user)
  await user.click(screen.getByRole('button', { name: 'Table A · Seat 1' }))
  await user.click(screen.getByRole('button', { name: 'Confirm seats' }))
  await screen.findByRole('heading', { name: 'Payment', exact: true })
}

it('syncs owner draft selections to the paired display before confirmation without locking or activating seats', async () => {
  const user = userEvent.setup()
  let broadcast!: () => void
  subscription.on.mockImplementation((event, _options, callback) => {
    if (event === 'broadcast') broadcast = callback
    return subscription
  })
  try {
    render(<Owner client={client} />)
    await seats(user)
    window.history.replaceState(null, '', '/owner?branch=riverside#' + 'a'.repeat(64))
    render(<CustomerDisplay />)
    const customer = await screen.findByRole('region', { name: 'Current customer checkout' })
    expect(within(customer).queryByRole('status', { name: 'Your seats' })).toBeNull()
    const choose = async (seat: string, ids: string[]) => {
      await user.click(screen.getByRole('button', { name: seat }))
      await waitFor(() => expect(snapshot.order!.draft_seat_ids).toEqual(ids))
      act(() => broadcast())
    }
    await choose('Table A · Seat 1', ['A'])
    expect((await within(customer).findByRole('status', { name: 'Your seats' })).textContent).toContain('Table A · Seat 1')
    await choose('Table B · Seat 1', ['A', '2A'])
    await waitFor(() => expect(within(customer).getByRole('status', { name: 'Your seats' }).textContent).toContain('Table B · Seat 1'))
    await choose('Table A · Seat 1', ['2A'])
    await waitFor(() => expect(within(customer).getByRole('status', { name: 'Your seats' }).textContent).toBe('Your seats:Table B · Seat 1'))
    await choose('Table B · Seat 1', [])
    await waitFor(() => expect(within(customer).queryByRole('status', { name: 'Your seats' })).toBeNull())
    expect(snapshot.order!.status).toBe('DRAFT')
    expect(snapshot.order!.session_expires_at).toBeNull()
    expect(snapshot.tables.every(table => table.seats.every(seat => seat.status === 'AVAILABLE'))).toBe(true)
    expect(vi.mocked(client.rpc).mock.calls.some(([name]) => ['confirm_order_seats', 'activate_seats'].includes(name))).toBe(false)
    expect(within(customer).queryByRole('list', { name: 'Seat status legend' })).toBeNull()
  } finally {
    subscription.on.mockReset().mockReturnThis()
  }
})

it('renders only the active workspace, searches the menu and caps seat selection at four', async () => {
  const user = userEvent.setup()
  render(<Owner client={client} />)
  await screen.findByRole('heading', { name: 'Menu and cart' })
  expect(screen.queryByRole('button', { name: 'Table A · Seat 1' })).toBeNull()
  await user.type(screen.getByRole('searchbox'), 'tea')
  expect(screen.queryByRole('button', { name: 'Unavailable' })).toBeNull()
  await seats(user)
  expect(screen.queryByRole('button', { name: 'Add Iced tea' })).toBeNull()
  for (const label of ['A', 'B', 'C', 'D']) await user.click(screen.getByRole('button', { name: `Table A · Seat ${label.charCodeAt(0)-64}` }))
  expect(screen.getByText('4 of 4 seats selected')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Table B · Seat 1' }).hasAttribute('disabled')).toBe(true)
  await user.click(screen.getByRole('button', { name: 'Remove Table A · Seat 1' }))
  expect(screen.getByText('3 of 4 seats selected')).toBeTruthy()
})

it('completes cash checkout and starts a new cart while paid seats remain occupied', async () => {
  const user = userEvent.setup()
  render(<Owner client={client} />)
  await payment(user)
  const deadline = snapshot.order!.session_expires_at
  const salesReadsBeforePayment = api.readDailySales.mock.calls.length
  await user.click(screen.getByRole('radio', { name: 'Cash & Card' }))
  const received = await screen.findByRole('textbox', { name: 'Amount received (SGD)' })
  await user.type(received, '1')
  expect(screen.getByRole('button', { name: 'Confirm Payment', exact: true }).hasAttribute('disabled')).toBe(true)
  await user.clear(received)
  await user.type(received, '5.00')
  await user.dblClick(screen.getByRole('button', { name: 'Confirm Payment', exact: true }))
  await screen.findByRole('heading', { name: 'Payment confirmed' })
  await waitFor(() => expect(api.readDailySales.mock.calls.length).toBeGreaterThan(salesReadsBeforePayment))
  expect(client.rpc).toHaveBeenCalledWith('confirm_cash_payment', expect.objectContaining({ p_received_minor: 500 }))
  expect(vi.mocked(client.rpc).mock.calls.filter(([name]) => name === 'confirm_cash_payment')).toHaveLength(1)
  expect(snapshot.order!.session_expires_at).toBe(deadline)
  await user.click(screen.getByRole('button', { name: 'Start new order' }))
  await screen.findByRole('heading', { name: 'Menu and cart' })
  expect(snapshot.allocations).toHaveLength(1)
  expect(snapshot.tables[0].seats[0].status).toBe('UNAVAILABLE')
})

it('retains cart quantities when server validation fails', async () => {
  const user = userEvent.setup()
  render(<Owner client={client} />)
  await user.click(await screen.findByRole('button', { name: 'Add Iced tea' }))
  vi.mocked(client.rpc).mockResolvedValueOnce({ data: null, error: { message: 'offline' } } as never)
  await user.click(screen.getByRole('button', { name: 'Next' }))
  await screen.findByRole('alert')
  expect((screen.getByRole('textbox', {name: 'Menu quantity for Iced tea'}) as HTMLInputElement).value).toBe('1')
  expect(screen.queryByRole('heading', { name: 'Choose individual seats' })).toBeNull()
})

it('keeps conflicting selected seats visible and explains the failed reservation', async () => {
  const user = userEvent.setup()
  render(<Owner client={client} />)
  await seats(user)
  await user.click(screen.getByRole('button', { name: 'Table A · Seat 1' }))
  vi.mocked(client.rpc).mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'Selected seats unavailable: Table 1 / Seat A. Choose available replacements.' } } as never)
  await user.click(screen.getByRole('button', { name: 'Confirm seats' }))
  expect((await screen.findByRole('alert')).textContent).toMatch(/unavailable/)
  expect(screen.getByRole('button', { name: 'Table A · Seat 1' }).getAttribute('aria-pressed')).toBe('true')
})

it('blocks cash for an unresolved QR and keeps simulation outside the checkout', async () => {
  const user = userEvent.setup()
  render(<Owner client={client} />)
  await payment(user)
  await user.click(screen.getByRole('radio', { name: 'QR payment' }))
  await user.click(await screen.findByRole('button', { name: 'Confirm Payment', exact: true }))
  await screen.findByAltText('Demo payment QR, no real charge')
  expect(screen.queryByRole('button', { name: 'Simulate payment success' })).toBeNull()
  snapshot.unresolved_qr = 1
  await user.click(screen.getByRole('radio', { name: 'Cash & Card' }))
  await user.type(await screen.findByRole('textbox', { name: 'Amount received (SGD)' }), '10')
  expect(screen.getByRole('button', { name: 'Confirm Payment', exact: true }).hasAttribute('disabled')).toBe(true)
  expect(screen.getByRole('alert').textContent).toMatch(/still pending/)
  expect(screen.queryByAltText('Demo payment QR, no real charge')).toBeNull()
})

it.each(['MENU', 'SEATS', 'PAYMENT', 'RESULT'] as const)('restores persisted %s after refresh', async (step) => {
  snapshot.order = { ...draft(), checkout_step: step, status: step === 'PAYMENT' ? 'PENDING' : step === 'RESULT' ? 'PAID' : 'DRAFT',
    draft_seat_ids: ['A'], session_expires_at: new Date(Date.now() + 200000).toISOString() }
  if (step === 'MENU') snapshot.cart_preview = [{ menu_item_id: 'tea', name: 'Iced tea', currency: 'SGD', unit_price_minor: 180, quantity: 2 }]
  render(<Owner client={client} />)
  await screen.findByRole('heading', { name: { MENU: 'Menu and cart', SEATS: 'Choose individual seats', PAYMENT: 'Payment', RESULT: 'Payment confirmed' }[step], exact: true })
  if (step === 'MENU') expect((screen.getByRole('textbox', {name: 'Menu quantity for Iced tea'}) as HTMLInputElement).value).toBe('2')
  if (step === 'SEATS') expect(screen.getByRole('button', { name: 'Table A · Seat 1' }).getAttribute('aria-pressed')).toBe('true')
})

it('does not read sales on button hover or focus', async () => {
  const user = userEvent.setup()
  render(<Owner client={client} />)
  const button = await screen.findByRole('button', { name: 'Next' })
  const count = api.readSales.mock.calls.length
  await user.hover(button)
  act(() => button.focus())
  await waitFor(() => expect(api.readSales).toHaveBeenCalledTimes(count))
})

it('retries a failed mock payment from the separate development workspace', async () => {
  const user = userEvent.setup()
  render(<Owner client={client} />)
  await payment(user)
  const deadline = snapshot.order!.session_expires_at
  await user.click(screen.getByRole('radio', { name: 'QR payment' }))
  await user.click(await screen.findByRole('button', { name: 'Confirm Payment', exact: true }))
  await screen.findByAltText('Demo payment QR, no real charge')
  await user.click(screen.getByRole('button', { name: 'Development tools' }))
  await user.click(screen.getByRole('button', { name: 'Simulate payment failure' }))
  await waitFor(() => expect(snapshot.attempts![0].status).toBe('FAILED'))
  await user.click(screen.getByRole('button', { name: 'Checkout', exact: true }))
  await screen.findByText(/Payment failed/)
  await user.click(screen.getByRole('button', { name: 'Confirm Payment', exact: true }))
  await screen.findByAltText('Demo payment QR, no real charge')
  await user.click(screen.getByRole('button', { name: 'Development tools' }))
  await user.click(screen.getByRole('button', { name: 'Simulate payment success' }))
  await waitFor(() => expect(snapshot.order!.status).toBe('PAID'))
  await user.click(screen.getByRole('button', { name: 'Checkout', exact: true }))
  await screen.findByRole('heading', { name: 'Payment confirmed' })
  expect(snapshot.order!.session_expires_at).toBe(deadline)
  expect(snapshot.allocations).toHaveLength(1)
})

it('requires explicit cancellation before releasing a reserved order and restarting', async () => {
  const user = userEvent.setup()
  render(<Owner client={client} />)
  await payment(user)
  await user.click(screen.getByRole('button', { name: 'Cancel and start again' }))
  expect(screen.getByRole('region', { name: 'Cancel and start again' }).textContent).toMatch(/reserved seats will be released/)
  expect(snapshot.order!.status).toBe('PENDING')
  await user.click(screen.getByRole('button', { name: 'Confirm cancellation and restart' }))
  await screen.findByRole('heading', { name: 'Menu and cart' })
  expect(client.rpc).toHaveBeenCalledWith('cancel_order', { p_order_id: 'order-1' })
  expect(snapshot.tables[0].seats[0].status).toBe('AVAILABLE')
})

it('returns to Menu and validates edited quantities with the updated preview revision', async () => {
  const user = userEvent.setup()
  render(<Owner client={client} />)
  await seats(user)
  await user.click(screen.getByRole('button', { name: 'Back to menu' }))
  await screen.findByRole('heading', { name: 'Menu and cart' })
  await user.click(screen.getByRole('button', { name: 'Add Iced tea' }))
  await user.click(screen.getByRole('button', { name: 'Next' }))
  await screen.findByRole('heading', { name: 'Choose individual seats' })
  expect(snapshot.order!.total_minor).toBe(360)
  expect(screen.queryByRole('alert')).toBeNull()
})

it('restores the same confirmed QR on both owner and paired display and advances both after verified success', async () => {
  const user = userEvent.setup()
  render(<Owner client={client} />)
  await payment(user)
  await user.click(screen.getByRole('radio', { name: 'QR payment' }))
  await user.dblClick(await screen.findByRole('button', { name: 'Confirm Payment', exact: true }))
  await screen.findByAltText('Demo payment QR, no real charge')
  expect(vi.mocked(client.rpc).mock.calls.filter(([name]) => name === 'prepare_mock_qr')).toHaveLength(1)
  window.history.replaceState(null, '', '/owner?branch=riverside#' + 'a'.repeat(64))
  const display = render(<CustomerDisplay />)
  await waitFor(() => expect(screen.getAllByAltText('Demo payment QR, no real charge')).toHaveLength(2))
  display.unmount()
  render(<CustomerDisplay />)
  await waitFor(() => expect(screen.getAllByAltText('Demo payment QR, no real charge')).toHaveLength(2))
  await client.rpc('simulate_mock_payment', { p_attempt_id: snapshot.attempts![0].id, p_event_id: crypto.randomUUID(), p_result: 'SUCCESS' })
  act(() => window.dispatchEvent(new Event('online')))
  await screen.findByRole('heading', { name: 'Payment confirmed' })
  await screen.findByText('Payment confirmed.')
  expect(screen.queryByAltText('Demo payment QR, no real charge')).toBeNull()
})

it('identifies disabled development configuration and does not create a fake payable QR', async () => {
  snapshot.development_enabled = false
  snapshot.payment_mode = 'UNCONFIGURED'
  snapshot.qr_configuration = 'MOCK_ACCESS_DISABLED'
  const user = userEvent.setup()
  render(<Owner client={client} />)
  await payment(user)
  await user.click(screen.getByRole('radio', { name: 'QR payment' }))
  expect((await screen.findByRole('alert')).textContent).toMatch(/check payment settings/)
  expect(screen.getByRole('button', { name: 'Confirm Payment', exact: true }).hasAttribute('disabled')).toBe(true)
  expect(screen.queryByAltText('Demo payment QR, no real charge')).toBeNull()
})

it('uses native radio keyboard navigation and makes the selected method visible', async () => {
  // JSDOM omits CSS.escape, used by user-event's native radio traversal.
  vi.stubGlobal('CSS', { escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '\\$&') })
  const user = userEvent.setup()
  render(<Owner client={client} />)
  await payment(user)
  const qr = screen.getByRole('radio', { name: 'QR payment' })
  await user.click(qr)
  await waitFor(() => expect((qr as HTMLInputElement).checked).toBe(true))
  act(() => qr.focus())
  await user.keyboard('{ArrowRight}')
  await waitFor(() => expect((screen.getByRole('radio', { name: 'Cash & Card' }) as HTMLInputElement).checked).toBe(true))
  expect(screen.getByText('Confirm only after receiving payment.')).toBeTruthy()
  vi.unstubAllGlobals()
})

it('pairs the current station using the active deployment origin and opens the generated display link', async () => {
  const user = userEvent.setup()
  const token = 'b'.repeat(64)
  const originalRpc = vi.mocked(client.rpc).getMockImplementation()!
  vi.mocked(client.rpc).mockImplementation(async (name, args) => {
    if (name === 'pair_customer_display') return { data: token, error: null } as never
    return originalRpc(name, args)
  })
  render(<Owner client={client} />)
  await user.click(await screen.findByRole('button', { name: 'Customer display settings' }))
  await user.click(screen.getByRole('button', { name: 'Pair customer display' }))
  const link = await screen.findByRole('link', { name: 'Open paired display in a new window' })
  const url = new URL(link.getAttribute('href')!)
  expect(url.origin).toBe(window.location.origin)
  expect(url.pathname).toBe('/display')
  expect(url.hash).toBe('#' + token)
  expect(client.rpc).toHaveBeenCalledWith('pair_customer_display', { p_station_id: 'station-one' })
  window.history.replaceState(null, '', url.pathname + '?source=pairing' + url.hash)
  const display = render(<CustomerDisplay />)
  await screen.findByText('Counter one')
  expect(api.readDisplay).toHaveBeenCalledWith(client, token, expect.any(AbortSignal))
  display.unmount()
  render(<CustomerDisplay />)
  await screen.findByText('Counter one')
  expect(window.location.search).toBe('?source=pairing')
  expect(window.location.hash).toBe('#' + token)
  expect(api.readDisplay).toHaveBeenLastCalledWith(client, token, expect.any(AbortSignal))
})

it.each(['CASH','QR'] as const)('completes %s checkout without seats and synchronizes the paired display', async method => {
  const user = userEvent.setup()
  render(<Owner client={client} />)
  await seats(user)
  await user.click(screen.getByRole('button', { name: 'Table A · Seat 1' }))
  await user.click(screen.getByRole('button', { name: 'Continue without seats' }))
  await screen.findByRole('heading', { name: 'Payment', exact: true })
  expect(snapshot.order!.selected_seat_ids).toEqual([])
  expect(snapshot.order!.draft_seat_ids).toEqual([])
  expect(snapshot.tables.every(table => table.seats.every(seat => seat.status === 'AVAILABLE'))).toBe(true)
  window.history.replaceState(null, '', '/owner?branch=riverside#'+'a'.repeat(64))
  render(<CustomerDisplay />)
  const customerOrder = await screen.findByRole('region', { name: 'Current customer checkout' })
  expect(screen.getByText('No seats selected')).toBeTruthy()
  expect(within(customerOrder).queryByText(/seats?/i)).toBeNull()
  await user.click(screen.getByRole('radio', { name: method === 'CASH' ? 'Cash & Card' : 'QR payment' }))
  if (method === 'CASH') await user.type(await screen.findByRole('textbox', { name: 'Amount received (SGD)' }), '5.00')
  await user.click(await screen.findByRole('button', { name: 'Confirm Payment', exact: true }))
  if (method === 'QR') {
    await screen.findByAltText('Demo payment QR, no real charge')
    await client.rpc('simulate_mock_payment', { p_attempt_id: snapshot.attempts![0].id, p_event_id: crypto.randomUUID(), p_result: 'SUCCESS' })
  }
  act(() => window.dispatchEvent(new Event('online')))
  await screen.findByRole('heading', { name: 'Payment confirmed' })
  await waitFor(() => expect(snapshot.allocations ?? []).toHaveLength(0))
  await within(customerOrder).findByText('Payment confirmed.')
  expect(within(customerOrder).queryByText(/seats?/i)).toBeNull()
  expect(screen.queryByRole('button', { name: 'Table A · Seat 1' })).toBeNull()
})

it('keeps reserved seats on the payment page without offering to skip them', async () => {
  const user = userEvent.setup()
  render(<Owner client={client} />)
  await payment(user)
  const deadline = snapshot.order!.session_expires_at
  expect(screen.queryByRole('button', { name: 'Continue without seats' })).toBeNull()
  expect(snapshot.order!.selected_seat_ids).toEqual(['A'])
  expect(snapshot.order!.session_expires_at).toBe(deadline)
  expect(snapshot.tables[0].seats[0].status).toBe('LOCKED')
  expect(screen.getByRole('button', { name: 'Cancel and start again' })).toBeTruthy()
})

it.each(['cart','seats','payment'] as const)('protects %s state when a different branch is chosen in the modal', async stage => {
  const user = userEvent.setup()
  render(<Owner client={client} />)
  if (stage==='cart') await user.click(await screen.findByRole('button',{name:'Add Iced tea'}))
  else if (stage==='seats') { await seats(user);await user.click(screen.getByRole('button',{name:'Table A · Seat 1'})) }
  else await payment(user)
  const deadline = snapshot.order?.session_expires_at
  await user.click(screen.getByRole('button',{name:'Switch branch',exact:true}))
  await user.click(screen.getByRole('radio',{name:'Market Square'}))
  await user.click(screen.getByRole('button',{name:'Continue',exact:true}))
  expect((await screen.findByRole('alert')).textContent).toMatch(stage==='cart'?/cart changes to save/:stage==='seats'?/Clear your seat selection/:/Cancel the pending order/)
  expect(new URL(location.href).searchParams.get('branch')).toBe('riverside')
  expect(snapshot.order?.session_expires_at).toBe(deadline)
  expect(api.readSales.mock.calls.some(call=>call[1]==='market')).toBe(false)
})




it('removes menu selections at zero without a separate cart section',async()=>{
 const user=userEvent.setup()
 render(<Owner client={client}/> )
 await user.click(await screen.findByRole('button',{name:'Add Iced tea'}))
 await user.click(screen.getByRole('button',{name:'Decrease Menu quantity for Iced tea'}))
 expect(screen.queryByRole('button',{name:'Remove Iced tea'})).toBeNull()
 expect((screen.getByRole('textbox',{name:'Menu quantity for Iced tea'}) as HTMLInputElement).value).toBe('0')
 await user.click(screen.getByRole('button',{name:'Add Iced tea'}))
 await user.clear(screen.getByRole('textbox',{name:'Menu quantity for Iced tea'}))
 await user.type(screen.getByRole('textbox',{name:'Menu quantity for Iced tea'}),'0')
 expect(screen.queryByRole('button',{name:'Remove Iced tea'})).toBeNull()
 expect(screen.getByRole('button',{name:'Add Iced tea'}).hasAttribute('disabled')).toBe(false)
 expect(screen.getByRole('button',{name:'Next'}).hasAttribute('disabled')).toBe(true)
 expect(client.rpc).not.toHaveBeenCalledWith('delete_menu_item',expect.anything())
})
