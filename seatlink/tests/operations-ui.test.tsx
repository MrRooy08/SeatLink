// @vitest-environment jsdom
import {useCallback,useState} from 'react'
import {cleanup,render,screen,waitFor} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {afterEach,expect,it,vi} from 'vitest'
import QuantityControl from '../src/features/checkout/QuantityControl'
import {quantityMaximum,validQuantities} from '../src/features/checkout/quantity'
import SeatMap from '../src/features/seats/SeatMap'
import ActiveSeats from '../src/features/seats/ActiveSeats'
import type {MenuItem,SalesSnapshot} from '../src/database.types'
import type {SeatLinkClient} from '../src/seat-data'
afterEach(cleanup)
const menu:MenuItem[]=[{id:'base',branch_id:'branch',name:'Rice',price_minor:100,currency:'SGD',available:true},
 {id:'variant',branch_id:'branch',name:'Extra meat',price_minor:200,currency:'SGD',available:true,quantity_group_id:'base'}]
it('shares the fifty-item cap across variants and leaves other items independent',()=>{
 expect(quantityMaximum('variant',{base:30,variant:20},menu)).toBe(20)
 expect(validQuantities({base:30,variant:20},menu)).toBe(true)
 expect(validQuantities({base:31,variant:20},menu)).toBe(false)
})
it('supports temporary empty input, rejects fractions and over-limit input, and increments/decrements exactly one',async()=>{
 const user=userEvent.setup()
 function Example(){const [n,setN]=useState(0);const [valid,setValid]=useState(true)
  const validity=useCallback((_id:string,ok:boolean)=>setValid(ok),[])
  return <><QuantityControl name="Rice" value={n} maximum={50} disabled={false} onChange={setN} onValidity={validity}/><button disabled={!valid}>Submit</button><output>{n}</output></>}
 render(<Example/>);const input=screen.getByRole('textbox',{name:'Rice'})
 expect((input as HTMLInputElement).value).toBe('0')
 await user.click(screen.getByRole('button',{name:'Increase Rice'}));expect((input as HTMLInputElement).value).toBe('1')
 await user.click(screen.getByRole('button',{name:'Decrease Rice'}));expect((input as HTMLInputElement).value).toBe('0')
 await user.clear(input);expect(screen.getByRole('button',{name:'Submit'}).hasAttribute('disabled')).toBe(true)
 await user.type(input,'51');expect(input.getAttribute('aria-invalid')).toBe('true')
 await user.clear(input);await user.type(input,'1.5');expect(input.getAttribute('aria-invalid')).toBe('true')
 await user.clear(input);await user.type(input,'50');expect(screen.getByRole('button',{name:'Increase Rice'}).hasAttribute('disabled')).toBe(true)
})
it('uses server expiry for occupied owner chairs and hides countdowns on read-only customer maps',()=>{
 const tables=[{table_number:1,seats:[{id:'stable-id',label:'B',status:'UNAVAILABLE' as const,expires_at:'2026-11-23T12:10:00Z'}]}]
 const view=render(<SeatMap tables={tables} ownerNow={Date.parse('2026-11-23T12:00:00Z')}/> )
 expect(screen.getByLabelText('Seat time remaining').textContent).toBe('10:00')
 view.rerender(<SeatMap tables={tables} ownerNow={Date.parse('2026-11-23T12:02:00Z')}/> )
 expect(screen.getByLabelText('Seat time remaining').textContent).toBe('8:00')
 view.rerender(<SeatMap tables={tables} ownerNow={Date.parse('2026-11-23T12:12:00Z')}/> )
 expect(screen.getByLabelText('Seat time remaining').textContent).toBe('Sync…')
 expect(screen.getByRole('group',{name:'Table A · Seat 2'}).textContent).toContain('Occupied')
 view.rerender(<SeatMap tables={tables}/>);expect(screen.queryByLabelText('Seat time remaining')).toBeNull();expect(screen.queryByRole('button')).toBeNull()
})
it('activates six real seats without checkout or payment calls and deduplicates confirmation',async()=>{
 const user=userEvent.setup(),rpc=vi.fn().mockResolvedValue({data:null,error:null}),refresh=vi.fn().mockResolvedValue(undefined)
 const snapshot={menu:[],order:null,history:[],tables:[1,2].map(n=>({id:`t${n}`,table_number:n,seats:['A','B','C','D'].map(label=>({id:`${n}${label}`,label,status:'AVAILABLE',locked_order_id:null}))}))} as SalesSnapshot
 render(<ActiveSeats client={{rpc} as unknown as SeatLinkClient} snapshot={snapshot} now={Date.now()} disabled={false} refresh={refresh} branchId="branch"/> )
 await user.click(screen.getByRole('button',{name:'Activate seats'}))
 for(const [table,seat] of [['A',1],['A',2],['A',3],['A',4],['B',1],['B',2]]) await user.click(screen.getByRole('button',{name:`Table ${table} · Seat ${seat}`}))
 await user.click(screen.getByRole('button',{name:'Activate selected seats'}))
 await user.dblClick(screen.getByRole('button',{name:'Confirm activation'}))
 await waitFor(()=>expect(rpc).toHaveBeenCalledTimes(1))
 expect(rpc.mock.calls[0][0]).toBe('activate_seats')
 expect(rpc.mock.calls[0][1].p_seat_ids).toHaveLength(6)
 expect(rpc.mock.calls[0][1].p_branch_id).toBe('branch')
})
