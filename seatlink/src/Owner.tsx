import { useCallback, useEffect, useState } from 'react'
import Sales from './features/sales/Sales'
import type { NavigationBlock } from './features/sales/Sales'
import { loadBranches } from './seat-data'
import type { SeatLinkClient } from './seat-data'
import { useQuery } from './use-query'

function branchFromUrl() {
  return new URL(window.location.href).searchParams.get('branch')
}

export default function Owner({ client }: { client: SeatLinkClient }) {
  const [requestedBranch, setRequestedBranch] = useState(branchFromUrl)
  const [navigationBlock, setNavigationBlock] = useState<NavigationBlock>(null)
  const [navigationMessage, setNavigationMessage] = useState('')
  const load = useCallback((signal: AbortSignal) => loadBranches(client, signal), [client])
  const { result, retry } = useQuery(load)

  useEffect(() => {
    const syncBranch = () => {
      const next = branchFromUrl()
      if (navigationBlock && next !== navigationBlock.branchId) {
        const url = new URL(window.location.href)
        url.searchParams.set('branch', navigationBlock.branchId)
        window.history.replaceState(null, '', url)
        setNavigationMessage(navigationBlock.message)
      } else {
        setRequestedBranch(next)
        setNavigationMessage('')
      }
    }
    window.addEventListener('popstate', syncBranch)
    return () => window.removeEventListener('popstate', syncBranch)
  }, [navigationBlock])

  function selectBranch(id: string) {
    if (navigationBlock && id !== navigationBlock.branchId) {
      setNavigationMessage(navigationBlock.message)
      return
    }
    setNavigationMessage('')
    const url = new URL(window.location.href)
    if (id) url.searchParams.set('branch', id)
    else url.searchParams.delete('branch')
    window.history.pushState(null, '', url)
    setRequestedBranch(id || null)
  }

  if (!result) return <p className="notice" role="status">Loading branches…</p>
  if ('error' in result) {
    return (
      <div className="notice">
        <p role="alert">Couldn’t load your branches. Check your connection and try again.</p>
        <button type="button" onClick={retry}>Retry</button>
      </div>
    )
  }

  const branches = result.data
  if (!branches.length) {
    return (
      <div className="notice">
        <h1>No branches assigned</h1>
        <p>Ask your SeatLink administrator to check your organisation membership and branch setup.</p>
        <button type="button" onClick={retry}>Check again</button>
      </div>
    )
  }

  const requested = branches.find((branch) => branch.id === requestedBranch)
  const branch = requested ?? (branches.length === 1 ? branches[0] : undefined)

  return (
    <>
      <div className="owner-heading">
        <div>
          {branch && <p className="organisation">{branch.organisation.name}</p>}
          <h1>{branch?.name ?? 'Choose a branch'}</h1>
        </div>
        {branches.length > 1 && (
          <label className="branch-picker">
            Branch
            <select value={branch?.id ?? ''} onChange={(event) => selectBranch(event.target.value)}>
              <option value="">Choose a branch</option>
              {branches.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name} · {option.organisation.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {navigationMessage && navigationBlock && <p className="notice" role="alert">{navigationBlock.message}</p>}
      {requestedBranch && !requested && (
        <p className="notice" role="status">
          The branch in this link is unavailable to your account.
        </p>
      )}
      {branch && <Sales key={branch.id} client={client} branchId={branch.id} setNavigationBlock={setNavigationBlock} />}
    </>
  )
}
