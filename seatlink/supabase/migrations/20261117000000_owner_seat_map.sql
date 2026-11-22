begin;

create type public.seat_status as enum ('AVAILABLE', 'LOCKED', 'UNAVAILABLE');

create table public.organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> '')
);

create table public.owner_memberships (
  user_id uuid not null references auth.users(id) on delete cascade,
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  primary key (user_id, organisation_id)
);
create index owner_memberships_organisation_id_idx on public.owner_memberships (organisation_id);

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  unique (organisation_id, name)
);

create table public.tables (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  table_number integer not null check (table_number > 0),
  unique (branch_id, table_number)
);

create table public.seats (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references public.tables(id) on delete cascade,
  label text not null check (label in ('A', 'B', 'C', 'D')),
  status public.seat_status not null default 'AVAILABLE',
  unique (table_id, label)
);

alter table public.organisations enable row level security;
alter table public.owner_memberships enable row level security;
alter table public.branches enable row level security;
alter table public.tables enable row level security;
alter table public.seats enable row level security;

revoke all on public.organisations, public.owner_memberships, public.branches,
  public.tables, public.seats from public, anon, authenticated;
grant select on public.organisations, public.owner_memberships, public.branches,
  public.tables, public.seats to authenticated;

create policy owners_read_own_memberships on public.owner_memberships
  for select to authenticated using (user_id = (select auth.uid()));

create policy owners_read_their_organisations on public.organisations
  for select to authenticated using (
    id in (select organisation_id from public.owner_memberships)
  );

create policy owners_read_their_branches on public.branches
  for select to authenticated using (
    organisation_id in (select organisation_id from public.owner_memberships)
  );

create policy owners_read_their_tables on public.tables
  for select to authenticated using (
    exists (select 1 from public.branches where branches.id = tables.branch_id)
  );

create policy owners_read_their_seats on public.seats
  for select to authenticated using (
    exists (select 1 from public.tables where tables.id = seats.table_id)
  );

commit;
