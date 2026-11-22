begin;

alter table public.orders add column checkout_step text not null default 'MENU'
  check (checkout_step in ('MENU','SEATS','PAYMENT','RESULT'));
alter table public.orders add column payment_method text check (payment_method in ('QR','CASH'));
alter table public.orders add column paid_method text check (paid_method in ('QR','CASH'));
alter table public.orders add column draft_seat_ids uuid[] not null default '{}';
update public.orders set checkout_step = case status when 'DRAFT' then 'SEATS' when 'PENDING' then 'PAYMENT' else 'RESULT' end,
  payment_method = case when status in ('PENDING','PAID','PAID_REVIEW') then 'QR' end,
  paid_method = case when status in ('PAID','PAID_REVIEW') then 'QR' end,
  draft_seat_ids = selected_seat_ids;

alter table public.checkout_stations add column cart_preview jsonb not null default '[]';
alter table public.checkout_stations add column cart_revision integer not null default 0;
alter table public.display_sessions add column last_seen_at timestamptz;

alter table public.payment_attempts drop constraint payment_attempts_provider_check;
alter table public.payment_attempts add constraint payment_attempts_provider_check check (provider in ('MOCK','CASH','TWO_C2P'));
alter table public.payment_attempts add column mode text not null default 'MOCK' check (mode in ('MOCK','CASH','SANDBOX'));
alter table public.payment_attempts add column provider_state text not null default 'UNKNOWN'
  check (provider_state in ('CREATING','UNKNOWN','PENDING','CLOSED','SUCCEEDED'));
alter table public.payment_attempts add column provider_invoice text unique;
alter table public.payment_attempts add column merchant_id text;
alter table public.payment_attempts add column provider_reference text;
alter table public.payment_attempts add column qr_image_url text;
alter table public.payment_attempts add column cash_received_minor bigint check (cash_received_minor between 1 and 9007199254740991);
alter table public.payment_attempts add column cash_change_minor bigint check (cash_change_minor between 0 and 9007199254740991);
alter table public.payment_attempts add column confirmed_by uuid references auth.users(id);
update public.payment_attempts set provider_state = case when status='SUCCEEDED' then 'SUCCEEDED' else 'UNKNOWN' end;

create table public.payment_runtime (
  singleton boolean primary key default true check (singleton),
  mode text not null default 'MOCK' check (mode in ('MOCK','SANDBOX','DISABLED')),
  merchant_id text
);
insert into public.payment_runtime(singleton) values(true);
create table public.payment_provider_secrets (
  attempt_id uuid primary key references public.payment_attempts(id),
  payment_token text not null
);
create table public.provider_receipts (
  merchant_id text not null,
  provider_reference text not null,
  attempt_id uuid not null references public.payment_attempts(id),
  amount_minor bigint not null,
  currency text not null,
  received_at timestamptz not null default clock_timestamp(),
  primary key (merchant_id,provider_reference)
);
alter table public.payment_runtime enable row level security;
alter table public.payment_provider_secrets enable row level security;
alter table public.provider_receipts enable row level security;
revoke all on public.payment_runtime,public.payment_provider_secrets,public.provider_receipts from public,anon,authenticated;
grant select on public.payment_provider_secrets,public.payment_attempts,public.orders to service_role;

create function public.update_cart_preview(p_station_id uuid,p_revision integer,p_items jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare station public.checkout_stations; normalized jsonb; count_items integer;
begin
 select * into station from public.checkout_stations where id=p_station_id;
 perform public.seatlink_lock_owner_branch(station.branch_id);
 select * into station from public.checkout_stations where id=p_station_id for update;
 if station.operator_id is distinct from auth.uid() then raise exception using errcode='42501',message='Counter access denied.'; end if;
 if exists(select 1 from public.orders where id=station.current_order_id and (status<>'DRAFT' or checkout_step<>'MENU')) then
   raise exception 'Return to Menu or explicitly cancel the reserved order before editing.';
 end if;
 if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Provide a cart item array.'; end if;
 count_items:=jsonb_array_length(p_items);
 if exists(select 1 from jsonb_array_elements(p_items) i where jsonb_typeof(i->'quantity') is distinct from 'number'
   or (i->>'quantity') !~ '^[1-9][0-9]*$' or jsonb_typeof(i->'menu_item_id') is distinct from 'string') then
   raise exception 'Use positive whole quantities and menu item IDs.';
 end if;
 if (select count(distinct i->>'menu_item_id') from jsonb_array_elements(p_items) i)<>count_items then raise exception 'Duplicate items are not allowed.'; end if;
 perform m.id from public.menu_items m join jsonb_to_recordset(p_items) as i(menu_item_id uuid,quantity integer) on i.menu_item_id=m.id
   where m.branch_id=station.branch_id and m.available order by m.id for share of m;
 if (select count(*) from public.menu_items m join jsonb_to_recordset(p_items) as i(menu_item_id uuid,quantity integer)
   on i.menu_item_id=m.id where m.branch_id=station.branch_id and m.available)<>count_items then
   raise exception 'An item is unavailable or belongs to another branch.';
 end if;
 if (select count(distinct m.currency) from public.menu_items m join jsonb_to_recordset(p_items) as i(menu_item_id uuid,quantity integer) on i.menu_item_id=m.id)>1 then
   raise exception 'Use one currency per order.';
 end if;
 if (select coalesce(sum(m.price_minor::numeric*i.quantity),0) from public.menu_items m join jsonb_to_recordset(p_items) as i(menu_item_id uuid,quantity integer) on i.menu_item_id=m.id)>9007199254740991 then
   raise exception 'The total exceeds safe numeric range.';
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('menu_item_id',m.id,'name',m.name,'quantity',i.quantity,
   'unit_price_minor',m.price_minor,'currency',m.currency) order by m.id),'[]') into normalized
 from public.menu_items m join jsonb_to_recordset(p_items) as i(menu_item_id uuid,quantity integer) on i.menu_item_id=m.id;
 if station.cart_preview=normalized then return jsonb_build_object('items',normalized,'revision',station.cart_revision,'total_minor',(select coalesce(sum((i->>'quantity')::numeric*(i->>'unit_price_minor')::numeric),0) from jsonb_array_elements(normalized) i),'currency',normalized->0->>'currency'); end if;
 if station.cart_revision is distinct from p_revision then raise exception 'The cart changed in another screen. Reload before editing.'; end if;
 update public.checkout_stations set cart_preview=normalized,cart_revision=cart_revision+1 where id=p_station_id returning * into station;
 return jsonb_build_object('items',normalized,'revision',station.cart_revision,'total_minor',(select coalesce(sum((i->>'quantity')::numeric*(i->>'unit_price_minor')::numeric),0) from jsonb_array_elements(normalized) i),'currency',normalized->0->>'currency');
end;
$$;

create function public.continue_to_seats(p_order_id uuid,p_branch_id uuid,p_revision integer,p_request_id uuid,p_items jsonb)
returns public.orders language plpgsql security definer set search_path='' as $$
declare chosen public.orders;
begin
 chosen:=public.save_draft_order(p_order_id,p_branch_id,p_revision,p_request_id,p_items);
 if chosen.status='DRAFT' and chosen.checkout_step='MENU' then
   update public.orders set checkout_step='SEATS',draft_seat_ids='{}' where id=chosen.id returning * into chosen;
 end if;
 return chosen;
end;
$$;
create function public.change_draft_step(p_order_id uuid,p_step text)
returns public.orders language plpgsql security definer set search_path='' as $$
declare chosen public.orders; branch uuid;
begin
 select branch_id into branch from public.orders where id=p_order_id;
 perform public.seatlink_lock_owner_branch(branch);
 select * into chosen from public.orders where id=p_order_id for update;
 if chosen.created_by is distinct from auth.uid() then raise exception using errcode='42501',message='Order access denied.'; end if;
 if chosen.status<>'DRAFT' or p_step is null or p_step not in ('MENU','SEATS') then raise exception 'Cancel the reserved order explicitly before changing items or seats.'; end if;
 if not exists(select 1 from public.order_items where order_id=p_order_id) then raise exception 'Save a purchase before choosing seats.'; end if;
 update public.orders set checkout_step=p_step where id=p_order_id returning * into chosen;
 if p_step='MENU' then
   update public.checkout_stations set cart_preview=(select coalesce(jsonb_agg(jsonb_build_object(
      'menu_item_id',i.menu_item_id,'quantity',i.quantity,'name',i.name,'unit_price_minor',i.unit_price_minor,'currency',chosen.currency
   ) order by i.menu_item_id),'[]') from public.order_items i where i.order_id=p_order_id),cart_revision=cart_revision+1
   where id=chosen.station_id;
 end if;
 return chosen;
end;
$$;
create function public.update_selected_seats(p_order_id uuid,p_seat_ids uuid[])
returns void language plpgsql security definer set search_path='' as $$
declare chosen public.orders; branch uuid;
begin
 select branch_id into branch from public.orders where id=p_order_id;
 perform public.seatlink_lock_owner_branch(branch);
 perform public.seatlink_expire_branch(branch);
 select * into chosen from public.orders where id=p_order_id for update;
 if chosen.created_by is distinct from auth.uid() then raise exception using errcode='42501',message='Order access denied.'; end if;
 if chosen.status<>'DRAFT' or chosen.checkout_step<>'SEATS' then raise exception 'Save the cart and continue to Seats first.'; end if;
 if p_seat_ids is null or cardinality(p_seat_ids)>4 or array_position(p_seat_ids,null) is not null
   or (select count(distinct id) from unnest(p_seat_ids) id)<>cardinality(p_seat_ids) then raise exception 'Select up to four distinct seats.'; end if;
 if (select count(*) from public.seats s join public.tables t on t.id=s.table_id where s.id=any(p_seat_ids) and t.branch_id=branch)<>cardinality(p_seat_ids) then
   raise exception 'A selected seat belongs to another branch.';
 end if;
 update public.orders set draft_seat_ids=p_seat_ids where id=p_order_id and draft_seat_ids is distinct from p_seat_ids;
end;
$$;

alter function public.confirm_order_seats(uuid,integer,uuid[]) rename to seatlink_confirm_order_seats_v1;
revoke all on function public.seatlink_confirm_order_seats_v1(uuid,integer,uuid[]) from public,anon,authenticated;
create function public.confirm_order_seats(p_order_id uuid,p_revision integer,p_seat_ids uuid[])
returns public.orders language plpgsql security definer set search_path='' as $$
declare chosen public.orders; branch uuid; conflicts text;
begin
 select branch_id into branch from public.orders where id=p_order_id;
 perform public.seatlink_lock_owner_branch(branch);
 perform public.seatlink_expire_branch(branch);
 if exists(select 1 from public.orders where id=p_order_id and status='DRAFT' and created_by=auth.uid()) then
   select string_agg('Table '||t.table_number||' / Seat '||s.label,', ' order by t.table_number,s.label) into conflicts
   from public.seats s join public.tables t on t.id=s.table_id
   where s.id=any(p_seat_ids) and t.branch_id=branch and s.status<>'AVAILABLE';
   if conflicts is not null then raise exception 'Selected seats unavailable: %. Choose available replacements.',conflicts; end if;
 end if;
 chosen:=public.seatlink_confirm_order_seats_v1(p_order_id,p_revision,p_seat_ids);
 if chosen.status='PENDING' then
   update public.orders set checkout_step='PAYMENT',draft_seat_ids=selected_seat_ids where id=p_order_id returning * into chosen;
 end if;
 return chosen;
end;
$$;

create function public.select_payment_method(p_order_id uuid,p_method text)
returns public.orders language plpgsql security definer set search_path='' as $$
declare chosen public.orders; branch uuid;
begin
 select branch_id into branch from public.orders where id=p_order_id;
 perform public.seatlink_lock_owner_branch(branch);
 perform public.seatlink_expire_branch(branch);
 select * into chosen from public.orders where id=p_order_id for update;
 if chosen.created_by is distinct from auth.uid() then raise exception using errcode='42501',message='Order access denied.'; end if;
 if chosen.status<>'PENDING' or chosen.session_expires_at<=clock_timestamp() then raise exception 'The reservation has ended. Reserve seats again.'; end if;
 if p_method is null or p_method not in ('QR','CASH') then raise exception 'Choose QR payment or cash.'; end if;
 update public.orders set payment_method=p_method where id=p_order_id returning * into chosen;
 return chosen;
end;
$$;

revoke all on function public.update_cart_preview(uuid,integer,jsonb),public.continue_to_seats(uuid,uuid,integer,uuid,jsonb),
 public.change_draft_step(uuid,text),public.update_selected_seats(uuid,uuid[]),public.confirm_order_seats(uuid,integer,uuid[]),
 public.select_payment_method(uuid,text) from public,anon,authenticated;
grant execute on function public.update_cart_preview(uuid,integer,jsonb),public.continue_to_seats(uuid,uuid,integer,uuid,jsonb),
 public.change_draft_step(uuid,text),public.update_selected_seats(uuid,uuid[]),public.confirm_order_seats(uuid,integer,uuid[]),
 public.select_payment_method(uuid,text) to authenticated;

commit;
