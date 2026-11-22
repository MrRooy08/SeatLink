import { expect, it, vi } from 'vitest'
import { sandboxPayment } from '../src/features/checkout/checkout-service'
import type { SeatLinkClient } from '../src/seat-data'

it.each([
  [503, 'SANDBOX_CONFIG_MISSING', /TWO_C2P/],
  [503, 'INVALID_QR_DATA', /supported QR image/],
  [503, 'PROVIDER_REQUEST_FAILED', /outcome is uncertain/],
  [404, undefined, /not deployed/],
  [401, undefined, /not authorised/],
] as const)('classifies HTTP %s / %s for owner diagnostics', async (status, code, message) => {
  const client = { functions: { invoke: vi.fn().mockResolvedValue({ data: null, error: { context: Response.json({ code }, { status }) } }) } } as unknown as SeatLinkClient
  await expect(sandboxPayment(client, { action: 'create', orderId: 'order', requestId: 'request' })).rejects.toMatchObject({ message: expect.stringMatching(message) })
})
