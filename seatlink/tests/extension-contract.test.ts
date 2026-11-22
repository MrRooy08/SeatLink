import { expect, it } from 'vitest'
import { parseExtensionRequest } from '../supabase/functions/_shared/extension-contract'

const request = {
  requestId: 'bf000000-0000-4000-8000-000000000001',
  seatId: 'bf000000-0000-4000-8000-000000000002',
  seatUseSessionId: 'bf000000-0000-4000-8000-000000000003',
  additionalSeconds: 180,
}

it('accepts the hardware contract with positive whole-minute additions', () => {
  expect(parseExtensionRequest(request)).toEqual(request)
})

it('rejects malformed identity fields and unsafe or non-minute durations', () => {
  for (const seconds of [0, -60, 61, 60.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN]) {
    expect(() => parseExtensionRequest({ ...request, additionalSeconds: seconds })).toThrow()
  }
  expect(() => parseExtensionRequest({ ...request, requestId: 'invalid' })).toThrow()
  expect(() => parseExtensionRequest(null)).toThrow()
})
