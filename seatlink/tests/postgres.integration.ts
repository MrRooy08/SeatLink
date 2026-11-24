import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:net'
import EmbeddedPostgres from 'embedded-postgres'
import { Client } from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'

let postgres: EmbeddedPostgres
let admin: Client
let first: Client
let second: Client
const ids = {
  owner1: 'b7000000-0000-4000-8000-000000000001',
  owner2: 'b7000000-0000-4000-8000-000000000002',
  organisation: 'b7000000-0000-4000-8000-000000000010',
  branch: 'b7000000-0000-4000-8000-000000000020',
  menu: 'b7000000-0000-4000-8000-000000000030',
  table: 'b7000000-0000-4000-8000-000000000040',
  seatA: 'b7000000-0000-4000-8000-000000000050',
  seatB: 'b7000000-0000-4000-8000-000000000051',
  order1: 'b7000000-0000-4000-8000-000000000060',
  order2: 'b7000000-0000-4000-8000-000000000061',
}
const sql = (path: string) => readFile(new URL(path, import.meta.url), 'utf8')

async function availablePort() {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Could not reserve a local test port')
  const port = address.port
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  return port
}

beforeAll(async () => {
  // A fresh isolated cluster, bound only to loopback. Existing databases are never opened.
  const directory = await mkdtemp(join(tmpdir(), 'seatlink-pg-tests-'))
  const port = await availablePort()
  const password = randomUUID()
  postgres = new EmbeddedPostgres({
    databaseDir: directory, port, user: 'postgres', password,
    authMethod: 'scram-sha-256', persistent: false,
    postgresFlags: ['-h', '127.0.0.1'],
    onLog: () => {}, onError: () => {},
  })
  await postgres.initialise()
  await postgres.start()
  const options = { host: '127.0.0.1', port, user: 'postgres', password, database: 'postgres', connectionTimeoutMillis: 5000 }
  admin = new Client(options)
  first = new Client(options)
  second = new Client(options)
  await Promise.all([admin.connect(), first.connect(), second.connect()])
  await admin.query(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    grant usage on schema auth to anon, authenticated;
  `)
  await admin.query(await sql('../supabase/migrations/20261117000000_owner_seat_map.sql'))
  await admin.query(await sql('../supabase/migrations/20261118000000_orders_and_seat_locks.sql'))
  await admin.query(await sql('../supabase/migrations/20261118000200_demo_checkout_schema.sql'))
  await admin.query(await sql('../supabase/migrations/20261118000300_payments_and_seat_use.sql'))
  await admin.query(await sql('../supabase/migrations/20261118000400_customer_display.sql'))
  await admin.query(await sql('../supabase/migrations/20261118000500_guided_checkout.sql'))
  await admin.query(await sql('../supabase/migrations/20261118000600_cash_and_sandbox_payments.sql'))
  await admin.query(await sql('../supabase/migrations/20261118000700_guided_display.sql'))
  await admin.query(await sql('../supabase/migrations/20261118000800_qr_confirmation_and_display.sql'))
  await admin.query(await sql('../supabase/migrations/20261123000000_optional_seats.sql'))
  await admin.query(await sql('../supabase/migrations/20261123000100_branches_and_daily_sales.sql'))
  await admin.query(await sql('../supabase/migrations/20261123000200_seat_operations.sql'))
  await admin.query(await sql('../supabase/migrations/20261123000300_quantities_and_resubmit.sql'))
  await admin.query(await sql('../supabase/migrations/20261123000400_seat_presentation.sql'))
})

afterAll(async () => {
  await Promise.allSettled([first?.end(), second?.end(), admin?.end()])
  // EmbeddedPostgres removes only the unique directory created above when stopped.
  if (postgres) await postgres.stop()
})

it('runs the complete SQL business and RLS assertions against native PostgreSQL', async () => {
  await admin.query(await sql('../supabase/tests/sales.sql'))
})

it('runs the complete checkout and restricted-display scenarios against native PostgreSQL', async () => {
  await admin.query(await sql('../supabase/tests/demo_checkout.sql'))
})

it('runs guided checkout, cash and provider-result permission scenarios against native PostgreSQL', async () => {
  await admin.query(await sql('../supabase/tests/guided_cash.sql'))
})

it('runs QR confirmation, renewal and canonical owner/display projections against PostgreSQL', async () => {
  await admin.query(await sql('../supabase/tests/qr_confirmation.sql'))
})

it('runs optional-seat checkout, skip-release and paired map isolation scenarios', async () => {
  await admin.query(await sql('../supabase/tests/optional_seats.sql'))
})

it('runs branch-authorized daily sales, canonical-payment and timezone assertions', async () => {
  await admin.query(await sql('../supabase/tests/daily_sales.sql'))
})

it('serializes simultaneous seat requests and rolls back the entire losing selection', async () => {
  await admin.query(`
    insert into auth.users (id) values ($1), ($2)
  `, [ids.owner1, ids.owner2])
  await admin.query('insert into public.organisations (id, name) values ($1, $2)', [ids.organisation, 'Concurrent test'])
  await admin.query('insert into public.owner_memberships values ($1, $3), ($2, $3)', [ids.owner1, ids.owner2, ids.organisation])
  await admin.query('insert into public.branches (id, organisation_id, name) values ($1, $2, $3)', [ids.branch, ids.organisation, 'Concurrent branch'])
  await admin.query("insert into public.menu_items (id, branch_id, name, price_minor, currency) values ($1, $2, 'Tea', 180, 'SGD')", [ids.menu, ids.branch])
  await admin.query('insert into public.tables (id, branch_id, table_number) values ($1, $2, 1)', [ids.table, ids.branch])
  await admin.query("insert into public.seats (id, table_id, label) values ($1, $3, 'A'), ($2, $3, 'B')", [ids.seatA, ids.seatB, ids.table])
  await first.query('set role authenticated')
  await second.query('set role authenticated')
  await first.query("select set_config('request.jwt.claim.sub', $1, false)", [ids.owner1])
  await second.query("select set_config('request.jwt.claim.sub', $1, false)", [ids.owner2])

  const items = JSON.stringify([{ menu_item_id: ids.menu, quantity: 1 }])
  await first.query('select public.save_draft_order($1, $2, 0, $3, $4)', [ids.order1, ids.branch, randomUUID(), items])
  await second.query('select public.save_draft_order($1, $2, 0, $3, $4)', [ids.order2, ids.branch, randomUUID(), items])
  const { rows: [backend] } = await second.query('select pg_backend_pid() as pid')

  await first.query('begin')
  await first.query('select public.confirm_order_seats($1, 1, $2::uuid[])', [ids.order1, [ids.seatA]])
  await second.query('begin')
  // Attach a rejection handler immediately while the statement waits on the first transaction.
  const contender = second.query('select public.confirm_order_seats($1, 1, $2::uuid[])', [ids.order2, [ids.seatB, ids.seatA]])
    .then(() => ({ error: null }), (error: Error) => ({ error }))

  try {
    let waiting = false
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const { rows } = await admin.query("select wait_event_type from pg_stat_activity where pid = $1", [backend.pid])
      if (rows[0]?.wait_event_type === 'Lock') { waiting = true; break }
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    expect(waiting).toBe(true)
    await first.query('commit')
    const result = await contender
    expect(result.error?.message).toMatch(/unavailable/)
  } finally {
    await first.query('rollback')
    await second.query('rollback')
  }

  const { rows } = await admin.query('select id, status, locked_order_id from public.seats where table_id = $1 order by label', [ids.table])
  expect(rows).toEqual([
    { id: ids.seatA, status: 'LOCKED', locked_order_id: ids.order1 },
    { id: ids.seatB, status: 'AVAILABLE', locked_order_id: null },
  ])
  const { rows: [order] } = await admin.query('select status, session_expires_at from public.orders where id = $1', [ids.order2])
  expect(order).toEqual({ status: 'DRAFT', session_expires_at: null })
})

it('serializes cash confirmation against a delayed QR success without reallocating seats', async () => {
  await admin.query('update public.development_settings set enabled=true')
  await admin.query('insert into public.development_operators(user_id) values ($1) on conflict do nothing', [ids.owner1])
  await second.query("select set_config('request.jwt.claim.sub', $1, false)", [ids.owner1])
  await first.query("select public.select_payment_method($1,'QR')", [ids.order1])
  const qrId = randomUUID()
  await first.query('select public.create_mock_payment($1,$2)', [ids.order1, qrId])
  await first.query('select public.resolve_mock_attempt($1)', [qrId])
  await first.query("select public.select_payment_method($1,'CASH')", [ids.order1])
  const { rows: [backend] } = await second.query('select pg_backend_pid() as pid')
  await first.query('begin')
  await first.query('select public.confirm_cash_payment($1,$2,500)', [ids.order1, randomUUID()])
  const { rows: before } = await first.query('select id,expires_at from public.seat_use_sessions where order_id=$1', [ids.order1])
  await second.query('begin')
  const contender = second.query("select public.simulate_mock_payment($1,$2,'SUCCESS')", [qrId, randomUUID()])
    .then(() => ({ error: null }), (error: Error) => ({ error }))
  try {
    let waiting = false
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const { rows } = await admin.query('select wait_event_type from pg_stat_activity where pid=$1', [backend.pid])
      if (rows[0]?.wait_event_type === 'Lock') { waiting = true; break }
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    expect(waiting).toBe(true)
    await first.query('commit')
    expect((await contender).error).toBeNull()
    await second.query('commit')
  } finally {
    await first.query('rollback')
    await second.query('rollback')
  }
  const { rows: after } = await admin.query('select id,expires_at from public.seat_use_sessions where order_id=$1', [ids.order1])
  expect(after).toEqual(before)
  const { rows: [order] } = await admin.query('select status,paid_method from public.orders where id=$1', [ids.order1])
  expect(order).toEqual({ status: 'PAID_REVIEW', paid_method: 'CASH' })
  const { rows: payments } = await admin.query("select provider from public.payment_attempts where order_id=$1 and status='SUCCEEDED' order by provider", [ids.order1])
  expect(payments).toEqual([{ provider: 'CASH' }, { provider: 'MOCK' }])
})

it('reuses one QR when two owner requests confirm the same reservation concurrently', async () => {
  await admin.query('insert into public.development_operators(user_id) values ($1) on conflict do nothing', [ids.owner2])
  await first.query("select set_config('request.jwt.claim.sub',$1,false)", [ids.owner2])
  await second.query("select set_config('request.jwt.claim.sub',$1,false)", [ids.owner2])
  await first.query('select public.confirm_order_seats($1,1,$2::uuid[])', [ids.order2, [ids.seatB]])
  await first.query("select public.select_payment_method($1,'QR')", [ids.order2])
  await first.query('begin')
  const { rows: [original] } = await first.query('select (public.prepare_mock_qr($1,$2)).id as id', [ids.order2, randomUUID()])
  const { rows: [backend] } = await second.query('select pg_backend_pid() as pid')
  await second.query('begin')
  const contender = second.query('select (public.prepare_mock_qr($1,$2)).id as id', [ids.order2, randomUUID()])
    .then(result => ({ result, error: null }), (error: Error) => ({ result: null, error }))
  try {
    let waiting = false
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const { rows } = await admin.query('select wait_event_type from pg_stat_activity where pid=$1', [backend.pid])
      if (rows[0]?.wait_event_type === 'Lock') { waiting = true; break }
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    expect(waiting).toBe(true)
    await first.query('commit')
    const repeated = await contender
    expect(repeated.error).toBeNull()
    expect(repeated.result!.rows[0].id).toBe(original.id)
    await second.query('commit')
  } finally {
    await first.query('rollback')
    await second.query('rollback')
  }
  const { rows: [count] } = await admin.query('select count(*)::integer as count from public.payment_attempts where order_id=$1', [ids.order2])
  expect(count.count).toBe(1)
})

it('serializes skipping seats with cash completion so released seats receive no allocation', async () => {
  const { rows: [attempt] } = await first.query('select id from public.payment_attempts where order_id=$1', [ids.order2])
  await first.query('select public.resolve_mock_attempt($1)', [attempt.id])
  await first.query("select public.select_payment_method($1,'CASH')", [ids.order2])
  const { rows: [order] } = await first.query('select revision,session_expires_at from public.orders where id=$1', [ids.order2])
  const { rows: [backend] } = await second.query('select pg_backend_pid() as pid')
  await first.query('begin')
  await first.query("select public.confirm_order_seats($1,$2,'{}')", [ids.order2,order.revision])
  await second.query('begin')
  const payment = second.query('select public.confirm_cash_payment($1,$2,500)', [ids.order2,randomUUID()])
    .then(result => ({ result,error:null }), (error: Error) => ({ result:null,error }))
  try {
    let waiting = false
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const { rows } = await admin.query('select wait_event_type from pg_stat_activity where pid=$1', [backend.pid])
      if (rows[0]?.wait_event_type === 'Lock') { waiting=true;break }
      await new Promise(resolve=>setTimeout(resolve,20))
    }
    expect(waiting).toBe(true)
    await first.query('commit')
    expect((await payment).error).toBeNull()
    await second.query('commit')
  } finally {
    await first.query('rollback');await second.query('rollback')
  }
  const { rows: [paid] } = await admin.query('select status,selected_seat_ids,session_expires_at from public.orders where id=$1', [ids.order2])
  expect(paid).toEqual({ status:'PAID',selected_seat_ids:[],session_expires_at:order.session_expires_at })
  expect((await admin.query('select id from public.seat_use_sessions where order_id=$1', [ids.order2])).rows).toHaveLength(0)
  expect((await admin.query('select status from public.seats where id=$1',[ids.seatB])).rows[0].status).toBe('AVAILABLE')
  expect((await admin.query('select status from public.seats where id=$1',[ids.seatA])).rows[0].status).toBe('UNAVAILABLE')
})




it('validates standalone sessions, variants and expired-order resubmission on native PostgreSQL',async()=>{
 const fixture=(await sql('../supabase/tests/guided_cash.sql')).split('set local role authenticated;')[0]
 await admin.query(fixture+await sql('../supabase/tests/operations-body.sql'))
})

it('serializes a standalone activation against checkout without partial reservation',async()=>{
 await first.query("select set_config('request.jwt.claim.sub',$1,false)",[ids.owner1])
 await second.query("select set_config('request.jwt.claim.sub',$1,false)",[ids.owner2])
 const order=randomUUID()
 await second.query('select public.continue_to_seats($1,$2,0,$3,$4)',[order,ids.branch,randomUUID(),JSON.stringify([{menu_item_id:ids.menu,quantity:1}])])
 await first.query('begin')
 await first.query('select public.activate_seats($1,$2,$3)',[ids.branch,[ids.seatB],randomUUID()])
 await second.query('begin')
 const pending=second.query('select public.confirm_order_seats($1,1,$2)',[order,[ids.seatB]])
  .then(()=>null,(error:Error)=>error)
 try{
  await first.query('commit')
  expect((await pending)?.message).toMatch(/unavailable/)
 }finally{await first.query('rollback');await second.query('rollback')}
 expect((await admin.query('select selected_seat_ids,status from public.orders where id=$1',[order])).rows[0]).toEqual({selected_seat_ids:[],status:'DRAFT'})
 expect((await admin.query("select origin,order_id from public.seat_use_sessions where seat_id=$1 and status='ACTIVE'",[ids.seatB])).rows).toEqual([{origin:'OWNER_ACTIVATION',order_id:null}])
})
