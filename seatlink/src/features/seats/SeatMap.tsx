import { useId } from 'react'
import Icon from '../../components/Icon'
import type { SeatStatus } from '../../database.types'
import styles from './SeatMap.module.css'

export type MapTable = { id?: string; table_number: number; seats: {
  id?: string; label: string; status: SeatStatus; current_order?: boolean
}[] }
const statusLabel = { AVAILABLE: 'Available', LOCKED: 'Awaiting payment', UNAVAILABLE: 'Occupied' }
const sides = ['north', 'east', 'south', 'west'] as const
const seatSide = (label: string, index: number) => {
  const known = ['A', 'B', 'C', 'D'].indexOf(label.toUpperCase())
  return (known < 0 ? index : known) % 4
}

export default function SeatMap({ tables, selectedIds = [], onToggle, disabled = false, maxSeats = 4 }: {
  tables: MapTable[]; selectedIds?: string[]; onToggle?: (id: string) => void; disabled?: boolean; maxSeats?: number
}) {
  const prefix = useId()
  return <div className={`${styles.map} ${!onToggle ? styles.readOnly : ''}`}>
    <ul className={styles.legend} aria-label="Seat status legend">
      <li><span className={`${styles.swatch} ${styles.available}`} />Available</li>
      <li><span className={`${styles.swatch} ${styles.selected}`}>✓</span>Selected</li>
      <li><span className={`${styles.swatch} ${styles.locked}`}><Icon name="timer" /></span>Awaiting payment</li>
      <li><span className={`${styles.swatch} ${styles.occupied}`}><Icon name="person" /></span>Occupied</li>
      <li><span className={styles.currentSwatch}>✓</span>This order</li>
    </ul>
    {!tables.length && <p>No tables configured for this branch.</p>}
    <div className={styles.tables}>{tables.map(table => <article className={styles.tableCard} key={table.id ?? table.table_number} aria-label={`Table ${table.table_number}`}>
      <div className={styles.layout}>
        <div className={styles.table}><h3 aria-label={`Table ${table.table_number}`}>T{table.table_number}</h3></div>
        {sides.map((side, sideIndex) => <div className={styles[side]} key={side}>{table.seats.filter((seat, index) => seatSide(seat.label, index) === sideIndex).map(seat => {
          const selected = !!seat.current_order || !!seat.id && selectedIds.includes(seat.id)
          const label = `Table ${table.table_number} seat ${seat.label}`
          const statusId = `${prefix}-${table.id ?? table.table_number}-${seat.id ?? seat.label}`
          const className = `${styles.seat} ${styles[seat.status === 'AVAILABLE' ? 'available' : seat.status === 'LOCKED' ? 'locked' : 'occupied']} ${selected ? seat.status === 'AVAILABLE' ? styles.selected : styles.current : ''}`
          const description = `${label} · ${statusLabel[seat.status]}${selected ? onToggle && seat.status === 'AVAILABLE' ? ' · Selected' : ' · This order' : ''}`
          const content = <><span className={styles.chair} aria-hidden="true"><span className={styles.backrest} />
            <span className={styles.cushion}><strong>{seat.label}</strong></span><span className={styles.legs} />
            <span className={styles.statusIcon}><Icon name={seat.status === 'LOCKED' ? 'timer' : seat.status === 'UNAVAILABLE' ? 'person' : 'success'} /></span>
            {selected && <span className={styles.check}>✓</span>}</span>
            <span id={statusId} className={styles.tooltip} role="tooltip">{description}</span></>
          return onToggle ? <button type="button" key={seat.id ?? seat.label} className={className} aria-label={label}
            aria-describedby={statusId} aria-pressed={selected} disabled={disabled || !seat.id ||
              (!selected && (seat.status !== 'AVAILABLE' || selectedIds.length >= maxSeats))}
            onClick={() => seat.id && onToggle(seat.id)}>{content}</button> :
            <div key={seat.id ?? seat.label} className={className} role="group" aria-label={label} aria-describedby={statusId} tabIndex={0}>{content}</div>
        })}</div>)}
      </div>
    </article>)}</div>
  </div>
}
