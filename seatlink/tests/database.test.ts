import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, expect, it } from 'vitest'

const db = new PGlite()
const sql = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const seed = sql('../supabase/dev/seed.sql')

beforeAll(async () => {
  // Match the parts of Supabase's auth schema and default table grants used by the policies.
  await db.exec(`
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
  await db.exec(sql('../supabase/migrations/20261117000000_owner_seat_map.sql'))
  await db.exec(sql('../supabase/migrations/20261118000000_orders_and_seat_locks.sql'))
  await db.exec(sql('../supabase/migrations/20261118000200_demo_checkout_schema.sql'))
  await db.exec(sql('../supabase/migrations/20261118000300_payments_and_seat_use.sql'))
  await db.exec(sql('../supabase/migrations/20261118000400_customer_display.sql'))
  await db.exec(sql('../supabase/migrations/20261118000500_guided_checkout.sql'))
  await db.exec(sql('../supabase/migrations/20261118000600_cash_and_sandbox_payments.sql'))
  await db.exec(sql('../supabase/migrations/20261118000700_guided_display.sql'))
  await db.exec(sql('../supabase/migrations/20261118000800_qr_confirmation_and_display.sql'))
  await db.exec(sql('../supabase/migrations/20261123000000_optional_seats.sql'))
  await db.exec(sql('../supabase/migrations/20261123000100_branches_and_daily_sales.sql'))
  await db.exec(sql('../supabase/migrations/20261123000200_seat_operations.sql'))
  await db.exec(sql('../supabase/migrations/20261123000300_quantities_and_resubmit.sql'))
  await db.exec(sql('../supabase/migrations/20261123000400_seat_presentation.sql'))
  await db.exec(sql('../supabase/migrations/20261125000000_activation_durations.sql'))
  await db.exec(sql('../supabase/migrations/20261125000100_custom_activation_durations.sql'))
}, 20_000)

afterAll(async () => db.close())

it('projects draft selections without reservations and isolates current-order seats across counters and reset', async () => {
 const fixture=sql('../supabase/tests/guided_cash.sql').split('set local role authenticated;')[0]
 await db.exec(fixture+sql('../supabase/tests/display-selection-body.sql'))
})

it('validates mixed activation durations, immutable retries, defaults and branch isolation',async()=>{
 const fixture=sql('../supabase/tests/guided_cash.sql').split('set local role authenticated;')[0]
 await db.exec(fixture+sql('../supabase/tests/activation-durations-body.sql'))
})

it('runs the PostgreSQL RLS and grants assertions under authenticated and anon roles', async () => {
  await db.exec(sql('../supabase/tests/owner_access.sql'))
})

it('validates authoritative drafts, atomic seat locks, expiry, cancellation, snapshots and RPC permissions', async () => {
  await db.exec(sql('../supabase/tests/sales.sql'))
})

it('runs mock payment, paid seat use, release, extension and customer display permission scenarios', async () => {
  await db.exec(sql('../supabase/tests/demo_checkout.sql'))
})

it('validates guided checkout, cash, unresolved QR switching and verified provider results', async () => {
  await db.exec(sql('../supabase/tests/guided_cash.sql'))
})

it('reuses confirmed QR attempts and projects the same canonical QR to the paired display', async () => {
  await db.exec(sql('../supabase/tests/qr_confirmation.sql'))
})

it('completes zero-seat cash/QR orders, preserves timed seat use and safely skips reservations', async () => {
  await db.exec(sql('../supabase/tests/optional_seats.sql'))
})

it('aggregates authorized branch-local gross sales across payment retries and day boundaries', async () => {
  await db.exec(sql('../supabase/tests/daily_sales.sql'))
})

it('seeds two branches with complete four-seat tables and preserves existing seat state on rerun', async () => {
  await db.exec(seed)
  await db.exec("update public.seats set status = 'UNAVAILABLE' from public.tables t where t.id = seats.table_id and t.table_number = 1 and seats.label = 'B'")
  await db.exec(seed)

  const { rows } = await db.query(`
    select branches.name, count(distinct tables.id)::integer as tables,
      count(seats.id)::integer as seats,
      count(seats.id) filter (where status = 'LOCKED')::integer as locked,
      count(seats.id) filter (where status = 'UNAVAILABLE')::integer as unavailable
    from public.branches
    join public.tables on tables.branch_id = branches.id
    join public.seats on seats.table_id = tables.id
    group by branches.name
    order by branches.name
  `)
  expect(rows).toEqual([
    { name: 'Market Square', tables: 3, seats: 12, locked: 0, unavailable: 1 },
    { name: 'Riverside', tables: 4, seats: 16, locked: 0, unavailable: 1 },
  ])
})

it('seeds labelled sample menu items idempotently while preserving existing prices and availability', async () => {
  await db.exec("set seatlink.development_seed = 'on'")
  await db.exec(sql('../supabase/dev/menu.sql'))
  await db.exec("update public.menu_items set price_minor = 777, available = false where name = 'Sample iced tea'")
  await db.exec(sql('../supabase/dev/menu.sql'))
  const { rows } = await db.query(`select count(*)::integer as items,
    count(*) filter (where name = 'Sample iced tea' and price_minor = 777 and not available)::integer as preserved
    from public.menu_items where is_demo`)
  expect(rows).toEqual([{ items: 10, preserved: 2 }])
})




it('validates quantities, resubmission and standalone seat operations',async()=>{
 const fixture=sql('../supabase/tests/guided_cash.sql').split('set local role authenticated;')[0]
 await db.exec(fixture+sql('../supabase/tests/operations-body.sql'))
})

it('seeds linked development scenarios idempotently and cleans up only its own sessions',async()=>{
 const fixture=sql('../supabase/tests/guided_cash.sql').split('set local role authenticated;')[0]
 await db.exec(fixture+`
 update public.development_settings set enabled=true;
 insert into public.development_operators(user_id) values('c6000000-0000-4000-8000-000000000001');
 update public.payment_runtime set mode='MOCK';
 update public.branches set currency='SGD' where id='c6000000-0000-4000-8000-000000000020';
 set local seatlink.fixture_branch='c6000000-0000-4000-8000-000000000020';
 set local seatlink.fixture_owner='sales-owner-a@test.invalid';
 set local seatlink.fixture_cleanup='off';
 `)
 const seed=sql('../supabase/dev/seat-scenarios.sql')
 await db.exec(seed)
 const before=(await db.query(`select id,started_at,expires_at from public.seat_use_sessions where branch_id='c6000000-0000-4000-8000-000000000020' order by id`)).rows
 expect(before).toHaveLength(6)
 await db.exec(seed)
 expect((await db.query(`select id,started_at,expires_at from public.seat_use_sessions where branch_id='c6000000-0000-4000-8000-000000000020' order by id`)).rows).toEqual(before)
 expect((await db.query(`select status,count(*)::integer as count from public.seats s join public.tables t on t.id=s.table_id where t.branch_id='c6000000-0000-4000-8000-000000000020' group by status order by status`)).rows).toEqual([
  {status:'AVAILABLE',count:5},{status:'LOCKED',count:1},{status:'UNAVAILABLE',count:6},
 ])
 await db.exec("set local seatlink.fixture_cleanup='on';"+seed)
 expect((await db.query(`select count(*)::integer as count from public.seat_use_sessions where branch_id='c6000000-0000-4000-8000-000000000020' and status='ACTIVE'`)).rows[0].count).toBe(0)
 expect((await db.query(`select count(*)::integer as count from public.orders where branch_id='c6000000-0000-4000-8000-000000000020'`)).rows[0].count).toBe(2)
 await db.exec('rollback')
})
