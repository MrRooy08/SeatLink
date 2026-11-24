begin;
-- Variants remain ordinary menu rows with authoritative prices. Grouping is server-owned.
alter table public.menu_items add column quantity_group_id uuid references public.menu_items(id);
alter table public.menu_items add column options jsonb not null default '{}'::jsonb check(jsonb_typeof(options)='object');
alter table public.order_items add column options jsonb not null default '{}'::jsonb;
create function public.seatlink_menu_group() returns trigger language plpgsql set search_path='' as $$
begin
 if new.quantity_group_id is not null and not exists(select 1 from public.menu_items m
  where m.id=new.quantity_group_id and m.branch_id=new.branch_id and m.quantity_group_id is null and m.id<>new.id)
 then raise exception 'A variant must reference a base item in the same branch.'; end if;
 if exists(select 1 from public.menu_items where quantity_group_id=new.id and
  (new.quantity_group_id is not null or branch_id<>new.branch_id))
 then raise exception 'Keep base items and variants in the same branch and group.'; end if;
 return new;
end; $$;
create trigger menu_quantity_group before insert or update on public.menu_items for each row execute function public.seatlink_menu_group();

create function public.seatlink_quantity_items(p_branch_id uuid,p_items jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare normalized jsonb;
begin
 if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Provide item quantities.'; end if;
 if exists(select 1 from jsonb_array_elements(p_items) x where jsonb_typeof(x->'quantity') is distinct from 'number'
  or (x->>'quantity')::numeric<>trunc((x->>'quantity')::numeric) or (x->>'quantity')::numeric not between 0 and 50)
 then raise exception 'Quantity must be a whole number from 0 to 50.'; end if;
 if (select count(*)<>count(distinct x->>'menu_item_id') from jsonb_array_elements(p_items) x)
 then raise exception 'Duplicate menu item.'; end if;
 select coalesce(jsonb_agg(x),'[]') into normalized from jsonb_array_elements(p_items) x where (x->>'quantity')::numeric>0;
 if exists(select 1 from jsonb_array_elements(normalized) x join public.menu_items m on m.id=(x->>'menu_item_id')::uuid
  where m.branch_id=p_branch_id group by coalesce(m.quantity_group_id,m.id) having sum((x->>'quantity')::integer)>50)
 then raise exception 'Maximum 50 per menu item across all variants and options.'; end if;
 return normalized;
end; $$;

alter table public.orders add column resubmitted_from uuid unique references public.orders(id);
alter table public.orders add column resubmit_request_id uuid unique;
alter table public.orders add column resubmission_note text;
alter function public.save_draft_order(uuid,uuid,integer,uuid,jsonb) rename to seatlink_save_draft_order_v1;
revoke all on function public.seatlink_save_draft_order_v1(uuid,uuid,integer,uuid,jsonb) from public,anon,authenticated;
create function public.save_draft_order(p_order_id uuid,p_branch_id uuid,p_revision integer,p_request_id uuid,p_items jsonb)
returns public.orders language plpgsql security definer set search_path='' as $$
declare result public.orders; items jsonb; prior_request uuid;
begin
 perform public.seatlink_lock_owner_branch(p_branch_id);
 select last_request_id into prior_request from public.orders where id=p_order_id;
 items:=public.seatlink_quantity_items(p_branch_id,p_items);
 result:=public.seatlink_save_draft_order_v1(p_order_id,p_branch_id,p_revision,p_request_id,items);
 if result.status='DRAFT' and prior_request is distinct from p_request_id then
  update public.order_items i set options=m.options from public.menu_items m where i.order_id=result.id and m.id=i.menu_item_id and i.options is distinct from m.options;
  if result.resubmission_note is not null then update public.orders set resubmission_note=null where id=result.id returning * into result; end if;
 end if;
 return result;
end; $$;
alter function public.update_cart_preview(uuid,integer,jsonb) rename to seatlink_update_cart_preview_v1;
revoke all on function public.seatlink_update_cart_preview_v1(uuid,integer,jsonb) from public,anon,authenticated;
create or replace function public.seatlink_update_cart_preview_v1(p_station_id uuid,p_revision integer,p_items jsonb)
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
   'unit_price_minor',m.price_minor,'currency',m.currency,'options',m.options) order by m.id),'[]') into normalized
 from public.menu_items m join jsonb_to_recordset(p_items) as i(menu_item_id uuid,quantity integer) on i.menu_item_id=m.id;
 if station.cart_preview=normalized then return jsonb_build_object('items',normalized,'revision',station.cart_revision,'total_minor',(select coalesce(sum((i->>'quantity')::numeric*(i->>'unit_price_minor')::numeric),0) from jsonb_array_elements(normalized) i),'currency',normalized->0->>'currency'); end if;
 if station.cart_revision is distinct from p_revision then raise exception 'The cart changed in another screen. Reload before editing.'; end if;
 update public.checkout_stations set cart_preview=normalized,cart_revision=cart_revision+1 where id=p_station_id returning * into station;
 return jsonb_build_object('items',normalized,'revision',station.cart_revision,'total_minor',(select coalesce(sum((i->>'quantity')::numeric*(i->>'unit_price_minor')::numeric),0) from jsonb_array_elements(normalized) i),'currency',normalized->0->>'currency');
end;
$$;
create function public.update_cart_preview(p_station_id uuid,p_revision integer,p_items jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare branch uuid; items jsonb;
begin
 select branch_id into branch from public.checkout_stations where id=p_station_id;
 perform public.seatlink_lock_owner_branch(branch);
 items:=public.seatlink_quantity_items(branch,p_items);
 return public.seatlink_update_cart_preview_v1(p_station_id,p_revision,items);
end; $$;

create function public.resubmit_order(p_order_id uuid,p_request_id uuid) returns public.orders
language plpgsql security definer set search_path='' as $$
declare original public.orders; replacement public.orders; items jsonb; corrections boolean; new_id uuid:=gen_random_uuid();
begin
 select * into original from public.orders where id=p_order_id;
 perform public.seatlink_lock_owner_branch(original.branch_id);
 perform public.seatlink_expire_branch(original.branch_id);
 select * into original from public.orders where id=p_order_id for update;
 if original.created_by is distinct from auth.uid() then raise exception using errcode='42501',message='Order access denied.'; end if;
 if original.paid_attempt_id is not null or exists(select 1 from public.payment_attempts where order_id=p_order_id and status='SUCCEEDED')
 then raise exception 'Payment received. Resolve the original payment before resubmitting.'; end if;
 if original.status<>'EXPIRED' then raise exception 'Only an unpaid expired checkout can be resubmitted.'; end if;
 if p_request_id is null then raise exception 'Request ID required.'; end if;
 select * into replacement from public.orders where resubmitted_from=p_order_id;
 if found then return replacement; end if;
 if exists(select 1 from public.orders where resubmit_request_id=p_request_id)
 then raise exception 'Request ID was reused.'; end if;
 if exists(select 1 from public.orders where branch_id=original.branch_id and created_by=auth.uid() and status in ('DRAFT','PENDING'))
 then raise exception 'Finish the current checkout first.'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('menu_item_id',i.menu_item_id,'quantity',i.quantity)),'[]') into items
 from public.order_items i where order_id=p_order_id;
 corrections:=not exists(select 1 from public.order_items where order_id=p_order_id)
 or exists(select 1 from public.order_items i join public.menu_items m on m.id=i.menu_item_id where i.order_id=p_order_id
 and (not m.available or m.price_minor<>i.unit_price_minor or m.currency<>original.currency or m.name<>i.name or m.options<>i.options));
 begin perform public.seatlink_quantity_items(original.branch_id,items);
 exception when raise_exception then corrections:=true; end;
 if not corrections then
  replacement:=public.continue_to_seats(new_id,original.branch_id,0,p_request_id,items);
  update public.orders set resubmitted_from=p_order_id,resubmit_request_id=p_request_id where id=new_id returning * into replacement;
 else
  insert into public.orders(id,branch_id,created_by,currency,total_minor,resubmitted_from,resubmit_request_id,resubmission_note,last_request_id,last_request_items)
  values(new_id,original.branch_id,auth.uid(),original.currency,original.total_minor,p_order_id,p_request_id,
  'Menu details changed. Review quantities, options, availability and current prices before continuing.',p_request_id,items) returning * into replacement;
  insert into public.order_items(order_id,menu_item_id,name,unit_price_minor,quantity,options)
  select new_id,menu_item_id,name,unit_price_minor,quantity,options from public.order_items where order_id=p_order_id;
 end if;
 update public.checkout_stations set cart_preview=(select coalesce(jsonb_agg(jsonb_build_object('menu_item_id',menu_item_id,
 'name',name,'quantity',quantity,'unit_price_minor',unit_price_minor,'currency',original.currency,'options',options)),'[]')
 from public.order_items where order_id=new_id),cart_revision=cart_revision+1 where id=replacement.station_id;
 insert into public.audit_events(branch_id,order_id,actor_id,action,details) values(original.branch_id,new_id,auth.uid(),
 'ORDER_RESUBMITTED',jsonb_build_object('original_order_id',p_order_id,'request_id',p_request_id,'corrections_required',corrections));
 return replacement;
end; $$;
revoke all on function public.seatlink_quantity_items(uuid,jsonb),public.seatlink_menu_group(),
 public.save_draft_order(uuid,uuid,integer,uuid,jsonb),public.update_cart_preview(uuid,integer,jsonb),public.resubmit_order(uuid,uuid) from public,anon,authenticated;
grant execute on function public.save_draft_order(uuid,uuid,integer,uuid,jsonb),public.update_cart_preview(uuid,integer,jsonb),public.resubmit_order(uuid,uuid) to authenticated;
alter function public.confirm_order_seats(uuid,integer,uuid[]) rename to seatlink_confirm_order_seats_v3;
revoke all on function public.seatlink_confirm_order_seats_v3(uuid,integer,uuid[]) from public,anon,authenticated;
create function public.confirm_order_seats(p_order_id uuid,p_revision integer,p_seat_ids uuid[]) returns public.orders
language plpgsql security definer set search_path='' as $$
declare chosen public.orders; conflicts text;
begin
 if p_seat_ids is null or cardinality(p_seat_ids)>4 or array_position(p_seat_ids,null) is not null
  or (select count(distinct id) from unnest(p_seat_ids) id)<>cardinality(p_seat_ids)
 then raise exception 'Select zero to four distinct seats.'; end if;
 select * into chosen from public.orders where id=p_order_id;
 perform public.seatlink_lock_owner_branch(chosen.branch_id);
 perform public.seatlink_expire_branch(chosen.branch_id);
 select * into chosen from public.orders where id=p_order_id;
 if chosen.created_by is distinct from auth.uid() then raise exception using errcode='42501',message='Order access denied.'; end if;
 if chosen.status='DRAFT' then
  perform public.seatlink_quantity_items(chosen.branch_id,(select jsonb_agg(jsonb_build_object('menu_item_id',menu_item_id,'quantity',quantity)) from public.order_items where order_id=p_order_id));
  if exists(select 1 from public.order_items i join public.menu_items m on m.id=i.menu_item_id where i.order_id=p_order_id and i.options<>m.options)
  then raise exception 'Item options changed. Return to menu and review the order.'; end if;
  select string_agg('Table '||t.display_label||' · Seat '||s.display_number,', ' order by t.table_number,s.display_number) into conflicts
  from public.seats s join public.tables t on t.id=s.table_id where s.id=any(p_seat_ids) and t.branch_id=chosen.branch_id and s.status<>'AVAILABLE';
  if conflicts is not null then raise exception 'Selected seats unavailable: %. Choose available replacements.',conflicts; end if;
 end if;
 return public.seatlink_confirm_order_seats_v3(p_order_id,p_revision,p_seat_ids);
end; $$;
revoke all on function public.confirm_order_seats(uuid,integer,uuid[]) from public,anon,authenticated;
grant execute on function public.confirm_order_seats(uuid,integer,uuid[]) to authenticated;
commit;

