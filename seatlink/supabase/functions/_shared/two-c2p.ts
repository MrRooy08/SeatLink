type ObjectData = Record<string, unknown>
export class ProviderError extends Error {
  code: string
  constructor(code: string, message: string) { super(message); this.code = code }
}
export function validQrImageUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      ((url.hostname === 'pgw-static-sandbox.s3.amazonaws.com' && url.pathname.startsWith('/images/qr/')) ||
       (url.hostname === 'api.2c2p.com' && url.pathname.startsWith('/pgw/qr/')))
  } catch { return false }
}
export type SandboxConfig = { mode: string; merchantId: string; secret: string; channelCode: string; callbackUrl: string }
export type ProviderAttempt = { id: string; provider_invoice: string; merchant_id: string; amount_minor: number; currency: string }
export type VerifiedResult = { merchantId: string; invoice: string; amountMinor: number; currency: string; reference: string;
  outcome: 'SUCCESS' | 'FAILURE' | 'CANCELLED' | 'PENDING'; code: string }

const encoder = new TextEncoder()
function encode(value: Uint8Array) {
  return btoa(String.fromCharCode(...value)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}
function decode(value: string) {
  return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), (character) => character.charCodeAt(0))
}
async function keyFor(secret: string) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}
export async function signProviderJwt(payload: ObjectData, secret: string) {
  const message = encode(encoder.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))) + '.' + encode(encoder.encode(JSON.stringify(payload)))
  const signature = await crypto.subtle.sign('HMAC', await keyFor(secret), encoder.encode(message))
  return message + '.' + encode(new Uint8Array(signature))
}
export async function verifyProviderJwt(token: string, secret: string): Promise<ObjectData> {
  if (token.length > 100000) throw new Error('Invalid provider message.')
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('Invalid provider message.')
  const header = JSON.parse(new TextDecoder().decode(decode(parts[0])))
  if (header.alg !== 'HS256') throw new Error('Unexpected signing algorithm.')
  const valid = await crypto.subtle.verify('HMAC', await keyFor(secret), decode(parts[2]), encoder.encode(parts[0] + '.' + parts[1]))
  if (!valid) throw new Error('Invalid provider signature.')
  const payload = JSON.parse(new TextDecoder().decode(decode(parts[1])))
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid provider payload.')
  if (typeof payload.exp === 'number' && payload.exp <= Date.now() / 1000) throw new Error('Expired provider message.')
  return payload
}
function digits(currency: string) {
  return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2
}
export function amountToMinor(value: unknown, currency: string) {
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error('Missing provider amount.')
  const text = String(value)
  if (!/^\d+(\.\d+)?$/.test(text)) throw new Error('Invalid provider amount.')
  const [whole, fraction = ''] = text.split('.')
  const scale = digits(currency)
  if (fraction.slice(scale).replaceAll('0', '')) throw new Error('Unexpected provider amount precision.')
  const minor = BigInt(whole) * 10n ** BigInt(scale) + BigInt(fraction.slice(0, scale).padEnd(scale, '0') || '0')
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Provider amount exceeds safe numeric range.')
  return Number(minor)
}
export function verifyPaymentDetails(payload: ObjectData, attempt: ProviderAttempt): VerifiedResult {
  if (payload.merchantID !== attempt.merchant_id || payload.invoiceNo !== attempt.provider_invoice ||
      payload.currencyCode !== attempt.currency || amountToMinor(payload.amount, attempt.currency) !== attempt.amount_minor) {
    throw new Error('Provider payment details do not match the order.')
  }
  const code = String(payload.respCode)
  const outcome = code === '0000' ? 'SUCCESS' : code === '0003' ? 'CANCELLED' :
    ['9035', '5009', '9020'].includes(code) ? 'FAILURE' : 'PENDING'
  const reference = typeof payload.referenceNo === 'string' ? payload.referenceNo : ''
  if (outcome === 'SUCCESS' && !reference) throw new Error('Missing provider reference.')
  return { merchantId: attempt.merchant_id, invoice: attempt.provider_invoice, amountMinor: attempt.amount_minor,
    currency: attempt.currency, reference, outcome, code }
}
export async function providerEventId(result: VerifiedResult) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode([result.merchantId, result.invoice, result.reference, result.code].join('|')))
  const hex = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('').slice(0, 32)
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-')
}
export class TwoC2PSandbox {
  private readonly base = 'https://sandbox-pgw.2c2p.com/payment/4.5/'
  constructor(private config: SandboxConfig, private request: typeof fetch = fetch) {
    if (config.mode !== 'SANDBOX' || !config.merchantId || !config.secret || !config.channelCode ||
        !config.callbackUrl.startsWith('https://')) throw new Error('Sandbox payment configuration is incomplete. Live mode is disabled.')
  }
  private async signed(path: string, payload: ObjectData) {
    const body = { payload: await signProviderJwt(payload, this.config.secret) }
    const response = await this.request(this.base + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000), redirect: 'error',
    })
    if (!response.ok) throw new ProviderError('PROVIDER_REQUEST_FAILED', 'Provider request failed.')
    const envelope = await response.json()
    if (typeof envelope.payload !== 'string') throw new Error('Missing signed provider response.')
    try { return await verifyProviderJwt(envelope.payload, this.config.secret) }
    catch { throw new ProviderError('PROVIDER_SIGNATURE_INVALID', 'Provider signature could not be verified.') }
  }
  async createQr(attempt: ProviderAttempt) {
    if (attempt.merchant_id !== this.config.merchantId || !/^[a-zA-Z0-9]{1,20}$/.test(attempt.provider_invoice)) throw new Error('Unexpected sandbox merchant or invoice.')
    const scale = digits(attempt.currency)
    const whole = BigInt(attempt.amount_minor) / 10n ** BigInt(scale)
    const fraction = String(BigInt(attempt.amount_minor) % 10n ** BigInt(scale)).padStart(scale, '0')
    const amount = Number(String(whole) + (scale ? '.' + fraction : ''))
    if (amountToMinor(amount, attempt.currency) !== attempt.amount_minor || attempt.currency === 'IDR' && !Number.isInteger(amount)) {
      throw new Error('Amount cannot be represented safely for this provider.')
    }
    const tokenResult = await this.signed('paymentToken', {
      merchantID: this.config.merchantId, invoiceNo: attempt.provider_invoice, description: 'SeatLink food order',
      amount, currencyCode: attempt.currency, paymentChannel: ['QR'], idempotencyID: attempt.id,
      backendReturnUrl: this.config.callbackUrl,
    })
    if (tokenResult.respCode !== '0000' || typeof tokenResult.paymentToken !== 'string') throw new ProviderError('PROVIDER_REQUEST_FAILED', 'Provider did not issue a payment token.')
    const response = await this.request(this.base + 'payment', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentToken: tokenResult.paymentToken, clientID: attempt.id, locale: 'en',
        payment: { code: { channelCode: this.config.channelCode } } }),
      signal: AbortSignal.timeout(15000), redirect: 'error',
    })
    if (!response.ok) throw new ProviderError('PROVIDER_REQUEST_FAILED', 'Provider QR request failed.')
    const qr = await response.json()
    if (qr.respCode !== '1005' || qr.type !== 'URL' || qr.channelCode !== this.config.channelCode ||
        !validQrImageUrl(qr.data)) {
      throw new ProviderError('INVALID_QR_DATA', 'Provider QR response needs channel configuration review.')
    }
    const expiryMs = qr.expiryTimer == null ? null : Number(qr.expiryTimer)
    if (expiryMs !== null && (!Number.isSafeInteger(expiryMs) || expiryMs <= 0 || expiryMs > 9999999999)) {
      throw new ProviderError('INVALID_QR_DATA', 'Provider QR expiry is invalid.')
    }
    return { paymentToken: tokenResult.paymentToken, imageUrl: qr.data, expiryMs }
  }
  async verifyCallback(envelope: unknown, attempt: ProviderAttempt) {
    if (!envelope || typeof envelope !== 'object' || !('payload' in envelope) || typeof envelope.payload !== 'string') throw new Error('Missing callback payload.')
    return verifyPaymentDetails(await verifyProviderJwt(envelope.payload, this.config.secret), attempt)
  }
  async inquire(attempt: ProviderAttempt) {
    return verifyPaymentDetails(await this.signed('paymentInquiry', {
      merchantID: this.config.merchantId, invoiceNo: attempt.provider_invoice, locale: 'en',
    }), attempt)
  }
}
