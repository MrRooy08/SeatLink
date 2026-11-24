import { useRef, useState } from 'react'
import type { SeatLinkClient } from '../../seat-data'
import { salesError } from '../../sales-data'
import { activateSeats, releaseSeats } from './seat-operations-service'

export function useSeatOperations(client: SeatLinkClient, branch: string, refresh: () => Promise<void>) {
 const [working,setWorking]=useState(false)
 const [error,setError]=useState('')
 const busy=useRef(false)
 const request=useRef({key:'',id:''})
 async function submit(operation:'ACTIVATE'|'RELEASE', ids:string[]) {
  if(busy.current) return false
  busy.current=true; setWorking(true); setError('')
  const key=JSON.stringify([branch,operation,[...ids].sort()])
  if(request.current.key!==key) request.current={key,id:crypto.randomUUID()}
  try {
   await (operation==='ACTIVATE'?activateSeats:releaseSeats)(client,branch,ids,request.current.id)
   request.current={key:'',id:''}
   return true
  } catch(failure) {setError(salesError(failure)); return false}
  finally {await refresh(); busy.current=false; setWorking(false)}
 }
 return {working,error,submit}
}
