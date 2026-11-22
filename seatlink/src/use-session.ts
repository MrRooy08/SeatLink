import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import type { SeatLinkClient } from './seat-data'

type SessionResult = { session: Session | null } | { error: true }

export function useSession(client: SeatLinkClient) {
  const [attempt, setAttempt] = useState(0)
  const [settled, setSettled] = useState<{ attempt: number; result: SessionResult }>()

  useEffect(() => {
    let active = true
    let receivedAuthChange = false
    const publish = (result: SessionResult) => {
      if (active) setSettled({ attempt, result })
    }

    const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
      if (event !== 'INITIAL_SESSION') {
        receivedAuthChange = true
        publish({ session })
      }
    })

    async function restore() {
      try {
        const { data, error } = await client.auth.getSession()
        if (!receivedAuthChange) publish(error ? { error: true } : { session: data.session })
      } catch {
        if (!receivedAuthChange) publish({ error: true })
      }
    }

    void restore()
    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [attempt, client])

  return {
    result: settled?.attempt === attempt ? settled.result : undefined,
    retry: () => setAttempt((previous) => previous + 1),
  }
}
