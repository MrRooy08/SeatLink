begin;

-- Persist requested durations separately from mutable session expiry (hardware extensions).
alter table public.seat_operation_requests add column activation_seats jsonb;
update public.seat_operation_requests r set activation_seats=(
 select jsonb_agg(jsonb_build_object('seat_id',seat_id,'duration_seconds',600) order by seat_id)
 from unnest(r.targets) seat_id
) where operation='ACTIVATE';
alter table public.seat_operation_requests add constraint seat_operation_activation_payload check(
 (operation='ACTIVATE' and activation_seats is not null and jsonb_typeof(activation_seats)='array')
 or (operation='RELEASE' and activation_seats is null));

create function public.activate_seats(p_branch_id uuid,p_seats jsonb,p_request_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare ids uuid[]; normalized jsonb; prior public.seat_operation_requests; started timestamptz;
begin
 perform public.seatlink_lock_owner_branch(p_branch_id);
 if p_request_id is null or jsonb_typeof(p_seats) is distinct from 'array' then
  raise exception 'Select available seats and a duration for each seat.';
 end if;
 if jsonb_array_length(p_seats)=0 then raise exception 'Select available seats.'; end if;
 if exists(select 1 from jsonb_array_elements(p_seats) item where jsonb_typeof(item) is distinct from 'object'
  or jsonb_typeof(item->'seat_id') is distinct from 'string'
  or jsonb_typeof(item->'duration_seconds') is distinct from 'number') then
  raise exception 'Each seat needs its stable ID and a preset duration.';
 end if;
 if exists(select 1 from jsonb_array_elements(p_seats) item
  where (item->>'duration_seconds')::numeric not in (300,600,900,1200)) then
  raise exception 'Choose 5, 10, 15 or 20 minutes for each seat.';
 end if;
 select array_agg((item->>'seat_id')::uuid order by (item->>'seat_id')::uuid),
  jsonb_agg(jsonb_build_object('seat_id',(item->>'seat_id')::uuid,
    'duration_seconds',(item->>'duration_seconds')::numeric::integer) order by (item->>'seat_id')::uuid)
 into ids,normalized from jsonb_array_elements(p_seats) item;
 if array_position(ids,null) is not null or (select count(distinct id) from unnest(ids) id)<>cardinality(ids)
 then raise exception 'Select distinct seat IDs.'; end if;

 select * into prior from public.seat_operation_requests where id=p_request_id;
 if found then
  if prior.branch_id<>p_branch_id or prior.actor_id<>auth.uid() or prior.operation<>'ACTIVATE'
    or prior.targets<>ids or prior.activation_seats<>normalized
  then raise exception 'Request ID was reused for different seats or durations.'; end if;
  return;
 end if;
 perform public.seatlink_expire_branch(p_branch_id);
 perform s.id from public.seats s join public.tables t on t.id=s.table_id
  where s.id=any(ids) and t.branch_id=p_branch_id order by s.id for update of s;
 if (select count(*) from public.seats s join public.tables t on t.id=s.table_id
  where s.id=any(ids) and t.branch_id=p_branch_id and s.status='AVAILABLE'
  and s.locked_order_id is null and s.active_seat_use_session_id is null)<>cardinality(ids)
 then raise exception 'Some selected seats are no longer available. Refresh and select again.'; end if;

 insert into public.seat_operation_requests(id,branch_id,actor_id,operation,targets,activation_seats)
 values(p_request_id,p_branch_id,auth.uid(),'ACTIVATE',ids,normalized);
 started:=clock_timestamp();
 insert into public.seat_use_sessions(branch_id,seat_id,origin,activated_by,activation_request_id,started_at,expires_at)
 select p_branch_id,item.seat_id,'OWNER_ACTIVATION',auth.uid(),p_request_id,started,
  started+make_interval(secs=>item.duration_seconds)
 from jsonb_to_recordset(normalized) as item(seat_id uuid,duration_seconds integer) order by item.seat_id;
 update public.seats s set status='UNAVAILABLE',active_seat_use_session_id=u.id
 from public.seat_use_sessions u where u.activation_request_id=p_request_id and s.id=u.seat_id;
 insert into public.audit_events(branch_id,actor_id,action,details) values(p_branch_id,auth.uid(),'OWNER_SEATS_ACTIVATED',
  jsonb_build_object('request_id',p_request_id,'seat_ids',ids,'seats',normalized,'session_ids',
    (select jsonb_agg(id) from public.seat_use_sessions where activation_request_id=p_request_id)));
end; $$;

-- Preserve existing clients, fixtures and maintenance calls: omitted durations mean ten minutes.
create or replace function public.activate_seats(p_branch_id uuid,p_seat_ids uuid[],p_request_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 if p_seat_ids is null then raise exception 'Select available seats.'; end if;
 perform public.activate_seats(p_branch_id,coalesce((
  select jsonb_agg(jsonb_build_object('seat_id',id,'duration_seconds',600)) from unnest(p_seat_ids) id
 ),'[]'::jsonb),p_request_id);
end; $$;
revoke all on function public.activate_seats(uuid,jsonb,uuid),public.activate_seats(uuid,uuid[],uuid) from public,anon,authenticated;
grant execute on function public.activate_seats(uuid,jsonb,uuid),public.activate_seats(uuid,uuid[],uuid) to authenticated;
commit;
