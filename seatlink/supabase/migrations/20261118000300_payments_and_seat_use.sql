begin;

create function public.create_mock_payment(p_order_id uuid, p_request_id uuid)
returns public.payment_attempts language plpgsql security definer set search_path = '' as $$
declare branch uuid; chosen public.orders; attempt public.payment_attempts;
begin
  perform public.seatlink_require_development();
  select branch_id into branch from public.orders where id = p_order_id;
  perform public.seatlink_lock_owner_branch(branch);
  perform public.seatlink_expire_branch(branch);
  select * into chosen from public.orders where id = p_order_id for update;
  if chosen.created_by is distinct from auth.uid() then
    raise exception using errcode = '42501', message = 'Order access denied.';
  end if;
  select * into attempt from public.payment_attempts where id = p_request_id;
  if found then
    if attempt.order_id <> p_order_id then raise exception 'Request ID already belongs to another order.'; end if;
    return attempt;
  end if;
  if chosen.status <> 'PENDING' or chosen.session_expires_at <= clock_timestamp() then
    raise exception 'The order session has ended. Start a new order.';
  end if;
  -- A replacement invalidates the old QR, but its eventual success is still recorded.
  update public.payment_attempts set status = 'EXPIRED' where order_id = p_order_id and status = 'PENDING';
  insert into public.payment_attempts (id, order_id, amount_minor, currency, qr_expires_at)
  values (p_request_id, p_order_id, chosen.total_minor, chosen.currency,
    least(clock_timestamp() + interval '60 seconds', chosen.session_expires_at))
  returning * into attempt;
  return attempt;
end;
$$;

-- Trusted payment boundary. Only verified adapters or the guarded mock can invoke it.
create function public.seatlink_apply_payment_result(p_attempt_id uuid, p_event_id uuid, p_result text)
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
  if attempt.amount_minor <> chosen.total_minor or attempt.currency <> chosen.currency or attempt.provider <> 'MOCK' then
    raise exception 'Payment amount, currency or provider does not match the order.';
  end if;
  insert into public.payment_events (id, payment_attempt_id, result) values (p_event_id, p_attempt_id, p_result);
  if attempt.status = 'SUCCEEDED' then return chosen; end if;
  if p_result = 'FAILURE' then
    update public.payment_attempts set status = 'FAILED' where id = p_attempt_id;
    insert into public.audit_events (branch_id, order_id, actor_id, action, details)
    values (branch, chosen.id, auth.uid(), 'MOCK_PAYMENT_FAILED', jsonb_build_object('attempt_id', p_attempt_id));
    return chosen;
  end if;

  verified_at := clock_timestamp();
  update public.payment_attempts set status = 'SUCCEEDED', succeeded_at = verified_at where id = p_attempt_id;
  if chosen.paid_attempt_id is not null then
    exception_kind := 'DUPLICATE_PAYMENT';
  else
    select count(*) into valid_locks from public.seats
    where id = any(chosen.selected_seat_ids) and status = 'LOCKED' and locked_order_id = chosen.id;
    if chosen.status <> 'PENDING' or chosen.session_expires_at <= verified_at
        or valid_locks <> cardinality(chosen.selected_seat_ids) or valid_locks not between 1 and 4 then
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
    jsonb_build_object('attempt_id', p_attempt_id, 'provider', 'MOCK'));
  return chosen;
end;
$$;

create function public.simulate_mock_payment(p_attempt_id uuid, p_event_id uuid, p_result text)
returns public.orders language plpgsql security definer set search_path = '' as $$
declare branch uuid; owner_id uuid;
begin
  perform public.seatlink_require_development();
  select o.branch_id, o.created_by into branch, owner_id
  from public.payment_attempts p join public.orders o on o.id = p.order_id where p.id = p_attempt_id;
  perform public.seatlink_lock_owner_branch(branch);
  if owner_id is distinct from auth.uid() then
    raise exception using errcode = '42501', message = 'Order access denied.';
  end if;
  return public.seatlink_apply_payment_result(p_attempt_id, p_event_id, p_result);
end;
$$;

create function public.release_seat_use(p_order_id uuid, p_session_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare branch uuid; matched integer;
begin
  select branch_id into branch from public.orders where id = p_order_id;
  perform public.seatlink_lock_owner_branch(branch);
  perform public.seatlink_expire_branch(branch);
  if p_session_ids is null or cardinality(p_session_ids) = 0
      or array_position(p_session_ids, null) is not null
      or (select count(distinct id) from unnest(p_session_ids) id) <> cardinality(p_session_ids) then
    raise exception 'Select distinct active seat-use sessions to release.';
  end if;
  perform s.id from public.seats s join public.seat_use_sessions u on u.id = s.active_seat_use_session_id
  where u.id = any(p_session_ids) order by s.id for update of s;
  select count(*) into matched from public.seat_use_sessions u
  join public.seats s on s.active_seat_use_session_id = u.id and s.id = u.seat_id
  where u.id = any(p_session_ids) and u.order_id = p_order_id and u.status = 'ACTIVE' and u.expires_at > clock_timestamp();
  if matched <> cardinality(p_session_ids) then
    raise exception 'An allocation changed or ended. Refresh before releasing seats.';
  end if;
  update public.seats set status = 'AVAILABLE', active_seat_use_session_id = null
  where active_seat_use_session_id = any(p_session_ids);
  update public.seat_use_sessions set status = 'RELEASED', ended_at = clock_timestamp() where id = any(p_session_ids);
  insert into public.audit_events (branch_id, order_id, actor_id, action, details)
  values (branch, p_order_id, auth.uid(), 'SEATS_RELEASED', jsonb_build_object('session_ids', p_session_ids));
end;
$$;

create function public.seatlink_extend_session(
  p_request_id uuid, p_seat_id uuid, p_session_id uuid, p_additional_seconds numeric,
  p_device_id uuid, p_actor_id uuid
) returns timestamptz language plpgsql security definer set search_path = '' as $$
declare previous public.extension_requests; allocation public.seat_use_sessions; branch uuid; deadline timestamptz;
begin
  if p_request_id is null or p_additional_seconds is null or p_additional_seconds <= 0
      or p_additional_seconds > 9007199254740991 or mod(p_additional_seconds, 60) <> 0 then
    raise exception 'Additional time must be positive whole minutes within safe numeric range.';
  end if;
  select o.branch_id into branch from public.seat_use_sessions u join public.orders o on o.id = u.order_id
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

create function public.extend_seat_use(
  p_device_token text, p_request_id uuid, p_seat_id uuid, p_session_id uuid, p_additional_seconds numeric
) returns timestamptz language plpgsql security definer set search_path = '' as $$
declare device public.hardware_devices;
begin
  if p_device_token is null or p_device_token !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '42501', message = 'Device access denied.';
  end if;
  select d.* into device from public.hardware_devices d join public.seats s on s.table_id = d.table_id
  where d.token_hash = encode(sha256(convert_to(p_device_token, 'UTF8')), 'hex') and d.enabled and s.id = p_seat_id;
  if not found then raise exception using errcode = '42501', message = 'Device access denied.'; end if;
  return public.seatlink_extend_session(p_request_id, p_seat_id, p_session_id, p_additional_seconds, device.id, null);
end;
$$;

create function public.simulate_extension(p_session_id uuid, p_request_id uuid, p_additional_seconds numeric)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare branch uuid; seat uuid;
begin
  perform public.seatlink_require_development();
  select o.branch_id, u.seat_id into branch, seat
  from public.seat_use_sessions u join public.orders o on o.id = u.order_id where u.id = p_session_id;
  perform public.seatlink_lock_owner_branch(branch);
  return public.seatlink_extend_session(p_request_id, seat, p_session_id, p_additional_seconds, null, auth.uid());
end;
$$;

create function public.record_payment_follow_up(p_exception_id uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare branch uuid; chosen public.payment_exceptions;
begin
  select e.* into chosen from public.payment_exceptions e where id = p_exception_id;
  select branch_id into branch from public.orders where id = chosen.order_id;
  perform public.seatlink_lock_owner_branch(branch);
  if p_note is null or btrim(p_note) = '' then raise exception 'Describe the owner follow-up.'; end if;
  update public.payment_exceptions set reviewed_at = clock_timestamp(), reviewed_by = auth.uid(), owner_note = btrim(p_note)
  where id = p_exception_id;
  insert into public.audit_events (branch_id, order_id, actor_id, action, details)
  values (branch, chosen.order_id, auth.uid(), 'PAYMENT_OWNER_FOLLOW_UP',
    jsonb_build_object('exception_id', p_exception_id, 'note', btrim(p_note)));
end;
$$;

create function public.start_next_sale(p_station_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare station public.checkout_stations;
begin
  select * into station from public.checkout_stations where id = p_station_id;
  perform public.seatlink_lock_owner_branch(station.branch_id);
  perform public.seatlink_expire_branch(station.branch_id);
  if station.operator_id is distinct from auth.uid() then
    raise exception using errcode = '42501', message = 'Counter access denied.';
  end if;
  if exists (select 1 from public.orders where station_id = p_station_id and status in ('DRAFT', 'PENDING')) then
    raise exception 'Finish or cancel the current order first.';
  end if;
  update public.checkout_stations set current_order_id = null where id = p_station_id;
end;
$$;

revoke all on function public.create_mock_payment(uuid, uuid),
  public.seatlink_apply_payment_result(uuid, uuid, text), public.simulate_mock_payment(uuid, uuid, text),
  public.release_seat_use(uuid, uuid[]), public.seatlink_extend_session(uuid, uuid, uuid, numeric, uuid, uuid),
  public.extend_seat_use(text, uuid, uuid, uuid, numeric), public.simulate_extension(uuid, uuid, numeric),
  public.record_payment_follow_up(uuid, text), public.start_next_sale(uuid) from public, anon, authenticated;
grant execute on function public.create_mock_payment(uuid, uuid), public.simulate_mock_payment(uuid, uuid, text),
  public.release_seat_use(uuid, uuid[]), public.simulate_extension(uuid, uuid, numeric),
  public.record_payment_follow_up(uuid, text), public.start_next_sale(uuid) to authenticated;
grant execute on function public.extend_seat_use(text, uuid, uuid, uuid, numeric) to anon, authenticated;

commit;
