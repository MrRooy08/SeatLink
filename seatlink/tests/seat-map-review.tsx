// Vite development fixture only; not an entry point in the production build.
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../src/index.css'
import SeatMap from '../src/features/seats/SeatMap'
import type { MapTable } from '../src/features/seats/SeatMap'
import styles from './SeatMapReview.module.css'

const tables: MapTable[] = Array.from({ length: 8 }, (_, index) => ({ id: `review-table-${index}`, table_number: index + 1,
  seats: ['A','B','C','D'].filter(label => index !== 7 || label === 'C').map(label => ({
    id: `review-seat-${index}-${label}`, label,
    status: index === 0 && label === 'B' || index === 2 && label === 'A' ? 'LOCKED' :
      index === 0 && label === 'C' || index === 3 && label === 'D' ? 'UNAVAILABLE' : 'AVAILABLE',
    current_order: index === 0 && label === 'B',
  })) }))

export default function Review() {
  const [selected, setSelected] = useState(['review-seat-0-A'])
  return <main className={styles.review}><h1>Seat-map review</h1><p>Development fixtures · No database requests or payments</p>
    <p aria-live="polite">{selected.length} of 4 seats selected. {selected.map(id => id.replace('review-seat-','')).join(', ') || 'No seats selected'}</p>
    <div className={styles.comparison}>
      <section><h2>Owner · Interactive</h2><SeatMap tables={tables} selectedIds={selected} onToggle={id => setSelected(previous => previous.includes(id)
        ? previous.filter(seat=>seat!==id) : previous.length<4 ? [...previous,id] : previous)} /></section>
      <section><h2>Customer · Read only</h2><SeatMap tables={tables} selectedIds={selected} /></section>
    </div>
  </main>
}
if (import.meta.env.DEV) createRoot(document.getElementById('root')!).render(<Review />)
