begin;

-- Stable identities and legacy labels remain unchanged (including hardware mappings).
create function public.seatlink_table_label(p_number integer) returns text
language plpgsql immutable set search_path='' as $$
declare n integer:=p_number; result text:='';
begin
 if n<1 then return p_number::text; end if;
 while n>0 loop result:=chr(65+(n-1)%26)||result; n:=(n-1)/26; end loop;
 return result;
end; $$;
alter table public.tables add column display_label text;
update public.tables set display_label=public.seatlink_table_label(table_number);
alter table public.tables alter column display_label set not null;
alter table public.seats add column display_number integer;
alter table public.seats add column position text;
update public.seats set display_number=ascii(label::text)-64,
 position=(array['north','east','south','west'])[ascii(label::text)-64];
alter table public.seats alter column display_number set not null;
alter table public.seats add constraint seat_display_positive check(display_number>0);
alter table public.seats add constraint seat_position check(position in ('north','east','south','west'));
create function public.seatlink_display_metadata() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_table_name='tables' then new.display_label:=coalesce(new.display_label,public.seatlink_table_label(new.table_number));
 else new.display_number:=coalesce(new.display_number,ascii(new.label::text)-64);
 new.position:=coalesce(new.position,(array['north','east','south','west'])[(new.display_number-1)%4+1]); end if;
 return new;
end; $$;
create trigger table_display_metadata before insert on public.tables for each row execute function public.seatlink_display_metadata();
create trigger seat_display_metadata before insert on public.seats for each row execute function public.seatlink_display_metadata();

alter table public.seat_use_sessions alter column order_id drop not null;
alter table public.seat_use_sessions add column branch_id uuid references public.branches(id);
alter table public.seat_use_sessions add column origin text not null default 'CHECKOUT' check(origin in ('CHECKOUT','OWNER_ACTIVATION'));
alter table public.seat_use_sessions add column activated_by uuid references auth.users(id);
alter table public.seat_use_sessions add column activation_request_id uuid;
update public.seat_use_sessions u set branch_id=t.branch_id,activated_by=o.created_by
 from public.seats s join public.tables t on t.id=s.table_id, public.orders o
 where s.id=u.seat_id and o.id=u.order_id;
alter table public.seat_use_sessions alter column branch_id set not null;
alter table public.seat_use_sessions add constraint seat_use_origin check(
 (origin='CHECKOUT' and order_id is not null) or
 (origin='OWNER_ACTIVATION' and order_id is null and activated_by is not null and activation_request_id is not null));
create index seat_use_branch_active on public.seat_use_sessions(branch_id,expires_at) where status='ACTIVE';
create function public.seatlink_session_branch() returns trigger language plpgsql security definer set search_path='' as $$
declare branch uuid; owner_id uuid;
begin
 select t.branch_id into branch from public.seats s join public.tables t on t.id=s.table_id where s.id=new.seat_id;
 if new.branch_id is not null and new.branch_id<>branch then raise exception 'Session branch mismatch.'; end if;
 new.branch_id:=branch;
 if new.order_id is not null then
  select created_by into owner_id from public.orders where id=new.order_id and branch_id=branch;
  if not found then raise exception 'Session order branch mismatch.'; end if;
  new.activated_by:=coalesce(new.activated_by,owner_id);
 end if;
 return new;
end; $$;
create trigger seat_use_branch before insert or update on public.seat_use_sessions for each row execute function public.seatlink_session_branch();
drop policy owners_read_seat_use on public.seat_use_sessions;
create policy owners_read_seat_use on public.seat_use_sessions for select to authenticated using(
 exists(select 1 from public.branches b where b.id=seat_use_sessions.branch_id));

create table public.seat_operation_requests(
 id uuid primary key, branch_id uuid not null references public.branches(id), actor_id uuid not null references auth.users(id),
 operation text not null check(operation in ('ACTIVATE','RELEASE')), targets uuid[] not null,
 created_at timestamptz not null default clock_timestamp());
alter table public.seat_operation_requests enable row level security;
revoke all on public.seat_operation_requests from anon,authenticated;

create function public.activate_seats(p_branch_id uuid,p_seat_ids uuid[],p_request_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare ids uuid[]; prior public.seat_operation_requests; started timestamptz;
begin
 perform public.seatlink_lock_owner_branch(p_branch_id);
 select array_agg(distinct x order by x) into ids from unnest(p_seat_ids) x;
 if p_request_id is null or coalesce(cardinality(ids),0)=0 or cardinality(ids)<>cardinality(p_seat_ids)
  or array_position(ids,null) is not null then raise exception 'Select available seats.'; end if;
 select * into prior from public.seat_operation_requests where id=p_request_id;
 if found then
  if prior.branch_id<>p_branch_id or prior.actor_id<>auth.uid() or prior.operation<>'ACTIVATE' or prior.targets<>ids
   then raise exception 'Request ID was reused.'; end if;
  return;
 end if;
 perform public.seatlink_expire_branch(p_branch_id);
 perform s.id from public.seats s join public.tables t on t.id=s.table_id where s.id=any(ids) and t.branch_id=p_branch_id order by s.id for update of s;
 if (select count(*) from public.seats s join public.tables t on t.id=s.table_id
  where s.id=any(ids) and t.branch_id=p_branch_id and s.status='AVAILABLE'
  and s.locked_order_id is null and s.active_seat_use_session_id is null)<>cardinality(ids)
 then raise exception 'Some selected seats are no longer available. Refresh and select again.'; end if;
 insert into public.seat_operation_requests(id,branch_id,actor_id,operation,targets) values(p_request_id,p_branch_id,auth.uid(),'ACTIVATE',ids);
 started:=clock_timestamp();
 insert into public.seat_use_sessions(branch_id,seat_id,origin,activated_by,activation_request_id,started_at,expires_at)
 select p_branch_id,id,'OWNER_ACTIVATION',auth.uid(),p_request_id,started,started+interval '10 minutes' from unnest(ids) id;
 update public.seats s set status='UNAVAILABLE',active_seat_use_session_id=u.id
 from public.seat_use_sessions u where u.activation_request_id=p_request_id and s.id=u.seat_id;
 insert into public.audit_events(branch_id,actor_id,action,details) values(p_branch_id,auth.uid(),'OWNER_SEATS_ACTIVATED',
 jsonb_build_object('request_id',p_request_id,'seat_ids',ids,'session_ids',
 (select jsonb_agg(id) from public.seat_use_sessions where activation_request_id=p_request_id)));
end; $$;

create function public.release_active_seats(p_branch_id uuid,p_session_ids uuid[],p_request_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare ids uuid[]; prior public.seat_operation_requests;
begin
 perform public.seatlink_lock_owner_branch(p_branch_id);
 select array_agg(distinct x order by x) into ids from unnest(p_session_ids) x;
 if p_request_id is null or coalesce(cardinality(ids),0)=0 or array_position(ids,null) is not null then raise exception 'Select seat sessions.'; end if;
 select * into prior from public.seat_operation_requests where id=p_request_id;
 if found then
  if prior.branch_id<>p_branch_id or prior.actor_id<>auth.uid() or prior.operation<>'RELEASE' or prior.targets<>ids then raise exception 'Request ID was reused.'; end if;
  return;
 end if;
 if (select count(*) from public.seat_use_sessions where id=any(ids) and branch_id=p_branch_id)<>cardinality(ids)
 then raise exception 'Seat session access denied.'; end if;
 perform public.seatlink_expire_branch(p_branch_id);
 insert into public.seat_operation_requests(id,branch_id,actor_id,operation,targets) values(p_request_id,p_branch_id,auth.uid(),'RELEASE',ids);
 -- Compare the session pointer, never just the seat ID: an old screen cannot release a newer occupant.
 update public.seats set status='AVAILABLE',active_seat_use_session_id=null where active_seat_use_session_id=any(ids);
 update public.seat_use_sessions set status='RELEASED',ended_at=clock_timestamp() where id=any(ids) and status='ACTIVE';
 insert into public.audit_events(branch_id,actor_id,action,details) values(p_branch_id,auth.uid(),'SEATS_RELEASED',jsonb_build_object('request_id',p_request_id,'session_ids',ids));
end; $$;
revoke all on function public.activate_seats(uuid,uuid[],uuid),public.release_active_seats(uuid,uuid[],uuid),
 public.seatlink_session_branch(),public.seatlink_display_metadata() from public,anon,authenticated;
grant execute on function public.activate_seats(uuid,uuid[],uuid),public.release_active_seats(uuid,uuid[],uuid) to authenticated;


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
  from public.seat_use_sessions u
  where u.branch_id = p_branch_id and u.status = 'ACTIVE' and u.expires_at <= clock_timestamp()
    and s.active_seat_use_session_id = u.id and s.status = 'UNAVAILABLE';
  update public.seat_use_sessions u set status = 'EXPIRED', ended_at = clock_timestamp()
  where u.branch_id = p_branch_id
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
    or exists (select 1 from public.seat_use_sessions u
      where u.branch_id = b.id and u.status = 'ACTIVE' and u.expires_at <= clock_timestamp())
    or exists (select 1 from public.payment_attempts p join public.orders o on o.id = p.order_id
      where o.branch_id = b.id and p.status = 'PENDING' and p.qr_expires_at <= clock_timestamp())
    order by b.id
  loop
    perform 1 from public.branches where id = branch for update skip locked;
    if found then perform public.seatlink_expire_branch(branch); end if;
  end loop;
end;
$$;

create or replace function public.seatlink_extend_session(
  p_request_id uuid, p_seat_id uuid, p_session_id uuid, p_additional_seconds numeric,
  p_device_id uuid, p_actor_id uuid
) returns timestamptz language plpgsql security definer set search_path = '' as $$
declare previous public.extension_requests; allocation public.seat_use_sessions; branch uuid; deadline timestamptz;
begin
  if p_request_id is null or p_additional_seconds is null or p_additional_seconds <= 0
      or p_additional_seconds > 9007199254740991 or mod(p_additional_seconds, 60) <> 0 then
    raise exception 'Additional time must be positive whole minutes within safe numeric range.';
  end if;
  select u.branch_id into branch from public.seat_use_sessions u
  where u.id = p_session_id and u.seat_id = p_seat_id;
  if branch is null then raise exception 'Seat-use session does not match the seat.'; end if;
  perform 1 from public.branches where id = branch for update;
  select * into previous from public.extension_requests where request_id = p_request_id;
  if found then
    if previous.seat_id <> p_seat_id or previous.seat_use_session_id <> p_session_id
        or previous.additional_seconds <> p_additional_seconds
        or previous.device_id is distinct from p_device_id or previous.actor_id is distinct from p_actor_id then
      raise exception 'Request ID was reused for a different extension.';
    end if;
    return previous.resulting_expiry;
  end if;
  perform public.seatlink_expire_branch(branch);
  select * into allocation from public.seat_use_sessions where id = p_session_id for update;
  if allocation.status <> 'ACTIVE' or allocation.expires_at <= clock_timestamp()
      or not exists (select 1 from public.seats where id = p_seat_id and status = 'UNAVAILABLE'
        and active_seat_use_session_id = p_session_id) then
    raise exception 'The seat-use session has ended or changed.';
  end if;
  begin
    deadline := allocation.expires_at + make_interval(secs => p_additional_seconds::double precision);
  exception when datetime_field_overflow or interval_field_overflow or numeric_value_out_of_range then
    raise exception 'The requested time exceeds the database timestamp range.';
  end;
  if not isfinite(deadline) then raise exception 'The requested time exceeds the database timestamp range.'; end if;
  update public.seat_use_sessions set expires_at = deadline where id = p_session_id;
  insert into public.extension_requests
    (request_id, seat_id, seat_use_session_id, additional_seconds, device_id, actor_id, resulting_expiry)
  values (p_request_id, p_seat_id, p_session_id, p_additional_seconds::bigint, p_device_id, p_actor_id, deadline);
  insert into public.audit_events (branch_id, order_id, actor_id, action, details)
  values (branch, allocation.order_id, p_actor_id, 'SEAT_EXTENDED',
    jsonb_build_object('request_id', p_request_id, 'seat_use_session_id', p_session_id,
      'additional_seconds', p_additional_seconds, 'device_id', p_device_id));
  return deadline;
end;
$$;

create or replace function public.simulate_extension(p_session_id uuid, p_request_id uuid, p_additional_seconds numeric)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare branch uuid; seat uuid;
begin
  perform public.seatlink_require_development();
  select u.branch_id, u.seat_id into branch, seat
  from public.seat_use_sessions u where u.id = p_session_id;
  perform public.seatlink_lock_owner_branch(branch);
  return public.seatlink_extend_session(p_request_id, seat, p_session_id, p_additional_seconds, null, auth.uid());
end;
$$;

create or replace function public.seatlink_display_changed()
returns trigger language plpgsql security definer set search_path='' as $$
declare branch uuid;
begin
 if tg_table_name in ('checkout_stations','orders','seat_use_sessions') then branch:=new.branch_id;
 elsif tg_table_name='seats' then select branch_id into branch from public.tables where id=new.table_id;
 else select branch_id into branch from public.orders where id=new.order_id; end if;
 perform public.seatlink_notify_branch(branch);
 return new;
end;
$$;

commit;
