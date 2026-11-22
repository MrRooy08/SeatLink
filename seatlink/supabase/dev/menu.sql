-- Development fixtures. Use the local or explicitly targeted hosted development seed command.
-- SGD is a demo currency choice, and prices are minor units (cents).
begin;

do $$
begin
  if current_setting('seatlink.development_seed', true) is distinct from 'on' then
    raise exception 'Use a SeatLink development seed command against an intended development database.';
  end if;
end;
$$;

insert into public.menu_items (branch_id, name, price_minor, currency, available, is_demo)
select b.id, item.name, item.price_minor, 'SGD', item.available, true
from public.branches b
cross join (values
  ('Sample chicken rice', 550, true),
  ('Sample vegetable noodles', 480, true),
  ('Sample iced tea', 180, true),
  ('Sample lime juice', 250, true),
  ('Sample daily special', 650, false)
) as item(name, price_minor, available)
where b.id in ('9ab8e80c-7bf4-4cf0-a437-133318c32b01', '9ab8e80c-7bf4-4cf0-a437-133318c32b02')
  or b.id = nullif(current_setting('seatlink.demo_branch_id', true), '')::uuid
on conflict (branch_id, name) do nothing;

commit;
