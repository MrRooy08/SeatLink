import type { SeatLinkClient } from '../../seat-data'
import type { Database } from '../../database.types'

type Operations = Database['public']['Functions']
export const qrErrors: Record<string, string> = {
  MOCK_ACCESS_DISABLED: 'Development mock payments are disabled for this owner. An administrator must enable development payments and allowlist this test owner on a development project.',
  SANDBOX_MERCHANT_MISSING: 'The sandbox merchant is missing from payment_runtime. Configure the same sandbox merchant on the server and in the database.',
  SANDBOX_CONFIG_MISSING: 'Sandbox server configuration is incomplete. Check PAYMENT_MODE and the TWO_C2P merchant, secret, channel and callback settings.',
  QR_DISABLED: 'QR payments are disabled by the server. Choose cash or contact your administrator.',
  QR_ENDPOINT_MISSING: 'The qr-payment Edge Function is not deployed. Ask your administrator to deploy it to this Supabase project.',
  QR_ENDPOINT_UNREACHABLE: 'The payment backend could not be reached. Check qr-payment deployment, the connection and CORS. Verify payment status before accepting cash.',
  OWNER_AUTH_REQUIRED: 'Your payment request is not authorised. Sign in again and check branch access.',
  RESERVATION_REJECTED: 'The server rejected this payment request. Reload and check that the order still has an active reservation and QR selected.',
  PROVIDER_REQUEST_FAILED: 'The provider request failed or its outcome is uncertain. Check payment status before retrying or accepting cash.',
  PROVIDER_SIGNATURE_INVALID: 'The provider response could not be authenticated. Check sandbox signing configuration and verify payment status.',
  INVALID_QR_DATA: 'The provider did not return a supported QR image or expiry. Check the configured QR channel and provider response mapping.',
  QR_PERSIST_FAILED: 'The provider QR could not be saved. Check the payment migration and verify provider status before accepting cash.',
  UNCONFIGURED: 'QR payment mode is unavailable. Check the server payment configuration; there is no automatic mock fallback.',
}
export const qrFailure = (code: string) => ({ code: 'P0001', message: qrErrors[code] ?? qrErrors.PROVIDER_REQUEST_FAILED })

export async function checkoutOperation<Name extends keyof Operations>(
  client: SeatLinkClient, name: Name, args: Operations[Name]['Args'],
): Promise<Operations[Name]['Returns']> {
  const { data, error } = await client.rpc(name, args)
  if (error) {
    if (name === 'prepare_mock_qr' && ['PGRST202', '42883'].includes(error.code)) throw {
      code: 'P0001', message: 'Apply the QR confirmation migration 20261118000800 to this Supabase project, then reload.',
    }
    throw error
  }
  return data as Operations[Name]['Returns']
}

export async function sandboxPayment(client: SeatLinkClient, body:
  { action: 'create'; orderId: string; requestId: string } | { action: 'inquire'; attemptId: string }) {
  const { data, error } = await client.functions.invoke('qr-payment', { body })
  if (error || data?.error) {
    let code = data?.code
    if (error && ['FunctionsFetchError', 'FunctionsRelayError'].includes(error.name)) code = 'QR_ENDPOINT_UNREACHABLE'
    if (error?.context instanceof Response) {
      try { code = (await error.context.clone().json()).code } catch { /* Use HTTP classification below. */ }
      if (!code && error.context.status === 404) code = 'QR_ENDPOINT_MISSING'
      if (!code && [401, 403].includes(error.context.status)) code = 'OWNER_AUTH_REQUIRED'
    }
    throw qrFailure(typeof code === 'string' ? code : 'PROVIDER_REQUEST_FAILED')
  }
  return data
}
