// The production provider boundary. The current development simulator uses the
// guarded SQL mock adapter. A 2C2P adapter must verify official provider messages
// before calling a trusted database transition. No real provider is configured.
export type PaymentRequest = {
  attemptId: string
  amountMinor: number
  currency: string
  merchantId: string
}

export type VerifiedPayment = PaymentRequest & {
  providerReference: string
  eventId: string
  outcome: 'SUCCESS' | 'FAILURE'
}

export interface PaymentProvider {
  createPayment(request: PaymentRequest): Promise<{ providerReference: string; qrContent: string; qrExpiresAt: string }>
  verifyCallback(rawBody: string, headers: Headers): Promise<VerifiedPayment>
  inquire(request: PaymentRequest): Promise<VerifiedPayment | null>
}
