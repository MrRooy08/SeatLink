// Development-only UI fixtures. No Supabase calls or real payment data.
import {useState} from 'react'
import {createRoot} from 'react-dom/client'
import '../src/index.css'
import '../src/App.css'
import BranchSelectionModal from '../src/features/branches/BranchSelectionModal'
import DailySalesCard from '../src/features/daily-sales/DailySalesCard'
import type {Branch} from '../src/seat-data'
import type {DailySales} from '../src/database.types'
import header from '../src/features/branches/BranchWorkspace.module.css'
import styles from './BranchSalesReview.module.css'

const branches:Branch[]=Array.from({length:9},(_,index)=>({id:`review-${index}`,name:['Riverside','Market Square','Harbour Point'][index%3]+(index>2?` ${index+1}`:''),
  address:`${index+10} ${['River Road','Market Street','Harbour Road'][index%3]}`,timezone:'Asia/Singapore',currency:'SGD',organisation:{name:'SeatLink Food Court'}}))
const data:DailySales={branch_id:'review-0',day:'2026-11-23',timezone:'Asia/Singapore',currency:'SGD',total_minor:'34850',paid_orders:26,
  day_start:'2026-11-22T16:00:00Z',day_end:'2026-11-23T16:00:00Z',server_now:'2026-11-23T04:00:00Z',basis:'GROSS',mock_excluded:true,sandbox_orders:0,refunds_supported:false}
export default function Review(){
  const [branch,setBranch]=useState<Branch>()
  const [open,setOpen]=useState(true)
  const [mode,setMode]=useState('loaded')
  const sales={result:mode==='loading'?undefined:mode==='error'?{error:true as const}:{data:{...data,branch_id:branch?.id??data.branch_id,total_minor:mode==='zero'?'0':data.total_minor,paid_orders:mode==='zero'?0:data.paid_orders}},data:undefined,retry:()=>setMode('loaded')}
  return <main className={styles.frame}><p className={styles.note}>Development review · Sample figures · No database connection</p>
    {branch?<header className={header.header}><div><p className="organisation">SeatLink Food Court</p><h1>{branch.name}</h1>
      <button className={header.switchButton} onClick={()=>setOpen(true)}>Switch branch</button></div><DailySalesCard sales={sales}/></header>:<h1>Choose a branch</h1>}
    {branch&&<section className={styles.reviewTools}><h2>Review sales states</h2>{['loaded','loading','error','zero'].map(value=><button key={value} onClick={()=>setMode(value)}>{value}</button>)}</section>}
    {open&&<BranchSelectionModal branches={branches} currentId={branch?.id} message="" onClose={()=>setOpen(false)} onContinue={id=>{setBranch(branches.find(item=>item.id===id));setOpen(false);return true}}/>}
  </main>
}
if(import.meta.env.DEV)createRoot(document.getElementById('root')!).render(<Review/>);
