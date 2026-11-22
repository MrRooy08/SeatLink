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
}, 20_000)

afterAll(async () => db.close())

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

