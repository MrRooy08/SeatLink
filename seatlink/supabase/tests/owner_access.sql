-- Run on a local development database with psql -v ON_ERROR_STOP=1.
begin;

insert into auth.users (id, email) values
  ('3c04e8f2-8d01-457a-9266-e372bfc34001', 'owner-a@seatlink-test.invalid'),
  ('3c04e8f2-8d01-457a-9266-e372bfc34002', 'owner-b@seatlink-test.invalid'),
  ('3c04e8f2-8d01-457a-9266-e372bfc34003', 'no-membership@seatlink-test.invalid');

insert into public.organisations (id, name) values
  ('3c04e8f2-8d01-457a-9266-e372bfc34101', 'Test organisation A'),
  ('3c04e8f2-8d01-457a-9266-e372bfc34102', 'Test organisation B');

insert into public.owner_memberships (user_id, organisation_id) values
  ('3c04e8f2-8d01-457a-9266-e372bfc34001', '3c04e8f2-8d01-457a-9266-e372bfc34101'),
  ('3c04e8f2-8d01-457a-9266-e372bfc34002', '3c04e8f2-8d01-457a-9266-e372bfc34102');

insert into public.branches (id, organisation_id, name) values
  ('3c04e8f2-8d01-457a-9266-e372bfc34201', '3c04e8f2-8d01-457a-9266-e372bfc34101', 'Test branch A'),
  ('3c04e8f2-8d01-457a-9266-e372bfc34202', '3c04e8f2-8d01-457a-9266-e372bfc34102', 'Test branch B');

insert into public.tables (id, branch_id, table_number) values
  ('3c04e8f2-8d01-457a-9266-e372bfc34301', '3c04e8f2-8d01-457a-9266-e372bfc34201', 1),
  ('3c04e8f2-8d01-457a-9266-e372bfc34302', '3c04e8f2-8d01-457a-9266-e372bfc34202', 1);

insert into public.seats (table_id, label, status) values
  ('3c04e8f2-8d01-457a-9266-e372bfc34301', 'A', 'LOCKED'),
  ('3c04e8f2-8d01-457a-9266-e372bfc34302', 'B', 'AVAILABLE');

set local role authenticated;
set local request.jwt.claim.sub = '3c04e8f2-8d01-457a-9266-e372bfc34001';

do $$
begin
  if (select array_agg(name) from public.organisations) is distinct from array['Test organisation A']
      or (select array_agg(name) from public.branches) is distinct from array['Test branch A']
      or (select array_agg(id) from public.tables) is distinct from array['3c04e8f2-8d01-457a-9266-e372bfc34301'::uuid]
      or (select array_agg(label) from public.seats) is distinct from array['A']
      or (select array_agg(user_id) from public.owner_memberships) is distinct from array[auth.uid()] then
    raise exception 'Owner A did not get exactly their own organisation data.';
  end if;
  if exists (select from public.tables where branch_id = '3c04e8f2-8d01-457a-9266-e372bfc34202')
      or exists (select from public.seats where table_id = '3c04e8f2-8d01-457a-9266-e372bfc34302') then
    raise exception 'Owner A could directly query another organisation.';
  end if;

  begin
    update public.seats set status = 'AVAILABLE' where table_id = '3c04e8f2-8d01-457a-9266-e372bfc34301';
    raise exception 'Authenticated seat update was accepted.';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.owner_memberships (user_id, organisation_id)
    values (auth.uid(), '3c04e8f2-8d01-457a-9266-e372bfc34102');
    raise exception 'Authenticated membership insert was accepted.';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.owner_memberships set organisation_id = '3c04e8f2-8d01-457a-9266-e372bfc34102'
    where user_id = auth.uid();
    raise exception 'Authenticated membership update was accepted.';
  exception when insufficient_privilege then null;
  end;

  begin
    delete from public.owner_memberships where user_id = auth.uid();
    raise exception 'Authenticated membership delete was accepted.';
  exception when insufficient_privilege then null;
  end;
end;
$$;

set local request.jwt.claim.sub = '3c04e8f2-8d01-457a-9266-e372bfc34002';
do $$
begin
  if (select array_agg(label) from public.seats) is distinct from array['B'] then
    raise exception 'Owner B did not get exactly their own seats.';
  end if;
end;
$$;

set local request.jwt.claim.sub = '3c04e8f2-8d01-457a-9266-e372bfc34003';
do $$
begin
  if exists (select from public.organisations) or exists (select from public.owner_memberships)
      or exists (select from public.branches) or exists (select from public.tables)
      or exists (select from public.seats) then
    raise exception 'An authenticated user without membership could read owner data.';
  end if;
end;
$$;

set local role anon;
set local request.jwt.claim.sub = '';
do $$
declare
  relation text;
begin
  foreach relation in array array['organisations', 'owner_memberships', 'branches', 'tables', 'seats'] loop
    begin
      execute format('select 1 from public.%I limit 1', relation);
      raise exception 'An anonymous user could query %.', relation;
    exception when insufficient_privilege then null;
    end;
  end loop;
end;
$$;

reset role;
rollback;
