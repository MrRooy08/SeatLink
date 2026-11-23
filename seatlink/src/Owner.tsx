import type { SeatLinkClient } from './seat-data'
import { useBranchSelection } from './features/branches/useBranchSelection'
import BranchSelectionModal from './features/branches/BranchSelectionModal'
import BranchWorkspace from './features/branches/BranchWorkspace'

export default function Owner({ client, freshLogin = false }: { client: SeatLinkClient; freshLogin?: boolean }) {
  const selection = useBranchSelection(client, freshLogin)
  if (!selection.result) return <p className="notice" role="status">Loading branches…</p>
  if ('error' in selection.result) return <div className="notice"><p role="alert">Couldn’t load your branches. Check your connection and try again.</p>
    <button type="button" onClick={selection.retry}>Retry</button></div>
  if (!selection.branches.length) return <div className="notice"><h1>No branches assigned</h1>
    <p>Ask your SeatLink administrator to check your organisation membership and branch setup.</p><button type="button" onClick={selection.retry}>Check again</button></div>
  return <>
    {!selection.branch && <h1>Choose a branch</h1>}
    {selection.invalidBranch && <p className="notice" role="status">The branch in this link is unavailable to your account.</p>}
    {selection.message && !selection.modalOpen && <p className="notice" role="alert">{selection.message}</p>}
    {selection.branch && <BranchWorkspace client={client} branch={selection.branch} onSwitch={selection.open} setNavigationBlock={selection.setNavigationBlock} />}
    {selection.modalOpen && <BranchSelectionModal branches={selection.branches} currentId={selection.branch?.id}
      message={selection.message} onContinue={selection.select} onClose={selection.close} />}
  </>
}
