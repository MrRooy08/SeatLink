import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()

function isProjectUrl(value: string) {
  try {
    const parsed = new URL(value)
    return ['http:', 'https:'].includes(parsed.protocol) &&
      !parsed.username && !parsed.password && !parsed.search && !parsed.hash
  } catch {
    return false
  }
}

export const supabase =
  url && key && isProjectUrl(url) && key.startsWith('sb_publishable_') &&
    key !== 'sb_publishable_REPLACE_ME'
    && window.location.pathname.replace(/\/+$/, '') !== '/display' ? createClient<Database>(url, key)
    : null

export function createDisplayClient() {
  if (!url || !key || !isProjectUrl(url) || !key.startsWith('sb_publishable_') || key === 'sb_publishable_REPLACE_ME') return null
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'seatlink-display' },
  })
}
