import {createClient} from '@supabase/supabase-js'
import {expect,it,vi} from 'vitest'
import {readDailySales,formatDailyMoney} from '../src/features/daily-sales/daily-sales-service'
import type {Database} from '../src/database.types'

it('uses a branch-scoped aggregate RPC and rejects data for a different branch',async()=>{
  const response={branch_id:'other-branch',total_minor:'100',currency:'SGD',paid_orders:1,day_end:new Date().toISOString()}
  const request=vi.fn<typeof fetch>().mockResolvedValue(Response.json(response))
  const client=createClient<Database>('http://localhost:54321','sb_publishable_test',{global:{fetch:request},auth:{persistSession:false,autoRefreshToken:false}})
  await expect(readDailySales(client,'branch-a',new AbortController().signal)).rejects.toThrow(/incomplete/)
  expect(String(request.mock.calls[0][0])).toContain('/rest/v1/rpc/read_branch_daily_sales')
  expect(JSON.parse(request.mock.calls[0][1]!.body as string)).toEqual({p_branch_id:'branch-a'})
})
it('formats aggregate amounts beyond JavaScript safe integer limits without losing minor units',()=>{
  expect(formatDailyMoney('900719925474099199','SGD')).toMatch(/9[,.]007[,.]199[,.]254[,.]740[,.]991\.99/)
  expect(formatDailyMoney('125','JPY')).toMatch(/125/)
})
