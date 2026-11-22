import { createClient } from 'npm:@supabase/supabase-js@2.119.0'
import { TwoC2PSandbox, ProviderError, providerEventId, verifyProviderJwt } from '../_shared/two-c2p.ts'
import type { ProviderAttempt, VerifiedResult } from '../_shared/two-c2p.ts'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info' }
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i

Deno.serve(async (request: Request) => {
  const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: cors })
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return reply({ error: 'Use POST.' }, 405)
  const url = Deno.env.get('SUPABASE_URL')
  const anon = Deno.env.get('SUPABASE_ANON_KEY')
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const secret = Deno.env.get('TWO_C2P_SECRET')
  const merchantId = Deno.env.get('TWO_C2P_MERCHANT_ID')
  if (!url || !anon || !service || !secret || !merchantId) return reply({ code: 'SANDBOX_CONFIG_MISSING', error: 'Sandbox payment secrets are incomplete.' }, 503)
  let provider: TwoC2PSandbox
  try {
    provider = new TwoC2PSandbox({
      mode: Deno.env.get('PAYMENT_MODE') ?? '', merchantId, secret,
      channelCode: Deno.env.get('TWO_C2P_CHANNEL_CODE') ?? '',
      callbackUrl: Deno.env.get('TWO_C2P_CALLBACK_URL') ?? '',
    })
  } catch { return reply({ code: 'SANDBOX_CONFIG_MISSING', error: 'Sandbox mode, channel or callback configuration is incomplete. Live charging is disabled.' }, 503) }
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })
  let body
  try { body = await request.json() } catch { return reply({ error: 'Invalid request.' }, 400) }
  const callback = new URL(request.url).searchParams.get('callback') === '1'
  async function apply(result: VerifiedResult, attemptId: string) {
    if (result.outcome === 'PENDING') return
    const { error } = await admin.rpc('apply_verified_sandbox_result', {
      p_attempt_id: attemptId, p_merchant_id: result.merchantId, p_invoice: result.invoice,
      p_amount_minor: result.amountMinor, p_currency: result.currency, p_reference: result.reference,
      p_result: result.outcome, p_event_id: await providerEventId(result),
    })
    if (error) throw new Error('Payment reconciliation failed.')
  }
  try {
    if (callback) {
      if (typeof body?.payload !== 'string') return reply({ error: 'Invalid callback.' }, 400)
      // Authenticate before looking up a payment, then match every financial field.
      const claims = await verifyProviderJwt(body.payload, secret)
      if (claims.merchantID !== merchantId || typeof claims.invoiceNo !== 'string') return reply({ error: 'Invalid callback.' }, 403)
      const { data: attempt, error } = await admin.from('payment_attempts').select('*')
        .eq('provider_invoice', claims.invoiceNo).eq('provider', 'TWO_C2P').eq('mode', 'SANDBOX').single()
      if (error || !attempt) return reply({ error: 'Payment attempt not found.' }, 404)
      const result = await provider.verifyCallback(body, attempt as ProviderAttempt)
      await apply(result, attempt.id)
      return reply({ received: true })
    }

    const authorization = request.headers.get('authorization') ?? ''
    const user = createClient(url, anon, { global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false } })
    const { data: identity, error: authError } = await user.auth.getUser(authorization.replace(/^Bearer /, ''))
    if (authError || !identity.user) return reply({ code: 'OWNER_AUTH_REQUIRED', error: 'Sign in first.' }, 401)
    if (body?.action === 'create') {
      if (!uuid.test(body.orderId ?? '') || !uuid.test(body.requestId ?? '')) return reply({ error: 'Invalid order or request ID.' }, 400)
      const { data: attempt, error } = await user.rpc('begin_sandbox_payment', { p_order_id: body.orderId, p_request_id: body.requestId })
      if (error || !attempt) return reply({ code: 'RESERVATION_REJECTED', error: 'QR creation rejected. Check the reservation and payment configuration.' }, 409)
      if (attempt.merchant_id !== merchantId) return reply({ code: 'SANDBOX_CONFIG_MISSING', error: 'Sandbox merchant configuration does not match.' }, 503)
      const { data: claimed, error: claimError } = await admin.rpc('claim_sandbox_creation', { p_attempt_id: attempt.id })
      if (claimError) return reply({ error: 'Unable to prepare the provider request.' }, 503)
      if (!claimed) {
        if (attempt.qr_issue) return reply({ code: attempt.qr_issue, error: 'The previous QR request needs status verification.', attemptId: attempt.id }, 409)
        return reply({ attemptId: attempt.id, status: attempt.qr_image_url ? 'READY' : 'CREATING', reused: true }, attempt.qr_image_url ? 200 : 202)
      }
      try {
        const qr = await provider.createQr(attempt as ProviderAttempt)
        const { error: storeError } = await admin.rpc('store_sandbox_qr_expiry', {
          p_attempt_id: attempt.id, p_payment_token: qr.paymentToken, p_image_url: qr.imageUrl, p_expiry_ms: qr.expiryMs,
        })
        if (storeError) throw new ProviderError('QR_PERSIST_FAILED', 'Unable to record the provider QR.')
        return reply({ attemptId: attempt.id, status: 'READY' })
      } catch (failure) {
        const code = failure instanceof ProviderError ? failure.code : 'PROVIDER_REQUEST_FAILED'
        await admin.rpc('record_sandbox_qr_issue', { p_attempt_id: attempt.id, p_code: code })
        return reply({ code, error: 'QR creation failed. Verify payment status before accepting cash.', attemptId: attempt.id }, 503)
      }
    }
    if (body?.action === 'inquire' && uuid.test(body.attemptId ?? '')) {
      // Owner-scoped RLS must permit the attempt before the privileged inquiry.
      const { data: visible, error } = await user.from('payment_attempts').select('id, order_id').eq('id', body.attemptId).single()
      if (error || !visible) return reply({ code: 'OWNER_AUTH_REQUIRED', error: 'Payment access denied.' }, 403)
      const { data: attempt } = await admin.from('payment_attempts').select('*').eq('id', visible.id).eq('provider', 'TWO_C2P').eq('mode', 'SANDBOX').single()
      if (!attempt) return reply({ error: 'Sandbox attempt not found.' }, 404)
      const result = await provider.inquire(attempt as ProviderAttempt)
      await apply(result, attempt.id)
      return reply({ status: result.outcome })
    }
    return reply({ error: 'Unsupported payment action.' }, 400)
  } catch {
    // A failed network call can leave a payable attempt. Keep it unresolved for inquiry.
    return reply({ code: 'PROVIDER_REQUEST_FAILED', error: callback ? 'Callback verification or processing failed.' :
      'Provider response is unverified or unavailable. Check payment status before retrying or accepting cash.' }, callback ? 400 : 503)
  }
})
