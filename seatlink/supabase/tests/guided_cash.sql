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
select pg_temp.assert_true(
 (public.update_cart_preview(current_setting('test.station')::uuid,0,'[{"menu_item_id":"c6000000-0000-4000-8000-000000000030","quantity":1}]')->>'total_minor')::integer=180,
 'Cart preview did not calculate the server total');
select public.continue_to_seats('c6000000-0000-4000-8000-000000000060','c6000000-0000-4000-8000-000000000020',0,gen_random_uuid(),
 '[{"menu_item_id":"c6000000-0000-4000-8000-000000000030","quantity":1,"price_minor":1}]');
select pg_temp.assert_true((select checkout_step='SEATS' and total_minor=180 from public.orders where id='c6000000-0000-4000-8000-000000000060'),
 'Continue to seats did not save a validated order');
select public.update_selected_seats('c6000000-0000-4000-8000-000000000060',array['c6000000-0000-4000-8000-000000000050']::uuid[]);
select set_config('test.display',public.pair_customer_display(current_setting('test.station')::uuid),true);
select public.change_draft_step('c6000000-0000-4000-8000-000000000060','MENU');
select public.update_cart_preview(current_setting('test.station')::uuid,
 (public.read_branch_sales('c6000000-0000-4000-8000-000000000020')->>'cart_revision')::integer,'[]');
select pg_temp.assert_true(jsonb_array_length(public.read_customer_display(current_setting('test.display'))->'order'->'items')=0,
 'Emptying a menu cart left old saved items on the display');
select public.change_draft_step('c6000000-0000-4000-8000-000000000060','SEATS');
select public.confirm_order_seats('c6000000-0000-4000-8000-000000000060',1,array['c6000000-0000-4000-8000-000000000050']::uuid[]);
select set_config('test.reservation',(select session_expires_at::text from public.orders where id='c6000000-0000-4000-8000-000000000060'),true);
select public.select_payment_method('c6000000-0000-4000-8000-000000000060','CASH');
select pg_temp.assert_true(
 (select status='PENDING' and checkout_step='PAYMENT' and session_expires_at=current_setting('test.reservation')::timestamptz from public.orders where id='c6000000-0000-4000-8000-000000000060'),
 'Choosing cash marked paid or reset the reservation');
select pg_temp.expect_error($cmd$
 select public.confirm_cash_payment('c6000000-0000-4000-8000-000000000060',gen_random_uuid(),179)
$cmd$,'cover the total');
set local role anon;
select pg_temp.assert_true(public.read_customer_display(current_setting('test.display'))->'order'->>'payment_method'='CASH'
 and public.read_customer_display(current_setting('test.display'))->'order'->>'qr_text' is null,'Cash display contains an obsolete QR');
select pg_temp.expect_error($cmd$
 select public.confirm_cash_payment('c6000000-0000-4000-8000-000000000060',gen_random_uuid(),500)
$cmd$,'permission denied');
set local role authenticated;
select public.confirm_cash_payment('c6000000-0000-4000-8000-000000000060','c6000000-0000-4000-8000-000000000070',500);
select public.confirm_cash_payment('c6000000-0000-4000-8000-000000000060','c6000000-0000-4000-8000-000000000070',500);
select pg_temp.assert_true(
 (select status='PAID' and checkout_step='RESULT' and paid_method='CASH' from public.orders where id='c6000000-0000-4000-8000-000000000060')
 and (select cash_change_minor=320 and confirmed_by=auth.uid() and succeeded_at is not null from public.payment_attempts where id='c6000000-0000-4000-8000-000000000070')
 and (select count(*)=1 and bool_and(expires_at-started_at=interval '10 minutes') from public.seat_use_sessions where order_id='c6000000-0000-4000-8000-000000000060'),
 'Cash receipt, idempotency or ten-minute allocation is incorrect');
select pg_temp.expect_error($cmd$
 select public.confirm_cash_payment('c6000000-0000-4000-8000-000000000060',gen_random_uuid(),500)
$cmd$,'already paid');
select public.start_next_sale(current_setting('test.station')::uuid);
select pg_temp.assert_true((select status='UNAVAILABLE' from public.seats where id='c6000000-0000-4000-8000-000000000050'),
 'Starting the next order reset a paid seat');

-- QR expiry or hiding it does not resolve provider liability.
select public.continue_to_seats('c6000000-0000-4000-8000-000000000061','c6000000-0000-4000-8000-000000000020',0,gen_random_uuid(),
 '[{"menu_item_id":"c6000000-0000-4000-8000-000000000030","quantity":1}]');
select public.confirm_order_seats('c6000000-0000-4000-8000-000000000061',1,array['c6000000-0000-4000-8000-000000000051','c6000000-0000-4000-8000-000000000052']::uuid[]);
select public.select_payment_method('c6000000-0000-4000-8000-000000000061','QR');
reset role;
update public.development_settings set enabled=true;
insert into public.development_operators values('c6000000-0000-4000-8000-000000000001');
set local role authenticated;
select public.create_mock_payment('c6000000-0000-4000-8000-000000000061','c6000000-0000-4000-8000-000000000080');
select set_config('test.reservation',(select session_expires_at::text from public.orders where id='c6000000-0000-4000-8000-000000000061'),true);
select public.select_payment_method('c6000000-0000-4000-8000-000000000061','CASH');
reset role;
update public.payment_attempts set qr_expires_at=clock_timestamp()-interval '1 second' where id='c6000000-0000-4000-8000-000000000080';
select public.expire_order_sessions();
set local role authenticated;
select pg_temp.expect_error($cmd$
 select public.confirm_cash_payment('c6000000-0000-4000-8000-000000000061',gen_random_uuid(),500)
$cmd$,'QR attempt may still accept payment');
select pg_temp.assert_true((select session_expires_at=current_setting('test.reservation')::timestamptz from public.orders where id='c6000000-0000-4000-8000-000000000061'),
 'Switching methods reset the reservation');
select public.resolve_mock_attempt('c6000000-0000-4000-8000-000000000080');
select public.confirm_cash_payment('c6000000-0000-4000-8000-000000000061','c6000000-0000-4000-8000-000000000071',500);
select set_config('test.use_deadline',(select min(expires_at)::text from public.seat_use_sessions where order_id='c6000000-0000-4000-8000-000000000061'),true);
select public.simulate_mock_payment('c6000000-0000-4000-8000-000000000080',gen_random_uuid(),'SUCCESS');
select pg_temp.assert_true(
 (select status='PAID_REVIEW' and paid_method='CASH' from public.orders where id='c6000000-0000-4000-8000-000000000061')
 and (select count(*)=2 and min(expires_at)=current_setting('test.use_deadline')::timestamptz from public.seat_use_sessions where order_id='c6000000-0000-4000-8000-000000000061')
 and (select count(*)=2 from public.payment_attempts where order_id='c6000000-0000-4000-8000-000000000061' and status='SUCCEEDED'),
 'Additional QR success after cash lost a payment or allocated twice');

-- Expired cash completion is rejected, even if the owner still has the screen open.
select public.start_next_sale(current_setting('test.station')::uuid);
select public.continue_to_seats('c6000000-0000-4000-8000-000000000062','c6000000-0000-4000-8000-000000000020',0,gen_random_uuid(),
 '[{"menu_item_id":"c6000000-0000-4000-8000-000000000030","quantity":1}]');
select public.confirm_order_seats('c6000000-0000-4000-8000-000000000062',1,array['c6000000-0000-4000-8000-000000000053']::uuid[]);
select public.select_payment_method('c6000000-0000-4000-8000-000000000062','CASH');
reset role;
update public.orders set session_expires_at=clock_timestamp()-interval '1 second' where id='c6000000-0000-4000-8000-000000000062';
select public.expire_order_sessions();
set local role authenticated;
select pg_temp.expect_error($cmd$
 select public.confirm_cash_payment('c6000000-0000-4000-8000-000000000062',gen_random_uuid(),500)
$cmd$,'reservation has ended');
select pg_temp.assert_true(not exists(select 1 from public.payment_attempts where order_id='c6000000-0000-4000-8000-000000000062'),'Expired cash attempt persisted');

-- A browser cannot assert provider verification.
select public.start_next_sale(current_setting('test.station')::uuid);
reset role;
update public.payment_runtime set mode='SANDBOX',merchant_id='TEST_MERCHANT';
set local role authenticated;
select public.continue_to_seats('c6000000-0000-4000-8000-000000000063','c6000000-0000-4000-8000-000000000020',0,gen_random_uuid(),
 '[{"menu_item_id":"c6000000-0000-4000-8000-000000000030","quantity":1}]');
select public.confirm_order_seats('c6000000-0000-4000-8000-000000000063',1,array['c6000000-0000-4000-8000-000000000053']::uuid[]);
select public.select_payment_method('c6000000-0000-4000-8000-000000000063','QR');
select public.begin_sandbox_payment('c6000000-0000-4000-8000-000000000063','c6000000-0000-4000-8000-000000000081');
select pg_temp.expect_error($cmd$
 select public.apply_verified_sandbox_result('c6000000-0000-4000-8000-000000000081','TEST_MERCHANT','x',180,'SGD','ref','SUCCESS',gen_random_uuid())
$cmd$,'permission denied');
select pg_temp.expect_error($cmd$
 select public.simulate_mock_payment('c6000000-0000-4000-8000-000000000081',gen_random_uuid(),'SUCCESS')
$cmd$,'Branch access denied');
select set_config('test.invoice',(select provider_invoice from public.payment_attempts where id='c6000000-0000-4000-8000-000000000081'),true);
set local role service_role;
select public.store_sandbox_qr('c6000000-0000-4000-8000-000000000081','private-token',
 'https://pgw-static-sandbox.s3.amazonaws.com/images/qr/test.png');
set local role anon;
select pg_temp.assert_true(
 public.read_customer_display(current_setting('test.display'))->'order'->>'qr_text' is null
 and public.read_customer_display(current_setting('test.display'))->'order'->>'qr_image_url'=
 'https://pgw-static-sandbox.s3.amazonaws.com/images/qr/test.png',
 'Sandbox customer QR was replaced by a mock QR');
set local role service_role;
select pg_temp.expect_error($cmd$
 select public.apply_verified_sandbox_result('c6000000-0000-4000-8000-000000000081','TEST_MERCHANT',current_setting('test.invoice'),181,'SGD','ref','SUCCESS',gen_random_uuid())
$cmd$,'details do not match');
select public.apply_verified_sandbox_result('c6000000-0000-4000-8000-000000000081','TEST_MERCHANT',current_setting('test.invoice'),180,'SGD','provider-ref-one','SUCCESS',gen_random_uuid());
select public.apply_verified_sandbox_result('c6000000-0000-4000-8000-000000000081','TEST_MERCHANT',current_setting('test.invoice'),180,'SGD','provider-ref-one','SUCCESS',gen_random_uuid());
select public.apply_verified_sandbox_result('c6000000-0000-4000-8000-000000000081','TEST_MERCHANT',current_setting('test.invoice'),180,'SGD','provider-ref-two','SUCCESS',gen_random_uuid());
reset role;
select pg_temp.assert_true(
 (select count(*)=1 from public.seat_use_sessions where order_id='c6000000-0000-4000-8000-000000000063')
 and (select count(*)=2 from public.provider_receipts)
 and (select status='PAID_REVIEW' from public.orders where id='c6000000-0000-4000-8000-000000000063'),
 'Distinct provider references were lost or allocated twice');
rollback;
