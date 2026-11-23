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

update public.development_settings set enabled=true;
insert into public.development_operators(user_id) values('c6000000-0000-4000-8000-000000000001');
set local role authenticated;
set local request.jwt.claim.sub='c6000000-0000-4000-8000-000000000001';
select set_config('test.station',(public.read_branch_sales('c6000000-0000-4000-8000-000000000020')->'station'->>'id'),true);
select set_config('test.display',public.pair_customer_display(current_setting('test.station')::uuid),true);

do $$
declare n integer; oid uuid; receipt uuid; selected uuid[]; sessions uuid[]; chosen public.orders;
 all_seats uuid[]:=array['c6000000-0000-4000-8000-000000000050','c6000000-0000-4000-8000-000000000051',
 'c6000000-0000-4000-8000-000000000052','c6000000-0000-4000-8000-000000000053']::uuid[];
begin
 for n in 0..4 loop
  oid:=gen_random_uuid();receipt:=gen_random_uuid();selected:=case when n=0 then '{}'::uuid[] else all_seats[1:n] end;
  perform public.continue_to_seats(oid,'c6000000-0000-4000-8000-000000000020',0,gen_random_uuid(),
   '[{"menu_item_id":"c6000000-0000-4000-8000-000000000030","quantity":1}]');
  chosen:=public.confirm_order_seats(oid,1,selected);
  perform pg_temp.assert_true(chosen.status='PENDING' and chosen.session_expires_at>clock_timestamp()+interval '4 minutes 59 seconds','Checkout expiry missing');
  perform pg_temp.assert_true((select count(*)=n from public.seats where locked_order_id=oid),'Unexpected reservation count');
  perform public.select_payment_method(oid,'CASH');
  perform public.confirm_cash_payment(oid,receipt,500);
  perform public.confirm_cash_payment(oid,receipt,500);
  perform pg_temp.assert_true((select status='PAID' from public.orders where id=oid),'Cash checkout did not complete');
  perform pg_temp.assert_true((select count(*)=n from public.seat_use_sessions where order_id=oid),'Wrong allocation count, including zero-seat order');
  perform pg_temp.assert_true((select coalesce(bool_and(expires_at-started_at=interval '10 minutes'),true) from public.seat_use_sessions where order_id=oid),'Seat-use duration changed');
  perform pg_temp.assert_true((select count(*)=1 from public.payment_attempts where order_id=oid),'Cash retry duplicated receipt');
  if n>0 then
   select array_agg(id) into sessions from public.seat_use_sessions where order_id=oid;
   perform public.release_seat_use(oid,sessions);
  end if;
  perform public.start_next_sale(current_setting('test.station')::uuid);
 end loop;
end;
$$;

-- A different checkout keeps its lock while this order changes to zero seats.
set local request.jwt.claim.sub='c6000000-0000-4000-8000-000000000002';
select public.continue_to_seats('c6000000-0000-4000-8000-000000000061','c6000000-0000-4000-8000-000000000020',0,gen_random_uuid(),
 '[{"menu_item_id":"c6000000-0000-4000-8000-000000000030","quantity":1}]');
select public.confirm_order_seats('c6000000-0000-4000-8000-000000000061',1,array['c6000000-0000-4000-8000-000000000051']::uuid[]);
select set_config('test.other_display',public.pair_customer_display((public.read_branch_sales('c6000000-0000-4000-8000-000000000020')->'station'->>'id')::uuid),true);
set local request.jwt.claim.sub='c6000000-0000-4000-8000-000000000001';
select public.continue_to_seats('c6000000-0000-4000-8000-000000000060','c6000000-0000-4000-8000-000000000020',0,gen_random_uuid(),
 '[{"menu_item_id":"c6000000-0000-4000-8000-000000000030","quantity":1}]');
select pg_temp.expect_error($cmd$select public.confirm_order_seats('c6000000-0000-4000-8000-000000000060',1,
 array['c6000000-0000-4000-8000-000000000050','c6000000-0000-4000-8000-000000000051','c6000000-0000-4000-8000-000000000052',
 'c6000000-0000-4000-8000-000000000053','c6000000-0000-4000-8000-000000000054']::uuid[])$cmd$,'zero to four');
select public.update_selected_seats('c6000000-0000-4000-8000-000000000060',array['c6000000-0000-4000-8000-000000000050']::uuid[]);
select public.confirm_order_seats('c6000000-0000-4000-8000-000000000060',1,array['c6000000-0000-4000-8000-000000000050']::uuid[]);
select set_config('test.deadline',(select session_expires_at::text from public.orders where id='c6000000-0000-4000-8000-000000000060'),true);
select pg_temp.assert_true(public.read_customer_display(current_setting('test.display'))->'tables'->0->'seats'->0->>'current_order'='true','Own reserved seat missing');
select pg_temp.assert_true(public.read_customer_display(current_setting('test.other_display'))->'tables'->0->'seats'->0->>'current_order'='false','Other station highlighted this order');
select public.confirm_order_seats('c6000000-0000-4000-8000-000000000060',2,'{}');
select public.confirm_order_seats('c6000000-0000-4000-8000-000000000060',2,'{}');
select pg_temp.assert_true((select status='AVAILABLE' and locked_order_id is null from public.seats where id='c6000000-0000-4000-8000-000000000050'),'Skip did not release own lock');
select pg_temp.assert_true((select status='LOCKED' and locked_order_id='c6000000-0000-4000-8000-000000000061' from public.seats where id='c6000000-0000-4000-8000-000000000051'),'Skip released another order');
select pg_temp.assert_true((select session_expires_at=current_setting('test.deadline')::timestamptz and cardinality(draft_seat_ids)=0 from public.orders where id='c6000000-0000-4000-8000-000000000060'),'Skip reset expiry or retained draft selection');
select pg_temp.assert_true(jsonb_array_length(public.read_customer_display(current_setting('test.display'))->'order'->'selected_seats')=0,'Skipped seats remained on paired display');
select public.select_payment_method('c6000000-0000-4000-8000-000000000060','QR');
select public.prepare_mock_qr('c6000000-0000-4000-8000-000000000060','c6000000-0000-4000-8000-000000000080');
select public.simulate_mock_payment('c6000000-0000-4000-8000-000000000080','c6000000-0000-4000-8000-000000000081','SUCCESS');
select public.simulate_mock_payment('c6000000-0000-4000-8000-000000000080','c6000000-0000-4000-8000-000000000081','SUCCESS');
select pg_temp.assert_true((select status='PAID' from public.orders where id='c6000000-0000-4000-8000-000000000060'),'Zero-seat QR not paid');
select pg_temp.assert_true(not exists(select 1 from public.seat_use_sessions where order_id='c6000000-0000-4000-8000-000000000060'),'Zero-seat QR created a timer');
select pg_temp.expect_error($cmd$select public.confirm_order_seats('c6000000-0000-4000-8000-000000000060',3,'{}')$cmd$,'already paid');
select public.start_next_sale(current_setting('test.station')::uuid);
select public.continue_to_seats('c6000000-0000-4000-8000-000000000062','c6000000-0000-4000-8000-000000000020',0,gen_random_uuid(),
 '[{"menu_item_id":"c6000000-0000-4000-8000-000000000030","quantity":1}]');
select public.confirm_order_seats('c6000000-0000-4000-8000-000000000062',1,'{}');
select public.select_payment_method('c6000000-0000-4000-8000-000000000062','CASH');
select public.select_payment_method('c6000000-0000-4000-8000-000000000062','QR');
select public.prepare_mock_qr('c6000000-0000-4000-8000-000000000062','c6000000-0000-4000-8000-000000000084');
select public.select_payment_method('c6000000-0000-4000-8000-000000000062','CASH');
reset role;
update public.orders set session_expires_at=clock_timestamp()-interval '1 second' where id='c6000000-0000-4000-8000-000000000062';
set local role authenticated;
select pg_temp.expect_error($cmd$select public.confirm_cash_payment('c6000000-0000-4000-8000-000000000062',gen_random_uuid(),500)$cmd$,'reservation has ended');
select public.simulate_mock_payment('c6000000-0000-4000-8000-000000000084',gen_random_uuid(),'SUCCESS');
select pg_temp.assert_true((select status='PAID_REVIEW' from public.orders where id='c6000000-0000-4000-8000-000000000062')
 and not exists(select 1 from public.seat_use_sessions where order_id='c6000000-0000-4000-8000-000000000062'),'Late zero-seat success bypassed review');
select public.start_next_sale(current_setting('test.station')::uuid);
select public.continue_to_seats('c6000000-0000-4000-8000-000000000063','c6000000-0000-4000-8000-000000000020',0,gen_random_uuid(),
 '[{"menu_item_id":"c6000000-0000-4000-8000-000000000030","quantity":1}]');
select public.confirm_order_seats('c6000000-0000-4000-8000-000000000063',1,'{}');
select public.select_payment_method('c6000000-0000-4000-8000-000000000063','QR');
reset role;
update public.payment_runtime set mode='SANDBOX',merchant_id='TEST_MERCHANT';
set local role authenticated;
select public.begin_sandbox_payment('c6000000-0000-4000-8000-000000000063','c6000000-0000-4000-8000-000000000085');
select set_config('test.invoice',(select provider_invoice from public.payment_attempts where id='c6000000-0000-4000-8000-000000000085'),true);
set local role service_role;
select public.apply_verified_sandbox_result('c6000000-0000-4000-8000-000000000085','TEST_MERCHANT',current_setting('test.invoice'),180,'SGD','zero-seat-provider-ref','SUCCESS',gen_random_uuid());
set local role authenticated;
select pg_temp.assert_true((select status='PAID' from public.orders where id='c6000000-0000-4000-8000-000000000063')
 and not exists(select 1 from public.seat_use_sessions where order_id='c6000000-0000-4000-8000-000000000063'),'Verified zero-seat provider success created seat use or failed to complete');
set local role anon;
select pg_temp.expect_error($cmd$select public.confirm_order_seats('c6000000-0000-4000-8000-000000000062',2,'{}')$cmd$,'permission denied');
rollback;


