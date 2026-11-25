// Development-only presentation fixture. Never connects to Supabase or creates real sessions.
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../src/index.css'
import ActiveSeats from '../src/features/seats/ActiveSeats'
import type { SalesSnapshot, SeatLabel } from '../src/database.types'
import type { SeatLinkClient } from '../src/seat-data'
import styles from './SeatMapReview.module.css'

const started = Date.now()
const fixtureExpiry = (table:number,label:string) => new Date(started + (table === 2 && label === 'C' ? 545 : 600)*1000).toISOString()
const initial: SalesSnapshot = {
  server_now: new Date(started).toISOString(), menu: [], order: null, history: [],
  tables: [1,2,3,4].map(number => ({ id: `table-${number}`, table_number: number,
    seats: (['A','B','C','D'] as SeatLabel[]).map(label => ({id:`${number}-${label}`,label,locked_order_id:null,
      status: number === 1 && label === 'B' ? 'LOCKED' : number === 3 || number === 2 && ['C','D'].includes(label) ? 'UNAVAILABLE' : 'AVAILABLE',
      expires_at: number === 3 || number === 2 && ['C','D'].includes(label) ? fixtureExpiry(number,label) : null,
    })),
  })),
  allocations: [2,3].flatMap(table => (table === 2 ? ['C','D'] as SeatLabel[] : ['A','B','C','D'] as SeatLabel[]).map(label =>
    ({id:`session-${table}-${label}`,seat_id:`${table}-${label}`,order_id:'review-order',label,table_number:table,
      status:'ACTIVE',started_at:new Date(started).toISOString(),expires_at:fixtureExpiry(table,label),ended_at:null}))),
}
export default function Review() {
  const [snapshot,setSnapshot] = useState(initial)
  const [now,setNow] = useState(() => Date.now())
  useEffect(() => {const timer=window.setInterval(()=>setNow(Date.now()),1000);return ()=>window.clearInterval(timer)},[])
  const client = {rpc: async (operation:string,args:{p_seats?:{seat_id:string;duration_seconds:number}[];p_session_ids?:string[]}) => {
    setSnapshot(previous => {
      const next = structuredClone(previous)
      if(operation==='activate_seats') {
        const time=Date.now()
        for(const table of next.tables) for(const seat of table.seats) if(args.p_seats?.some(item=>item.seat_id===seat.id)) {
          const duration=args.p_seats.find(item=>item.seat_id===seat.id)!.duration_seconds
          seat.status='UNAVAILABLE';seat.expires_at=new Date(time+duration*1000).toISOString()
          next.allocations!.push({id:crypto.randomUUID(),seat_id:seat.id,order_id:null,activation_request_id:'review-activation',origin:'OWNER_ACTIVATION',
            label:seat.label,table_number:table.table_number,status:'ACTIVE',started_at:new Date(time).toISOString(),expires_at:seat.expires_at,ended_at:null})
        }
      } else if(operation==='release_active_seats') {
        const released=next.allocations!.filter(session=>args.p_session_ids?.includes(session.id))
        next.allocations=next.allocations!.filter(session=>!args.p_session_ids?.includes(session.id))
        for(const table of next.tables) for(const seat of table.seats) if(released.some(session=>session.seat_id===seat.id)) {seat.status='AVAILABLE';seat.expires_at=null}
      }
      return next
    })
    return {data:null,error:null}
  }} as unknown as SeatLinkClient
  return <main className={styles.review}><h1>SeatLink</h1><p>Development review · Local fixtures only</p>
    <ActiveSeats client={client} snapshot={snapshot} now={now} disabled={false} refresh={async()=>{}} branchId="review-branch" />
  </main>
}
if(import.meta.env.DEV) createRoot(document.getElementById('root')!).render(<Review />)
