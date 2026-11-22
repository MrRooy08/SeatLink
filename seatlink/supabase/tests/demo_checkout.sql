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
set local request.jwt.claim.sub = 'c6000000-0000-4000-8000-000000000001';

select public.save_draft_order(
 'c6000000-0000-4000-8000-000000000060','c6000000-0000-4000-8000-000000000020',0,gen_random_uuid(),
 '[{"menu_item_id":"c6000000-0000-4000-8000-000000000030","quantity":1}]');
select public.confirm_order_seats('c6000000-0000-4000-8000-000000000060',1,
 array['c6000000-0000-4000-8000-000000000050','c6000000-0000-4000-8000-000000000051']::uuid[]);
select set_config('test.deadline',(select session_expires_at::text from public.orders where id='c6000000-0000-4000-8000-000000000060'),true);
select pg_temp.expect_error($cmd$
 select public.create_mock_payment('c6000000-0000-4000-8000-000000000060',gen_random_uuid())
$cmd$, 'Development simulator access denied');

reset role;
update public.development_settings set enabled=true;
insert into public.development_operators values ('c6000000-0000-4000-8000-000000000001'),('c6000000-0000-4000-8000-000000000002');
set local role authenticated;

select public.create_mock_payment('c6000000-0000-4000-8000-000000000060','c6000000-0000-4000-8000-000000000080');
select public.simulate_mock_payment('c6000000-0000-4000-8000-000000000080','c6000000-0000-4000-8000-000000000090','FAILURE');
select pg_temp.assert_true(
 (select status='PENDING' and session_expires_at=current_setting('test.deadline')::timestamptz from public.orders where id='c6000000-0000-4000-8000-000000000060')
 and (select count(*)=2 from public.seats where locked_order_id='c6000000-0000-4000-8000-000000000060'),
 'Failed payment reset the deadline or released locks');
select public.create_mock_payment('c6000000-0000-4000-8000-000000000060','c6000000-0000-4000-8000-000000000081');
select pg_temp.assert_true(
 (select session_expires_at=current_setting('test.deadline')::timestamptz from public.orders where id='c6000000-0000-4000-8000-000000000060'),
 'Payment retry reset the five-minute deadline');

-- QR expiry is independent of reservation expiry.
reset role;
update public.payment_attempts set qr_expires_at=clock_timestamp()-interval '1 second' where id='c6000000-0000-4000-8000-000000000081';
select public.expire_order_sessions();
set local role authenticated;
select pg_temp.assert_true(
 (select status='PENDING' from public.orders where id='c6000000-0000-4000-8000-000000000060')
 and (select status='EXPIRED' from public.payment_attempts where id='c6000000-0000-4000-8000-000000000081'),
 'QR expiry ended a valid reservation');
select public.create_mock_payment('c6000000-0000-4000-8000-000000000060','c6000000-0000-4000-8000-000000000082');
select public.simulate_mock_payment('c6000000-0000-4000-8000-000000000082','c6000000-0000-4000-8000-000000000091','SUCCESS');
select set_config('test.started',(select min(started_at)::text from public.seat_use_sessions where order_id='c6000000-0000-4000-8000-000000000060'),true);
select set_config('test.use_a',(select id::text from public.seat_use_sessions where seat_id='c6000000-0000-4000-8000-000000000050'),true);
select set_config('test.use_b',(select id::text from public.seat_use_sessions where seat_id='c6000000-0000-4000-8000-000000000051'),true);
select set_config('test.expiry_a',(select expires_at::text from public.seat_use_sessions where id=current_setting('test.use_a')::uuid),true);
select pg_temp.assert_true(
 (select count(*)=2 and bool_and(expires_at-started_at=interval '10 minutes') from public.seat_use_sessions where order_id='c6000000-0000-4000-8000-000000000060')
 and (select count(*)=2 from public.seats where status='UNAVAILABLE' and active_seat_use_session_id is not null),
 'Payment success did not start exactly two ten-minute allocations');
select public.simulate_mock_payment('c6000000-0000-4000-8000-000000000082','c6000000-0000-4000-8000-000000000091','SUCCESS');
select public.simulate_mock_payment('c6000000-0000-4000-8000-000000000082',gen_random_uuid(),'SUCCESS');
select pg_temp.assert_true(
 (select count(*)=2 and min(started_at)=current_setting('test.started')::timestamptz from public.seat_use_sessions where order_id='c6000000-0000-4000-8000-000000000060'),
 'Duplicate payment restarted or duplicated allocations');

-- Extension retries add time exactly once.
select public.simulate_extension(current_setting('test.use_a')::uuid,'c6000000-0000-4000-8000-000000000092',180);
select public.simulate_extension(current_setting('test.use_a')::uuid,'c6000000-0000-4000-8000-000000000092',180);
select pg_temp.assert_true(
 (select expires_at=current_setting('test.expiry_a')::timestamptz+interval '180 seconds' from public.seat_use_sessions where id=current_setting('test.use_a')::uuid)
 and (select expires_at=current_setting('test.expiry_a')::timestamptz from public.seat_use_sessions where id=current_setting('test.use_b')::uuid),
 'Extension changed another seat or was applied twice');
select pg_temp.expect_error($cmd$
 select public.simulate_extension(current_setting('test.use_a')::uuid,gen_random_uuid(),61)
$cmd$,'positive whole minutes');
select pg_temp.expect_error($cmd$
 select public.simulate_extension(current_setting('test.use_a')::uuid,'c6000000-0000-4000-8000-000000000092',240)
$cmd$,'Request ID was reused');

-- A real device identity is bound to a physical table.
reset role;
insert into public.hardware_devices (table_id,token_hash)
values ('c6000000-0000-4000-8000-000000000040',encode(sha256(convert_to(repeat('a',64),'UTF8')),'hex'));
set local role anon;
select public.extend_seat_use(repeat('a',64),gen_random_uuid(),'c6000000-0000-4000-8000-000000000050',current_setting('test.use_a')::uuid,60);
select pg_temp.expect_error($cmd$
 select public.extend_seat_use(repeat('b',64),gen_random_uuid(),'c6000000-0000-4000-8000-000000000050',current_setting('test.use_a')::uuid,60)
$cmd$,'Device access denied');
select pg_temp.expect_error($cmd$
 select public.extend_seat_use(repeat('a',64),gen_random_uuid(),'c6000000-0000-4000-8000-000000000054',current_setting('test.use_a')::uuid,60)
$cmd$,'Device access denied');
select pg_temp.expect_error($cmd$
 select public.simulate_mock_payment('c6000000-0000-4000-8000-000000000082',gen_random_uuid(),'SUCCESS')
$cmd$,'permission denied');

-- Explicit release scopes preserve other seats and payment history.
set local role authenticated;
select public.release_seat_use('c6000000-0000-4000-8000-000000000060',array[current_setting('test.use_a')::uuid]);
select pg_temp.assert_true(
 (select status='ACTIVE' from public.seat_use_sessions where id=current_setting('test.use_b')::uuid)
 and (select status='AVAILABLE' from public.seats where id='c6000000-0000-4000-8000-000000000050'),
 'Single-seat release affected the wrong allocation');
select pg_temp.expect_error($cmd$
 select public.simulate_extension(current_setting('test.use_a')::uuid,gen_random_uuid(),60)
$cmd$,'ended or changed');
select pg_temp.expect_error($cmd$
 select public.release_seat_use('c6000000-0000-4000-8000-000000000060',array[current_setting('test.use_a')::uuid])
$cmd$,'allocation changed');
select public.release_seat_use('c6000000-0000-4000-8000-000000000060',array[current_setting('test.use_b')::uuid]);
select pg_temp.assert_true(
 (select status='PAID' from public.orders where id='c6000000-0000-4000-8000-000000000060')
 and (select count(*)=1 from public.order_items where order_id='c6000000-0000-4000-8000-000000000060')
 and (select status='SUCCEEDED' from public.payment_attempts where id='c6000000-0000-4000-8000-000000000082'),
 'Release removed paid order history');

-- A second successful attempt produces an exception without allocating again.
select public.simulate_mock_payment('c6000000-0000-4000-8000-000000000080',gen_random_uuid(),'SUCCESS');
select pg_temp.assert_true(
 (select count(*)=1 from public.payment_exceptions where kind='DUPLICATE_PAYMENT')
 and (select count(*)=2 from public.seat_use_sessions where order_id='c6000000-0000-4000-8000-000000000060'),
 'A second payment allocated again or was not flagged');

select set_config('test.display_a',public.pair_customer_display((select station_id from public.orders where id='c6000000-0000-4000-8000-000000000060')),true);
select public.start_next_sale((select station_id from public.orders where id='c6000000-0000-4000-8000-000000000060'));

-- Owner B has a separate checkout station in the same branch.
set local request.jwt.claim.sub='c6000000-0000-4000-8000-000000000002';
select public.save_draft_order('c6000000-0000-4000-8000-000000000061','c6000000-0000-4000-8000-000000000020',0,gen_random_uuid(),
 '[{"menu_item_id":"c6000000-0000-4000-8000-000000000030","quantity":1}]');
select public.confirm_order_seats('c6000000-0000-4000-8000-000000000061',1,array['c6000000-0000-4000-8000-000000000050']::uuid[]);
select public.create_mock_payment('c6000000-0000-4000-8000-000000000061','c6000000-0000-4000-8000-000000000083');
select set_config('test.display_b',public.pair_customer_display((select station_id from public.orders where id='c6000000-0000-4000-8000-000000000061')),true);
select public.cancel_order('c6000000-0000-4000-8000-000000000061');

set local request.jwt.claim.sub='c6000000-0000-4000-8000-000000000001';
select public.save_draft_order('c6000000-0000-4000-8000-000000000062','c6000000-0000-4000-8000-000000000020',0,gen_random_uuid(),
 '[{"menu_item_id":"c6000000-0000-4000-8000-000000000030","quantity":3}]');
select public.confirm_order_seats('c6000000-0000-4000-8000-000000000062',1,array['c6000000-0000-4000-8000-000000000050']::uuid[]);

set local request.jwt.claim.sub='c6000000-0000-4000-8000-000000000002';
select public.simulate_mock_payment('c6000000-0000-4000-8000-000000000083',gen_random_uuid(),'SUCCESS');
select pg_temp.assert_true(
 (select status='PAID_REVIEW' from public.orders where id='c6000000-0000-4000-8000-000000000061')
 and (select locked_order_id='c6000000-0000-4000-8000-000000000062' from public.seats where id='c6000000-0000-4000-8000-000000000050')
 and not exists(select 1 from public.seat_use_sessions where order_id='c6000000-0000-4000-8000-000000000061'),
 'Late payment reclaimed a seat or failed to record the paid exception');

set local role anon;
select pg_temp.assert_true(
 (public.read_customer_display(current_setting('test.display_a'))->'order'->>'total_minor')::integer=540
 and (public.read_customer_display(current_setting('test.display_b'))->'order'->>'total_minor')::integer=180
 and public.read_customer_display(current_setting('test.display_b'))->'order'->>'status'='PAID_REVIEW'
 and public.read_customer_display(current_setting('test.display_b'))->'order'->>'qr_text' is null,
 'Customer displays mixed counter data or retained an obsolete QR');
select pg_temp.expect_error($cmd$select * from public.payment_attempts$cmd$,'permission denied');
select pg_temp.expect_error($cmd$select * from public.checkout_stations$cmd$,'permission denied');
select pg_temp.expect_error($cmd$
 select public.read_customer_display(repeat('f',64))
$cmd$,'invalid or expired');
select pg_temp.expect_error($cmd$
 select public.cancel_order('c6000000-0000-4000-8000-000000000062')
$cmd$,'permission denied');

set local role authenticated;
select pg_temp.expect_error($cmd$
 select public.seatlink_apply_payment_result('c6000000-0000-4000-8000-000000000083',gen_random_uuid(),'SUCCESS')
$cmd$,'permission denied');
set local request.jwt.claim.sub='c6000000-0000-4000-8000-000000000003';
select pg_temp.assert_true(not exists(select 1 from public.payment_attempts) and not exists(select 1 from public.seat_use_sessions),'Cross-organisation payments leaked');
select pg_temp.expect_error($cmd$
 select public.release_seat_use('c6000000-0000-4000-8000-000000000060',array[current_setting('test.use_b')::uuid])
$cmd$,'Branch access denied');

reset role;
select pg_temp.assert_true((select count(*)>0 from public.audit_events),'Audit trail is empty');

-- An extension survives the old deadline, then current expiry releases the seat.
set local role authenticated;
set local request.jwt.claim.sub='c6000000-0000-4000-8000-000000000001';
select public.create_mock_payment('c6000000-0000-4000-8000-000000000062','c6000000-0000-4000-8000-000000000084');
select public.simulate_mock_payment('c6000000-0000-4000-8000-000000000084',gen_random_uuid(),'SUCCESS');
select set_config('test.use_c',(select id::text from public.seat_use_sessions where order_id='c6000000-0000-4000-8000-000000000062'),true);
reset role;
update public.seat_use_sessions set started_at=clock_timestamp()-interval '11 minutes', expires_at=clock_timestamp()+interval '1 second'
where id=current_setting('test.use_c')::uuid;
set local role authenticated;
select public.simulate_extension(current_setting('test.use_c')::uuid,gen_random_uuid(),180);
reset role;
select pg_sleep(1.1);
select public.expire_order_sessions();
select pg_temp.assert_true((select status='UNAVAILABLE' from public.seats where id='c6000000-0000-4000-8000-000000000050'),
 'An old expiry pass released an extended session');
update public.seat_use_sessions set expires_at=clock_timestamp()-interval '1 second' where id=current_setting('test.use_c')::uuid;
select public.expire_order_sessions();
select pg_temp.assert_true((select status='AVAILABLE' and active_seat_use_session_id is null from public.seats where id='c6000000-0000-4000-8000-000000000050'),
 'Current seat-use expiry failed to release the seat');
set local role authenticated;
select pg_temp.expect_error($cmd$
 select public.simulate_extension(current_setting('test.use_c')::uuid,gen_random_uuid(),60)
$cmd$,'ended or changed');

-- Reassignment is protected from a stale paid-seat release request.
set local request.jwt.claim.sub='c6000000-0000-4000-8000-000000000002';
select public.save_draft_order('c6000000-0000-4000-8000-000000000063','c6000000-0000-4000-8000-000000000020',0,gen_random_uuid(),
 '[{"menu_item_id":"c6000000-0000-4000-8000-000000000030","quantity":1}]');
select public.confirm_order_seats('c6000000-0000-4000-8000-000000000063',1,array['c6000000-0000-4000-8000-000000000050']::uuid[]);
set local request.jwt.claim.sub='c6000000-0000-4000-8000-000000000001';
select pg_temp.expect_error($cmd$
 select public.release_seat_use('c6000000-0000-4000-8000-000000000062',array[current_setting('test.use_c')::uuid])
$cmd$,'allocation changed');
select pg_temp.assert_true((select locked_order_id='c6000000-0000-4000-8000-000000000063' from public.seats where id='c6000000-0000-4000-8000-000000000050'),
 'A stale release affected a reassigned seat');

-- Multiple explicitly selected sessions are released together.
select public.save_draft_order('c6000000-0000-4000-8000-000000000064','c6000000-0000-4000-8000-000000000020',0,gen_random_uuid(),
 '[{"menu_item_id":"c6000000-0000-4000-8000-000000000030","quantity":1}]');
select public.confirm_order_seats('c6000000-0000-4000-8000-000000000064',1,
 array['c6000000-0000-4000-8000-000000000052','c6000000-0000-4000-8000-000000000053']::uuid[]);
select public.create_mock_payment('c6000000-0000-4000-8000-000000000064','c6000000-0000-4000-8000-000000000085');
select public.simulate_mock_payment('c6000000-0000-4000-8000-000000000085',gen_random_uuid(),'SUCCESS');
select public.release_seat_use('c6000000-0000-4000-8000-000000000064',
 (select array_agg(id) from public.seat_use_sessions where order_id='c6000000-0000-4000-8000-000000000064'));
select pg_temp.assert_true((select count(*)=2 from public.seats where label in ('C','D') and table_id='c6000000-0000-4000-8000-000000000040' and status='AVAILABLE'),
 'Grouped release did not free exactly the requested seats');
select public.record_payment_follow_up((select id from public.payment_exceptions where kind='DUPLICATE_PAYMENT'), 'Customer assisted by the owner.');
select pg_temp.assert_true((select count(*)=1 from public.audit_events where action='PAYMENT_OWNER_FOLLOW_UP'), 'Owner follow-up was not audited');
select pg_temp.expect_error($cmd$update public.development_settings set enabled=true$cmd$,'permission denied');
select pg_temp.expect_error($cmd$update public.owner_memberships set role='OWNER'$cmd$,'permission denied');

-- Re-pairing invalidates the old token for this station alone.
select public.pair_customer_display((select station_id from public.orders where id='c6000000-0000-4000-8000-000000000064'));
set local role anon;
select pg_temp.expect_error($cmd$select public.read_customer_display(current_setting('test.display_a'))$cmd$,'invalid or expired');
select pg_temp.assert_true(public.read_customer_display(current_setting('test.display_b'))->>'station_id' is not null,
 'Re-pairing one station invalidated another station');

reset role;
rollback;
