import type { SeatLinkClient } from '../../seat-data'

export async function readDailySales(client: SeatLinkClient, branchId: string, signal: AbortSignal) {
  const { data, error } = await client.rpc('read_branch_daily_sales', { p_branch_id: branchId }).abortSignal(signal)
  if (error) throw error
  if (!data || data.branch_id !== branchId || typeof data.total_minor !== 'string' || !/^\d+$/.test(data.total_minor) || !/^[A-Z]{3}$/.test(data.currency) ||
    !Number.isSafeInteger(data.paid_orders) || data.paid_orders < 0 || !Number.isFinite(Date.parse(data.day_end)) ||
    !Number.isFinite(Date.parse(data.day_start)) || !Number.isFinite(Date.parse(data.server_now)) ||
    Date.parse(data.day_end) <= Date.parse(data.day_start) || data.basis !== 'GROSS' || data.mock_excluded !== true) {
    throw new Error('Daily sales response is incomplete.')
  }
  return data
}

export function formatDailyMoney(minor: string, currency: string) {
  const formatter = new Intl.NumberFormat(undefined, { style: 'currency', currency })
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2
  const scale = 10n ** BigInt(digits)
  const amount = BigInt(minor)
  const fraction = String(amount % scale).padStart(digits, '0')
  return formatter.formatToParts(amount / scale).map(part => part.type === 'fraction' ? fraction : part.value).join('')
}
