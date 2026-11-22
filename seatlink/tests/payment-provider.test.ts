import { expect, it, vi } from 'vitest'
import { parseMinorUnits } from '../src/features/checkout/money'
import { TwoC2PSandbox, amountToMinor, signProviderJwt, verifyProviderJwt, verifyPaymentDetails, validQrImageUrl } from '../supabase/functions/_shared/two-c2p'

const attempt = { id: 'request-1', provider_invoice: 'a123', merchant_id: 'merchant', amount_minor: 180, currency: 'SGD' }
const config = { mode: 'SANDBOX', merchantId: 'merchant', secret: 'test-secret', channelCode: 'TESTQR', callbackUrl: 'https://example.test/callback' }
const details = { merchantID: 'merchant', invoiceNo: 'a123', amount: '1.8000', currencyCode: 'SGD', referenceNo: 'provider-ref', respCode: '0000' }

it('parses exact currency units and rejects excessive precision and unsafe values', () => {
  expect(parseMinorUnits('1.80', 'SGD')).toBe(180)
  expect(parseMinorUnits('3', 'JPY')).toBe(3)
  for (const value of ['1.001', '-1', '1e3', '9007199254740992']) expect(parseMinorUnits(value, 'SGD')).toBeNull()
  expect(amountToMinor('1.8000', 'SGD')).toBe(180)
  expect(() => amountToMinor('1.8001', 'SGD')).toThrow(/precision/)
})

it('authenticates signed messages and matches every financial field before success', async () => {
  const token = await signProviderJwt(details, config.secret)
  expect(await verifyProviderJwt(token, config.secret)).toEqual(details)
  await expect(verifyProviderJwt(token, 'wrong-secret')).rejects.toThrow(/signature/)
  const provider = new TwoC2PSandbox(config)
  expect((await provider.verifyCallback({ payload: token }, attempt)).outcome).toBe('SUCCESS')
  for (const change of [{ merchantID: 'other' }, { invoiceNo: 'other' }, { amount: '1.81' }, { currencyCode: 'USD' }, { referenceNo: '' }]) {
    expect(() => verifyPaymentDetails({ ...details, ...change }, attempt)).toThrow()
  }
  expect(verifyPaymentDetails({ ...details, respCode: '2002' }, attempt).outcome).toBe('PENDING')
  expect(verifyPaymentDetails({ ...details, respCode: '0003' }, attempt).outcome).toBe('CANCELLED')
})

it('uses the signed sandbox token and documented QR request without enabling live mode', async () => {
  const request = vi.fn<typeof fetch>()
  request.mockResolvedValueOnce(Response.json({ payload: await signProviderJwt({ respCode: '0000', paymentToken: 'private-token' }, config.secret) }))
    .mockResolvedValueOnce(Response.json({ respCode: '1005', type: 'URL', channelCode: config.channelCode,
      data: 'https://pgw-static-sandbox.s3.amazonaws.com/images/qr/example.png' }))
  const result = await new TwoC2PSandbox(config, request).createQr(attempt)
  expect(result.paymentToken).toBe('private-token')
  const tokenRequest = JSON.parse(request.mock.calls[0][1]!.body as string)
  const payload = await verifyProviderJwt(tokenRequest.payload, config.secret)
  expect(payload).toMatchObject({ merchantID: 'merchant', invoiceNo: 'a123', amount: 1.8, paymentChannel: ['QR'] })
  expect(request.mock.calls[0][0]).toBe('https://sandbox-pgw.2c2p.com/payment/4.5/paymentToken')
  expect(JSON.parse(request.mock.calls[1][1]!.body as string)).toMatchObject({ paymentToken: 'private-token', payment: { code: { channelCode: 'TESTQR' } } })
  expect(() => new TwoC2PSandbox({ ...config, mode: 'LIVE' }, request)).toThrow(/Live mode is disabled/)
})

it('maps the documented API QR image and millisecond expiry without encoding the URL', async () => {
  const request = vi.fn<typeof fetch>()
  request.mockResolvedValueOnce(Response.json({ payload: await signProviderJwt({ respCode: '0000', paymentToken: 'token' }, config.secret) }))
    .mockResolvedValueOnce(Response.json({ respCode: '1005', type: 'URL', channelCode: config.channelCode,
      data: 'https://api.2c2p.com/pgw/qr/example.png', expiryTimer: '60000' }))
  expect(await new TwoC2PSandbox(config, request).createQr(attempt)).toEqual({ paymentToken: 'token', imageUrl: 'https://api.2c2p.com/pgw/qr/example.png', expiryMs: 60000 })
  for (const value of ['http://api.2c2p.com/pgw/qr/test.png', 'https://api.2c2p.com.attacker.test/pgw/qr/test.png',
    'https://user@api.2c2p.com/pgw/qr/test.png', 'https://api.2c2p.com:444/pgw/qr/test.png', 'https://api.2c2p.com/authenticate/test']) expect(validQrImageUrl(value)).toBe(false)
})

it('distinguishes a missing QR image from a rejected provider request', async () => {
  const request = vi.fn<typeof fetch>()
  request.mockResolvedValueOnce(Response.json({ payload: await signProviderJwt({ respCode: '0000', paymentToken: 'token' }, config.secret) }))
    .mockResolvedValueOnce(Response.json({ respCode: '1005', type: 'URL', channelCode: config.channelCode, data: 'not-an-image-url' }))
  await expect(new TwoC2PSandbox(config, request).createQr(attempt)).rejects.toMatchObject({ code: 'INVALID_QR_DATA' })
  request.mockResolvedValueOnce(new Response('', { status: 503 }))
  await expect(new TwoC2PSandbox(config, request).createQr(attempt)).rejects.toMatchObject({ code: 'PROVIDER_REQUEST_FAILED' })
})
