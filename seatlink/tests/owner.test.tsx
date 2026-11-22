// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from '../src/App'
import { useCallback } from 'react'
import { useQuery } from '../src/use-query'

const backend = vi.hoisted(() => {
  const listeners = new Set<(event: string, session: typeof session | null) => void>()
  const session = { user: { id: 'owner-a' } }
  return {
    session,
    emit(event: string, value: typeof session | null) {
      for (const listener of listeners) listener(event, value)
    },
    auth: {
      getSession: vi.fn(),
      signInWithPassword: vi.fn(),
      signOut: vi.fn(),
      onAuthStateChange(listener: (event: string, value: typeof session | null) => void) {
        listeners.add(listener)
        return { data: { subscription: { unsubscribe: () => listeners.delete(listener) } } }
      },
    },
    loadBranches: vi.fn(),
    loadTables: vi.fn(),
  }
})

vi.mock('../src/supabase', () => ({ supabase: { auth: backend.auth } }))
vi.mock('../src/seat-data', () => ({ loadBranches: backend.loadBranches, loadTables: backend.loadTables }))
vi.mock('../src/use-sales', () => ({
  salesFallbackStaleMs: 15000,
  salesLiveStaleMs: 45000,
  useSales: (client: unknown, branchId: string) => {
    const query = useQuery(useCallback(async (signal: AbortSignal) => ({
      server_now: new Date().toISOString(), menu: [], order: null, history: [],
      cart_revision: 0, cart_preview: [], station: { id: 'station-one', name: 'Counter one' },
      tables: await backend.loadTables(client, branchId, signal),
    }), [client, branchId]))
    return {
      result: query.result && 'data' in query.result
        ? { snapshot: query.result.data, receivedAt: performance.now() } : undefined,
      failed: !!query.result && 'error' in query.result,
      refreshing: !query.result,
      live: false,
      refresh: async () => query.retry(),
    }
  },
}))

const riverside = { id: 'riverside', name: 'Riverside', organisation: { name: 'Demo Food Court' } }
const market = { id: 'market', name: 'Market Square', organisation: riverside.organisation }
const table = {
  id: 'table-1',
  table_number: 1,
  seats: [
    { id: '1a', label: 'A', status: 'AVAILABLE' },
    { id: '1b', label: 'B', status: 'LOCKED' },
    { id: '1c', label: 'C', status: 'UNAVAILABLE' },
    { id: '1d', label: 'D', status: 'AVAILABLE' },
  ],
}

beforeEach(() => {
  window.history.replaceState(null, '', '/owner')
  backend.auth.getSession.mockResolvedValue({ data: { session: backend.session }, error: null })
  backend.loadBranches.mockResolvedValue([riverside])
  backend.loadTables.mockResolvedValue([table])
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

it('protects a direct branch link while restoring and after finding no session', async () => {
  window.history.replaceState(null, '', '/owner?branch=riverside')
  backend.auth.getSession.mockResolvedValue({ data: { session: null }, error: null })
  render(<App />)

  expect(screen.getByRole('status').textContent).toMatch(/Restoring/)
  await screen.findByRole('heading', { name: 'Owner sign-in' })
  expect(backend.loadBranches).not.toHaveBeenCalled()
  expect(backend.loadTables).not.toHaveBeenCalled()
})

it('signs in with email and password and reports invalid credentials', async () => {
  const user = userEvent.setup()
  window.history.replaceState(null, '', '/owner?branch=market')
  backend.loadBranches.mockResolvedValue([riverside, market])
  backend.auth.getSession.mockResolvedValue({ data: { session: null }, error: null })
  backend.auth.signInWithPassword
    .mockResolvedValueOnce({ error: { code: 'invalid_credentials' } })
    .mockRejectedValueOnce(new Error('offline'))
    .mockImplementationOnce(async () => {
      backend.emit('SIGNED_IN', backend.session)
      return { error: null }
    })

  render(<App />)
  await user.type(await screen.findByLabelText('Email address'), 'owner@example.test')
  await user.type(screen.getByLabelText('Password'), 'example-password')
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
  expect((await screen.findByRole('alert')).textContent).toMatch(/email or password is incorrect/)

  await user.click(screen.getByRole('button', { name: 'Sign in' }))
  expect((await screen.findByRole('alert')).textContent).toMatch(/Check your connection/)

  await user.click(screen.getByRole('button', { name: 'Sign in' }))
  await screen.findByRole('heading', { name: 'Market Square' })
  expect(backend.auth.signInWithPassword).toHaveBeenLastCalledWith({
    email: 'owner@example.test',
    password: 'example-password',
  })
  expect(backend.loadTables).toHaveBeenCalledWith(expect.anything(), 'market', expect.any(AbortSignal))
})

it('restores a session, opens the only branch, and clears owner data on sign-out', async () => {
  const user = userEvent.setup()
  backend.auth.signOut.mockImplementation(async () => {
    backend.emit('SIGNED_OUT', null)
    return { error: null }
  })
  render(<App />)

  await screen.findByRole('heading', { name: 'Riverside' })
  expect(screen.queryByRole('combobox')).toBeNull()
  await user.click(await screen.findByRole('button', { name: 'Active seats' }))
  expect(within(screen.getByRole('navigation', { name: 'Owner workspace' })).getByRole('button', { name: 'Checkout' })).toBeTruthy()

  await user.click(screen.getByRole('button', { name: 'Sign out' }))
  await screen.findByRole('heading', { name: 'Owner sign-in' })
  expect(screen.queryByRole('region', { name: 'Seat map' })).toBeNull()
  expect(backend.auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
})

it('shows a useful empty state when an owner has no authorised branches', async () => {
  backend.loadBranches.mockResolvedValue([])
  render(<App />)
  await screen.findByRole('heading', { name: 'No branches assigned' })
  expect(backend.loadTables).not.toHaveBeenCalled()
})

it('rejects an unknown URL branch and waits for the current order before switching', async () => {
  const user = userEvent.setup()
  window.history.replaceState(null, '', '/owner?branch=other-organisation')
  backend.loadBranches.mockResolvedValue([riverside, market])
  let finishOld!: (tables: unknown[]) => void
  const old = new Promise<unknown[]>((resolve) => { finishOld = resolve })
  backend.loadTables
    .mockReturnValueOnce(old)
    .mockResolvedValueOnce([table])
    .mockResolvedValueOnce([{ ...table, id: 'market-2', table_number: 2 }])

  render(<App />)
  const selector = await screen.findByRole('combobox', { name: 'Branch' })
  expect(screen.getByText(/branch in this link is unavailable/)).toBeTruthy()
  expect(backend.loadTables).not.toHaveBeenCalled()

  await user.selectOptions(selector, 'riverside')
  expect(screen.getByText('Loading branch checkout…')).toBeTruthy()
  const oldSignal = backend.loadTables.mock.calls[0][2]
  await user.selectOptions(selector, 'market')
  expect(screen.getByRole('alert').textContent).toMatch(/Wait for the branch order/)
  expect(new URL(window.location.href).searchParams.get('branch')).toBe('riverside')
  await act(async () => finishOld([{ ...table, table_number: 99 }]))
  await screen.findByRole('button', { name: 'Checkout' })
  await user.selectOptions(selector, 'market')
  expect(oldSignal.aborted).toBe(true)
  expect(new URL(window.location.href).searchParams.get('branch')).toBe('market')
  await screen.findByRole('button', { name: 'Checkout' })

  expect(screen.queryByRole('heading', { name: 'Table 99' })).toBeNull()

  await user.selectOptions(selector, 'riverside')
  expect(screen.queryByRole('heading', { name: 'Table 1' })).toBeNull()
  await screen.findByRole('button', { name: 'Checkout' })
})

it('retries failed branch and seat requests and handles a branch with no tables', async () => {
  const user = userEvent.setup()
  backend.loadBranches.mockRejectedValueOnce(new Error('offline'))
  backend.loadTables.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([])
  render(<App />)
  expect((await screen.findByRole('alert')).textContent).toMatch(/load your branches/)
  await user.click(screen.getByRole('button', { name: 'Retry' }))
  expect((await screen.findByRole('alert')).textContent).toMatch(/load branch sales/)
  await user.click(screen.getByRole('button', { name: 'Retry' }))
  await screen.findByText(/No menu items configured for this branch/)
})
