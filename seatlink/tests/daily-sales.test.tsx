// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { useDailySales } from '../src/features/daily-sales/useDailySales'
import DailySalesCard from '../src/features/daily-sales/DailySalesCard'
import type { DailySales } from '../src/database.types'
import type { SeatLinkClient } from '../src/seat-data'

const api = vi.hoisted(()=>({read:vi.fn()}))
vi.mock('../src/features/daily-sales/daily-sales-service', async original=>({
  ...await original<typeof import('../src/features/daily-sales/daily-sales-service')>(),readDailySales:api.read,
}))
const channel = {on:vi.fn().mockReturnThis(),subscribe:vi.fn().mockReturnThis()}
const client = {channel:()=>channel,removeChannel:vi.fn()} as unknown as SeatLinkClient
const data = (branch:string,total='0'):DailySales=>({branch_id:branch,total_minor:total,currency:'SGD',paid_orders:total==='0'?0:2,
  day:'2026-11-23',timezone:'Asia/Singapore',day_start:'2026-11-22T16:00:00Z',day_end:new Date(Date.now()+86400000).toISOString(),
  server_now:new Date().toISOString(),basis:'GROSS',mock_excluded:true,sandbox_orders:0,refunds_supported:false})
afterEach(()=>{cleanup();vi.clearAllMocks()})

it('ignores a late response from the previous branch and aborts its request',async()=>{
  let finish!: (value:DailySales)=>void
  api.read.mockImplementationOnce(()=>new Promise<DailySales>(resolve=>{finish=resolve})).mockResolvedValueOnce(data('b','500'))
  const view=renderHook(({branch})=>useDailySales(client,branch),{initialProps:{branch:'a'}})
  const oldSignal=api.read.mock.calls[0][2]
  view.rerender({branch:'b'})
  await waitFor(()=>expect(view.result.current.data?.branch_id).toBe('b'))
  await act(async()=>finish(data('a','99999')))
  expect(oldSignal.aborted).toBe(true)
  expect(view.result.current.data?.total_minor).toBe('500')
})

it('shows loading, an error with retry, and genuine zero without treating failure as zero',async()=>{
  const user=userEvent.setup()
  api.read.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(data('a'))
  function Card(){const sales=useDailySales(client,'a');return <DailySalesCard sales={sales}/>}
  render(<Card />)
  expect(screen.getByRole('status').textContent).toMatch(/Loading sales/)
  await screen.findByRole('alert')
  expect(screen.queryByText(/SGD|\$0\.00/)).toBeNull()
  await user.click(screen.getByRole('button',{name:'Retry sales'}))
  await screen.findByText(/0 paid orders/)
  expect(screen.getByText(/excludes mock QR/)).toBeTruthy()
  expect(screen.getByRole('region',{name:"Today's sales"}).textContent).toMatch(/0\.00/)
})

it('refreshes the aggregate after a paid-order event and removes subscriptions',async()=>{
  let paid!: (payload:{new:{status:string}})=>void
  channel.on.mockImplementation((_event,_filter,callback)=>{paid=callback;return channel})
  api.read.mockResolvedValueOnce(data('a')).mockResolvedValueOnce(data('a','600'))
  const view=renderHook(()=>useDailySales(client,'a'))
  await waitFor(()=>expect(view.result.current.data?.paid_orders).toBe(0))
  act(()=>paid({new:{status:'PAID'}}))
  await waitFor(()=>expect(view.result.current.data?.total_minor).toBe('600'))
  view.unmount()
  expect(client.removeChannel).toHaveBeenCalledWith(channel)
})
