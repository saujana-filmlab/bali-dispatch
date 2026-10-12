begin;

-- No default and no backfill: every pre-existing order remains N/A.
alter table public.orders
  add column collect_negatives text null
  constraint orders_collect_negatives_allowed
  check (collect_negatives in ('yes', 'no'));

comment on column public.orders.collect_negatives is
  'Customer submission answer. NULL means historical N/A and cannot be backfilled. Yes/No corrections are saved explicitly.';

create function public.protect_order_negative_collection()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.collect_negatives is distinct from old.collect_negatives
     and (old.collect_negatives is null or new.collect_negatives is null) then
    raise exception 'Historical N/A answers cannot be backfilled and recorded answers cannot be cleared.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.protect_order_negative_collection() from public;

create trigger orders_negative_collection_protected
before update of collect_negatives on public.orders
for each row execute function public.protect_order_negative_collection();

notify pgrst, 'reload schema';
commit;
