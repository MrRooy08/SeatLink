begin;

create table public.menu_items (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  name text not null check (btrim(name) <> ''),
  price_minor bigint not null check (price_minor between 1 and 9007199254740991),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  available boolean not null default true,
  unique (branch_id, name)
);

create table public.orders (
  id uuid primary key,
  branch_id uuid not null references public.branches(id),
  created_by uuid not null references auth.users(id),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'PENDING', 'CANCELLED', 'EXPIRED')),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  total_minor bigint not null check (total_minor between 1 and 9007199254740991),
  revision integer not null default 1 check (revision > 0),
  session_expires_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  last_request_id uuid not null,
  last_request_items jsonb not null,
  selected_seat_ids uuid[] not null default '{}',
  check (
    (status = 'DRAFT' and session_expires_at is null and cardinality(selected_seat_ids) = 0)
    or (status = 'PENDING' and session_expires_at is not null and cardinality(selected_seat_ids) between 1 and 4)
    or status in ('EXPIRED', 'CANCELLED')
  )
);
create unique index orders_one_active_per_owner_branch on public.orders (branch_id, created_by)
  where status in ('DRAFT', 'PENDING');
create index orders_branch_history_idx on public.orders (branch_id, created_at desc);
create index orders_pending_expiry_idx on public.orders (session_expires_at, branch_id) where status = 'PENDING';

create table public.order_items (
  order_id uuid not null references public.orders(id),
  menu_item_id uuid not null references public.menu_items(id),
  name text not null,
  unit_price_minor bigint not null check (unit_price_minor > 0),
  quantity integer not null check (quantity > 0),
  primary key (order_id, menu_item_id)
);
create index order_items_menu_item_idx on public.order_items (menu_item_id);

alter table public.seats add column locked_order_id uuid references public.orders(id);
create index seats_locked_order_idx on public.seats (locked_order_id) where locked_order_id is not null;

alter table public.menu_items enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
revoke all on public.menu_items, public.orders, public.order_items from public, anon, authenticated;
grant select on public.menu_items, public.orders, public.order_items to authenticated;

create policy owners_read_menu on public.menu_items for select to authenticated using (
  exists (select 1 from public.branches where branches.id = menu_items.branch_id)
);
create policy owners_read_orders on public.orders for select to authenticated using (
  exists (select 1 from public.branches where branches.id = orders.branch_id)
);
create policy owners_read_order_items on public.order_items for select to authenticated using (
  exists (select 1 from public.orders where orders.id = order_items.order_id)
);

-- All operations use the same branch -> order -> seat lock order.
-- Branch serialization is deliberately conservative for this first sales slice.
create function public.seatlink_lock_owner_branch(p_branch_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.branches b
  join public.owner_memberships m on m.organisation_id = b.organisation_id
  where b.id = p_branch_id and m.user_id = auth.uid()
  for update of b;
  if not found then
    raise exception using errcode = '42501', message = 'Branch access denied.';
  end if;
end;
$$;

create function public.seatlink_expire_branch(p_branch_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  expired_ids uuid[];
begin
  select array_agg(id) into expired_ids from public.orders
  where branch_id = p_branch_id and status = 'PENDING' and session_expires_at <= clock_timestamp();

  update public.seats set status = 'AVAILABLE', locked_order_id = null
  where locked_order_id = any(expired_ids) and status = 'LOCKED';

  update public.orders set status = 'EXPIRED', revision = revision + 1, updated_at = clock_timestamp()
  where id = any(expired_ids);
end;
$$;

create function public.save_draft_order(
  p_order_id uuid, p_branch_id uuid, p_revision integer, p_request_id uuid, p_items jsonb
) returns public.orders language plpgsql security definer set search_path = '' as $$
declare
  existing public.orders;
  saved public.orders;
  total numeric;
  currencies integer;
  chosen_currency text;
  requested_count integer;
begin
  perform public.seatlink_lock_owner_branch(p_branch_id);
  perform public.seatlink_expire_branch(p_branch_id);
  if p_order_id is null or p_request_id is null or p_revision is null then
    raise exception 'Order ID, request ID and revision are required.';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Items must be a JSON array.';
  end if;
  requested_count := jsonb_array_length(p_items);
  if requested_count = 0 then raise exception 'Add a purchase to the order.'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) item
    where jsonb_typeof(item) is distinct from 'object'
      or jsonb_typeof(item->'quantity') is distinct from 'number'
      or (item->>'quantity') !~ '^[1-9][0-9]*$'
      or jsonb_typeof(item->'menu_item_id') is distinct from 'string'
  ) then raise exception 'Each item needs a menu item ID and a positive whole quantity.'; end if;
  if (select count(distinct item->>'menu_item_id') from jsonb_array_elements(p_items) item) <> requested_count then
    raise exception 'Duplicate menu items are not allowed.';
  end if;

  select * into existing from public.orders where id = p_order_id for update;
  if found then
    if existing.branch_id <> p_branch_id or existing.created_by <> auth.uid() then
      raise exception using errcode = '42501', message = 'Order access denied.';
    end if;
    if existing.last_request_id = p_request_id then
      if existing.last_request_items <> p_items then raise exception 'Request ID was reused with different items.'; end if;
      return existing;
    end if;
    if existing.status <> 'DRAFT' then raise exception 'Only draft orders can be edited.'; end if;
    if existing.revision <> p_revision then raise exception 'Order changed. Reload before editing.'; end if;
  elsif p_revision <> 0 then
    raise exception 'Order changed. Reload before editing.';
  end if;

  -- Lock menu rows against concurrent administrator edits, then read current prices.
  perform mi.id from public.menu_items mi
  join jsonb_to_recordset(p_items) as item(menu_item_id uuid, quantity integer) on item.menu_item_id = mi.id
  where mi.branch_id = p_branch_id and mi.available
  order by mi.id for share of mi;

  select sum(mi.price_minor::numeric * item.quantity),
    count(distinct mi.currency), min(mi.currency)
  into total, currencies, chosen_currency
  from jsonb_to_recordset(p_items) as item(menu_item_id uuid, quantity integer)
  join public.menu_items mi on mi.id = item.menu_item_id and mi.branch_id = p_branch_id and mi.available;

  if (select count(*) from jsonb_to_recordset(p_items) as item(menu_item_id uuid, quantity integer)
    join public.menu_items mi on mi.id = item.menu_item_id and mi.branch_id = p_branch_id and mi.available) <> requested_count then
    raise exception 'An item is unavailable or belongs to another branch.';
  end if;
  if currencies <> 1 then raise exception 'Items must use the same currency.'; end if;
  if total is null or total < 1 or total > 9007199254740991 then raise exception 'Order total exceeds safe numeric range.'; end if;

  if existing.id is null then
    insert into public.orders (id, branch_id, created_by, currency, total_minor, last_request_id, last_request_items)
    values (p_order_id, p_branch_id, auth.uid(), chosen_currency, total::bigint, p_request_id, p_items)
    returning * into saved;
  else
    update public.orders set currency = chosen_currency, total_minor = total::bigint,
      revision = revision + 1, updated_at = clock_timestamp(),
      last_request_id = p_request_id, last_request_items = p_items
    where id = p_order_id returning * into saved;
    delete from public.order_items where order_id = p_order_id;
  end if;
  insert into public.order_items (order_id, menu_item_id, name, unit_price_minor, quantity)
  select p_order_id, mi.id, mi.name, mi.price_minor, item.quantity
  from jsonb_to_recordset(p_items) as item(menu_item_id uuid, quantity integer)
  join public.menu_items mi on mi.id = item.menu_item_id;
  return saved;
end;
$$;

create function public.confirm_order_seats(p_order_id uuid, p_revision integer, p_seat_ids uuid[])
returns public.orders language plpgsql security definer set search_path = '' as $$
declare
  chosen public.orders;
  branch uuid;
  locked_count integer;
  ordered_ids uuid[];
begin
  select branch_id into branch from public.orders where id = p_order_id;
  perform public.seatlink_lock_owner_branch(branch);
  perform public.seatlink_expire_branch(branch);
  select * into chosen from public.orders where id = p_order_id for update;
  if chosen.created_by <> auth.uid() then
    raise exception using errcode = '42501', message = 'Order access denied.';
  end if;
  if p_seat_ids is null or cardinality(p_seat_ids) not between 1 and 4
      or array_position(p_seat_ids, null) is not null
      or (select count(distinct id) from unnest(p_seat_ids) id) <> cardinality(p_seat_ids) then
    raise exception 'Select one to four distinct seats.';
  end if;
  select array_agg(id order by id) into ordered_ids from unnest(p_seat_ids) id;
  if chosen.status = 'PENDING' and chosen.selected_seat_ids = ordered_ids then return chosen; end if;
  if chosen.status = 'EXPIRED' then return chosen; end if;
  if chosen.status <> 'DRAFT' or chosen.revision is distinct from p_revision then
    raise exception 'Order changed. Reload before confirming.';
  end if;

  -- A draft is priced again at confirmation. Require explicit review if the menu changed.
  perform mi.id from public.menu_items mi join public.order_items oi on oi.menu_item_id = mi.id
  where oi.order_id = p_order_id order by mi.id for share of mi;
  if not exists (select 1 from public.order_items where order_id = p_order_id)
      or exists (
        select 1 from public.order_items oi join public.menu_items mi on mi.id = oi.menu_item_id
        where oi.order_id = p_order_id and
          (not mi.available or mi.price_minor <> oi.unit_price_minor or mi.name <> oi.name
            or mi.currency <> chosen.currency or mi.branch_id <> branch)
      ) then raise exception 'Menu changed. Save the draft again to review current prices.'; end if;

  perform s.id from public.seats s join public.tables t on t.id = s.table_id
  where s.id = any(ordered_ids) and t.branch_id = branch order by s.id for update of s;
  select count(*) into locked_count from public.seats s join public.tables t on t.id = s.table_id
  where s.id = any(ordered_ids) and t.branch_id = branch and s.status = 'AVAILABLE' and s.locked_order_id is null;
  if locked_count <> cardinality(ordered_ids) then
    raise exception 'A selected seat is unavailable or belongs to another branch. Refresh and select again.';
  end if;

  update public.orders set status = 'PENDING', session_expires_at = clock_timestamp() + interval '5 minutes',
    selected_seat_ids = ordered_ids, revision = revision + 1, updated_at = clock_timestamp()
  where id = p_order_id returning * into chosen;
  update public.seats set status = 'LOCKED', locked_order_id = p_order_id where id = any(ordered_ids);
  return chosen;
end;
$$;

create function public.cancel_order(p_order_id uuid)
returns public.orders language plpgsql security definer set search_path = '' as $$
declare
  branch uuid;
  chosen public.orders;
begin
  select branch_id into branch from public.orders where id = p_order_id;
  perform public.seatlink_lock_owner_branch(branch);
  perform public.seatlink_expire_branch(branch);
  select * into chosen from public.orders where id = p_order_id for update;
  if chosen.created_by <> auth.uid() then
    raise exception using errcode = '42501', message = 'Order access denied.';
  end if;
  if chosen.status in ('CANCELLED', 'EXPIRED') then return chosen; end if;
  if chosen.status not in ('DRAFT', 'PENDING') then raise exception 'Order cannot be cancelled.'; end if;
  update public.seats set status = 'AVAILABLE', locked_order_id = null
  where locked_order_id = p_order_id and status = 'LOCKED';
  update public.orders set status = 'CANCELLED', revision = revision + 1, updated_at = clock_timestamp()
  where id = p_order_id returning * into chosen;
  return chosen;
end;
$$;

create function public.read_branch_sales(p_branch_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  active_order jsonb;
begin
  perform public.seatlink_lock_owner_branch(p_branch_id);
  perform public.seatlink_expire_branch(p_branch_id);
  select to_jsonb(o) - 'last_request_items' - 'last_request_id' || jsonb_build_object('items', (
    select coalesce(jsonb_agg(to_jsonb(oi) order by oi.name), '[]'::jsonb)
    from public.order_items oi where oi.order_id = o.id
  )) into active_order from public.orders o
  where o.branch_id = p_branch_id and o.created_by = auth.uid() and o.status in ('DRAFT', 'PENDING');

  return jsonb_build_object(
    'server_now', clock_timestamp(),
    'order', active_order,
    'menu', (select coalesce(jsonb_agg(to_jsonb(mi) order by mi.name), '[]'::jsonb)
      from public.menu_items mi where mi.branch_id = p_branch_id),
    'tables', (select coalesce(jsonb_agg(
      jsonb_build_object('id', t.id, 'table_number', t.table_number, 'seats', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', s.id, 'label', s.label, 'status', s.status, 'locked_order_id', s.locked_order_id
        ) order by s.label), '[]'::jsonb) from public.seats s where s.table_id = t.id
      )) order by t.table_number), '[]'::jsonb)
      from public.tables t where t.branch_id = p_branch_id),
    'history', (select coalesce(jsonb_agg(to_jsonb(recent)), '[]'::jsonb) from (
      select id, status, currency, total_minor, created_at, session_expires_at
      from public.orders where branch_id = p_branch_id and created_by = auth.uid()
        and status in ('CANCELLED', 'EXPIRED') order by created_at desc limit 10
    ) recent)
  );
end;
$$;

-- Scheduler only. It works with browsers closed and recovers missed cleanup.
create function public.expire_order_sessions()
returns void language plpgsql security definer set search_path = '' as $$
declare
  branch uuid;
begin
  for branch in select b.id from public.branches b
    where exists (select 1 from public.orders o where o.branch_id = b.id
      and o.status = 'PENDING' and o.session_expires_at <= clock_timestamp())
    order by b.id
  loop
    -- A busy branch is recovered on the next pass or by its next owner operation.
    perform 1 from public.branches where id = branch for update skip locked;
    if found then perform public.seatlink_expire_branch(branch); end if;
  end loop;
end;
$$;

revoke all on function public.seatlink_lock_owner_branch(uuid), public.seatlink_expire_branch(uuid),
  public.save_draft_order(uuid, uuid, integer, uuid, jsonb), public.confirm_order_seats(uuid, integer, uuid[]),
  public.cancel_order(uuid), public.read_branch_sales(uuid), public.expire_order_sessions()
  from public, anon, authenticated;
grant execute on function public.save_draft_order(uuid, uuid, integer, uuid, jsonb),
  public.confirm_order_seats(uuid, integer, uuid[]), public.cancel_order(uuid),
  public.read_branch_sales(uuid) to authenticated;

-- Realtime is an invalidation signal. RLS still controls delivery.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.menu_items, public.orders, public.seats;
  end if;
end;
$$;

commit;
