begin;
alter function public.read_branch_sales(uuid) rename to seatlink_read_branch_sales_v4;
revoke all on function public.seatlink_read_branch_sales_v4(uuid) from public,anon,authenticated;
create function public.read_branch_sales(p_branch_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare snapshot jsonb;
begin
 snapshot:=public.seatlink_read_branch_sales_v4(p_branch_id);
 return snapshot||jsonb_build_object('menu',(select coalesce(jsonb_agg(to_jsonb(m) order by m.name),'[]') from public.menu_items m where branch_id=p_branch_id),
 'history',(select coalesce(jsonb_agg(h||jsonb_build_object('payment_mode',p.mode) order by o.created_at desc),'[]')
 from jsonb_array_elements(snapshot->'history') h join public.orders o on o.id=(h->>'id')::uuid
 left join public.payment_attempts p on p.id=o.paid_attempt_id and p.status='SUCCEEDED'),
 'tables',(select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'table_number',t.table_number,'display_label',t.display_label,'seats',
 (select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'label',s.label,'display_number',s.display_number,'position',s.position,
 'status',s.status,'locked_order_id',s.locked_order_id,'expires_at',u.expires_at) order by s.display_number),'[]')
 from public.seats s left join public.seat_use_sessions u on u.id=s.active_seat_use_session_id and u.status='ACTIVE' where s.table_id=t.id))
 order by t.table_number),'[]') from public.tables t where t.branch_id=p_branch_id));
end; $$;
alter function public.read_customer_display(text) rename to seatlink_read_customer_display_v4;
revoke all on function public.seatlink_read_customer_display_v4(text) from public,anon,authenticated;
create function public.read_customer_display(p_token text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare snapshot jsonb; tables jsonb;
begin
 snapshot:=public.seatlink_read_customer_display_v4(p_token);
 select coalesce(jsonb_agg(t||jsonb_build_object('display_label',actual.display_label,'seats',
 (select coalesce(jsonb_agg(s||jsonb_build_object('display_number',seat.display_number,'position',seat.position) order by seat.display_number),'[]')
 from jsonb_array_elements(t->'seats') s join public.seats seat on seat.id=(s->>'id')::uuid)) order by actual.table_number),'[]') into tables
 from jsonb_array_elements(snapshot->'tables') t join public.tables actual on actual.id=(t->>'id')::uuid;
 -- Owner-only timers are deliberately absent from the shared availability map.
 return snapshot||jsonb_build_object('tables',tables);
end; $$;
revoke all on function public.read_branch_sales(uuid),public.read_customer_display(text) from public,anon,authenticated;
grant execute on function public.read_branch_sales(uuid) to authenticated;
grant execute on function public.read_customer_display(text) to anon,authenticated;
commit;
