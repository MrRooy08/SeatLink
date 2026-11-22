-- pg_cron is provided by Supabase Postgres. Isolated PostgreSQL test runtimes
-- may omit it, in which case the business functions remain independently testable.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    execute 'create extension if not exists pg_cron with schema pg_catalog';
    execute $schedule$
      select cron.schedule(
        'seatlink-expire-orders', '30 seconds',
        'select public.expire_order_sessions()'
      )
    $schedule$;
  else
    raise warning 'pg_cron unavailable. Enable Supabase Cron and schedule public.expire_order_sessions() every 30 seconds.';
  end if;
end;
$$;
