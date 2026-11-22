begin;

alter table public.payment_attempts add column creation_started_at timestamptz;
create function public.claim_sandbox_creation(p_attempt_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 update public.payment_attempts set creation_started_at=clock_timestamp()
 where id=p_attempt_id and provider='TWO_C2P' and mode='SANDBOX' and creation_started_at is null;
 return found;
end;
$$;
revoke all on function public.claim_sandbox_creation(uuid) from public,anon,authenticated;
grant execute on function public.claim_sandbox_creation(uuid) to service_role;

alter function public.read_branch_sales(uuid) rename to seatlink_read_branch_sales_v2;
revoke all on function public.seatlink_read_branch_sales_v2(uuid) from public,anon,authenticated;
create function public.read_branch_sales(p_branch_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare snapshot jsonb; station public.checkout_stations;
begin
 snapshot:=public.seatlink_read_branch_sales_v2(p_branch_id);
 select * into station from public.checkout_stations where id=(snapshot->'station'->>'id')::uuid;
 if snapshot->'order'='null'::jsonb and station.current_order_id is not null then
   snapshot:=jsonb_set(snapshot,'{order}',coalesce(public.seatlink_order_projection(station.current_order_id),'null'));
 end if;
 return snapshot||jsonb_build_object(
  'cart_preview',station.cart_preview,'cart_revision',station.cart_revision,
  'cart_total_minor',(select coalesce(sum((i->>'quantity')::numeric*(i->>'unit_price_minor')::numeric),0) from jsonb_array_elements(station.cart_preview) i),
  'display_last_seen_at',(select max(last_seen_at) from public.display_sessions where station_id=station.id and expires_at>clock_timestamp()),
  'payment_mode',(select case when mode='MOCK' and not public.seatlink_is_development_operator() then 'UNCONFIGURED' else mode end from public.payment_runtime),
  'unresolved_qr',(select count(*) from public.payment_attempts where order_id=(snapshot->'order'->>'id')::uuid
     and provider<>'CASH' and status<>'SUCCEEDED' and provider_state<>'CLOSED')
 );
end;
$$;

alter function public.read_customer_display(text) rename to seatlink_read_customer_display_v1;
revoke all on function public.seatlink_read_customer_display_v1(text) from public,anon,authenticated;
create function public.read_customer_display(p_token text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare snapshot jsonb; station public.checkout_stations; chosen public.orders; attempt public.payment_attempts;
begin
 snapshot:=public.seatlink_read_customer_display_v1(p_token);
 select * into station from public.checkout_stations where id=(snapshot->>'station_id')::uuid;
 -- The base reader validated the token and acquired the branch lock.
 update public.display_sessions set last_seen_at=clock_timestamp()
 where token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') and expires_at>clock_timestamp();
 if not found then raise exception using errcode='42501',message='Display pairing is invalid or expired.'; end if;
 select * into chosen from public.orders where id=station.current_order_id;
 if chosen.id is null or (chosen.status='DRAFT' and chosen.checkout_step='MENU') then
   if jsonb_array_length(station.cart_preview)>0 or chosen.id is not null then
     snapshot:=jsonb_set(snapshot,'{order}',jsonb_build_object('reference',case when chosen.id is not null then left(chosen.id::text,8) else 'Preparing' end,
      'status','DRAFT','checkout_step','MENU','payment_method',null,'paid_method',null,
      'total_minor',(select coalesce(sum((i->>'quantity')::numeric*(i->>'unit_price_minor')::numeric),0) from jsonb_array_elements(station.cart_preview) i),
      'currency',coalesce(station.cart_preview->0->>'currency',chosen.currency),'items',station.cart_preview,'selected_seats','[]'::jsonb,'allocations','[]'::jsonb,
      'session_expires_at',null,'payment_status',null,'qr_expires_at',null,'qr_text',null,'qr_image_url',null,'payment_mode',null));
   elsif chosen.id is null then snapshot:=jsonb_set(snapshot,'{order}','null'); end if;
 end if;
 if chosen.id is not null and snapshot->'order'<>'null'::jsonb then
   select * into attempt from public.payment_attempts where order_id=chosen.id order by created_at desc limit 1;
   snapshot:=jsonb_set(snapshot,'{order}',snapshot->'order'||jsonb_build_object(
    'checkout_step',chosen.checkout_step,'payment_method',chosen.payment_method,'paid_method',chosen.paid_method,
    'qr_image_url',case when chosen.status='PENDING' and chosen.payment_method='QR' and attempt.status='PENDING'
      and attempt.qr_expires_at>clock_timestamp() then attempt.qr_image_url else null end,
    'payment_mode',attempt.mode,
    'selected_seats',(select coalesce(jsonb_agg(jsonb_build_object('label',s.label,'table_number',t.table_number)
       order by t.table_number,s.label),'[]') from public.seats s join public.tables t on t.id=s.table_id
       where s.id=any(case when chosen.status='DRAFT' then chosen.draft_seat_ids else chosen.selected_seat_ids end))
   ));
   if attempt.provider is distinct from 'MOCK' then
     snapshot:=jsonb_set(snapshot,'{order,qr_text}','null');
   end if;
   if chosen.payment_method is distinct from 'QR' then
     snapshot:=jsonb_set(snapshot,'{order,qr_text}','null');
     snapshot:=jsonb_set(snapshot,'{order,qr_image_url}','null');
   end if;
 end if;
 return snapshot;
end;
$$;

-- Preview writes also invalidate only the paired counter's read-only projection.
create or replace function public.seatlink_display_changed()
returns trigger language plpgsql security definer set search_path='' as $$
declare branch uuid;
begin
 if tg_table_name in ('checkout_stations','orders') then branch:=new.branch_id;
 elsif tg_table_name='seats' then select branch_id into branch from public.tables where id=new.table_id;
 else select branch_id into branch from public.orders where id=new.order_id; end if;
 perform public.seatlink_notify_branch(branch);
 return new;
end;
$$;
revoke all on function public.read_branch_sales(uuid),public.read_customer_display(text) from public,anon,authenticated;
grant execute on function public.read_branch_sales(uuid) to authenticated;
grant execute on function public.read_customer_display(text) to anon,authenticated;

commit;
