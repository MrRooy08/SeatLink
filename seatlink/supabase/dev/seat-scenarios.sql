-- Development-only. Caller supplies seatlink.fixture_branch, fixture_owner and fixture_cleanup.
-- Never applied as a migration. Reuses existing IDs and never deletes history or hardware.
do $$
declare branch uuid:=current_setting('seatlink.fixture_branch')::uuid;
 owner_id uuid; previous jsonb; fixture_order uuid; pending_id uuid; activation uuid; menu_id uuid;
 seat_ids uuid[]; ids uuid[]; station uuid; attempt public.payment_attempts; saved public.orders;
begin
 select id into owner_id from auth.users where email=current_setting('seatlink.fixture_owner');
 if owner_id is null then raise exception 'Fixture owner not found.'; end if;
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 perform public.seatlink_require_development();
 perform public.seatlink_lock_owner_branch(branch);
 if not exists(select 1 from public.payment_runtime where singleton and mode='MOCK') then raise exception 'Fixtures require an explicitly configured MOCK development project.'; end if;
 select details into previous from public.audit_events where branch_id=branch and actor_id=owner_id and action='DEVELOPMENT_FIXTURE_RUN' order by created_at desc limit 1;
 if current_setting('seatlink.fixture_cleanup')='on' then
  if previous is null then return; end if;
  pending_id:=(previous->>'pending_order')::uuid;
  if exists(select 1 from public.orders where id=pending_id and status in ('DRAFT','PENDING')) then perform public.cancel_order(pending_id); end if;
  select array_agg(id) into ids from public.seat_use_sessions where activation_request_id=(previous->>'activation')::uuid or order_id=(previous->>'paid_order')::uuid;
  if cardinality(ids)>0 then perform public.release_active_seats(branch,ids,gen_random_uuid()); end if;
  update public.checkout_stations set current_order_id=null,cart_preview='[]',cart_revision=cart_revision+1
   where branch_id=branch and operator_id=owner_id and current_order_id in (pending_id,(previous->>'paid_order')::uuid);
  return;
 end if;
 perform public.seatlink_expire_branch(branch);
 if previous is not null and (exists(select 1 from public.orders where id=(previous->>'pending_order')::uuid and status='PENDING')
  or exists(select 1 from public.seat_use_sessions where status='ACTIVE' and (activation_request_id=(previous->>'activation')::uuid or order_id=(previous->>'paid_order')::uuid))) then
  raise notice 'Fixtures already active; IDs and deadlines preserved. Clean up before creating a fresh run.'; return;
 end if;
 if exists(select 1 from public.orders where branch_id=branch and created_by=owner_id and status in ('DRAFT','PENDING')) then raise exception 'Finish the owner checkout before seeding fixtures.'; end if;
 insert into public.tables(branch_id,table_number) select branch,n from generate_series(1,3) n on conflict(branch_id,table_number) do nothing;
 insert into public.seats(table_id,label) select t.id,l from public.tables t cross join unnest(array['A','B','C','D']) l where t.branch_id=branch and t.table_number between 1 and 3 on conflict(table_id,label) do nothing;
 if exists(select 1 from public.menu_items where branch_id=branch and name='Seat scenario fixture' and not is_demo) then raise exception 'Fixture menu name conflicts with real data.'; end if;
 insert into public.menu_items(branch_id,name,price_minor,currency,available,is_demo) values(branch,'Seat scenario fixture',100,
 coalesce((select currency from public.branches where id=branch),'SGD'),true,true) on conflict(branch_id,name) do nothing;
 select id into menu_id from public.menu_items where branch_id=branch and name='Seat scenario fixture';
 select array_agg(s.id order by t.table_number,s.label) into seat_ids from public.seats s join public.tables t on t.id=s.table_id where t.branch_id=branch and t.table_number between 1 and 3;
 if exists(select 1 from public.seats where id=any(seat_ids) and status<>'AVAILABLE') then raise exception 'Scenario tables must be available. Existing occupants were preserved.'; end if;
 activation:=gen_random_uuid();
 perform public.activate_seats(branch,seat_ids[5:9],activation);
 fixture_order:=gen_random_uuid();
 saved:=public.continue_to_seats(fixture_order,branch,0,gen_random_uuid(),jsonb_build_array(jsonb_build_object('menu_item_id',menu_id,'quantity',1)));
 saved:=public.confirm_order_seats(fixture_order,saved.revision,array[seat_ids[2]]);
 perform public.select_payment_method(fixture_order,'QR');
 attempt:=public.prepare_mock_qr(fixture_order,gen_random_uuid());
 perform public.simulate_mock_payment(attempt.id,gen_random_uuid(),'SUCCESS');
 select station_id into station from public.orders where id=fixture_order;
 perform public.start_next_sale(station);
 pending_id:=gen_random_uuid();
 saved:=public.continue_to_seats(pending_id,branch,0,gen_random_uuid(),jsonb_build_array(jsonb_build_object('menu_item_id',menu_id,'quantity',1)));
 perform public.confirm_order_seats(pending_id,saved.revision,array[seat_ids[1]]);
 insert into public.audit_events(branch_id,actor_id,action,details) values(branch,owner_id,'DEVELOPMENT_FIXTURE_RUN',
 jsonb_build_object('paid_order',fixture_order,'pending_order',pending_id,'activation',activation,'menu_item',menu_id));
end; $$;
