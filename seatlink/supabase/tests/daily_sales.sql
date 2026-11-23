-- Local development/test database only. All fixtures and assertions roll back.
begin;

create function pg_temp.assert_true(value boolean, message text)
returns void language plpgsql as $$
begin
  if value is distinct from true then raise exception '%', message; end if;
end;
$$;

create function pg_temp.expect_error(statement text, expected text)
returns void language plpgsql as $$
declare
  failed boolean := false;
begin
  begin
    execute statement;
  exception when others then
    if position(expected in sqlerrm) = 0 then raise; end if;
    failed := true;
  end;
  if not failed then raise exception 'Expected error containing %', expected; end if;
end;
$$;

insert into auth.users (id, email) values
  ('c6000000-0000-4000-8000-000000000001', 'sales-owner-a@test.invalid'),
  ('c6000000-0000-4000-8000-000000000002', 'sales-owner-b@test.invalid'),
  ('c6000000-0000-4000-8000-000000000003', 'sales-outsider@test.invalid');
insert into public.organisations (id, name) values
  ('c6000000-0000-4000-8000-000000000010', 'Sales test organisation'),
  ('c6000000-0000-4000-8000-000000000011', 'Other organisation');
insert into public.owner_memberships values
  ('c6000000-0000-4000-8000-000000000001', 'c6000000-0000-4000-8000-000000000010'),
  ('c6000000-0000-4000-8000-000000000002', 'c6000000-0000-4000-8000-000000000010'),
  ('c6000000-0000-4000-8000-000000000003', 'c6000000-0000-4000-8000-000000000011');
insert into public.branches (id, organisation_id, name) values
  ('c6000000-0000-4000-8000-000000000020', 'c6000000-0000-4000-8000-000000000010', 'Sales branch'),
  ('c6000000-0000-4000-8000-000000000021', 'c6000000-0000-4000-8000-000000000010', 'Another authorised branch'),
  ('c6000000-0000-4000-8000-000000000022', 'c6000000-0000-4000-8000-000000000011', 'Forbidden branch');
insert into public.menu_items (id, branch_id, name, price_minor, currency, available) values
  ('c6000000-0000-4000-8000-000000000030', 'c6000000-0000-4000-8000-000000000020', 'Iced tea', 180, 'SGD', true),
  ('c6000000-0000-4000-8000-000000000031', 'c6000000-0000-4000-8000-000000000021', 'Other branch tea', 200, 'SGD', true),
  ('c6000000-0000-4000-8000-000000000032', 'c6000000-0000-4000-8000-000000000020', 'Sold out', 300, 'SGD', false),
  ('c6000000-0000-4000-8000-000000000033', 'c6000000-0000-4000-8000-000000000020', 'Other currency', 300, 'USD', true),
  ('c6000000-0000-4000-8000-000000000034', 'c6000000-0000-4000-8000-000000000020', 'Large price', 9007199254740991, 'SGD', true);
insert into public.tables (id, branch_id, table_number) values
  ('c6000000-0000-4000-8000-000000000040', 'c6000000-0000-4000-8000-000000000020', 1),
  ('c6000000-0000-4000-8000-000000000041', 'c6000000-0000-4000-8000-000000000021', 1);
insert into public.seats (id, table_id, label) values
  ('c6000000-0000-4000-8000-000000000050', 'c6000000-0000-4000-8000-000000000040', 'A'),
  ('c6000000-0000-4000-8000-000000000051', 'c6000000-0000-4000-8000-000000000040', 'B'),
  ('c6000000-0000-4000-8000-000000000052', 'c6000000-0000-4000-8000-000000000040', 'C'),
  ('c6000000-0000-4000-8000-000000000053', 'c6000000-0000-4000-8000-000000000040', 'D'),
  ('c6000000-0000-4000-8000-000000000054', 'c6000000-0000-4000-8000-000000000041', 'A');

update public.branches set currency='SGD';
update public.development_settings set enabled=true;
insert into public.development_operators(user_id) values('c6000000-0000-4000-8000-000000000001');
set local request.jwt.claim.sub='c6000000-0000-4000-8000-000000000001';
select pg_temp.assert_true((public.seatlink_daily_sales_at('c6000000-0000-4000-8000-000000000020','2026-11-23 03:00Z')->>'total_minor')='0','Genuine zero was not returned');
set local role authenticated;
select set_config('test.station',(public.read_branch_sales('c6000000-0000-4000-8000-000000000020')->'station'->>'id'),true);
do $$
declare n integer; oid uuid; receipt uuid; seats uuid[];
begin
 for n in 1..3 loop
  oid:=gen_random_uuid();receipt:=gen_random_uuid();
  seats:=case when n=3 then array['c6000000-0000-4000-8000-000000000050']::uuid[] else '{}'::uuid[] end;
  perform public.continue_to_seats(oid,'c6000000-0000-4000-8000-000000000020',0,gen_random_uuid(),
   '[{"menu_item_id":"c6000000-0000-4000-8000-000000000030","quantity":1}]');
  perform public.confirm_order_seats(oid,1,seats);
  perform public.select_payment_method(oid,'CASH');
  perform public.confirm_cash_payment(oid,receipt,500);
  perform public.confirm_cash_payment(oid,receipt,500);
  perform set_config('test.cash_'||n,receipt::text,true);
  if n=3 then perform set_config('test.seated_order',oid::text,true); end if;
  perform public.start_next_sale(current_setting('test.station')::uuid);
 end loop;
end;
$$;

-- Two verified sandbox QR orders, both without seats.
reset role;
update public.payment_runtime set mode='SANDBOX',merchant_id='TEST_MERCHANT';
set local role authenticated;
select public.continue_to_seats('c6000000-0000-4000-8000-000000000063','c6000000-0000-4000-8000-000000000020',0,gen_random_uuid(),
 '[{"menu_item_id":"c6000000-0000-4000-8000-000000000030","quantity":1}]');
select public.confirm_order_seats('c6000000-0000-4000-8000-000000000063',1,'{}');
select public.select_payment_method('c6000000-0000-4000-8000-000000000063','QR');
select public.begin_sandbox_payment('c6000000-0000-4000-8000-000000000063','c6000000-0000-4000-8000-000000000083');
select set_config('test.invoice1',(select provider_invoice from public.payment_attempts where id='c6000000-0000-4000-8000-000000000083'),true);
set local role service_role;
select public.apply_verified_sandbox_result('c6000000-0000-4000-8000-000000000083','TEST_MERCHANT',current_setting('test.invoice1'),180,'SGD','sales-qr-before','SUCCESS',gen_random_uuid());
set local role authenticated;
select public.start_next_sale(current_setting('test.station')::uuid);
select public.continue_to_seats('c6000000-0000-4000-8000-000000000064','c6000000-0000-4000-8000-000000000020',0,gen_random_uuid(),
 '[{"menu_item_id":"c6000000-0000-4000-8000-000000000030","quantity":1}]');
select public.confirm_order_seats('c6000000-0000-4000-8000-000000000064',1,'{}');
select public.select_payment_method('c6000000-0000-4000-8000-000000000064','QR');
select public.begin_sandbox_payment('c6000000-0000-4000-8000-000000000064','c6000000-0000-4000-8000-000000000084');
select set_config('test.invoice2',(select provider_invoice from public.payment_attempts where id='c6000000-0000-4000-8000-000000000084'),true);
set local role service_role;
select public.apply_verified_sandbox_result('c6000000-0000-4000-8000-000000000084','TEST_MERCHANT',current_setting('test.invoice2'),180,'SGD','sales-qr-counted','SUCCESS',gen_random_uuid());
select public.apply_verified_sandbox_result('c6000000-0000-4000-8000-000000000084','TEST_MERCHANT',current_setting('test.invoice2'),180,'SGD','sales-qr-counted','SUCCESS',gen_random_uuid());
select public.apply_verified_sandbox_result('c6000000-0000-4000-8000-000000000084','TEST_MERCHANT',current_setting('test.invoice2'),180,'SGD','sales-qr-extra','SUCCESS',gen_random_uuid());
set local role authenticated;
select public.start_next_sale(current_setting('test.station')::uuid);

-- A successful mock payment and a failed/cancelled payment must not inflate gross sales.
-- A cancelled checkout receiving a late verified payment is owner-review money, not a completed sale.
select public.continue_to_seats('c6000000-0000-4000-8000-000000000069','c6000000-0000-4000-8000-000000000020',0,gen_random_uuid(),
 '[{"menu_item_id":"c6000000-0000-4000-8000-000000000030","quantity":1}]');
select public.confirm_order_seats('c6000000-0000-4000-8000-000000000069',1,'{}');
select public.select_payment_method('c6000000-0000-4000-8000-000000000069','QR');
select public.begin_sandbox_payment('c6000000-0000-4000-8000-000000000069','c6000000-0000-4000-8000-000000000089');
select set_config('test.late_invoice',(select provider_invoice from public.payment_attempts where id='c6000000-0000-4000-8000-000000000089'),true);
select public.cancel_order('c6000000-0000-4000-8000-000000000069');
set local role service_role;
select public.apply_verified_sandbox_result('c6000000-0000-4000-8000-000000000089','TEST_MERCHANT',current_setting('test.late_invoice'),180,'SGD','late-cancelled-sales','SUCCESS',gen_random_uuid());
set local role authenticated;
select public.start_next_sale(current_setting('test.station')::uuid);
reset role;
update public.payment_runtime set mode='MOCK';
set local role authenticated;
select public.continue_to_seats('c6000000-0000-4000-8000-000000000065','c6000000-0000-4000-8000-000000000020',0,gen_random_uuid(),
 '[{"menu_item_id":"c6000000-0000-4000-8000-000000000030","quantity":1}]');
select public.confirm_order_seats('c6000000-0000-4000-8000-000000000065',1,'{}');
select public.select_payment_method('c6000000-0000-4000-8000-000000000065','QR');
select public.prepare_mock_qr('c6000000-0000-4000-8000-000000000065','c6000000-0000-4000-8000-000000000085');
select public.simulate_mock_payment('c6000000-0000-4000-8000-000000000085',gen_random_uuid(),'SUCCESS');
select public.start_next_sale(current_setting('test.station')::uuid);
select public.continue_to_seats('c6000000-0000-4000-8000-000000000066','c6000000-0000-4000-8000-000000000020',0,gen_random_uuid(),
 '[{"menu_item_id":"c6000000-0000-4000-8000-000000000030","quantity":1}]');
select public.confirm_order_seats('c6000000-0000-4000-8000-000000000066',1,'{}');
select public.select_payment_method('c6000000-0000-4000-8000-000000000066','QR');
select public.prepare_mock_qr('c6000000-0000-4000-8000-000000000066','c6000000-0000-4000-8000-000000000086');
select public.simulate_mock_payment('c6000000-0000-4000-8000-000000000086',gen_random_uuid(),'FAILURE');
select public.cancel_order('c6000000-0000-4000-8000-000000000066');
select public.start_next_sale(current_setting('test.station')::uuid);
select public.continue_to_seats('c6000000-0000-4000-8000-000000000067','c6000000-0000-4000-8000-000000000020',0,gen_random_uuid(),
 '[{"menu_item_id":"c6000000-0000-4000-8000-000000000030","quantity":1}]');

-- Another branch has its own independently paid order.
select public.continue_to_seats('c6000000-0000-4000-8000-000000000068','c6000000-0000-4000-8000-000000000021',0,gen_random_uuid(),
 '[{"menu_item_id":"c6000000-0000-4000-8000-000000000031","quantity":1}]');
select public.confirm_order_seats('c6000000-0000-4000-8000-000000000068',1,'{}');
select public.select_payment_method('c6000000-0000-4000-8000-000000000068','CASH');
select public.confirm_cash_payment('c6000000-0000-4000-8000-000000000068','c6000000-0000-4000-8000-000000000088',500);
reset role;
update public.payment_attempts set succeeded_at='2026-11-23 03:00Z' where status='SUCCEEDED';
update public.payment_attempts set succeeded_at='2026-11-22 16:00Z' where id=current_setting('test.cash_1')::uuid;
update public.payment_attempts set succeeded_at='2026-11-23 16:00Z' where id=current_setting('test.cash_2')::uuid;
update public.payment_attempts set succeeded_at='2026-11-22 15:59:59.999999Z' where id='c6000000-0000-4000-8000-000000000083';
select pg_temp.assert_true(public.seatlink_daily_sales_at('c6000000-0000-4000-8000-000000000020','2026-11-23 03:00Z')->>'total_minor'='540'
 and public.seatlink_daily_sales_at('c6000000-0000-4000-8000-000000000020','2026-11-23 03:00Z')->>'paid_orders'='3',
 'Daily totals included wrong day, mock, another branch, duplicate payment or excluded zero-seat payments');
select pg_temp.assert_true(public.seatlink_daily_sales_at('c6000000-0000-4000-8000-000000000020','2026-11-23 03:00Z')->>'sandbox_orders'='1','Sandbox amount was not identified');
select pg_temp.assert_true(public.seatlink_daily_sales_at('c6000000-0000-4000-8000-000000000020','2026-11-23 17:00Z')->>'total_minor'='180','End boundary was not exclusive');
select pg_temp.assert_true(public.seatlink_daily_sales_at('c6000000-0000-4000-8000-000000000021','2026-11-23 03:00Z')->>'total_minor'='200','Branch isolation failed');
set local role authenticated;
select public.release_seat_use(current_setting('test.seated_order')::uuid,(select array_agg(id) from public.seat_use_sessions where order_id=current_setting('test.seated_order')::uuid));
select pg_temp.assert_true(public.read_branch_daily_sales('c6000000-0000-4000-8000-000000000020')->>'branch_id'='c6000000-0000-4000-8000-000000000020','Owner RPC failed');
select pg_temp.expect_error($cmd$select public.read_branch_daily_sales('c6000000-0000-4000-8000-000000000022')$cmd$,'access denied');
select pg_temp.expect_error($cmd$select public.seatlink_daily_sales_at('c6000000-0000-4000-8000-000000000020',now())$cmd$,'permission denied');
reset role;
select pg_temp.assert_true(public.seatlink_daily_sales_at('c6000000-0000-4000-8000-000000000020','2026-11-23 03:00Z')->>'total_minor'='540','Seat release reduced sales');
update public.branches set timezone='America/New_York' where id='c6000000-0000-4000-8000-000000000020';
select pg_temp.assert_true((public.seatlink_daily_sales_at('c6000000-0000-4000-8000-000000000020','2026-11-01 12:00Z')->>'day_end')::timestamptz-
 (public.seatlink_daily_sales_at('c6000000-0000-4000-8000-000000000020','2026-11-01 12:00Z')->>'day_start')::timestamptz=interval '25 hours','Fall DST day was not 25 hours');
select pg_temp.assert_true((public.seatlink_daily_sales_at('c6000000-0000-4000-8000-000000000020','2026-03-08 12:00Z')->>'day_end')::timestamptz-
 (public.seatlink_daily_sales_at('c6000000-0000-4000-8000-000000000020','2026-03-08 12:00Z')->>'day_start')::timestamptz=interval '23 hours','Spring DST day was not 23 hours');
select pg_temp.expect_error($cmd$update public.branches set timezone='Invalid/Zone' where id='c6000000-0000-4000-8000-000000000020'$cmd$,'IANA');
update public.branches set currency='USD' where id='c6000000-0000-4000-8000-000000000021';
select pg_temp.expect_error($cmd$select public.seatlink_daily_sales_at('c6000000-0000-4000-8000-000000000021','2026-11-23 03:00Z')$cmd$,'different currency');
update public.branches set currency=null where id='c6000000-0000-4000-8000-000000000021';
select pg_temp.expect_error($cmd$select public.seatlink_daily_sales_at('c6000000-0000-4000-8000-000000000021','2026-11-23 03:00Z')$cmd$,'Configure this branch currency');
set local role anon;
select pg_temp.expect_error($cmd$select public.read_branch_daily_sales('c6000000-0000-4000-8000-000000000020')$cmd$,'permission denied');
rollback;


