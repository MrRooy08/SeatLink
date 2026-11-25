import { useId } from 'react'
import type { ReactNode } from 'react'
import Icon from '../../components/Icon'
import type { SeatStatus } from '../../database.types'
import styles from './SeatMap.module.css'
import { tableLabel, seatNumber } from './seat-labels'
import { countdown } from '../checkout/checkout-state'

export type MapTable = { id?: string; table_number: number; display_label?: string; seats: {
  id?: string; label: string; status: SeatStatus; current_order?: boolean; display_number?: number; position?: string; expires_at?: string | null
}[] }
const statusLabel = { AVAILABLE: 'Available', LOCKED: 'Awaiting payment', UNAVAILABLE: 'Occupied' }
const sides = ['north', 'east', 'south', 'west'] as const
const seatSide = (label: string, index: number) => {
  const known = ['A', 'B', 'C', 'D'].indexOf(label.toUpperCase())
  return (known < 0 ? index : known) % 4
}

export default function SeatMap({ tables, selectedIds = [], onToggle, disabled = false, maxSeats = 4, ownerNow, stale = false,
  eligibleIds, selectionStyle = 'status', showCurrentOrder = true, renderSeatDetails }: {
  tables: MapTable[]; selectedIds?: string[]; onToggle?: (id: string) => void; disabled?: boolean; maxSeats?: number; ownerNow?: number; stale?: boolean
  eligibleIds?: string[]; selectionStyle?: 'status' | 'outline'
  showCurrentOrder?: boolean
  renderSeatDetails?: (seatId: string, label: string, chairId: string) => ReactNode
}) {
  const prefix = useId()
  return <div className={`${styles.map} ${!onToggle ? styles.readOnly : ''}`}>
    <ul className={styles.legend} aria-label="Seat status legend">
      <li><span className={`${styles.swatch} ${styles.available}`} />Available</li>
      <li><span className={`${styles.swatch} ${selectionStyle === 'outline' ? styles.outlineSwatch : styles.selected}`}>✓</span>Selected</li>
      <li><span className={`${styles.swatch} ${styles.locked}`}><Icon name="timer" /></span>Awaiting payment</li>
      <li><span className={`${styles.swatch} ${styles.occupied}`}><Icon name="person" /></span>Occupied</li>
      {showCurrentOrder && <li><span className={styles.currentSwatch}>✓</span>This order</li>}
    </ul>
    {!tables.length && <p>No tables configured for this branch.</p>}
    <div className={styles.tables}>{tables.map(table => <article className={styles.tableCard} key={table.id ?? table.table_number} aria-label={`Table ${table.display_label ?? tableLabel(table.table_number)}`}>
      <div className={styles.layout}>
        <div className={styles.table}><h3 aria-label={`Table ${table.display_label ?? tableLabel(table.table_number)}`}>{table.display_label ?? tableLabel(table.table_number)}</h3></div>
        {sides.map((side, sideIndex) => <div className={styles[side]} key={side}>{table.seats.filter((seat, index) => seat.position ? seat.position === side : seatSide(seat.label, index) === sideIndex).map(seat => {
          const outlined = selectionStyle === 'outline'
          const currentOrder = showCurrentOrder && !!seat.current_order
          const selected = (currentOrder && !outlined) || !!seat.id && selectedIds.includes(seat.id)
          const eligible = eligibleIds ? !!seat.id && eligibleIds.includes(seat.id) : seat.status === 'AVAILABLE'
          const label = `Table ${table.display_label ?? tableLabel(table.table_number)} · Seat ${seat.display_number ?? seatNumber(seat.label)}`
          const statusId = `${prefix}-${table.id ?? table.table_number}-${seat.id ?? seat.label}`
          const chairId = `${statusId}-chair`
          const className = `${styles.seat} ${styles[seat.status === 'AVAILABLE' ? 'available' : seat.status === 'LOCKED' ? 'locked' : 'occupied']} ${selected ? outlined ? styles.operationSelected : seat.status === 'AVAILABLE' ? styles.selected : styles.current : ''} ${outlined && currentOrder && !selected ? styles.current : ''} ${onToggle && eligibleIds && !eligible ? styles.ineligible : ''}`
          const description = `${label} · ${statusLabel[seat.status]}${selected ? outlined || onToggle && seat.status === 'AVAILABLE' ? ' · Selected' : ' · This order' : ''}${outlined && currentOrder ? ' · This order' : ''}${onToggle && eligibleIds && !eligible ? ' · Not eligible for this action' : ''}`
          const content = <><span className={styles.chair} aria-hidden="true"><span className={styles.backrest} />
            <span className={styles.cushion}><strong>{seat.display_number ?? seatNumber(seat.label)}</strong></span><span className={styles.legs} />
            <span className={styles.statusIcon}><Icon name={seat.status === 'LOCKED' ? 'timer' : seat.status === 'UNAVAILABLE' ? 'person' : 'success'} /></span>
            {(selected || outlined && currentOrder) && <span className={`${styles.check} ${selected && outlined ? styles.operationCheck : ''}`}>✓</span>}</span>
            <span id={statusId} className={styles.tooltip} role="tooltip">{description}</span></>
          const control = onToggle ? <button id={chairId} type="button" className={className} aria-label={label}
            aria-describedby={statusId} aria-pressed={selected} disabled={disabled || !seat.id ||
              (!selected && (!eligible || selectedIds.length >= maxSeats))}
            onClick={() => seat.id && onToggle(seat.id)}>{content}</button> :
            <div id={chairId} className={className} role="group" aria-label={label} aria-describedby={statusId} tabIndex={0}>{content}</div>
          return <div key={seat.id ?? seat.label} className={styles.seatSlot}>
            {control}
            {ownerNow !== undefined && seat.status === 'UNAVAILABLE' && seat.expires_at && <span className={styles.countdown} aria-label={`Seat time remaining for ${label}`}>
              {stale || Date.parse(seat.expires_at) <= ownerNow ? 'Sync…' : countdown(seat.expires_at, ownerNow).padStart(5, '0')}
            </span>}
            {seat.id && renderSeatDetails?.(seat.id, label, chairId)}
          </div>
        })}</div>)}
      </div>
    </article>)}</div>
  </div>
}
