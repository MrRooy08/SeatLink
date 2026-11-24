update public.branches set currency='SGD' where id='c6000000-0000-4000-8000-000000000020';
-- Appended to the standard isolated fixture by the test runner. Entire transaction rolls back.
insert into public.menu_items(id,branch_id,name,price_minor,currency,quantity_group_id,options)
values('c6000000-0000-4000-8000-000000000035','c6000000-0000-4000-8000-000000000020','Tea large',250,'SGD',
 'c6000000-0000-4000-8000-000000000030','{"size":"large"}');
insert into public.tables(id,branch_id,table_number) values
 ('c6000000-0000-4000-8000-000000000042','c6000000-0000-4000-8000-000000000020',2),
 ('c6000000-0000-4000-8000-000000000043','c6000000-0000-4000-8000-000000000020',3);
insert into public.seats(table_id,label) select t.id,l from public.tables t cross join unnest(array['A','B','C','D']) l
 where t.id in ('c6000000-0000-4000-8000-000000000042','c6000000-0000-4000-8000-000000000043');
set local role authenticated;
set local request.jwt.claim.sub='c6000000-0000-4000-8000-000000000001';
select set_config('test.branch','c6000000-0000-4000-8000-000000000020',true);
select set_config('test.station',public.read_branch_sales(current_setting('test.branch')::uuid)->'station'->>'id',true);
select set_config('test.display',public.pair_customer_display(current_setting('test.station')::uuid),true);
select public.update_cart_preview(current_setting('test.station')::uuid,0,'[{"menu_item_id":"c6000000-0000-4000-8000-000000000035","quantity":2}]');
select set_config('test.preview_revision',public.read_branch_sales(current_setting('test.branch')::uuid)->>'cart_revision',true);
select public.update_cart_preview(current_setting('test.station')::uuid,0,'[{"menu_item_id":"c6000000-0000-4000-8000-000000000035","quantity":2}]');
select pg_temp.assert_true(public.read_branch_sales(current_setting('test.branch')::uuid)->>'cart_revision'=current_setting('test.preview_revision'),'Identical option preview retry changed revision');
select public.continue_to_seats('c6000000-0000-4000-8000-000000000060',current_setting('test.branch')::uuid,0,gen_random_uuid(),
 '[{"menu_item_id":"c6000000-0000-4000-8000-000000000030","quantity":30},{"menu_item_id":"c6000000-0000-4000-8000-000000000035","quantity":20}]');
select pg_temp.assert_true((select options='{"size":"large"}' from public.order_items where menu_item_id='c6000000-0000-4000-8000-000000000035'),'Options lost');
select public.change_draft_step('c6000000-0000-4000-8000-000000000060','MENU');
select pg_temp.expect_error($q$select public.save_draft_order('c6000000-0000-4000-8000-000000000060','c6000000-0000-4000-8000-000000000020',1,gen_random_uuid(),
 '[{"menu_item_id":"c6000000-0000-4000-8000-000000000030","quantity":31},{"menu_item_id":"c6000000-0000-4000-8000-000000000035","quantity":20}]')$q$,'Maximum 50');
select pg_temp.expect_error($q$select public.update_cart_preview(current_setting('test.station')::uuid,0,
 '[{"menu_item_id":"c6000000-0000-4000-8000-000000000030","quantity":1.5}]')$q$,'whole number');
select public.continue_to_seats('c6000000-0000-4000-8000-000000000060',current_setting('test.branch')::uuid,1,gen_random_uuid(),
 '[{"menu_item_id":"c6000000-0000-4000-8000-000000000030","quantity":0},{"menu_item_id":"c6000000-0000-4000-8000-000000000035","quantity":2}]');
select pg_temp.assert_true((select count(*)=1 from public.order_items where order_id='c6000000-0000-4000-8000-000000000060'),'Zero did not remove item');
select public.confirm_order_seats('c6000000-0000-4000-8000-000000000060',2,array['c6000000-0000-4000-8000-000000000050']::uuid[]);
reset role;
update public.orders set session_expires_at=clock_timestamp()-interval '1 second' where id='c6000000-0000-4000-8000-000000000060';
set local role authenticated;
select set_config('test.resubmit',gen_random_uuid()::text,true);
select set_config('test.replacement',(public.resubmit_order('c6000000-0000-4000-8000-000000000060',current_setting('test.resubmit')::uuid)).id::text,true);
select pg_temp.assert_true((public.resubmit_order('c6000000-0000-4000-8000-000000000060',gen_random_uuid())).id=current_setting('test.replacement')::uuid,'Resubmit created duplicate');
select pg_temp.assert_true((select checkout_step='SEATS' and session_expires_at is null and selected_seat_ids='{}' and draft_seat_ids='{}' from public.orders where id=current_setting('test.replacement')::uuid),'Resubmit started timer or retained seats');
select pg_temp.assert_true(public.read_customer_display(current_setting('test.display'))->'order'->>'checkout_step'='SEATS' and
 public.read_customer_display(current_setting('test.display'))->'order'->>'qr_text' is null,'Resubmit did not reset display');
select pg_temp.assert_true((select quantity=2 and options='{"size":"large"}' from public.order_items where order_id=current_setting('test.replacement')::uuid),'Resubmit lost items/options');
select public.confirm_order_seats(current_setting('test.replacement')::uuid,1,'{}');
reset role;
update public.orders set session_expires_at=clock_timestamp()-interval '1 second' where id=current_setting('test.replacement')::uuid;
update public.menu_items set price_minor=300,available=false where id='c6000000-0000-4000-8000-000000000035';
set local role authenticated;
select set_config('test.correction',(public.resubmit_order(current_setting('test.replacement')::uuid,gen_random_uuid())).id::text,true);
select pg_temp.assert_true((select checkout_step='MENU' and resubmission_note is not null and session_expires_at is null from public.orders where id=current_setting('test.correction')::uuid),'Changed menu did not request correction');
select public.cancel_order(current_setting('test.correction')::uuid);
reset role;
insert into public.payment_attempts(id,order_id,provider,mode,status,amount_minor,currency,qr_expires_at)
select 'c6000000-0000-4000-8000-000000000080',id,'MOCK','MOCK','PENDING',total_minor,currency,clock_timestamp()+interval '1 minute'
from public.orders where id='c6000000-0000-4000-8000-000000000060';
select public.seatlink_apply_payment_result('c6000000-0000-4000-8000-000000000080',gen_random_uuid(),'SUCCESS');
update public.menu_items set options='{"size":"changed"}' where id='c6000000-0000-4000-8000-000000000035';
set local role authenticated;
select pg_temp.expect_error($q$select public.resubmit_order('c6000000-0000-4000-8000-000000000060',gen_random_uuid())$q$,'Payment received');
select public.save_draft_order(id,branch_id,revision,last_request_id,last_request_items) from public.orders where id='c6000000-0000-4000-8000-000000000060';
select pg_temp.assert_true((select options='{"size":"large"}' from public.order_items where order_id='c6000000-0000-4000-8000-000000000060'),'Idempotent save altered frozen paid options');
select set_config('test.activation',gen_random_uuid()::text,true);
select set_config('test.seats',(select jsonb_agg(id)::text from (select s.id from public.seats s join public.tables t on t.id=s.table_id where t.branch_id=current_setting('test.branch')::uuid order by s.id limit 6) q),true);
select public.activate_seats(current_setting('test.branch')::uuid,array(select jsonb_array_elements_text(current_setting('test.seats')::jsonb)::uuid),current_setting('test.activation')::uuid);
select set_config('test.expiry',(select min(expires_at)::text from public.seat_use_sessions where activation_request_id=current_setting('test.activation')::uuid),true);
select public.activate_seats(current_setting('test.branch')::uuid,array(select jsonb_array_elements_text(current_setting('test.seats')::jsonb)::uuid),current_setting('test.activation')::uuid);
select pg_temp.assert_true((select count(*)=6 and min(expires_at)=current_setting('test.expiry')::timestamptz and bool_and(order_id is null and origin='OWNER_ACTIVATION') from public.seat_use_sessions where activation_request_id=current_setting('test.activation')::uuid),'Activation not standalone/idempotent');
select pg_temp.assert_true((public.read_branch_daily_sales(current_setting('test.branch')::uuid)->>'paid_orders')::integer=0,'Activation inflated sales');
select pg_temp.assert_true(public.read_customer_display(current_setting('test.display'))->'tables'->0->>'display_label'='A' and
 public.read_customer_display(current_setting('test.display'))->'tables'->0->'seats'->0->>'display_number'='1' and
 not (public.read_customer_display(current_setting('test.display'))->'tables'->0->'seats'->0 ? 'expires_at'),'Display labels/timer privacy failed');
select set_config('test.session',(select id::text from public.seat_use_sessions where activation_request_id=current_setting('test.activation')::uuid order by seat_id limit 1),true);
select set_config('test.seat',(select seat_id::text from public.seat_use_sessions where id=current_setting('test.session')::uuid),true);
select pg_temp.expect_error($q$select public.activate_seats(current_setting('test.branch')::uuid,array[current_setting('test.seat')::uuid,(select s.id from public.seats s join public.tables t on t.id=s.table_id where t.branch_id=current_setting('test.branch')::uuid and s.status='AVAILABLE' limit 1)],gen_random_uuid())$q$,'no longer available');
select pg_temp.assert_true((select count(*)=6 from public.seat_use_sessions),'Conflict partially activated');
reset role;
select set_config('test.extension',gen_random_uuid()::text,true);
select public.seatlink_extend_session(current_setting('test.extension')::uuid,current_setting('test.seat')::uuid,current_setting('test.session')::uuid,120,null,'c6000000-0000-4000-8000-000000000001');
select public.seatlink_extend_session(current_setting('test.extension')::uuid,current_setting('test.seat')::uuid,current_setting('test.session')::uuid,120,null,'c6000000-0000-4000-8000-000000000001');
select pg_temp.assert_true((select expires_at=current_setting('test.expiry')::timestamptz+interval '2 minutes' from public.seat_use_sessions where id=current_setting('test.session')::uuid),'Extension retry added time twice');
set local role authenticated;
select public.release_active_seats(current_setting('test.branch')::uuid,array[current_setting('test.session')::uuid],gen_random_uuid());
select public.activate_seats(current_setting('test.branch')::uuid,array[current_setting('test.seat')::uuid],gen_random_uuid());
select public.release_active_seats(current_setting('test.branch')::uuid,array[current_setting('test.session')::uuid],gen_random_uuid());
select pg_temp.assert_true((select status='UNAVAILABLE' and active_seat_use_session_id<>current_setting('test.session')::uuid from public.seats where id=current_setting('test.seat')::uuid),'Stale release affected new occupant');
set local request.jwt.claim.sub='c6000000-0000-4000-8000-000000000003';
select pg_temp.expect_error($q$select public.release_active_seats(current_setting('test.branch')::uuid,array[current_setting('test.session')::uuid],gen_random_uuid())$q$,'access denied');
reset role;
update public.seat_use_sessions set started_at=clock_timestamp()-interval '11 minutes',expires_at=clock_timestamp()-interval '1 second' where status='ACTIVE';
select public.expire_order_sessions();
select pg_temp.assert_true(not exists(select 1 from public.seat_use_sessions where branch_id=current_setting('test.branch')::uuid and status='ACTIVE') and not exists(select 1 from public.seats s join public.tables t on t.id=s.table_id where t.branch_id=current_setting('test.branch')::uuid and s.status='UNAVAILABLE'),'Standalone cron expiry failed');
rollback;


