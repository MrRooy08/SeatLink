-- One-time repair of the four legacy occupied seats explicitly requested by the owner.
-- Not a migration or seed. Exact IDs prevent this from touching unrelated seats.
-- Reuses normal activation, audit, expiry, extension and paired-display notifications.
-- Fixed request IDs make a retry a no-op, even after these sessions have ended.
begin;
do $$
declare target record; previous public.seat_operation_requests;
 owner_id constant uuid:='787ceaf9-09f4-4090-ab31-2f709c023bd3';
begin
 if not exists(select 1 from auth.users where id=owner_id and lower(email)='roni.nguyen@avepoint.com')
 then raise exception 'The verified repair owner does not match this database.'; end if;
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 for target in select * from (values
  ('9ab8e80c-7bf4-4cf0-a437-133318c32b01'::uuid,'f8db9a51-dc93-4e3c-a325-63cb5871b741'::uuid,
    array['04946f84-c1e9-4bec-a1d8-1615addae47a','078e2fae-e632-4136-bf31-912cda383c32']::uuid[]),
  ('9ab8e80c-7bf4-4cf0-a437-133318c32b02'::uuid,'090315bc-15b8-447f-8938-d256ed9c68f7'::uuid,
    array['813fe76e-f4ee-4f9f-9f0c-43e970e2625f','f1b9f0ae-a312-4c0e-9a55-26b3a878ea96']::uuid[])
 ) as targets(branch_id,request_id,seat_ids) order by branch_id loop
  perform public.seatlink_lock_owner_branch(target.branch_id);
  select * into previous from public.seat_operation_requests where id=target.request_id;
  if found then
   if previous.branch_id<>target.branch_id or previous.actor_id<>owner_id or previous.operation<>'ACTIVATE'
     or previous.targets<>target.seat_ids then raise exception 'Repair request ID conflict.'; end if;
   continue;
  end if;
  perform s.id from public.seats s join public.tables t on t.id=s.table_id
   where s.id=any(target.seat_ids) and t.branch_id=target.branch_id order by s.id for update of s;
  if (select count(*) from public.seats s join public.tables t on t.id=s.table_id
   where s.id=any(target.seat_ids) and t.branch_id=target.branch_id and s.status='UNAVAILABLE'
   and s.locked_order_id is null and s.active_seat_use_session_id is null
   and not exists(select 1 from public.seat_use_sessions u where u.seat_id=s.id and u.status='ACTIVE'))<>2
  then raise exception 'Legacy seat state changed. Repair aborted without changing any seats.'; end if;
  -- No AVAILABLE state is externally visible: both transitions commit atomically.
  update public.seats set status='AVAILABLE' where id=any(target.seat_ids);
  perform public.activate_seats(target.branch_id,target.seat_ids,target.request_id);
  insert into public.audit_events(branch_id,actor_id,action,details)
   values(target.branch_id,owner_id,'LEGACY_OCCUPIED_TIMERS_STARTED',jsonb_build_object(
    'request_id',target.request_id,'seat_ids',target.seat_ids,'duration_seconds',600,
    'reason','Owner requested countdowns for legacy occupied seats without sessions'));
 end loop;
end; $$;
commit;
