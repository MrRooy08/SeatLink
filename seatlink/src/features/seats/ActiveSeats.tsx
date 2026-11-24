import { useState } from 'react'
import type { SalesSnapshot, SeatUse } from '../../database.types'
import type { SeatLinkClient } from '../../seat-data'
import SeatMap from './SeatMap'
import { seatReference } from './seat-labels'
import { useSeatOperations } from './useSeatOperations'
import styles from './ActiveSeats.module.css'
import { currentOrderSeatIds } from './order-seat-map'

export default function ActiveSeats({client,snapshot,now,disabled,refresh,branchId}:{
 client:SeatLinkClient;snapshot:SalesSnapshot;now:number;disabled:boolean;refresh:()=>Promise<void>;branchId:string
}) {
 const operations=useSeatOperations(client,branchId,refresh)
 const [activating,setActivating]=useState(false)
 const [seats,setSeats]=useState<string[]>([])
 const [selected,setSelected]=useState<string[]>([])
 const [confirmation,setConfirmation]=useState<SeatUse[]>([])
 const [confirmActivation,setConfirmActivation]=useState(false)
 const busy=disabled||operations.working
 const allocations=snapshot.allocations??[]
 const groups=[...new Set(allocations.map(session=>session.order_id??session.activation_request_id??'standalone'))]
 return <section className={styles.workspace}>
  <header className={styles.header}><h2>Active seats</h2><button type="button" disabled={busy} onClick={()=>{setActivating(!activating);setSeats([])}}>Activate seats</button></header>
  {activating && <section aria-label="Activate seats"><h3>Choose available seats</h3><p>{seats.length} selected · Ten minutes per seat</p>
   <SeatMap tables={snapshot.tables} ownerNow={now} stale={disabled} selectedIds={seats} maxSeats={Infinity} disabled={busy}
    onToggle={id=>setSeats(previous=>previous.includes(id)?previous.filter(value=>value!==id):[...previous,id])}/>
   <button type="button" disabled={busy||!seats.length} onClick={()=>setConfirmActivation(true)}>Activate selected seats</button>
   {confirmActivation && <div className={styles.confirmation} role="region" aria-label="Confirm activation"><p>Start ten minutes for {seats.length} seats?</p>
    <button type="button" disabled={busy} onClick={()=>void operations.submit('ACTIVATE',seats).then(ok=>{if(ok){setSeats([]);setConfirmActivation(false);setActivating(false)}})}>Confirm activation</button>
    <button type="button" disabled={busy} onClick={()=>setConfirmActivation(false)}>Keep choosing</button></div>}
  </section>}
  {!activating && <SeatMap tables={snapshot.tables} ownerNow={now} stale={disabled} selectedIds={currentOrderSeatIds(snapshot)}/>}
  {!allocations.length && <p>No active seat-use sessions in this branch.</p>}
  {groups.map(key=>{const group=allocations.filter(session=>(session.order_id??session.activation_request_id??'standalone')===key)
   return <section key={key}><h3>{group[0].order_id?`Order ${group[0].order_id.slice(0,8)}`:'Owner activation'}</h3>
    {group.map(session=><div className={styles.row} key={session.id}><label><input type="checkbox" checked={selected.includes(session.id)} disabled={busy}
     onChange={event=>setSelected(previous=>event.target.checked?[...previous,session.id]:previous.filter(id=>id!==session.id))}/>{seatReference(session.table_number,session.label)}</label>
     <button type="button" disabled={busy} onClick={()=>setConfirmation([session])}>Release this seat</button></div>)}
    <button type="button" disabled={busy} onClick={()=>setConfirmation(group)}>{group[0].order_id?'Release all seats for this order':'Release activation seats'}</button>
   </section>})}
  {!!selected.length&&<button type="button" disabled={busy} onClick={()=>setConfirmation(allocations.filter(session=>selected.includes(session.id)))}>Release selected seats</button>}
  {!!confirmation.length&&<section className={styles.confirmation} aria-label="Release these seats?"><h3>Release these seats?</h3><p>{confirmation.map(session=>seatReference(session.table_number,session.label)).join(', ')}</p>
   <button type="button" disabled={busy} onClick={()=>void operations.submit('RELEASE',confirmation.map(session=>session.id)).then(ok=>{if(ok){setSelected([]);setConfirmation([])}})}>Confirm seat release</button>
   <button type="button" disabled={busy} onClick={()=>setConfirmation([])}>Keep seats</button></section>}
  {operations.error&&<p role="alert">{operations.error}</p>}
 </section>
}
