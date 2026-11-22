import type { SeatLinkClient } from '../../seat-data'

export async function readDisplay(client: SeatLinkClient, token: string, signal: AbortSignal) {
  const { data, error } = await client.rpc('read_customer_display', { p_token: token }).abortSignal(signal)
  if (error) throw error
  if (!data) throw new Error('Display data unavailable.')
  return data
}
