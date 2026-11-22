import { useState } from 'react'
import type { FormEvent } from 'react'
import { isAuthRetryableFetchError } from '@supabase/supabase-js'
import Owner from './Owner'
import type { SeatLinkClient } from './seat-data'
import { supabase } from './supabase'
import { useSession } from './use-session'
import './App.css'
import CustomerDisplay from './features/display/CustomerDisplay'

function SignIn({ client }: { client: SeatLinkClient }) {
  const [working, setWorking] = useState(false)
  const [message, setMessage] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    const email = String(fields.get('email')).trim()
    const password = String(fields.get('password'))
    setMessage('')
    setWorking(true)

    try {
      const { error } = await client.auth.signInWithPassword({ email, password })
      if (!error) return

      if (error.code === 'invalid_credentials') setMessage('The email or password is incorrect.')
      else if (error.code === 'email_not_confirmed') setMessage('Ask your SeatLink administrator to confirm this email address.')
      else if (isAuthRetryableFetchError(error)) setMessage('Couldn’t reach Supabase. Check your connection and try again.')
      else setMessage('Couldn’t sign in. Try again in a moment.')
    } catch {
      setMessage('Couldn’t reach Supabase. Check your connection and try again.')
    } finally {
      setWorking(false)
    }
  }

  return (
    <section className="session-card" aria-labelledby="sign-in-title">
      <h1 id="sign-in-title">Owner sign-in</h1>
      <p>Sign in to view seating at your branches.</p>
      <form onSubmit={submit}>
        <label>Email address<input name="email" type="email" autoComplete="username" required /></label>
        <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
        {message && <p role="alert">{message}</p>}
        <button className="primary" type="submit" disabled={working}>
          {working ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </section>
  )
}

function Workspace({ client }: { client: SeatLinkClient }) {
  const { result, retry } = useSession(client)
  const session = result && 'session' in result ? result.session : null
  const [signingOut, setSigningOut] = useState(false)
  const [signOutFailedFor, setSignOutFailedFor] = useState<string>()
  const metadata = session?.user.user_metadata
  const displayName = metadata?.display_name ?? metadata?.full_name

  async function signOut(userId: string) {
    setSigningOut(true)
    setSignOutFailedFor(undefined)
    try {
      const { error } = await client.auth.signOut({ scope: 'local' })
      if (error) setSignOutFailedFor(userId)
    } catch {
      setSignOutFailedFor(userId)
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <>
      <header className="site-header">
        <div className="shell header-content">
          <span className="wordmark"><span aria-hidden="true" className="brand-mark" />SeatLink</span>
          {session && (
            <div className="signed-in-controls">
              <span>{typeof displayName === 'string' && displayName.trim() ? displayName : session.user.email}</span>
            <button type="button" onClick={() => void signOut(session.user.id)} disabled={signingOut}>
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
            </div>
          )}
        </div>
      </header>
      <main className="shell">
        {!result && <p className="notice" role="status">Restoring your session…</p>}
        {result && 'error' in result && (
          <div className="notice">
            <p role="alert">Couldn’t restore your session. Check your connection and try again.</p>
            <button type="button" onClick={retry}>Retry</button>
          </div>
        )}
        {result && 'session' in result && !session && <SignIn client={client} />}
        {session && (
          <>
            {signOutFailedFor === session.user.id && (
              <p className="notice" role="alert">Couldn’t sign out. Check your connection and try again.</p>
            )}
            <Owner key={session.user.id} client={client} />
          </>
        )}
      </main>
    </>
  )
}

export default function App() {
  if (window.location.pathname.replace(/\/+$/, '') === '/display') return <CustomerDisplay />
  if (supabase) return <Workspace client={supabase} />

  return (
    <main className="shell">
      <section className="session-card">
        <h1>Set up SeatLink</h1>
        <p role="alert">
          Add a valid <code>SUPABASE_URL</code> and <code>SUPABASE_PUBLISHABLE_KEY</code> to{' '}
          <code>.env.local</code>, then restart Vite.
        </p>
      </section>
    </main>
  )
}
