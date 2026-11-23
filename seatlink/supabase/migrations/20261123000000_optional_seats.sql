begin;

alter table public.orders drop constraint orders_session_check;
alter table public.orders add constraint orders_session_check check (
 (status='DRAFT' and session_expires_at is null and cardinality(selected_seat_ids)=0)
 or (status='PENDING' and session_expires_at is not null and cardinality(selected_seat_ids) between 0 and 4)
 or status in ('CANCELLED','EXPIRED','PAID','PAID_REVIEW')
);
alter table public.orders add constraint orders_seat_limit check (cardinality(selected_seat_ids) between 0 and 4);

alter function public.confirm_order_seats(uuid,integer,uuid[]) rename to seatlink_confirm_order_seats_v2;
revoke all on function public.seatlink_confirm_order_seats_v2(uuid,integer,uuid[]) from public,anon,authenticated;
create function public.confirm_order_seats(p_order_id uuid,p_revision integer,p_seat_ids uuid[])
returns public.orders language plpgsql security definer set search_path='' as $$
declare chosen public.orders; branch uuid;
begin
 if p_seat_ids is null or cardinality(p_seat_ids)>4 or array_position(p_seat_ids,null) is not null
   or (select count(distinct id) from unnest(p_seat_ids) id)<>cardinality(p_seat_ids) then
  raise exception 'Select zero to four distinct seats.';
 end if;
 if cardinality(p_seat_ids)>0 then return public.seatlink_confirm_order_seats_v2(p_order_id,p_revision,p_seat_ids); end if;
 select branch_id into branch from public.orders where id=p_order_id;
 perform public.seatlink_lock_owner_branch(branch);
 perform public.seatlink_expire_branch(branch);
 select * into chosen from public.orders where id=p_order_id for update;
 if chosen.created_by is distinct from auth.uid() then raise exception using errcode='42501',message='Order access denied.'; end if;
 if chosen.status not in ('DRAFT','PENDING') then raise exception 'The checkout session ended or is already paid. Start a new order.'; end if;
 if not exists(select 1 from public.order_items where order_id=p_order_id and quantity>0) then raise exception 'Purchase at least one item before continuing.'; end if;
 if chosen.status='PENDING' and cardinality(chosen.selected_seat_ids)=0 then return chosen; end if;
 if chosen.revision is distinct from p_revision then raise exception 'Order changed. Reload before continuing.'; end if;
 if chosen.status='DRAFT' then
  perform mi.id from public.menu_items mi join public.order_items oi on oi.menu_item_id=mi.id
  where oi.order_id=p_order_id order by mi.id for share of mi;
  if exists(select 1 from public.order_items oi join public.menu_items mi on mi.id=oi.menu_item_id
    where oi.order_id=p_order_id and (not mi.available or mi.price_minor<>oi.unit_price_minor or mi.name<>oi.name
      or mi.currency<>chosen.currency or mi.branch_id<>branch)) then
    raise exception 'Menu changed. Save the draft again to review current prices.';
  end if;
 end if;
 if exists(select 1 from public.seat_use_sessions where order_id=p_order_id and status='ACTIVE') then raise exception 'Paid seat use cannot be released by skipping seats.'; end if;
 update public.seats set status='AVAILABLE',locked_order_id=null
 where locked_order_id=p_order_id and status='LOCKED';
 update public.orders set status='PENDING',checkout_step='PAYMENT',selected_seat_ids='{}',draft_seat_ids='{}',
  session_expires_at=coalesce(session_expires_at,clock_timestamp()+interval '5 minutes'),revision=revision+1,updated_at=clock_timestamp()
 where id=p_order_id returning * into chosen;
 insert into public.audit_events(branch_id,order_id,actor_id,action,details)
 values(branch,p_order_id,auth.uid(),'SEATS_SKIPPED','{}');
 return chosen;
end;
$$;
revoke all on function public.confirm_order_seats(uuid,integer,uuid[]) from public,anon,authenticated;
grant execute on function public.confirm_order_seats(uuid,integer,uuid[]) to authenticated;

-- Payment allocation is replaced below: empty selections complete without inserting seat-use rows.
create or replace function public.seatlink_apply_payment_result(p_attempt_id uuid, p_event_id uuid, p_result text)
returns public.orders language plpgsql security definer set search_path = '' as $$
declare
  branch uuid;
  attempt public.payment_attempts;
  chosen public.orders;
  event public.payment_events;
  valid_locks integer;
  verified_at timestamptz;
  exception_kind text;
begin
  select o.branch_id into branch from public.payment_attempts p join public.orders o on o.id = p.order_id
  where p.id = p_attempt_id;
  if branch is null then raise exception 'Payment attempt not found.'; end if;
  perform 1 from public.branches where id = branch for update;
  perform public.seatlink_expire_branch(branch);
  select * into attempt from public.payment_attempts where id = p_attempt_id for update;
  select * into chosen from public.orders where id = attempt.order_id for update;
  if p_result is null or p_result not in ('SUCCESS', 'FAILURE') or p_event_id is null then
    raise exception 'Invalid payment event.';
  end if;
  select * into event from public.payment_events where id = p_event_id;
  if found then
    if event.payment_attempt_id <> p_attempt_id or event.result <> p_result then
      raise exception 'Event ID was reused for a different payment result.';
    end if;
    return chosen;
  end if;
  if attempt.amount_minor <> chosen.total_minor or attempt.currency <> chosen.currency or attempt.provider not in ('MOCK','CASH','TWO_C2P') then
    raise exception 'Payment amount, currency or provider does not match the order.';
  end if;
  insert into public.payment_events (id, payment_attempt_id, result) values (p_event_id, p_attempt_id, p_result);
  if attempt.status = 'SUCCEEDED' then return chosen; end if;
  if p_result = 'FAILURE' then
    update public.payment_attempts set status = 'FAILED' where id = p_attempt_id;
    insert into public.audit_events (branch_id, order_id, actor_id, action, details)
    values (branch, chosen.id, auth.uid(), 'PAYMENT_FAILED', jsonb_build_object('attempt_id', p_attempt_id,'provider',attempt.provider));
    return chosen;
  end if;

  verified_at := clock_timestamp();
  update public.payment_attempts set status = 'SUCCEEDED', provider_state = 'SUCCEEDED', succeeded_at = verified_at where id = p_attempt_id;
  if chosen.paid_attempt_id is not null then
    exception_kind := 'DUPLICATE_PAYMENT';
  else
    select count(*) into valid_locks from public.seats
    where id = any(chosen.selected_seat_ids) and status = 'LOCKED' and locked_order_id = chosen.id;
    if not exists(select 1 from public.order_items where order_id=chosen.id and quantity>0) or chosen.status <> 'PENDING' or chosen.session_expires_at <= verified_at
        or valid_locks <> cardinality(chosen.selected_seat_ids) or valid_locks not between 0 and 4 then
      exception_kind := 'LATE_PAYMENT';
    end if;
  end if;

  if exception_kind is not null then
    update public.orders set status = 'PAID_REVIEW', paid_at = coalesce(paid_at, verified_at),
      paid_attempt_id = coalesce(paid_attempt_id, p_attempt_id),
      revision = revision + 1, updated_at = verified_at where id = chosen.id returning * into chosen;
    insert into public.payment_exceptions (order_id, payment_attempt_id, kind)
    values (chosen.id, p_attempt_id, exception_kind) on conflict (payment_attempt_id) do nothing;
  else
    insert into public.seat_use_sessions (order_id, seat_id, started_at, expires_at)
    select chosen.id, s.id, verified_at, verified_at + interval '10 minutes'
    from public.seats s where s.id = any(chosen.selected_seat_ids) order by s.id;
    update public.seats s set status = 'UNAVAILABLE', locked_order_id = null, active_seat_use_session_id = u.id
    from public.seat_use_sessions u where u.order_id = chosen.id and u.status = 'ACTIVE' and u.seat_id = s.id;
    update public.orders set status = 'PAID', paid_at = verified_at, paid_attempt_id = p_attempt_id,
      revision = revision + 1, updated_at = verified_at where id = chosen.id returning * into chosen;
  end if;
  insert into public.audit_events (branch_id, order_id, actor_id, action, details)
  values (branch, chosen.id, auth.uid(), coalesce(exception_kind, 'PAYMENT_ALLOCATED'),
    jsonb_build_object('attempt_id', p_attempt_id, 'provider', attempt.provider));
  update public.orders set paid_method=(select case when p.provider='CASH' then 'CASH' else 'QR' end
    from public.payment_attempts p where p.id=chosen.paid_attempt_id) where id=chosen.id returning * into chosen;
  return chosen;
end;
$$;

alter function public.read_customer_display(text) rename to seatlink_read_customer_display_v3;
revoke all on function public.seatlink_read_customer_display_v3(text) from public,anon,authenticated;
create function public.read_customer_display(p_token text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare snapshot jsonb; station public.checkout_stations; chosen public.orders; highlighted uuid[];
begin
 snapshot:=public.seatlink_read_customer_display_v3(p_token);
 select * into station from public.checkout_stations where id=(snapshot->>'station_id')::uuid;
 select * into chosen from public.orders where id=station.current_order_id;
 highlighted:=case when chosen.status='DRAFT' then chosen.draft_seat_ids
   when chosen.status='PENDING' then chosen.selected_seat_ids else '{}'::uuid[] end;
 return snapshot||jsonb_build_object('tables',(
   select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'table_number',t.table_number,'seats',(
    select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'label',s.label,'status',s.status,
      'current_order',case when chosen.status in ('PAID','PAID_REVIEW') then exists(
        select 1 from public.seat_use_sessions u where u.order_id=chosen.id and u.seat_id=s.id
          and u.status='ACTIVE' and u.id=s.active_seat_use_session_id)
       when chosen.status='PENDING' then coalesce(s.id=any(highlighted) and s.locked_order_id=chosen.id,false)
       else s.id=any(highlighted) end
    ) order by s.label),'[]') from public.seats s where s.table_id=t.id
   )) order by t.table_number),'[]') from public.tables t where t.branch_id=station.branch_id
 ));
end;
$$;
revoke all on function public.read_customer_display(text) from public,anon,authenticated;
grant execute on function public.read_customer_display(text) to anon,authenticated;
commit;




