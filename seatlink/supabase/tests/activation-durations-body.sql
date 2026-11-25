-- Runs after the shared isolated fixture; all mutations roll back.
set local role authenticated;
set local request.jwt.claim.sub='c6000000-0000-4000-8000-000000000001';
select set_config('test.branch','c6000000-0000-4000-8000-000000000020',true);
select set_config('test.duration_request',gen_random_uuid()::text,true);
select set_config('test.activation_payload','[
 {"seat_id":"c6000000-0000-4000-8000-000000000050","duration_seconds":300},
 {"seat_id":"c6000000-0000-4000-8000-000000000051","duration_seconds":720},
 {"seat_id":"c6000000-0000-4000-8000-000000000052","duration_seconds":1500},
 {"seat_id":"c6000000-0000-4000-8000-000000000053","duration_seconds":2147483640}]',true);
-- Every malformed value is rejected before any request/session/seat mutation.
do $$
declare value jsonb; message text;
begin
 for value,message in select * from (values
  ('0'::jsonb,'positive whole minutes'),('-60'::jsonb,'positive whole minutes'),
  ('60.5'::jsonb,'positive whole minutes'),('61'::jsonb,'positive whole minutes'),
  ('2147483700'::jsonb,'35791394 minutes or less'),('600000000000000000000'::jsonb,'35791394 minutes or less'),
  ('true'::jsonb,'whole-minute duration'),('null'::jsonb,'whole-minute duration'),
  ('"1e3"'::jsonb,'whole-minute duration'),('"abc"'::jsonb,'whole-minute duration')) cases(value,message)
 loop
  perform pg_temp.expect_error(format('select public.activate_seats(%L::uuid,%L::jsonb,gen_random_uuid())',
   current_setting('test.branch'),jsonb_build_array(
    jsonb_build_object('seat_id','c6000000-0000-4000-8000-000000000050','duration_seconds',300),
    jsonb_build_object('seat_id','c6000000-0000-4000-8000-000000000051','duration_seconds',value))),message);
 end loop;
end $$;
reset role;
select pg_temp.assert_true(not exists(select 1 from public.seat_operation_requests),'Invalid batch persisted a request');
set local role authenticated;
select pg_temp.assert_true((select bool_and(status='AVAILABLE' and active_seat_use_session_id is null)
 from public.seats where id in ('c6000000-0000-4000-8000-000000000050','c6000000-0000-4000-8000-000000000051')),'Invalid batch changed seats');
select pg_temp.expect_error($q$select public.activate_seats(current_setting('test.branch')::uuid,
 '[{"seat_id":"c6000000-0000-4000-8000-000000000050","duration_seconds":301}]'::jsonb,gen_random_uuid())$q$,'positive whole minutes');
select pg_temp.expect_error($q$select public.activate_seats(current_setting('test.branch')::uuid,
 '[{"seat_id":"c6000000-0000-4000-8000-000000000050","duration_seconds":300.5}]'::jsonb,gen_random_uuid())$q$,'positive whole minutes');
select pg_temp.expect_error($q$select public.activate_seats(current_setting('test.branch')::uuid,
 '[{"seat_id":"c6000000-0000-4000-8000-000000000050","duration_seconds":"600"}]'::jsonb,gen_random_uuid())$q$,'whole-minute duration');
select pg_temp.expect_error($q$select public.activate_seats(current_setting('test.branch')::uuid,
 '[{"seat_id":"c6000000-0000-4000-8000-000000000050"}]'::jsonb,gen_random_uuid())$q$,'whole-minute duration');
select pg_temp.expect_error($q$select public.activate_seats(current_setting('test.branch')::uuid,
 '[{"seat_id":"c6000000-0000-4000-8000-000000000050","duration_seconds":300},
 {"seat_id":"c6000000-0000-4000-8000-000000000050","duration_seconds":600}]'::jsonb,gen_random_uuid())$q$,'distinct seat IDs');
select pg_temp.expect_error($q$select public.activate_seats(current_setting('test.branch')::uuid,
 '[{"seat_id":"c6000000-0000-4000-8000-000000000050","duration_seconds":300},
 {"seat_id":"c6000000-0000-4000-8000-000000000054","duration_seconds":600}]'::jsonb,gen_random_uuid())$q$,'no longer available');
select pg_temp.assert_true(not exists(select 1 from public.seat_use_sessions),'Rejected request partially activated seats');
select public.activate_seats(current_setting('test.branch')::uuid,current_setting('test.activation_payload')::jsonb,current_setting('test.duration_request')::uuid);
select pg_temp.assert_true((select count(*)=4 and min(started_at)=max(started_at) and bool_and(order_id is null and origin='OWNER_ACTIVATION')
 from public.seat_use_sessions),'Mixed durations did not share one server start or created an order');
select pg_temp.assert_true((select bool_and(extract(epoch from(u.expires_at-u.started_at))=item.duration_seconds)
 from jsonb_to_recordset(current_setting('test.activation_payload')::jsonb) as item(seat_id uuid,duration_seconds integer)
 join public.seat_use_sessions u on u.seat_id=item.seat_id),'Per-seat durations were not applied');
select pg_temp.assert_true((select bool_and(isfinite(expires_at) and abs(extract(epoch from expires_at)*1000)<=8640000000000000)
 from public.seat_use_sessions),'Maximum duration produced an unsupported expiry');
select set_config('test.original_sessions',(select jsonb_agg(jsonb_build_object('id',id,'start',started_at,'end',expires_at) order by id)::text from public.seat_use_sessions),true);
select public.activate_seats(current_setting('test.branch')::uuid,
 (select jsonb_agg(item order by item->>'seat_id' desc) from jsonb_array_elements(current_setting('test.activation_payload')::jsonb) item),current_setting('test.duration_request')::uuid);
select pg_temp.assert_true((select jsonb_agg(jsonb_build_object('id',id,'start',started_at,'end',expires_at) order by id)=current_setting('test.original_sessions')::jsonb from public.seat_use_sessions),'Retry restarted a timer or created sessions');
select pg_temp.expect_error($q$select public.activate_seats(current_setting('test.branch')::uuid,
 jsonb_set(current_setting('test.activation_payload')::jsonb,'{0,duration_seconds}','600'),current_setting('test.duration_request')::uuid)$q$,'different seats or durations');
select pg_temp.expect_error($q$select public.activate_seats(current_setting('test.branch')::uuid,
 current_setting('test.activation_payload')::jsonb,gen_random_uuid())$q$,'no longer available');
set local request.jwt.claim.sub='c6000000-0000-4000-8000-000000000003';
select pg_temp.expect_error($q$select public.activate_seats(current_setting('test.branch')::uuid,
 current_setting('test.activation_payload')::jsonb,gen_random_uuid())$q$,'access denied');
reset role;
select pg_temp.assert_true(not has_function_privilege('anon','public.activate_seats(uuid,jsonb,uuid)','execute'),'Anonymous activation was granted');
select public.seatlink_extend_session(gen_random_uuid(),'c6000000-0000-4000-8000-000000000050',
 (select id from public.seat_use_sessions where seat_id='c6000000-0000-4000-8000-000000000050'),3600,null,'c6000000-0000-4000-8000-000000000001');
select set_config('test.extended_expiry',(select expires_at::text from public.seat_use_sessions where seat_id='c6000000-0000-4000-8000-000000000050'),true);
set local role authenticated;
set local request.jwt.claim.sub='c6000000-0000-4000-8000-000000000001';
select public.activate_seats(current_setting('test.branch')::uuid,current_setting('test.activation_payload')::jsonb,current_setting('test.duration_request')::uuid);
select pg_temp.assert_true((select expires_at=current_setting('test.extended_expiry')::timestamptz from public.seat_use_sessions
 where seat_id='c6000000-0000-4000-8000-000000000050'),'Activation retry changed an extended expiry');
select public.release_active_seats(current_setting('test.branch')::uuid,(select array_agg(id) from public.seat_use_sessions),gen_random_uuid());
select public.activate_seats(current_setting('test.branch')::uuid,current_setting('test.activation_payload')::jsonb,current_setting('test.duration_request')::uuid);
select pg_temp.assert_true((select count(*)=4 and bool_and(status='RELEASED') from public.seat_use_sessions),'Ended request retry created new sessions');
-- Old callers still get ten minutes; checkout remains ten minutes independently of this API.
select public.activate_seats(current_setting('test.branch')::uuid,array['c6000000-0000-4000-8000-000000000050']::uuid[],gen_random_uuid());
select pg_temp.assert_true((select expires_at-started_at=interval '10 minutes' from public.seat_use_sessions where status='ACTIVE'),'Legacy default changed');
rollback;
