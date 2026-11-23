begin;

alter table public.branches add column address text;
alter table public.branches add column timezone text not null default 'Asia/Singapore';
alter table public.branches add column currency text check (currency ~ '^[A-Z]{3}$');
-- Infer a currency only when existing data is unambiguous. Unknown/mixed branches
-- require explicit configuration instead of showing a misleading zero or sum.
update public.branches b set currency=m.currency from (
 select branch_id,min(currency) currency from public.menu_items group by branch_id having count(distinct currency)=1
) m where m.branch_id=b.id;
update public.branches b set currency=o.currency from (
 select branch_id,min(currency) currency from public.orders group by branch_id having count(distinct currency)=1
) o where o.branch_id=b.id and b.currency is null;

create function public.seatlink_validate_branch_timezone()
returns trigger language plpgsql set search_path='' as $$
begin
 if not exists(select 1 from pg_timezone_names where name=new.timezone) then raise exception 'Use a valid IANA branch timezone.'; end if;
 return new;
end;
$$;
create trigger validate_branch_timezone before insert or update of timezone on public.branches
 for each row execute function public.seatlink_validate_branch_timezone();
revoke all on function public.seatlink_validate_branch_timezone() from public,anon,authenticated;

create index payment_attempts_successful_day_idx on public.payment_attempts(succeeded_at,order_id)
 where status='SUCCEEDED' and provider in ('CASH','TWO_C2P');

create function public.seatlink_daily_sales_at(p_branch_id uuid,p_now timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare branch public.branches; local_day date; starts_at timestamptz; ends_at timestamptz;
 amount numeric; paid_count bigint; sandbox_count bigint;
begin
 select b.* into branch from public.branches b join public.owner_memberships m on m.organisation_id=b.organisation_id
 where b.id=p_branch_id and m.user_id=auth.uid() and m.role='OWNER';
 if branch.id is null then raise exception using errcode='42501',message='Branch sales access denied.'; end if;
 if branch.currency is null then raise exception 'Configure this branch currency before viewing daily sales.'; end if;
 local_day:=(p_now at time zone branch.timezone)::date;
 starts_at:=local_day::timestamp at time zone branch.timezone;
 ends_at:=(local_day+1)::timestamp at time zone branch.timezone;
 if exists(select 1 from public.orders o join public.payment_attempts p on p.id=o.paid_attempt_id and p.order_id=o.id
  where o.branch_id=p_branch_id and o.status in ('PAID','PAID_REVIEW') and p.status='SUCCEEDED'
   and p.provider in ('CASH','TWO_C2P') and p.succeeded_at>=starts_at and p.succeeded_at<ends_at and o.currency<>branch.currency
   and not exists(select 1 from public.payment_exceptions e where e.payment_attempt_id=o.paid_attempt_id and e.kind='LATE_PAYMENT')) then
  raise exception 'Paid orders use a different currency. Review branch currency before viewing totals.';
 end if;
 select coalesce(sum(o.total_minor::numeric),0),count(*),count(*) filter(where p.mode='SANDBOX')
 into amount,paid_count,sandbox_count
 from public.orders o join public.payment_attempts p on p.id=o.paid_attempt_id and p.order_id=o.id
 where o.branch_id=p_branch_id and o.status in ('PAID','PAID_REVIEW') and p.status='SUCCEEDED'
  and p.provider in ('CASH','TWO_C2P') and p.succeeded_at>=starts_at and p.succeeded_at<ends_at
  and not exists(select 1 from public.payment_exceptions e where e.payment_attempt_id=o.paid_attempt_id and e.kind='LATE_PAYMENT');
 return jsonb_build_object('branch_id',p_branch_id,'day',local_day,'timezone',branch.timezone,'currency',branch.currency,
  'day_start',starts_at,'day_end',ends_at,'server_now',p_now,'total_minor',amount::text,'paid_orders',paid_count,
  'basis','GROSS','mock_excluded',true,'sandbox_orders',sandbox_count,'refunds_supported',false);
end;
$$;
create function public.read_branch_daily_sales(p_branch_id uuid)
returns jsonb language sql security definer set search_path='' as $$
 select public.seatlink_daily_sales_at(p_branch_id,clock_timestamp());
$$;
revoke all on function public.seatlink_daily_sales_at(uuid,timestamptz),public.read_branch_daily_sales(uuid) from public,anon,authenticated;
grant execute on function public.read_branch_daily_sales(uuid) to authenticated;
commit;
