begin;

create table public.development_settings (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false
);
insert into public.development_settings (singleton, enabled) values (true, false);
create table public.development_operators (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.development_settings enable row level security;
alter table public.development_operators enable row level security;
revoke all on public.development_settings, public.development_operators from public, anon, authenticated;

alter table public.menu_items add column is_demo boolean not null default false;
alter table public.owner_memberships add column role text not null default 'OWNER' check (role = 'OWNER');

create table public.checkout_stations (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  operator_id uuid not null references auth.users(id),
  name text not null default 'Checkout counter',
  current_order_id uuid,
  unique (branch_id, operator_id)
);
alter table public.orders add column station_id uuid references public.checkout_stations(id);
alter table public.orders drop constraint orders_status_check;
alter table public.orders drop constraint orders_check;
alter table public.orders add constraint orders_status_check check (
  status in ('DRAFT', 'PENDING', 'CANCELLED', 'EXPIRED', 'PAID', 'PAID_REVIEW')
);
alter table public.orders add constraint orders_session_check check (
  (status = 'DRAFT' and session_expires_at is null and cardinality(selected_seat_ids) = 0)
  or (status = 'PENDING' and session_expires_at is not null and cardinality(selected_seat_ids) between 1 and 4)
  or status in ('CANCELLED', 'EXPIRED', 'PAID', 'PAID_REVIEW')
);
alter table public.orders add column paid_at timestamptz;

insert into public.checkout_stations (branch_id, operator_id)
select distinct branch_id, created_by from public.orders;
update public.orders o set station_id = s.id
from public.checkout_stations s where s.branch_id = o.branch_id and s.operator_id = o.created_by;
update public.checkout_stations s set current_order_id = (
  select o.id from public.orders o where o.station_id = s.id
  order by (o.status in ('DRAFT', 'PENDING')) desc, o.created_at desc limit 1
);
alter table public.checkout_stations add foreign key (current_order_id) references public.orders(id);
create index orders_station_idx on public.orders(station_id);

create table public.payment_attempts (
  id uuid primary key,
  order_id uuid not null references public.orders(id),
  provider text not null default 'MOCK' check (provider = 'MOCK'),
  amount_minor bigint not null check (amount_minor between 1 and 9007199254740991),
  currency text not null,
  status text not null default 'PENDING' check (status in ('PENDING', 'FAILED', 'EXPIRED', 'SUCCEEDED')),
  created_at timestamptz not null default clock_timestamp(),
  qr_expires_at timestamptz not null,
  succeeded_at timestamptz
);
create index payment_attempts_order_idx on public.payment_attempts(order_id, created_at desc);
alter table public.orders add column paid_attempt_id uuid references public.payment_attempts(id);

create table public.seat_use_sessions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  seat_id uuid not null references public.seats(id),
  started_at timestamptz not null,
  expires_at timestamptz not null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'RELEASED', 'EXPIRED')),
  ended_at timestamptz,
  check (expires_at > started_at)
);
create unique index seat_use_one_active_idx on public.seat_use_sessions(seat_id) where status = 'ACTIVE';
create index seat_use_order_idx on public.seat_use_sessions(order_id);
create index seat_use_expiry_idx on public.seat_use_sessions(expires_at) where status = 'ACTIVE';
alter table public.seats add column active_seat_use_session_id uuid references public.seat_use_sessions(id);
create unique index seats_active_use_idx on public.seats(active_seat_use_session_id)
  where active_seat_use_session_id is not null;

create table public.payment_events (
  id uuid primary key,
  payment_attempt_id uuid not null references public.payment_attempts(id),
  result text not null check (result in ('SUCCESS', 'FAILURE')),
  created_at timestamptz not null default clock_timestamp()
);
create index payment_events_attempt_idx on public.payment_events(payment_attempt_id);
create table public.payment_exceptions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  payment_attempt_id uuid not null unique references public.payment_attempts(id),
  kind text not null check (kind in ('LATE_PAYMENT', 'DUPLICATE_PAYMENT')),
  created_at timestamptz not null default clock_timestamp(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  owner_note text
);
create index payment_exceptions_order_idx on public.payment_exceptions(order_id);
create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  order_id uuid references public.orders(id),
  actor_id uuid references auth.users(id),
  action text not null,
  details jsonb not null default '{}',
  created_at timestamptz not null default clock_timestamp()
);
create index audit_events_branch_idx on public.audit_events(branch_id, created_at desc);

create table public.display_sessions (
  token_hash text primary key,
  station_id uuid not null references public.checkout_stations(id) on delete cascade,
  expires_at timestamptz not null,
  created_by uuid not null references auth.users(id)
);
create index display_sessions_station_idx on public.display_sessions(station_id);
create table public.hardware_devices (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references public.tables(id),
  token_hash text not null unique,
  enabled boolean not null default true
);
create index hardware_devices_table_idx on public.hardware_devices(table_id);
create table public.extension_requests (
  request_id uuid primary key,
  seat_id uuid not null references public.seats(id),
  seat_use_session_id uuid not null references public.seat_use_sessions(id),
  additional_seconds bigint not null,
  device_id uuid references public.hardware_devices(id),
  actor_id uuid references auth.users(id),
  resulting_expiry timestamptz not null,
  created_at timestamptz not null default clock_timestamp()
);
create index extension_requests_session_idx on public.extension_requests(seat_use_session_id);

alter table public.checkout_stations enable row level security;
alter table public.payment_attempts enable row level security;
alter table public.seat_use_sessions enable row level security;
alter table public.payment_events enable row level security;
alter table public.payment_exceptions enable row level security;
alter table public.audit_events enable row level security;
alter table public.display_sessions enable row level security;
alter table public.hardware_devices enable row level security;
alter table public.extension_requests enable row level security;
revoke all on public.checkout_stations, public.payment_attempts, public.seat_use_sessions,
  public.payment_events, public.payment_exceptions, public.audit_events, public.display_sessions,
  public.hardware_devices, public.extension_requests from public, anon, authenticated;
grant select on public.checkout_stations, public.payment_attempts, public.seat_use_sessions,
  public.payment_exceptions, public.audit_events to authenticated;
create policy owners_read_stations on public.checkout_stations for select to authenticated using (
  exists (select 1 from public.branches b where b.id = checkout_stations.branch_id)
);
create policy owners_read_attempts on public.payment_attempts for select to authenticated using (
  exists (select 1 from public.orders o where o.id = payment_attempts.order_id)
);
create policy owners_read_seat_use on public.seat_use_sessions for select to authenticated using (
  exists (select 1 from public.orders o where o.id = seat_use_sessions.order_id)
);
create policy owners_read_exceptions on public.payment_exceptions for select to authenticated using (
  exists (select 1 from public.orders o where o.id = payment_exceptions.order_id)
);
create policy owners_read_audit on public.audit_events for select to authenticated using (
  exists (select 1 from public.branches b where b.id = audit_events.branch_id)
);

create function public.seatlink_assign_station()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.checkout_stations (branch_id, operator_id)
  values (new.branch_id, new.created_by)
  on conflict (branch_id, operator_id) do nothing;
  select id into new.station_id from public.checkout_stations
  where branch_id = new.branch_id and operator_id = new.created_by;
  return new;
end;
$$;
create trigger assign_checkout_station before insert on public.orders
  for each row execute function public.seatlink_assign_station();

create function public.seatlink_track_current_order()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.checkout_stations set current_order_id = new.id where id = new.station_id;
  return new;
end;
$$;
create trigger track_current_order after insert on public.orders
  for each row execute function public.seatlink_track_current_order();

create function public.seatlink_is_development_operator()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.development_settings where enabled)
    and exists (select 1 from public.development_operators where user_id = auth.uid());
$$;
create function public.seatlink_require_development()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.seatlink_is_development_operator() then
    raise exception using errcode = '42501', message = 'Development simulator access denied.';
  end if;
end;
$$;

-- Internal operations keep the existing branch -> order -> seat locking discipline.
create or replace function public.seatlink_expire_branch(p_branch_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare expired_ids uuid[];
begin
  select array_agg(id) into expired_ids from public.orders
  where branch_id = p_branch_id and status = 'PENDING' and session_expires_at <= clock_timestamp();
  update public.seats set status = 'AVAILABLE', locked_order_id = null
  where locked_order_id = any(expired_ids) and status = 'LOCKED';
  update public.orders set status = 'EXPIRED', revision = revision + 1, updated_at = clock_timestamp()
  where id = any(expired_ids);

  update public.seats s set status = 'AVAILABLE', active_seat_use_session_id = null
  from public.seat_use_sessions u join public.orders o on o.id = u.order_id
  where o.branch_id = p_branch_id and u.status = 'ACTIVE' and u.expires_at <= clock_timestamp()
    and s.active_seat_use_session_id = u.id and s.status = 'UNAVAILABLE';
  update public.seat_use_sessions u set status = 'EXPIRED', ended_at = clock_timestamp()
  from public.orders o where o.id = u.order_id and o.branch_id = p_branch_id
    and u.status = 'ACTIVE' and u.expires_at <= clock_timestamp();

  update public.payment_attempts p set status = 'EXPIRED'
  from public.orders o where o.id = p.order_id and o.branch_id = p_branch_id and p.status = 'PENDING'
    and (p.qr_expires_at <= clock_timestamp() or o.status <> 'PENDING');
end;
$$;

create or replace function public.expire_order_sessions()
returns void language plpgsql security definer set search_path = '' as $$
declare branch uuid;
begin
  for branch in select b.id from public.branches b where
    exists (select 1 from public.orders o where o.branch_id = b.id and o.status = 'PENDING'
      and o.session_expires_at <= clock_timestamp())
    or exists (select 1 from public.seat_use_sessions u join public.orders o on o.id = u.order_id
      where o.branch_id = b.id and u.status = 'ACTIVE' and u.expires_at <= clock_timestamp())
    or exists (select 1 from public.payment_attempts p join public.orders o on o.id = p.order_id
      where o.branch_id = b.id and p.status = 'PENDING' and p.qr_expires_at <= clock_timestamp())
    order by b.id
  loop
    perform 1 from public.branches where id = branch for update skip locked;
    if found then perform public.seatlink_expire_branch(branch); end if;
  end loop;
end;
$$;

revoke all on function public.seatlink_assign_station(), public.seatlink_track_current_order(),
  public.seatlink_is_development_operator(), public.seatlink_require_development()
  from public, anon, authenticated;

commit;
