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

set local role authenticated;
set local request.jwt.claim.sub='c6000000-0000-4000-8000-000000000001';
select set_config('test.station',(public.read_branch_sales('c6000000-0000-4000-8000-000000000020')->'station'->>'id'),true);
select pg_temp.assert_true(public.read_branch_sales('c6000000-0000-4000-8000-000000000020')->>'qr_configuration'='MOCK_ACCESS_DISABLED','Disabled mock access was not diagnosed');
select set_config('test.display',public.pair_customer_display(current_setting('test.station')::uuid),true);
select public.continue_to_seats('c6000000-0000-4000-8000-000000000060','c6000000-0000-4000-8000-000000000020',0,gen_random_uuid(),
 '[{"menu_item_id":"c6000000-0000-4000-8000-000000000030","quantity":1}]');
select public.confirm_order_seats('c6000000-0000-4000-8000-000000000060',1,array['c6000000-0000-4000-8000-000000000050']::uuid[]);
select public.select_payment_method('c6000000-0000-4000-8000-000000000060','QR');
select pg_temp.expect_error($cmd$select public.prepare_mock_qr('c6000000-0000-4000-8000-000000000060',gen_random_uuid())$cmd$,'Development');
reset role;
update public.development_settings set enabled=true;
insert into public.development_operators(user_id) values('c6000000-0000-4000-8000-000000000001');
set local role authenticated;
select public.prepare_mock_qr('c6000000-0000-4000-8000-000000000060','c6000000-0000-4000-8000-000000000080');
select public.prepare_mock_qr('c6000000-0000-4000-8000-000000000060',gen_random_uuid());
select pg_temp.assert_true((select count(*)=1 from public.payment_attempts),'Repeated confirmation created an extra QR');
select set_config('test.reservation',(select session_expires_at::text from public.orders where id='c6000000-0000-4000-8000-000000000060'),true);
select pg_temp.assert_true(public.read_customer_display(current_setting('test.display'))->'order'->>'payment_attempt_id'='c6000000-0000-4000-8000-000000000080','Display did not restore the current attempt');
reset role;
update public.payment_attempts set qr_expires_at=clock_timestamp()-interval '1 second';
set local role anon;
select pg_temp.assert_true(public.read_customer_display(current_setting('test.display'))->'order'->>'qr_text' is null,'Expired QR remained visible');
select pg_temp.expect_error($cmd$select public.prepare_mock_qr('c6000000-0000-4000-8000-000000000060',gen_random_uuid())$cmd$,'permission denied');
set local role authenticated;
select public.prepare_mock_qr('c6000000-0000-4000-8000-000000000060','c6000000-0000-4000-8000-000000000081');
select pg_temp.assert_true((select session_expires_at=current_setting('test.reservation')::timestamptz from public.orders where id='c6000000-0000-4000-8000-000000000060'),'Renewal changed the seat deadline');
select pg_temp.assert_true(public.read_customer_display(current_setting('test.display'))->'order'->>'payment_attempt_id'=
 public.read_branch_sales('c6000000-0000-4000-8000-000000000020')->'attempts'->0->>'id','Owner and display chose different QR attempts');
select public.cancel_order('c6000000-0000-4000-8000-000000000060');
select public.start_next_sale(current_setting('test.station')::uuid);
select public.continue_to_seats('c6000000-0000-4000-8000-000000000061','c6000000-0000-4000-8000-000000000020',0,gen_random_uuid(),
 '[{"menu_item_id":"c6000000-0000-4000-8000-000000000030","quantity":1}]');
select public.simulate_mock_payment('c6000000-0000-4000-8000-000000000081',gen_random_uuid(),'SUCCESS');
select pg_temp.assert_true(public.read_customer_display(current_setting('test.display'))->'order'->>'reference'=left('c6000000-0000-4000-8000-000000000061',8)
 and public.read_customer_display(current_setting('test.display'))->'order'->>'status'='DRAFT'
 and public.read_customer_display(current_setting('test.display'))->'order'->>'qr_text' is null,'An earlier payment event overwrote the newer checkout');
select public.confirm_order_seats('c6000000-0000-4000-8000-000000000061',1,array['c6000000-0000-4000-8000-000000000050']::uuid[]);
select public.select_payment_method('c6000000-0000-4000-8000-000000000061','QR');
reset role;
update public.payment_runtime set mode='SANDBOX',merchant_id='TEST_MERCHANT';
set local role authenticated;
select public.begin_sandbox_payment('c6000000-0000-4000-8000-000000000061','c6000000-0000-4000-8000-000000000082');
select public.begin_sandbox_payment('c6000000-0000-4000-8000-000000000061',gen_random_uuid());
select pg_temp.assert_true((select count(*)=1 from public.payment_attempts where provider='TWO_C2P'),'Sandbox confirmation did not reuse the attempt');
set local role service_role;
select public.store_sandbox_qr_expiry('c6000000-0000-4000-8000-000000000082','private-token','https://api.2c2p.com/pgw/qr/test.png',30000);
set local role authenticated;
select pg_temp.assert_true(public.read_customer_display(current_setting('test.display'))->'order'->>'qr_image_url'='https://api.2c2p.com/pgw/qr/test.png'
 and public.read_customer_display(current_setting('test.display'))->'order'->>'qr_text' is null,'Provider image was not projected or was encoded as a mock QR');
select pg_temp.assert_true((select provider_qr_expires_at<o.session_expires_at from public.payment_attempts p join public.orders o on o.id=p.order_id where p.id='c6000000-0000-4000-8000-000000000082'),'Provider QR expiry was confused with reservation expiry');
set local role anon;
select pg_temp.expect_error($cmd$select public.store_sandbox_qr_expiry('c6000000-0000-4000-8000-000000000082','token','https://api.2c2p.com/pgw/qr/test.png',30000)$cmd$,'permission denied');
rollback;


