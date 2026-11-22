begin;

-- Run with the CLI's --local flag. This file is outside the migration path.

insert into public.organisations (id, name)
values ('9ab8e80c-7bf4-4cf0-a437-133318c32a01', 'SeatLink Demo Food Court')
on conflict (id) do nothing;

insert into public.branches (id, organisation_id, name) values
  ('9ab8e80c-7bf4-4cf0-a437-133318c32b01', '9ab8e80c-7bf4-4cf0-a437-133318c32a01', 'Riverside'),
  ('9ab8e80c-7bf4-4cf0-a437-133318c32b02', '9ab8e80c-7bf4-4cf0-a437-133318c32a01', 'Market Square')
on conflict (id) do nothing;

insert into public.tables (branch_id, table_number)
select branch_id, table_number
from (values
  ('9ab8e80c-7bf4-4cf0-a437-133318c32b01'::uuid, 4),
  ('9ab8e80c-7bf4-4cf0-a437-133318c32b02'::uuid, 3)
) as branches(branch_id, table_count)
cross join lateral generate_series(1, branches.table_count) as table_number
on conflict (branch_id, table_number) do nothing;

insert into public.seats (table_id, label, status)
select tables.id, label, 'AVAILABLE'::public.seat_status
from public.tables
cross join (values ('A'), ('B'), ('C'), ('D')) as labels(label)
where (branch_id = '9ab8e80c-7bf4-4cf0-a437-133318c32b01' and table_number between 1 and 4)
   or (branch_id = '9ab8e80c-7bf4-4cf0-a437-133318c32b02' and table_number between 1 and 3)
on conflict (table_id, label) do nothing;

commit;
