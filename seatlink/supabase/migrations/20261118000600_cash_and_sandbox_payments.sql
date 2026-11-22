begin;

create function public.seatlink_sync_checkout_step()
returns trigger language plpgsql set search_path='' as $$
begin
 if new.status='PENDING' then new.checkout_step:='PAYMENT';
 elsif new.status in ('PAID','PAID_REVIEW','EXPIRED','CANCELLED') then new.checkout_step:='RESULT';
 end if;
 return new;
end;
$$;
create trigger sync_checkout_step before insert or update on public.orders for each row execute function public.seatlink_sync_checkout_step();
revoke all on function public.seatlink_sync_checkout_step() from public,anon,authenticated;

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
    jsonb_build_object('attempt_id', p_attempt_id, 'provider', attempt.provider));
  update public.orders set paid_method=(select case when p.provider='CASH' then 'CASH' else 'QR' end
    from public.payment_attempts p where p.id=chosen.paid_attempt_id) where id=chosen.id returning * into chosen;
  return chosen;
end;
$$;



create or replace function public.simulate_mock_payment(p_attempt_id uuid,p_event_id uuid,p_result text)
returns public.orders language plpgsql security definer set search_path='' as $$
declare branch uuid; owner_id uuid;
begin
 perform public.seatlink_require_development();
 select o.branch_id,o.created_by into branch,owner_id from public.payment_attempts p join public.orders o on o.id=p.order_id
 where p.id=p_attempt_id and p.provider='MOCK' and p.mode='MOCK';
 perform public.seatlink_lock_owner_branch(branch);
 if owner_id is distinct from auth.uid() then raise exception using errcode='42501',message='Order access denied.'; end if;
 return public.seatlink_apply_payment_result(p_attempt_id,p_event_id,p_result);
end;
$$;

create function public.confirm_cash_payment(p_order_id uuid,p_request_id uuid,p_received_minor bigint)
returns public.orders language plpgsql security definer set search_path='' as $$
declare chosen public.orders; branch uuid; attempt public.payment_attempts;
begin
 select branch_id into branch from public.orders where id=p_order_id;
 perform public.seatlink_lock_owner_branch(branch);
 perform public.seatlink_expire_branch(branch);
 select * into chosen from public.orders where id=p_order_id for update;
 if chosen.created_by is distinct from auth.uid() then raise exception using errcode='42501',message='Order access denied.'; end if;
 select * into attempt from public.payment_attempts where id=p_request_id;
 if found then
   if attempt.order_id<>p_order_id or attempt.provider<>'CASH' or attempt.cash_received_minor is distinct from p_received_minor then
     raise exception 'Payment request ID was reused with different details.';
   end if;
   return chosen;
 end if;
 if p_request_id is null or p_received_minor is null or p_received_minor<chosen.total_minor or p_received_minor>9007199254740991 then
   raise exception 'The amount received must cover the total and use safe whole minor units.';
 end if;
 if chosen.status<>'PENDING' or chosen.session_expires_at<=clock_timestamp() then raise exception 'The reservation has ended or is already paid. Reserve seats again for an unpaid order.'; end if;
 if chosen.payment_method is distinct from 'CASH' then raise exception 'Select cash before confirming receipt.'; end if;
 if exists(select 1 from public.payment_attempts where order_id=p_order_id and provider<>'CASH'
   and status<>'SUCCEEDED' and provider_state<>'CLOSED') then
   raise exception 'A QR attempt may still accept payment. Verify its cancellation or status before accepting cash.';
 end if;
 insert into public.payment_attempts(id,order_id,provider,mode,amount_minor,currency,qr_expires_at,
   cash_received_minor,cash_change_minor,confirmed_by,provider_state)
 values(p_request_id,p_order_id,'CASH','CASH',chosen.total_minor,chosen.currency,clock_timestamp(),
   p_received_minor,p_received_minor-chosen.total_minor,auth.uid(),'CLOSED');
 return public.seatlink_apply_payment_result(p_request_id,p_request_id,'SUCCESS');
end;
$$;

create function public.resolve_mock_attempt(p_attempt_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare branch uuid; owner_id uuid;
begin
 perform public.seatlink_require_development();
 select o.branch_id,o.created_by into branch,owner_id from public.payment_attempts p join public.orders o on o.id=p.order_id
 where p.id=p_attempt_id and p.provider='MOCK';
 perform public.seatlink_lock_owner_branch(branch);
 if owner_id is distinct from auth.uid() then raise exception using errcode='42501',message='Order access denied.'; end if;
 update public.payment_attempts set provider_state='CLOSED',status=case when status='SUCCEEDED' then status else 'EXPIRED' end where id=p_attempt_id;
 insert into public.audit_events(branch_id,actor_id,action,details)
 values(branch,auth.uid(),'MOCK_QR_RESOLVED',jsonb_build_object('attempt_id',p_attempt_id));
end;
$$;

-- Only the owner's authenticated call can prepare a frozen sandbox attempt.
create function public.begin_sandbox_payment(p_order_id uuid,p_request_id uuid)
returns public.payment_attempts language plpgsql security definer set search_path='' as $$
declare chosen public.orders; branch uuid; attempt public.payment_attempts; merchant text;
begin
 select merchant_id into merchant from public.payment_runtime where mode='SANDBOX';
 if merchant is null or btrim(merchant)='' then raise exception 'Sandbox QR payment is unconfigured.'; end if;
 select branch_id into branch from public.orders where id=p_order_id;
 perform public.seatlink_lock_owner_branch(branch);
 perform public.seatlink_expire_branch(branch);
 select * into chosen from public.orders where id=p_order_id for update;
 if chosen.created_by is distinct from auth.uid() then raise exception using errcode='42501',message='Order access denied.'; end if;
 select * into attempt from public.payment_attempts where id=p_request_id;
 if found then
  if attempt.order_id<>p_order_id or attempt.provider<>'TWO_C2P' then raise exception 'Request ID belongs to another payment.'; end if;
  return attempt;
 end if;
 if chosen.status<>'PENDING' or chosen.payment_method is distinct from 'QR' or chosen.session_expires_at<=clock_timestamp() then
   raise exception 'Choose QR on a valid reserved order first.';
 end if;
 insert into public.payment_attempts(id,order_id,provider,mode,amount_minor,currency,qr_expires_at,
  provider_state,merchant_id,provider_invoice)
 values(p_request_id,p_order_id,'TWO_C2P','SANDBOX',chosen.total_minor,chosen.currency,chosen.session_expires_at,
  'CREATING',merchant,substr(encode(sha256(convert_to(p_request_id::text,'UTF8')),'hex'),1,20)) returning * into attempt;
 return attempt;
end;
$$;

create function public.store_sandbox_qr(p_attempt_id uuid,p_payment_token text,p_image_url text)
returns void language plpgsql security definer set search_path='' as $$
declare branch uuid;
begin
 select o.branch_id into branch from public.payment_attempts p join public.orders o on o.id=p.order_id
 where p.id=p_attempt_id and p.provider='TWO_C2P' and p.mode='SANDBOX';
 if branch is null then raise exception 'Sandbox attempt not found.'; end if;
 perform 1 from public.branches where id=branch for update;
 if p_image_url !~ '^https://pgw-static-sandbox[.]s3[.]amazonaws[.]com/images/qr/' then raise exception 'Unexpected sandbox QR image host.'; end if;
 insert into public.payment_provider_secrets(attempt_id,payment_token) values(p_attempt_id,p_payment_token)
 on conflict(attempt_id) do update set payment_token=excluded.payment_token;
 update public.payment_attempts set qr_image_url=p_image_url,provider_state='PENDING'
 where id=p_attempt_id and status<>'SUCCEEDED';
end;
$$;

create function public.apply_verified_sandbox_result(
 p_attempt_id uuid,p_merchant_id text,p_invoice text,p_amount_minor bigint,p_currency text,
 p_reference text,p_result text,p_event_id uuid
) returns public.orders language plpgsql security definer set search_path='' as $$
declare attempt public.payment_attempts; chosen public.orders; branch uuid; receipt public.provider_receipts;
begin
 select o.branch_id into branch from public.payment_attempts p join public.orders o on o.id=p.order_id where p.id=p_attempt_id;
 if branch is null then raise exception 'Payment attempt not found.'; end if;
 perform 1 from public.branches where id=branch for update;
 select * into attempt from public.payment_attempts where id=p_attempt_id for update;
 if attempt.provider<>'TWO_C2P' or attempt.mode<>'SANDBOX' or attempt.merchant_id is distinct from p_merchant_id
  or attempt.provider_invoice is distinct from p_invoice or attempt.amount_minor is distinct from p_amount_minor or attempt.currency is distinct from p_currency then
  raise exception 'Verified payment details do not match the attempt.';
 end if;
 if p_result='CANCELLED' then
  update public.payment_attempts set provider_state='CLOSED',status=case when status='SUCCEEDED' then status else 'FAILED' end where id=p_attempt_id;
  select * into chosen from public.orders where id=attempt.order_id;
  return chosen;
 end if;
 if p_result not in ('SUCCESS','FAILURE') then raise exception 'Unsupported verified result.'; end if;
 if p_result='SUCCESS' then
  if p_reference is null or btrim(p_reference)='' then raise exception 'A verified payment reference is required.'; end if;
  select * into receipt from public.provider_receipts where merchant_id=p_merchant_id and provider_reference=p_reference;
  if found then
   if receipt.attempt_id<>p_attempt_id then raise exception 'Payment reference already belongs to another attempt.'; end if;
   select * into chosen from public.orders where id=attempt.order_id;
   return chosen;
  end if;
  insert into public.provider_receipts(merchant_id,provider_reference,attempt_id,amount_minor,currency)
  values(p_merchant_id,p_reference,p_attempt_id,p_amount_minor,p_currency);
  if attempt.status='SUCCEEDED' and attempt.provider_reference is distinct from p_reference then
   update public.orders set status='PAID_REVIEW' where id=attempt.order_id returning * into chosen;
   insert into public.payment_exceptions(order_id,payment_attempt_id,kind) values(attempt.order_id,p_attempt_id,'DUPLICATE_PAYMENT')
    on conflict(payment_attempt_id) do nothing;
   insert into public.audit_events(branch_id,order_id,action,details)
    values(branch,attempt.order_id,'ADDITIONAL_PROVIDER_PAYMENT',jsonb_build_object('attempt_id',p_attempt_id,'reference',p_reference));
   return chosen;
  end if;
  update public.payment_attempts set provider_reference=coalesce(provider_reference,p_reference) where id=p_attempt_id;
 end if;
 return public.seatlink_apply_payment_result(p_attempt_id,p_event_id,p_result);
end;
$$;

alter function public.start_next_sale(uuid) rename to seatlink_start_next_sale_v1;
revoke all on function public.seatlink_start_next_sale_v1(uuid) from public,anon,authenticated;
create function public.start_next_sale(p_station_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.seatlink_start_next_sale_v1(p_station_id);
 update public.checkout_stations set cart_preview='[]',cart_revision=cart_revision+1 where id=p_station_id;
end;
$$;

revoke all on function public.confirm_cash_payment(uuid,uuid,bigint),public.resolve_mock_attempt(uuid),
 public.begin_sandbox_payment(uuid,uuid),public.store_sandbox_qr(uuid,text,text),
 public.apply_verified_sandbox_result(uuid,text,text,bigint,text,text,text,uuid),public.start_next_sale(uuid)
 from public,anon,authenticated;
grant execute on function public.confirm_cash_payment(uuid,uuid,bigint),public.resolve_mock_attempt(uuid),
 public.begin_sandbox_payment(uuid,uuid),public.start_next_sale(uuid) to authenticated;
grant execute on function public.store_sandbox_qr(uuid,text,text),
 public.apply_verified_sandbox_result(uuid,text,text,bigint,text,text,text,uuid) to service_role;

commit;
