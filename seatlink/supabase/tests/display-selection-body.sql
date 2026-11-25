-- Runs after guided_cash's isolated fixture prefix. No production changes.
set local role authenticated;
set local request.jwt.claim.sub='c6000000-0000-4000-8000-000000000001';
select set_config('test.branch','c6000000-0000-4000-8000-000000000020',true);
select set_config('test.station',public.read_branch_sales(current_setting('test.branch')::uuid)->'station'->>'id',true);
select set_config('test.display',public.pair_customer_display(current_setting('test.station')::uuid),true);
select public.continue_to_seats('c6000000-0000-4000-8000-000000000060',current_setting('test.branch')::uuid,0,gen_random_uuid(),
 '[{"menu_item_id":"c6000000-0000-4000-8000-000000000030","quantity":1}]');
select public.update_selected_seats('c6000000-0000-4000-8000-000000000060',
 array['c6000000-0000-4000-8000-000000000050','c6000000-0000-4000-8000-000000000051']::uuid[]);
set local role anon;
select pg_temp.assert_true(public.read_customer_display(current_setting('test.display'))->'order'->'selected_seats'=
 '[{"table_number":1,"label":"A"},{"table_number":1,"label":"B"}]'::jsonb,'Draft selection missing before confirmation');
set local role authenticated;
select pg_temp.assert_true((select bool_and(status='AVAILABLE' and locked_order_id is null and active_seat_use_session_id is null) from public.seats)
 and not exists(select 1 from public.seat_use_sessions)
 and (select session_expires_at is null from public.orders where id='c6000000-0000-4000-8000-000000000060'),'Draft selection reserved seats or started a timer');
select public.update_selected_seats('c6000000-0000-4000-8000-000000000060',array['c6000000-0000-4000-8000-000000000051']::uuid[]);
select pg_temp.assert_true(public.read_customer_display(current_setting('test.display'))->'order'->'selected_seats'=
 '[{"table_number":1,"label":"B"}]'::jsonb,'Deselection did not update paired snapshot');
select public.update_selected_seats('c6000000-0000-4000-8000-000000000060','{}');
select pg_temp.assert_true(public.read_customer_display(current_setting('test.display'))->'order'->'selected_seats'='[]'::jsonb,'Empty selection retained seats');

-- The other owner has a distinct counter in the same branch.
set local request.jwt.claim.sub='c6000000-0000-4000-8000-000000000002';
select set_config('test.other_station',public.read_branch_sales(current_setting('test.branch')::uuid)->'station'->>'id',true);
select set_config('test.other_display',public.pair_customer_display(current_setting('test.other_station')::uuid),true);
select public.continue_to_seats('c6000000-0000-4000-8000-000000000061',current_setting('test.branch')::uuid,0,gen_random_uuid(),
 '[{"menu_item_id":"c6000000-0000-4000-8000-000000000030","quantity":1}]');
select public.update_selected_seats('c6000000-0000-4000-8000-000000000061',array['c6000000-0000-4000-8000-000000000052']::uuid[]);
set local request.jwt.claim.sub='c6000000-0000-4000-8000-000000000001';
select public.activate_seats(current_setting('test.branch')::uuid,array['c6000000-0000-4000-8000-000000000053']::uuid[],gen_random_uuid());
select pg_temp.assert_true(public.read_customer_display(current_setting('test.display'))->'order'->'selected_seats'='[]'::jsonb,'Other counter or standalone activation leaked');
select pg_temp.assert_true(public.read_customer_display(current_setting('test.other_display'))->'order'->'selected_seats'=
 '[{"table_number":1,"label":"C"}]'::jsonb,'Other counter selection lost its scope');

select public.update_selected_seats('c6000000-0000-4000-8000-000000000060',array['c6000000-0000-4000-8000-000000000050']::uuid[]);
select public.confirm_order_seats('c6000000-0000-4000-8000-000000000060',1,array['c6000000-0000-4000-8000-000000000050']::uuid[]);
select pg_temp.assert_true(public.read_customer_display(current_setting('test.display'))->'order'->'selected_seats'=
 '[{"table_number":1,"label":"A"}]'::jsonb,'Pending payment lost assigned seats');
select public.select_payment_method('c6000000-0000-4000-8000-000000000060','CASH');
select public.confirm_cash_payment('c6000000-0000-4000-8000-000000000060',gen_random_uuid(),200);
select public.release_seat_use('c6000000-0000-4000-8000-000000000060',
 (select array_agg(id) from public.seat_use_sessions where order_id='c6000000-0000-4000-8000-000000000060'));
set local role anon;
select pg_temp.assert_true(public.read_customer_display(current_setting('test.display'))->'order'->>'status'='PAID'
 and public.read_customer_display(current_setting('test.display'))->'order'->'selected_seats'=
 '[{"table_number":1,"label":"A"}]'::jsonb,'Completed/reconnected display lost order seats after seat release');
set local role authenticated;
select public.start_next_sale(current_setting('test.station')::uuid);
select pg_temp.assert_true(public.read_customer_display(current_setting('test.display'))->'order'='null'::jsonb,'Reset retained previous order');
select public.continue_to_seats('c6000000-0000-4000-8000-000000000062',current_setting('test.branch')::uuid,0,gen_random_uuid(),
 '[{"menu_item_id":"c6000000-0000-4000-8000-000000000030","quantity":1}]');
select pg_temp.assert_true(public.read_customer_display(current_setting('test.display'))->'order'->'selected_seats'='[]'::jsonb,'New order retained previous seats');
rollback;
