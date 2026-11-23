import type { SalesSnapshot } from '../../database.types'
import type { useCheckout } from './useCheckout'
import SeatMap from '../seats/SeatMap'

export default function SeatSelection({ snapshot, checkout, disabled, back }: {
  snapshot: SalesSnapshot; checkout: ReturnType<typeof useCheckout>; disabled: boolean; back: () => void
}) {
  const { selected, setSelected } = checkout
  const seats = snapshot.tables.flatMap((table) => table.seats.map((seat) => ({ ...seat, table_number: table.table_number })))
  const conflict = selected.some((id) => !seats.some((seat) => seat.id === id && seat.status === 'AVAILABLE'))
  const busy = disabled || checkout.working
  function toggle(id: string) {
    setSelected((previous) => previous.includes(id) ? previous.filter((value) => value !== id) :
      previous.length < 4 ? [...previous, id] : previous)
  }
  return <section aria-label="Seat selection">
    <h2>Choose individual seats</h2>
    <p>{seats.filter((seat) => seat.status === 'AVAILABLE').length} of {seats.length} seats available</p>
    <p role="status">{selected.length} of 4 seats selected</p>
    {selected.length === 4 && <p>Four seats are selected. Deselect one to choose another.</p>}
    <p className="form-help">Choose up to four seats, or continue without seats. Your checkout session lasts five minutes.</p>
    {conflict && <p role="alert">A selected seat is no longer available. Remove it from your selection and choose a replacement.</p>}
    <ul className="selected-seat-list">{selected.map((id) => {
      const seat = seats.find((item) => item.id === id)
      return <li key={id}>{seat ? `Table ${seat.table_number} / Seat ${seat.label}` : 'Seat no longer present'}
        <button type="button" disabled={busy} onClick={() => toggle(id)}>Remove selected seat {seat?.label}</button></li>
    })}</ul>
    <SeatMap tables={snapshot.tables} selectedIds={selected} onToggle={toggle} disabled={busy} />
    <div className="action-row">
      <button type="button" disabled={busy} onClick={back}>Back to menu</button>
      <button type="button" disabled={busy || checkout.changed} onClick={checkout.skipSeats}>Continue without seats</button>
      <button type="button" className="primary" disabled={busy || conflict || !selected.length || checkout.changed}
        onClick={checkout.reserve}>{checkout.working ? 'Reserving…' : 'Confirm seats'}</button>
    </div>
  </section>
}
