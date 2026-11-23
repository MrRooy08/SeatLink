import { useCallback, useEffect, useState } from 'react'
import { loadBranches } from '../../seat-data'
import type { SeatLinkClient } from '../../seat-data'
import { useQuery } from '../../use-query'
import type { NavigationBlock } from '../sales/Sales'

const branchFromUrl = () => new URL(window.location.href).searchParams.get('branch')

export function useBranchSelection(client: SeatLinkClient, freshLogin: boolean) {
  const [requestedBranch, setRequestedBranch] = useState(() => freshLogin ? null : branchFromUrl())
  const [navigationBlock, setNavigationBlock] = useState<NavigationBlock>(null)
  const [message, setMessage] = useState('')
  const [switching, setSwitching] = useState(false)
  const load = useCallback((signal: AbortSignal) => loadBranches(client, signal), [client])
  const query = useQuery(load)
  const branches = query.result && 'data' in query.result ? query.result.data : []
  const requested = branches.find(branch => branch.id === requestedBranch)
  const branch = requested ?? (branches.length === 1 ? branches[0] : undefined)

  useEffect(() => {
    if (freshLogin) {
      const url = new URL(window.location.href)
      url.searchParams.delete('branch')
      window.history.replaceState(null, '', url)
    }
  }, [freshLogin])

  useEffect(() => {
    if (!branch) return
    const url = new URL(window.location.href)
    if (url.searchParams.get('branch') !== branch.id) {
      url.searchParams.set('branch', branch.id)
      window.history.replaceState(null, '', url)
    }
  }, [branch])

  useEffect(() => {
    const sync = () => {
      const next = branchFromUrl()
      if (navigationBlock && next !== navigationBlock.branchId) {
        const url = new URL(window.location.href)
        url.searchParams.set('branch', navigationBlock.branchId)
        window.history.replaceState(null, '', url)
        setMessage(navigationBlock.message)
      } else { setRequestedBranch(next); setMessage('') }
    }
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [navigationBlock])

  function select(id: string) {
    if (!branches.some(option => option.id === id)) return false
    if (navigationBlock && id !== navigationBlock.branchId) { setMessage(navigationBlock.message); return false }
    const url = new URL(window.location.href)
    url.searchParams.set('branch', id)
    window.history.pushState(null, '', url)
    setRequestedBranch(id); setMessage(''); setSwitching(false)
    return true
  }
  return { ...query, branches, branch, requestedBranch, invalidBranch: !!requestedBranch && !requested, message,
    setNavigationBlock, modalOpen: switching || branches.length > 1 && !branch,
    open: () => { setMessage(''); setSwitching(true) }, close: () => { setMessage(''); setSwitching(false) }, select }
}
