begin;

create function public.seatlink_order_projection(p_order_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select to_jsonb(o) - 'last_request_id' - 'last_request_items' || jsonb_build_object('items', (
    select coalesce(jsonb_agg(to_jsonb(i) order by i.name), '[]'::jsonb)
    from public.order_items i where i.order_id = o.id
  )) from public.orders o where o.id = p_order_id;
$$;

alter function public.read_branch_sales(uuid) rename to seatlink_read_branch_sales_v1;
revoke all on function public.seatlink_read_branch_sales_v1(uuid) from public, anon, authenticated;

create function public.read_branch_sales(p_branch_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare snapshot jsonb; station public.checkout_stations; membership_role text;
begin
  perform public.seatlink_lock_owner_branch(p_branch_id);
  snapshot := public.seatlink_read_branch_sales_v1(p_branch_id);
  insert into public.checkout_stations (branch_id, operator_id)
  values (p_branch_id, auth.uid()) on conflict (branch_id, operator_id) do nothing;
  select * into station from public.checkout_stations
  where branch_id = p_branch_id and operator_id = auth.uid();
  select m.role into membership_role from public.owner_memberships m
  join public.branches b on b.organisation_id = m.organisation_id
  where b.id = p_branch_id and m.user_id = auth.uid();
  if snapshot->'order' = 'null'::jsonb and exists (
    select 1 from public.orders where id = station.current_order_id and status in ('PAID', 'PAID_REVIEW')
  ) then
    snapshot := jsonb_set(snapshot, '{order}', public.seatlink_order_projection(station.current_order_id));
  end if;
  return snapshot || jsonb_build_object(
    'station', jsonb_build_object('id', station.id, 'name', station.name),
    'operator', jsonb_build_object('role', membership_role,
      'role_label', case membership_role when 'OWNER' then 'Food Court Owner' end),
    'development_enabled', public.seatlink_is_development_operator(),
    'history', (select coalesce(jsonb_agg(to_jsonb(recent)), '[]'::jsonb) from (
      select id, status, currency, total_minor, created_at, session_expires_at from public.orders
      where branch_id = p_branch_id and created_by = auth.uid() and status in ('PAID', 'PAID_REVIEW', 'CANCELLED', 'EXPIRED')
      order by created_at desc limit 20
    ) recent),
    'attempts', (select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at desc), '[]'::jsonb)
      from public.payment_attempts p where p.order_id = (snapshot->'order'->>'id')::uuid),
    'allocations', (select coalesce(jsonb_agg(to_jsonb(u) || jsonb_build_object(
      'label', s.label, 'table_number', t.table_number) order by t.table_number, s.label), '[]'::jsonb)
      from public.seat_use_sessions u join public.seats s on s.id = u.seat_id
      join public.tables t on t.id = s.table_id where t.branch_id = p_branch_id and u.status = 'ACTIVE'),
    'recent_attempts', (select coalesce(jsonb_agg(to_jsonb(recent)), '[]'::jsonb) from (
      select p.* from public.payment_attempts p join public.orders o on o.id = p.order_id
      where o.branch_id = p_branch_id and o.created_by = auth.uid() order by p.created_at desc limit 20
    ) recent),
    'exceptions', (select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at desc), '[]'::jsonb)
      from public.payment_exceptions e join public.orders o on o.id = e.order_id where o.branch_id = p_branch_id),
    'audit', (select coalesce(jsonb_agg(to_jsonb(recent)), '[]'::jsonb) from (
      select id, order_id, action, created_at, details from public.audit_events
      where branch_id = p_branch_id order by created_at desc limit 30
    ) recent)
  );
end;
$$;

create function public.pair_customer_display(p_station_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare station public.checkout_stations; token text;
begin
  select * into station from public.checkout_stations where id = p_station_id;
  perform public.seatlink_lock_owner_branch(station.branch_id);
  if station.operator_id is distinct from auth.uid() then
    raise exception using errcode = '42501', message = 'Counter access denied.';
  end if;
  token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  delete from public.display_sessions where station_id = p_station_id;
  insert into public.display_sessions (token_hash, station_id, expires_at, created_by)
  values (encode(sha256(convert_to(token, 'UTF8')), 'hex'), p_station_id, clock_timestamp() + interval '24 hours', auth.uid());
  return token;
end;
$$;

create function public.read_customer_display(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  station public.checkout_stations;
  chosen public.orders;
  current_attempt public.payment_attempts;
  branch_name text;
  current_order jsonb;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '42501', message = 'Display pairing is invalid or expired.';
  end if;
  select s.* into station from public.display_sessions d join public.checkout_stations s on s.id = d.station_id
  join public.branches b on b.id = s.branch_id
  join public.owner_memberships m on m.organisation_id = b.organisation_id and m.user_id = s.operator_id
  where d.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') and d.expires_at > clock_timestamp();
  if not found then
    raise exception using errcode = '42501', message = 'Display pairing is invalid or expired.';
  end if;
  perform 1 from public.branches where id = station.branch_id for update;
  -- Read the station pointer again after waiting for concurrent checkout changes.
  select * into station from public.checkout_stations where id = station.id;
  perform public.seatlink_expire_branch(station.branch_id);
  select name into branch_name from public.branches where id = station.branch_id;
  select * into chosen from public.orders where id = station.current_order_id;
  if found then
    select * into current_attempt from public.payment_attempts where order_id = chosen.id order by created_at desc limit 1;
    current_order := jsonb_build_object(
      'reference', left(chosen.id::text, 8), 'status', chosen.status,
      'total_minor', chosen.total_minor, 'currency', chosen.currency,
      'session_expires_at', chosen.session_expires_at,
      'items', (select coalesce(jsonb_agg(jsonb_build_object('name', i.name, 'quantity', i.quantity,
        'unit_price_minor', i.unit_price_minor) order by i.name), '[]'::jsonb)
        from public.order_items i where i.order_id = chosen.id),
      'selected_seats', (select coalesce(jsonb_agg(jsonb_build_object('label', s.label,
        'table_number', t.table_number) order by t.table_number, s.label), '[]'::jsonb)
        from public.seats s join public.tables t on t.id = s.table_id where s.id = any(chosen.selected_seat_ids)),
      'allocations', (select coalesce(jsonb_agg(jsonb_build_object(
        'label', s.label, 'table_number', t.table_number, 'expires_at', u.expires_at) order by t.table_number, s.label), '[]'::jsonb)
        from public.seat_use_sessions u join public.seats s on s.id = u.seat_id
        join public.tables t on t.id = s.table_id where u.order_id = chosen.id and u.status = 'ACTIVE'),
      'payment_status', current_attempt.status,
      'qr_expires_at', current_attempt.qr_expires_at,
      'qr_text', case when chosen.status = 'PENDING' and current_attempt.status = 'PENDING'
        and current_attempt.qr_expires_at > clock_timestamp() and chosen.session_expires_at > clock_timestamp()
        then 'seatlink-demo:' || current_attempt.id::text else null end
    );
  end if;
  return jsonb_build_object('server_now', clock_timestamp(), 'station_id', station.id,
    'station_name', station.name, 'branch', branch_name, 'order', current_order,
    'tables', (select coalesce(jsonb_agg(jsonb_build_object('table_number', t.table_number, 'seats', (
      select coalesce(jsonb_agg(jsonb_build_object('label', s.label, 'status', s.status) order by s.label), '[]'::jsonb)
      from public.seats s where s.table_id = t.id
    )) order by t.table_number), '[]'::jsonb) from public.tables t where t.branch_id = station.branch_id));
end;
$$;

-- Public Realtime messages contain only an invalidation signal. Reading checkout
-- content always requires the station's unguessable, hashed pairing token.
create function public.seatlink_notify_branch(p_branch_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare station uuid;
begin
  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is not null then
    for station in select id from public.checkout_stations where branch_id = p_branch_id loop
      execute 'select realtime.send($1, $2, $3, false)'
      using jsonb_build_object('refresh', true), 'changed', 'seatlink-display-' || station::text;
    end loop;
  end if;
end;
$$;
create function public.seatlink_display_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
declare branch uuid;
begin
  if tg_table_name = 'checkout_stations' or tg_table_name = 'orders' then
    branch := new.branch_id;
  elsif tg_table_name = 'seats' then
    select branch_id into branch from public.tables where id = new.table_id;
  else
    select branch_id into branch from public.orders where id = new.order_id;
  end if;
  perform public.seatlink_notify_branch(branch);
  return new;
end;
$$;
create trigger display_order_changed after insert or update on public.orders
  for each row execute function public.seatlink_display_changed();
create trigger display_payment_changed after insert or update on public.payment_attempts
  for each row execute function public.seatlink_display_changed();
create trigger display_seat_changed after update on public.seats
  for each row execute function public.seatlink_display_changed();
create trigger display_use_changed after insert or update on public.seat_use_sessions
  for each row execute function public.seatlink_display_changed();
create trigger display_station_changed after update on public.checkout_stations
  for each row execute function public.seatlink_display_changed();

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.payment_attempts, public.seat_use_sessions, public.payment_exceptions;
  end if;
end;
$$;

revoke all on function public.seatlink_order_projection(uuid), public.read_branch_sales(uuid),
  public.pair_customer_display(uuid), public.read_customer_display(text), public.seatlink_notify_branch(uuid),
  public.seatlink_display_changed() from public, anon, authenticated;
grant execute on function public.read_branch_sales(uuid), public.pair_customer_display(uuid) to authenticated;
grant execute on function public.read_customer_display(text) to anon, authenticated;

commit;
