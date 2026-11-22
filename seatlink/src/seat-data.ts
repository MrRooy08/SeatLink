import type { QueryData, SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

export type SeatLinkClient = SupabaseClient<Database>
const pageSize = 100

function branchQuery(client: SeatLinkClient, signal: AbortSignal, offset: number) {
  return client.from('branches')
    .select('id, name, organisation:organisations!inner(name)')
    .order('name')
    .order('id')
    .range(offset, offset + pageSize - 1)
    .abortSignal(signal)
}

function tableQuery(client: SeatLinkClient, branchId: string, signal: AbortSignal, offset: number) {
  return client.from('tables')
    .select('id, table_number, seats(id, label, status)')
    .eq('branch_id', branchId)
    .order('table_number')
    .order('label', { referencedTable: 'seats' })
    .range(offset, offset + pageSize - 1)
    .abortSignal(signal)
}

export type Branch = QueryData<ReturnType<typeof branchQuery>>[number]
export type SeatTable = QueryData<ReturnType<typeof tableQuery>>[number]

async function loadPages<Row>(
  query: (offset: number) => PromiseLike<{ data: Row[] | null; error: unknown }>,
  signal: AbortSignal,
) {
  const rows: Row[] = []
  let offset = 0

  while (true) {
    signal.throwIfAborted()
    const { data, error } = await query(offset)
    if (error) throw error
    if (!data?.length) return rows
    rows.push(...data)
    offset += data.length
  }
}

export function loadBranches(client: SeatLinkClient, signal: AbortSignal) {
  return loadPages((offset) => branchQuery(client, signal, offset), signal)
}

export function loadTables(client: SeatLinkClient, branchId: string, signal: AbortSignal) {
  return loadPages((offset) => tableQuery(client, branchId, signal, offset), signal)
}
