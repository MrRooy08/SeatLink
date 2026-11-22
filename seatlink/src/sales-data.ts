import type { SeatLinkClient } from './seat-data'

export async function readSales(client: SeatLinkClient, branchId: string, signal: AbortSignal) {
  const { data, error } = await client.rpc('read_branch_sales', { p_branch_id: branchId }).abortSignal(signal)
  if (error) throw error
  if (!data) throw new Error('No sales data returned.')
  if (!Array.isArray(data.menu) || !Array.isArray(data.tables) || data.order === undefined) {
    throw new Error('The sales response is incomplete. Check the applied migrations.')
  }
  return data
}

export function salesLoadError(error: unknown) {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
  if (['PGRST202', 'PGRST205', '42883', '42P01'].includes(code)) {
    return 'SeatLink sales database setup is incomplete. Apply the pending sales migrations to the Supabase project used by this app, then retry.'
  }
  if (code === '42501') {
    return 'Your account cannot access sales for this branch. Ask your administrator to check your organisation membership and database permissions.'
  }
  return 'Couldn’t load branch sales. Check your connection and try again.'
}

export function formatMoney(minor: number, currency: string) {
  // Currency fractions come from ISO 4217 through Intl (e.g. JPY has zero).
  const formatter = new Intl.NumberFormat(undefined, { style: 'currency', currency })
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2
  return formatter.format(minor / 10 ** digits)
}

export function salesError(error: unknown) {
  if (error && typeof error === 'object' && 'message' in error && 'code' in error) {
    const message = String(error.message)
    if (String(error.code) === 'P0001') return message
    if (String(error.code) === '42501') return 'You do not have permission to perform this action. Ask your administrator to check your access.'
    if (String(error.code) === '23505') return 'An active order already exists. Reload to continue it.'
    if (String(error.code) === '22003') return 'The quantity or total exceeds the supported numeric range.'
  }
  return 'Couldn’t complete the request. Check your connection, then reload the order before retrying.'
}
