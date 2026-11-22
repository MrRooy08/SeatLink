export type ExtensionRequest = {
  requestId: string
  seatId: string
  seatUseSessionId: string
  additionalSeconds: number
}

export function parseExtensionRequest(value: unknown): ExtensionRequest {
  if (!value || typeof value !== 'object') throw new Error('Invalid extension request.')
  const request = value as Record<string, unknown>
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  for (const field of ['requestId', 'seatId', 'seatUseSessionId']) {
    if (typeof request[field] !== 'string' || !uuid.test(request[field])) throw new Error('Invalid session or request ID.')
  }
  if (typeof request.additionalSeconds !== 'number' || !Number.isSafeInteger(request.additionalSeconds) ||
      request.additionalSeconds <= 0 || request.additionalSeconds % 60 !== 0) {
    throw new Error('Additional time must be positive whole minutes within safe numeric range.')
  }
  return request as ExtensionRequest
}
