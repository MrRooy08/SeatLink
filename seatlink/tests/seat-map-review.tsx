// Vite development fixture only; not an entry point in the production build.
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../src/index.css'
import SeatMap from '../src/features/seats/SeatMap'
import type { MapTable } from '../src/features/seats/SeatMap'
import OrderSeatSummary from '../src/features/display/OrderSeatSummary'
import '../src/features/display/CustomerDisplay.css'
import styles from './SeatMapReview.module.css'

const tables: MapTable[] = Array.from({ length: 8 }, (_, index) => ({ id: `review-table-${index}`, table_number: index + 1,
  seats: ['A','B','C','D'].filter(label => index !== 7 || label === 'C').map(label => ({
    id: `review-seat-${index}-${label}`, label,
    status: index === 0 && label === 'B' || index === 2 && label === 'A' ? 'LOCKED' :
      index === 0 && label === 'C' || index === 3 && label === 'D' ? 'UNAVAILABLE' : 'AVAILABLE',
    current_order: index === 0 && label === 'B',
    expires_at: index === 0 && label === 'C' || index === 3 && label === 'D' ? new Date(Date.now()+8*60000).toISOString() : null,
  })) }))

export default function Review() {
  const [selected, setSelected] = useState(['review-seat-0-A'])
  const [now,setNow] = useState(() => Date.now())
  useEffect(() => { const timer=window.setInterval(()=>setNow(Date.now()),1000);return ()=>window.clearInterval(timer) },[])
  return <main className={styles.review}><h1>Seat-map review</h1><p>Development fixtures · No database requests or payments</p>
    <p aria-live="polite">{selected.length} of 4 seats selected. {selected.map(id => id.replace('review-seat-','')).join(', ') || 'No seats selected'}</p>
    <div className={styles.comparison}>
      <section><h2>Owner · Interactive</h2><SeatMap tables={tables} ownerNow={now} selectedIds={selected} onToggle={id => setSelected(previous => previous.includes(id)
        ? previous.filter(seat=>seat!==id) : previous.length<4 ? [...previous,id] : previous)} /></section>
      <section><h2>Customer · Read only</h2><div className="display-current"><h3>Your order</h3>
        <p>1 × Iced tea</p><p className="display-total">Total SGD 1.80</p>
        <OrderSeatSummary tables={tables} order={{ reference: 'review', status: 'DRAFT', checkout_step: 'SEATS',
          total_minor: 180, currency: 'SGD', items: [{ name: 'Iced tea', quantity: 1, unit_price_minor: 180 }],
          session_expires_at: null, payment_status: null, qr_expires_at: null, qr_text: null, allocations: [],
          selected_seats: tables.flatMap(table => table.seats.filter(seat => selected.includes(seat.id!))
            .map(seat => ({ table_number: table.table_number, label: seat.label }))),
        }} /><p>The seller is preparing your order.</p>
      </div></section>
    </div>
  </main>
}
if (import.meta.env.DEV) createRoot(document.getElementById('root')!).render(<Review />)
