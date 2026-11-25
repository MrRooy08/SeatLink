import { useRef, useState } from 'react'
import type { SeatLinkClient } from '../../seat-data'
import { salesError } from '../../sales-data'
import { activateSeats, releaseSeats } from './seat-operations-service'
import { defaultActivationDuration } from './activation-duration'
import type { ActivationDuration } from './activation-duration'

export function useSeatOperations(client: SeatLinkClient, branch: string, refresh: () => Promise<void>) {
 const [working,setWorking]=useState(false)
 const [error,setError]=useState('')
 const busy=useRef(false)
 const request=useRef({key:'',id:''})
 async function submit(operation:'ACTIVATE'|'RELEASE', ids:string[], durations?:Record<string,ActivationDuration>) {
  if(busy.current) return false
  busy.current=true; setWorking(true); setError('')
  const seats = [...ids].sort().map(seat_id => ({seat_id,duration_seconds:durations?.[seat_id] ?? defaultActivationDuration}))
  const key=JSON.stringify([branch,operation,operation==='ACTIVATE'?seats:[...ids].sort()])
  if(request.current.key!==key) request.current={key,id:crypto.randomUUID()}
  try {
   if(operation==='ACTIVATE') await activateSeats(client,branch,seats,request.current.id)
   else await releaseSeats(client,branch,ids,request.current.id)
   request.current={key:'',id:''}
   return true
  } catch(failure) {setError(salesError(failure)); return false}
  finally {await refresh(); busy.current=false; setWorking(false)}
 }
 return {working,error,submit,clearError:()=>setError('')}
}
