begin;

alter table public.payment_attempts add column qr_issue text;
alter table public.payment_attempts add column provider_qr_expires_at timestamptz;

create function public.prepare_mock_qr(p_order_id uuid,p_request_id uuid)
returns public.payment_attempts language plpgsql security definer set search_path='' as $$
declare chosen public.orders; attempt public.payment_attempts; branch uuid;
begin
 perform public.seatlink_require_development();
 if not exists(select 1 from public.payment_runtime where mode='MOCK') then raise exception 'Development mock is not the configured payment mode.'; end if;
 select branch_id into branch from public.orders where id=p_order_id;
 perform public.seatlink_lock_owner_branch(branch);
 perform public.seatlink_expire_branch(branch);
 select * into chosen from public.orders where id=p_order_id for update;
 if chosen.created_by is distinct from auth.uid() then raise exception using errcode='42501',message='Order access denied.'; end if;
 if chosen.status<>'PENDING' or chosen.payment_method is distinct from 'QR' or chosen.session_expires_at<=clock_timestamp() then
  raise exception 'Choose QR on an active reservation first.';
 end if;
 if exists(select 1 from public.payment_attempts where id=p_request_id) then
  return public.create_mock_payment(p_order_id,p_request_id);
 end if;
 select * into attempt from public.payment_attempts where order_id=p_order_id order by created_at desc,id desc limit 1;
 if attempt.provider='MOCK' and attempt.status='PENDING' and attempt.qr_expires_at>clock_timestamp() then return attempt; end if;
 return public.create_mock_payment(p_order_id,p_request_id);
end;
$$;

alter function public.begin_sandbox_payment(uuid,uuid) rename to seatlink_begin_sandbox_payment_v1;
revoke all on function public.seatlink_begin_sandbox_payment_v1(uuid,uuid) from public,anon,authenticated;
create function public.begin_sandbox_payment(p_order_id uuid,p_request_id uuid)
returns public.payment_attempts language plpgsql security definer set search_path='' as $$
declare chosen public.orders; attempt public.payment_attempts; branch uuid;
begin
 select branch_id into branch from public.orders where id=p_order_id;
 perform public.seatlink_lock_owner_branch(branch);
 perform public.seatlink_expire_branch(branch);
 select * into chosen from public.orders where id=p_order_id for update;
 if chosen.created_by is distinct from auth.uid() then raise exception using errcode='42501',message='Order access denied.'; end if;
 if exists(select 1 from public.payment_attempts where id=p_request_id) then
  return public.seatlink_begin_sandbox_payment_v1(p_order_id,p_request_id);
 end if;
 if chosen.status<>'PENDING' or chosen.payment_method is distinct from 'QR' or chosen.session_expires_at<=clock_timestamp() then
  raise exception 'Choose QR on an active reservation first.';
 end if;
 select * into attempt from public.payment_attempts where order_id=p_order_id order by created_at desc,id desc limit 1;
 if attempt.provider='TWO_C2P' and attempt.mode='SANDBOX' and attempt.status='PENDING'
   and attempt.provider_state<>'CLOSED' and attempt.qr_expires_at>clock_timestamp()
   and exists(select 1 from public.payment_runtime where mode='SANDBOX' and merchant_id=attempt.merchant_id) then return attempt; end if;
 return public.seatlink_begin_sandbox_payment_v1(p_order_id,p_request_id);
end;
$$;

create or replace function public.store_sandbox_qr(p_attempt_id uuid,p_payment_token text,p_image_url text)
returns void language plpgsql security definer set search_path='' as $$
declare branch uuid;
begin
 select o.branch_id into branch from public.payment_attempts p join public.orders o on o.id=p.order_id
 where p.id=p_attempt_id and p.provider='TWO_C2P' and p.mode='SANDBOX';
 if branch is null then raise exception 'Sandbox attempt not found.'; end if;
 perform 1 from public.branches where id=branch for update;
 if p_image_url is null or p_image_url !~ '^https://(pgw-static-sandbox[.]s3[.]amazonaws[.]com/images/qr/|api[.]2c2p[.]com/pgw/qr/)[^[:space:]]+$'
   then raise exception 'Unexpected provider QR image URL.'; end if;
 if p_payment_token is null or length(p_payment_token)=0 then raise exception 'Missing provider payment token.'; end if;
 insert into public.payment_provider_secrets(attempt_id,payment_token) values(p_attempt_id,p_payment_token)
 on conflict(attempt_id) do update set payment_token=excluded.payment_token;
 update public.payment_attempts set qr_image_url=p_image_url,qr_issue=null,provider_state='PENDING'
 where id=p_attempt_id and status='PENDING';
end;
$$;

create function public.store_sandbox_qr_expiry(p_attempt_id uuid,p_payment_token text,p_image_url text,p_expiry_ms bigint default null)
returns void language plpgsql security definer set search_path='' as $$
begin
 if p_expiry_ms is not null and (p_expiry_ms<=0 or p_expiry_ms>9999999999) then raise exception 'Invalid provider expiry timer.'; end if;
 perform public.store_sandbox_qr(p_attempt_id,p_payment_token,p_image_url);
 if p_expiry_ms is not null then
  update public.payment_attempts p set provider_qr_expires_at=clock_timestamp()+p_expiry_ms*interval '1 millisecond',
   qr_expires_at=least(o.session_expires_at,clock_timestamp()+p_expiry_ms*interval '1 millisecond')
  from public.orders o where p.id=p_attempt_id and o.id=p.order_id and p.status='PENDING';
 end if;
end;
$$;

create function public.record_sandbox_qr_issue(p_attempt_id uuid,p_code text)
returns void language plpgsql security definer set search_path='' as $$
declare branch uuid;
begin
 if p_code not in ('PROVIDER_REQUEST_FAILED','INVALID_QR_DATA','PROVIDER_SIGNATURE_INVALID','QR_PERSIST_FAILED') then raise exception 'Invalid diagnostic code.'; end if;
 select o.branch_id into branch from public.orders o join public.payment_attempts p on p.order_id=o.id where p.id=p_attempt_id;
 perform 1 from public.branches where id=branch for update;
 update public.payment_attempts set qr_issue=p_code,provider_state='UNKNOWN'
 where id=p_attempt_id and provider='TWO_C2P' and mode='SANDBOX' and status='PENDING' and qr_image_url is null;
end;
$$;

alter function public.read_branch_sales(uuid) rename to seatlink_read_branch_sales_v3;
revoke all on function public.seatlink_read_branch_sales_v3(uuid) from public,anon,authenticated;
create function public.read_branch_sales(p_branch_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare snapshot jsonb; runtime public.payment_runtime;
begin
 snapshot:=public.seatlink_read_branch_sales_v3(p_branch_id);
 select * into runtime from public.payment_runtime;
 return snapshot||jsonb_build_object(
  'attempts',(select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at desc,p.id desc),'[]') from public.payment_attempts p where p.order_id=(snapshot->'order'->>'id')::uuid),
  'qr_configuration',case when runtime.mode='MOCK' and not public.seatlink_is_development_operator() then 'MOCK_ACCESS_DISABLED'
    when runtime.mode='SANDBOX' and coalesce(runtime.merchant_id,'')='' then 'SANDBOX_MERCHANT_MISSING'
    when runtime.mode='DISABLED' then 'QR_DISABLED' else 'READY' end);
end;
$$;

alter function public.read_customer_display(text) rename to seatlink_read_customer_display_v2;
revoke all on function public.seatlink_read_customer_display_v2(text) from public,anon,authenticated;
create function public.read_customer_display(p_token text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare snapshot jsonb; attempt public.payment_attempts; chosen public.orders; valid_qr boolean;
begin
 snapshot:=public.seatlink_read_customer_display_v2(p_token);
 select o.* into chosen from public.orders o join public.checkout_stations s on s.current_order_id=o.id
 where s.id=(snapshot->>'station_id')::uuid;
 if chosen.id is null or snapshot->'order'='null'::jsonb then return snapshot; end if;
 select * into attempt from public.payment_attempts where order_id=chosen.id order by created_at desc,id desc limit 1;
 valid_qr:=chosen.status='PENDING' and chosen.payment_method='QR' and chosen.session_expires_at>clock_timestamp()
   and attempt.status='PENDING' and attempt.qr_expires_at>clock_timestamp();
 return jsonb_set(snapshot,'{order}',snapshot->'order'||jsonb_build_object(
  'payment_attempt_id',attempt.id,'payment_mode',attempt.mode,'payment_status',attempt.status,
  'qr_expires_at',attempt.qr_expires_at,'provider_qr_expires_at',attempt.provider_qr_expires_at,
  'qr_text',case when valid_qr and attempt.provider='MOCK' then 'seatlink-demo:'||attempt.id::text end,
  'qr_image_url',case when valid_qr and attempt.provider='TWO_C2P' then attempt.qr_image_url end));
end;
$$;

revoke all on function public.prepare_mock_qr(uuid,uuid),public.begin_sandbox_payment(uuid,uuid),
 public.store_sandbox_qr_expiry(uuid,text,text,bigint),public.record_sandbox_qr_issue(uuid,text),
 public.read_branch_sales(uuid),public.read_customer_display(text) from public,anon,authenticated;
grant execute on function public.prepare_mock_qr(uuid,uuid),public.begin_sandbox_payment(uuid,uuid),public.read_branch_sales(uuid) to authenticated;
grant execute on function public.read_customer_display(text) to anon,authenticated;
grant execute on function public.store_sandbox_qr_expiry(uuid,text,text,bigint),public.record_sandbox_qr_issue(uuid,text) to service_role;
commit;
