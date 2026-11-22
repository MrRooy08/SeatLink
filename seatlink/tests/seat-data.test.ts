import { createClient } from '@supabase/supabase-js'
import { expect, it, vi } from 'vitest'
import type { Database } from '../src/database.types'
import { loadTables } from '../src/seat-data'

it('uses the real Supabase client to filter and paginate seat data for one branch', async () => {
  const first = { id: 'table-a', table_number: 1, seats: [{ id: 'seat-a', label: 'A', status: 'LOCKED' }] }
  const second = { id: 'table-b', table_number: 2, seats: [] }
  const pages = new Map([['0', [first]], ['1', [second]], ['2', []]])
  const signal = new AbortController().signal
  const fetchResponse = vi.fn<typeof fetch>().mockImplementation(async (input, options) => {
    const url = new URL(String(input))
    expect(url.pathname).toBe('/rest/v1/tables')
    expect(url.searchParams.get('branch_id')).toBe('eq.branch-a')
    expect(url.searchParams.get('select')).toBe('id,table_number,seats(id,label,status)')
    expect(url.searchParams.get('order')).toBe('table_number.asc')
    expect(url.searchParams.get('seats.order')).toBe('label.asc')
    expect(options?.signal).toBe(signal)
    const page = pages.get(url.searchParams.get('offset') ?? '')
    if (!page) throw new Error('Unexpected page offset')
    return Response.json(page)
  })
  const client = createClient<Database>('http://localhost:54321', 'sb_publishable_test', {
    global: { fetch: fetchResponse },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })

  await expect(loadTables(client, 'branch-a', signal)).resolves.toEqual([first, second])
  expect(fetchResponse).toHaveBeenCalledTimes(3)
})
