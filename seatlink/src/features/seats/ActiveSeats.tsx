import { useCallback, useEffect, useRef, useState } from 'react'
import type { SalesSnapshot } from '../../database.types'
import type { SeatLinkClient } from '../../seat-data'
import SeatMap from './SeatMap'
import { seatReference } from './seat-labels'
import { tableLabel, seatNumber } from './seat-labels'
import SeatDurationSelector from './SeatDurationSelector'
import { isActivationDuration, defaultActivationDuration } from './activation-duration'
import type { ActivationDuration } from './activation-duration'
import { useSeatOperations } from './useSeatOperations'
import styles from './ActiveSeats.module.css'

type Action = 'ACTIVATE' | 'RELEASE'
type Selection = { seatId: string; sessionId?: string; durationSeconds?: ActivationDuration }

export default function ActiveSeats({ client, snapshot, now, disabled, refresh, branchId }: {
  client: SeatLinkClient; snapshot: SalesSnapshot; now: number; disabled: boolean
  refresh: () => Promise<void>; branchId: string
}) {
  const operations = useSeatOperations(client, branchId, refresh)
  const [action, setAction] = useState<Action | null>(null)
  const [selection, setSelection] = useState<Selection[]>([])
  const [confirmRelease, setConfirmRelease] = useState(false)
  const [editor, setEditor] = useState<{seatId: string; from: 'chair' | 'badge'} | null>(null)
  const [knownAvailability, setKnownAvailability] = useState<string | null>(null)
  const activateButton = useRef<HTMLButtonElement>(null)
  const releaseButton = useRef<HTMLButtonElement>(null)
  const cancelButton = useRef<HTMLButtonElement>(null)
  const restoreFocus = useRef<Action | null>(null)
  const busy = disabled || operations.working
  const allocations = snapshot.allocations ?? []
  const seats = snapshot.tables.flatMap(table => table.seats.map(seat => ({ ...seat, table_number: table.table_number, table_label: table.display_label ?? tableLabel(table.table_number) })))
  const availableIds = seats.filter(seat => seat.status === 'AVAILABLE').map(seat => seat.id)
  const availability = JSON.stringify([...availableIds].sort())
  // Reconcile incoming server availability before rendering pending activation controls.
  // Release selections deliberately retain their captured session IDs.
  if (knownAvailability !== availability) {
    setKnownAvailability(availability)
    if (action === 'ACTIVATE') {
      setSelection(previous => previous.filter(item => availableIds.includes(item.seatId)))
      setEditor(previous => previous && !availableIds.includes(previous.seatId) ? null : previous)
    }
  }
  const releasable = allocations.filter(session => session.status === 'ACTIVE' && Date.parse(session.expires_at) > now &&
    seats.some(seat => seat.id === session.seat_id && seat.status === 'UNAVAILABLE'))
  const eligibleIds = action === 'ACTIVATE' ? availableIds : releasable.map(session => session.seat_id)
  const selectedIds = selection.map(item => item.seatId)
  const valid = selection.length > 0 && selection.every(item => eligibleIds.includes(item.seatId) &&
    (action !== 'ACTIVATE' || isActivationDuration(item.durationSeconds ?? defaultActivationDuration)) &&
    (action !== 'RELEASE' || releasable.some(session => session.id === item.sessionId && session.seat_id === item.seatId)))
  const references = selection.map(item => {
    const seat = seats.find(seat => seat.id === item.seatId)
    return seat ? action === 'ACTIVATE' ? `${seat.table_label}${seat.display_number ?? seatNumber(seat.label)} · ${(item.durationSeconds ?? defaultActivationDuration) / 60} min` : seatReference(seat.table_number, seat.label) : 'Seat no longer present'
  })
  const groupKeys = [...new Set(releasable.map(session => session.order_id ?? session.activation_request_id ?? session.id))]
  const closeEditor = useCallback(() => setEditor(null), [])
  const fallbackFocus = useCallback(() => cancelButton.current ?? activateButton.current, [])

  useEffect(() => {
    if (action) cancelButton.current?.focus()
    else if (restoreFocus.current) {
      (restoreFocus.current === 'ACTIVATE' ? activateButton : releaseButton).current?.focus()
      restoreFocus.current = null
    }
  }, [action])

  function finish() {
    restoreFocus.current = action
    setAction(null)
    setSelection([])
    setConfirmRelease(false)
    setEditor(null)
    operations.clearError()
  }

  function choose(next: Action) {
    if (action || busy) return
    setAction(next)
    setSelection([])
    setConfirmRelease(false)
    setEditor(null)
    operations.clearError()
  }

  function toggle(seatId: string) {
    if (busy) return
    setConfirmRelease(false)
    if (action === 'ACTIVATE') setEditor(selectedIds.includes(seatId) ? null : {seatId, from: 'chair'})
    setSelection(previous => previous.some(item => item.seatId === seatId) ? previous.filter(item => item.seatId !== seatId) :
      eligibleIds.includes(seatId) ? [...previous, { seatId, sessionId: action === 'RELEASE' ? releasable.find(session => session.seat_id === seatId)?.id : undefined,
        durationSeconds: action === 'ACTIVATE' ? defaultActivationDuration : undefined }] : previous)
  }

  async function submit() {
    if (!action || !valid || busy) return
    if (action === 'RELEASE' && !confirmRelease) { setConfirmRelease(true); return }
    setEditor(null)
    // Captured session IDs survive live updates: never substitute a newer occupant.
    const ids = action === 'ACTIVATE' ? selectedIds : selection.map(item => item.sessionId!)
    const durations = action === 'ACTIVATE' ? Object.fromEntries(selection.map(item => [item.seatId, item.durationSeconds ?? defaultActivationDuration])) : undefined
    if (await operations.submit(action, ids, durations)) finish()
  }

  return <section className={styles.workspace} aria-busy={operations.working}>
    <header className={styles.header}>
      <h2>Active seats</h2>
      <div className={styles.actions}>
        {!action && <button ref={activateButton} type="button" disabled={busy} onClick={() => choose('ACTIVATE')}>Activate seats</button>}
        {!action && <button ref={releaseButton} type="button" disabled={busy} onClick={() => choose('RELEASE')}>Release seats</button>}
        {action && <button ref={cancelButton} type="button" disabled={operations.working} onClick={finish}>Cancel</button>}
      </div>
    </header>

    <SeatMap tables={snapshot.tables} ownerNow={now} stale={disabled} selectedIds={action ? selectedIds : []} showCurrentOrder={false}
      selectionStyle="outline" eligibleIds={action ? eligibleIds : undefined}
      onToggle={action ? toggle : undefined} maxSeats={Infinity} disabled={busy}
      renderSeatDetails={action === 'ACTIVATE' ? (seatId, label, chairId) => {
        if (!eligibleIds.includes(seatId)) return null
        const selected = selection.find(item => item.seatId === seatId)
        const seat = seats.find(item => item.id === seatId)!
        return <SeatDurationSelector label={label} shortLabel={`${seat.table_label}${seat.display_number ?? seatNumber(seat.label)}`}
          chairId={chairId} selected={!!selected} value={selected?.durationSeconds ?? defaultActivationDuration}
          open={editor?.seatId === seatId && !!selected && !busy} from={editor?.from ?? 'chair'}
          onOpen={() => setEditor({seatId, from: 'badge'})} onClose={closeEditor} fallbackFocus={fallbackFocus}
          disabled={busy} onChange={duration => {
            if (busy) return
            setSelection(previous => previous.map(item => item.seatId === seatId ? { ...item, durationSeconds: duration } : item))
          }} />
      } : undefined} />

    {!action && !allocations.length && <p>No active seat-use sessions in this branch.</p>}
    {action === 'RELEASE' && <div className={styles.groups}>{groupKeys.map(key => {
      const group = releasable.filter(session => (session.order_id ?? session.activation_request_id ?? session.id) === key)
      if (group.length < 2) return null
      const selected = group.every(session => selection.some(item => item.sessionId === session.id))
      return <button key={key} type="button" aria-pressed={selected} disabled={busy} onClick={() => {
        setConfirmRelease(false)
        setSelection(previous => selected ? previous.filter(item => !group.some(session => session.seat_id === item.seatId)) :
          [...previous.filter(item => !group.some(session => session.seat_id === item.seatId)), ...group.map(session => ({ seatId: session.seat_id, sessionId: session.id }))])
      }}>{selected ? 'Deselect' : 'Select'} {group[0].order_id ? `order ${group[0].order_id.slice(0, 8)}` : 'activation'} · {group.length} seats</button>
    })}</div>}

    {operations.error && <p role="alert">{operations.error}</p>}
    {selection.length > 0 && !valid && <p role="alert">A selected seat changed or its session ended. Update your selection.</p>}
    {action && <section className={`${styles.actionBar} ${action === 'ACTIVATE' ? styles.activationBar : ''}`} aria-label="Selected seats">
      <div className={styles.selectionSummary}>
        {confirmRelease && <strong role="status">Release these seats?</strong>}
        <span role="status">{selection.length} {selection.length === 1 ? 'seat' : 'seats'} selected</span>
        {references.length > 0 && <p>{references.join(', ')}</p>}
      </div>
      <button type="button" className="primary" disabled={busy || !valid} onClick={() => void submit()}>
        {operations.working ? action === 'ACTIVATE' ? 'Activating…' : 'Releasing…' : confirmRelease ? 'Confirm seat release' :
          `${action === 'ACTIVATE' ? 'Activate' : 'Release'} ${selection.length} ${selection.length === 1 ? 'seat' : 'seats'}`}
      </button>
    </section>}
  </section>
}
