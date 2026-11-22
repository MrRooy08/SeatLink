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

select pg_temp.expect_error($cmd$
  select public.read_branch_sales('c6000000-0000-4000-8000-000000000022')
$cmd$, 'Branch access denied');

-- Invalid carts never create partially saved orders.
do $$
declare
  items jsonb;
begin
  foreach items in array array[
    '[]'::jsonb,
    '[{"menu_item_id":"c6000000-0000-4000-8000-000000000030","quantity":0}]',
    '[{"menu_item_id":"c6000000-0000-4000-8000-000000000030","quantity":1.5}]',
    '[{"menu_item_id":"c6000000-0000-4000-8000-000000000030","quantity":-1}]',
    '[{"menu_item_id":"c6000000-0000-4000-8000-000000000030","quantity":1},{"menu_item_id":"c6000000-0000-4000-8000-000000000030","quantity":1}]',
    '[{"menu_item_id":"c6000000-0000-4000-8000-000000000031","quantity":1}]',
    '[{"menu_item_id":"c6000000-0000-4000-8000-000000000032","quantity":1}]',
    '[{"menu_item_id":"c6000000-0000-4000-8000-000000000034","quantity":2}]',
    '[{"menu_item_id":"c6000000-0000-4000-8000-000000000030","quantity":1},{"menu_item_id":"c6000000-0000-4000-8000-000000000033","quantity":1}]'
  ] loop
    begin
      perform public.save_draft_order(
        'c6000000-0000-4000-8000-000000000060', 'c6000000-0000-4000-8000-000000000020',
        0, gen_random_uuid(), items
      );
      raise exception 'Invalid cart was accepted: %', items;
    exception when raise_exception then
      if position('Invalid cart was accepted' in sqlerrm) > 0 then raise; end if;
    end;
  end loop;
end;
$$;
select pg_temp.assert_true(not exists(select 1 from public.orders where id = 'c6000000-0000-4000-8000-000000000060'), 'Invalid cart persisted an order');

select public.save_draft_order(
  'c6000000-0000-4000-8000-000000000060', 'c6000000-0000-4000-8000-000000000020',
  0, 'c6000000-0000-4000-8000-000000000070',
  '[{"menu_item_id":"c6000000-0000-4000-8000-000000000030","quantity":1,"price_minor":1}]'
);
select pg_temp.assert_true(
  (select total_minor = 180 and revision = 1 from public.orders where id = 'c6000000-0000-4000-8000-000000000060'),
  'Server did not calculate authoritative price'
);
-- Lost-response retry returns the same order and revision.
select public.save_draft_order(
  'c6000000-0000-4000-8000-000000000060', 'c6000000-0000-4000-8000-000000000020',
  0, 'c6000000-0000-4000-8000-000000000070',
  '[{"menu_item_id":"c6000000-0000-4000-8000-000000000030","quantity":1,"price_minor":1}]'
);
select pg_temp.assert_true(
  (select revision = 1 from public.orders where id = 'c6000000-0000-4000-8000-000000000060'),
  'Save retry changed revision'
);
select pg_temp.expect_error($cmd$
  select public.save_draft_order(
    'c6000000-0000-4000-8000-000000000060', 'c6000000-0000-4000-8000-000000000020',
    0, gen_random_uuid(), '[{"menu_item_id":"c6000000-0000-4000-8000-000000000030","quantity":2}]'
  )
$cmd$, 'Order changed');
select pg_temp.expect_error($cmd$
  update public.orders set total_minor = 1
$cmd$, 'permission denied');
select pg_temp.expect_error($cmd$
  update public.menu_items set price_minor = 1
$cmd$, 'permission denied');
select pg_temp.expect_error($cmd$
  update public.seats set status = 'AVAILABLE'
$cmd$, 'permission denied');
select pg_temp.expect_error($cmd$
  delete from public.order_items
$cmd$, 'permission denied');
select pg_temp.expect_error($cmd$
  select public.expire_order_sessions()
$cmd$, 'permission denied');
select pg_temp.expect_error($cmd$
  select public.seatlink_expire_branch('c6000000-0000-4000-8000-000000000020')
$cmd$, 'permission denied');

-- Reject zero, duplicate, five and cross-branch seat selections.
select pg_temp.expect_error($cmd$
  select public.confirm_order_seats('c6000000-0000-4000-8000-000000000060', 1, '{}')
$cmd$, 'one to four distinct');
select pg_temp.expect_error($cmd$
  select public.confirm_order_seats('c6000000-0000-4000-8000-000000000060', 1,
    array['c6000000-0000-4000-8000-000000000050','c6000000-0000-4000-8000-000000000050']::uuid[])
$cmd$, 'one to four distinct');
select pg_temp.expect_error($cmd$
  select public.confirm_order_seats('c6000000-0000-4000-8000-000000000060', 1,
    array['c6000000-0000-4000-8000-000000000050','c6000000-0000-4000-8000-000000000051',
    'c6000000-0000-4000-8000-000000000052','c6000000-0000-4000-8000-000000000053',
    'c6000000-0000-4000-8000-000000000054']::uuid[])
$cmd$, 'one to four distinct');
select pg_temp.expect_error($cmd$
  select public.confirm_order_seats('c6000000-0000-4000-8000-000000000060', 1,
    array['c6000000-0000-4000-8000-000000000050','c6000000-0000-4000-8000-000000000054']::uuid[])
$cmd$, 'another branch');
select pg_temp.assert_true(
  not exists(select 1 from public.seats where locked_order_id = 'c6000000-0000-4000-8000-000000000060'),
  'Rejected multi-seat operation acquired partial locks'
);

-- One drink buys eligibility for four seats, with one fixed five-minute deadline.
select public.confirm_order_seats('c6000000-0000-4000-8000-000000000060', 1,
  array['c6000000-0000-4000-8000-000000000053','c6000000-0000-4000-8000-000000000051',
  'c6000000-0000-4000-8000-000000000052','c6000000-0000-4000-8000-000000000050']::uuid[]);
create temporary table expected_deadline as
  select session_expires_at from public.orders where id = 'c6000000-0000-4000-8000-000000000060';
select public.confirm_order_seats('c6000000-0000-4000-8000-000000000060', 1,
  array['c6000000-0000-4000-8000-000000000050','c6000000-0000-4000-8000-000000000051',
  'c6000000-0000-4000-8000-000000000052','c6000000-0000-4000-8000-000000000053']::uuid[]);
select pg_temp.assert_true(
  (select count(*) = 4 from public.seats where locked_order_id = 'c6000000-0000-4000-8000-000000000060')
    and (select session_expires_at = (select session_expires_at from expected_deadline)
      and session_expires_at between clock_timestamp() + interval '4 minutes 50 seconds'
        and clock_timestamp() + interval '5 minutes'
      from public.orders where id = 'c6000000-0000-4000-8000-000000000060'),
  'Seat count or fixed five-minute deadline is incorrect'
);

set local request.jwt.claim.sub = 'c6000000-0000-4000-8000-000000000002';
select pg_temp.expect_error($cmd$
  select public.cancel_order('c6000000-0000-4000-8000-000000000060')
$cmd$, 'Order access denied');
select public.save_draft_order(
  'c6000000-0000-4000-8000-000000000061', 'c6000000-0000-4000-8000-000000000020',
  0, gen_random_uuid(), '[{"menu_item_id":"c6000000-0000-4000-8000-000000000030","quantity":1}]'
);
select pg_temp.expect_error($cmd$
  select public.confirm_order_seats('c6000000-0000-4000-8000-000000000061', 1,
    array['c6000000-0000-4000-8000-000000000050']::uuid[])
$cmd$, 'unavailable');

-- Expiry is server work, with no browser present.
reset role;
update public.orders set session_expires_at = clock_timestamp() - interval '1 second'
where id = 'c6000000-0000-4000-8000-000000000060';
select public.expire_order_sessions();
select pg_temp.assert_true(
  (select status = 'EXPIRED' from public.orders where id = 'c6000000-0000-4000-8000-000000000060')
  and (select count(*) = 4 from public.seats
    where table_id = 'c6000000-0000-4000-8000-000000000040' and status = 'AVAILABLE' and locked_order_id is null),
  'Server expiry did not release the old order locks'
);

set local role authenticated;
set local request.jwt.claim.sub = 'c6000000-0000-4000-8000-000000000002';
select public.confirm_order_seats('c6000000-0000-4000-8000-000000000061', 1,
  array['c6000000-0000-4000-8000-000000000050']::uuid[]);

-- A stale cancellation for an expired order cannot release a reassigned seat.
set local request.jwt.claim.sub = 'c6000000-0000-4000-8000-000000000001';
select public.cancel_order('c6000000-0000-4000-8000-000000000060');
select pg_temp.assert_true(
  (select locked_order_id = 'c6000000-0000-4000-8000-000000000061' and status = 'LOCKED'
    from public.seats where id = 'c6000000-0000-4000-8000-000000000050'),
  'Stale cancellation released a new allocation'
);

-- Rollback includes free seats if another requested seat is occupied.
select public.save_draft_order(
  'c6000000-0000-4000-8000-000000000062', 'c6000000-0000-4000-8000-000000000020',
  0, gen_random_uuid(), '[{"menu_item_id":"c6000000-0000-4000-8000-000000000030","quantity":1}]'
);
select pg_temp.expect_error($cmd$
  select public.confirm_order_seats('c6000000-0000-4000-8000-000000000062', 1,
    array['c6000000-0000-4000-8000-000000000051','c6000000-0000-4000-8000-000000000050']::uuid[])
$cmd$, 'unavailable');
select pg_temp.assert_true(
  (select status = 'AVAILABLE' and locked_order_id is null from public.seats where id = 'c6000000-0000-4000-8000-000000000051'),
  'Conflict left a partial seat lock'
);

-- Menu edits require explicit repricing before confirmation, preserving the old snapshot.
reset role;
update public.menu_items set price_minor = 200 where id = 'c6000000-0000-4000-8000-000000000030';
set local role authenticated;
set local request.jwt.claim.sub = 'c6000000-0000-4000-8000-000000000001';
select pg_temp.expect_error($cmd$
  select public.confirm_order_seats('c6000000-0000-4000-8000-000000000062', 1,
    array['c6000000-0000-4000-8000-000000000051']::uuid[])
$cmd$, 'Menu changed');
select pg_temp.assert_true(
  (select unit_price_minor = 180 from public.order_items where order_id = 'c6000000-0000-4000-8000-000000000062'),
  'Menu change overwrote the stored snapshot'
);
select public.save_draft_order(
  'c6000000-0000-4000-8000-000000000062', 'c6000000-0000-4000-8000-000000000020',
  1, gen_random_uuid(), '[{"menu_item_id":"c6000000-0000-4000-8000-000000000030","quantity":2}]'
);
select pg_temp.assert_true(
  (select total_minor = 400 and revision = 2 from public.orders where id = 'c6000000-0000-4000-8000-000000000062'),
  'Draft update did not reprice'
);
select public.cancel_order('c6000000-0000-4000-8000-000000000062');
select public.cancel_order('c6000000-0000-4000-8000-000000000062');
select pg_temp.assert_true(
  (select count(*) = 1 from public.order_items where order_id = 'c6000000-0000-4000-8000-000000000062'),
  'Cancellation deleted order history'
);

set local request.jwt.claim.sub = 'c6000000-0000-4000-8000-000000000003';
select pg_temp.assert_true(
  not exists(select 1 from public.orders) and not exists(select 1 from public.order_items)
    and not exists(select 1 from public.menu_items),
  'Cross-organisation data leaked through RLS'
);
select pg_temp.expect_error($cmd$
  select public.cancel_order('c6000000-0000-4000-8000-000000000061')
$cmd$, 'Branch access denied');

set local request.jwt.claim.sub = 'c6000000-0000-4000-8000-000000000002';
select public.cancel_order('c6000000-0000-4000-8000-000000000061');
select pg_temp.assert_true(
  (select status = 'AVAILABLE' and locked_order_id is null from public.seats where id = 'c6000000-0000-4000-8000-000000000050'),
  'Cancellation failed to release its own seat'
);

set local role anon;
select pg_temp.expect_error($cmd$
  select public.read_branch_sales('c6000000-0000-4000-8000-000000000020')
$cmd$, 'permission denied');
select pg_temp.expect_error($cmd$
  select public.confirm_order_seats('c6000000-0000-4000-8000-000000000061', 1,
    array['c6000000-0000-4000-8000-000000000050']::uuid[])
$cmd$, 'permission denied');

reset role;
rollback;
