import { createClient } from 'npm:@supabase/supabase-js@2.119.0'
import { parseExtensionRequest } from '../_shared/extension-contract.ts'

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return Response.json({ error: 'Use POST.' }, { status: 405 })
  const deviceToken = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? ''
  if (!/^[a-f0-9]{64}$/.test(deviceToken)) return Response.json({ error: 'Device access denied.' }, { status: 403 })
  let input
  try {
    input = parseExtensionRequest(await request.json())
  } catch {
    return Response.json({ error: 'Use valid IDs and a positive whole-minute duration.' }, { status: 400 })
  }
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_ANON_KEY')
  if (!url || !key) return Response.json({ error: 'Extension service is unconfigured.' }, { status: 503 })
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await client.rpc('extend_seat_use', {
    p_device_token: deviceToken,
    p_request_id: input.requestId,
    p_seat_id: input.seatId,
    p_session_id: input.seatUseSessionId,
    p_additional_seconds: input.additionalSeconds,
  })
  if (error) return Response.json({ error: error.code === '42501' ? 'Device access denied.' :
    'The extension was rejected. Verify the active session and request duration.' }, { status: error.code === '42501' ? 403 : 409 })
  return Response.json({ seatUseSessionId: input.seatUseSessionId, expiresAt: data })
})
