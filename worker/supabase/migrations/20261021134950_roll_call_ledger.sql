begin;

create table public.rc_members (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null unique references public.customers(id) on delete restrict,
  member_number bigint generated always as identity unique,
  card_token text not null unique check(length(card_token) >= 40),
  opening_stamps integer not null default 0 check(opening_stamps between 0 and 10000),
  version integer not null default 1,
  created_at timestamptz not null default now()
);
create table public.rc_order_members (
  order_id uuid primary key references public.orders(id) on delete restrict,
  member_id uuid not null references public.rc_members(id),
  counts jsonb not null default '{"c41":0,"bw":0,"ecn":0,"freeC41":0}',
  version integer not null default 0,
  confirmed_by text,
  confirmed_at timestamptz
);
create table public.rc_rolls (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.rc_order_members(order_id),
  roll_key text not null,
  process text not null check(process in ('c41','bw','ecn')),
  complimentary boolean not null,
  active boolean not null default true,
  unique(order_id,roll_key)
);
create index rc_rolls_active_order on public.rc_rolls(order_id) where active and not complimentary;
create index rc_orders_member on public.rc_order_members(member_id);
create table public.rc_cards (
  member_id uuid not null references public.rc_members(id),
  number integer not null check(number>0),
  first_completed_at timestamptz,
  primary key(member_id,number)
);
create table public.rc_rewards (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.rc_members(id),
  milestone integer not null check(milestone>0 and milestone%5=0),
  status text not null check(status in ('available','redeemed','void','used_on_paper')),
  earned_at timestamptz,
  expires_at timestamptz,
  redeemed_by text,
  redeemed_at timestamptz,
  redeemed_order_number text,
  redeemed_order_id uuid references public.orders(id),
  manually_restored boolean not null default false,
  unique(member_id,milestone)
);
create table public.rc_requests (
  request_id uuid primary key,
  member_id uuid not null references public.rc_members(id),
  fingerprint text not null,
  result jsonb not null
);
create table public.rc_events (
  id bigint generated always as identity primary key,
  member_id uuid not null references public.rc_members(id),
  order_id uuid references public.orders(id),
  order_number text,
  request_id uuid not null unique references public.rc_requests(request_id) deferrable initially deferred,
  action text not null,
  staff_name text not null check(length(trim(staff_name)) between 1 and 80),
  reason text not null,
  before_state jsonb,
  after_state jsonb not null,
  created_at timestamptz not null default now()
);
create index rc_events_member on public.rc_events(member_id,id desc);

create table public.rc_stamp_batches (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.rc_members(id),
  quantity integer not null check(quantity between -200 and 200 and quantity<>0),
  active boolean not null default true,
  request_id uuid not null unique,
  created_at timestamptz not null default now()
);
create index rc_stamp_batches_member on public.rc_stamp_batches(member_id) where active;

create function public.rc_total(p_member uuid) returns integer language sql security invoker set search_path='' as $$
  select m.opening_stamps + coalesce((select sum(b.quantity)::integer from public.rc_stamp_batches b where b.member_id=m.id and b.active),0) + (select count(*)::integer from public.rc_rolls r
    join public.rc_order_members o on o.order_id=r.order_id
    where o.member_id=m.id and r.active and not r.complimentary)
  from public.rc_members m where m.id=p_member;
$$;

create function public.rc_reconcile(p_member uuid) returns void language plpgsql security invoker set search_path='' as $$
declare total integer; n integer;
begin
  total:=public.rc_total(p_member);
  for n in 1..(total/10+1) loop
    insert into public.rc_cards(member_id,number,first_completed_at)
      values(p_member,n,case when n<=total/10 then now() end)
      on conflict(member_id,number) do update set first_completed_at=coalesce(public.rc_cards.first_completed_at,excluded.first_completed_at);
  end loop;
  update public.rc_rewards set status='void' where member_id=p_member and milestone>total and status<>'redeemed' and not manually_restored;
  for n in 1..(total/5) loop
    insert into public.rc_rewards(member_id,milestone,status,earned_at,expires_at)
      values(p_member,n*5,'available',now(),now()+interval '30 days')
      on conflict(member_id,milestone) do update set status=case when public.rc_rewards.status='void' then 'available' else public.rc_rewards.status end;
  end loop;
end;
$$;

create function public.rc_snapshot(p_member uuid) returns jsonb language sql security invoker set search_path='' as $$
  select jsonb_build_object(
    'member',jsonb_build_object('id',m.id,'customerId',m.customer_id,'number','RC-BALI-'||lpad(m.member_number::text,greatest(6,length(m.member_number::text)),'0'),'name',c.name,'email',c.email,'cardToken',m.card_token,'version',m.version,'openingStamps',m.opening_stamps),
    'totalStamps',public.rc_total(m.id),
    'currentCard',jsonb_build_object('number',public.rc_total(m.id)/10+1,'stamps',public.rc_total(m.id)%10),
    'completedCards',public.rc_total(m.id)/10,
    'cards',coalesce((select jsonb_agg(jsonb_build_object('number',x.number,'stamps',greatest(0,least(10,public.rc_total(m.id)-(x.number-1)*10)),'issuedAt',case when x.number=1 then m.created_at else (select prev.first_completed_at from public.rc_cards prev where prev.member_id=m.id and prev.number=x.number-1) end,'firstCompletedAt',x.first_completed_at) order by x.number) from public.rc_cards x where x.member_id=m.id),'[]'::jsonb),
    'rewards',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'cardNumber',(r.milestone-1)/10+1,'atStamp',case when r.milestone%10=0 then 10 else 5 end,'status',r.status,'displayStatus',case when r.status='available' and r.expires_at is null then 'verify' when r.status='available' and r.expires_at<=now() then 'expired' else r.status end,'earnedAt',r.earned_at,'expiresAt',r.expires_at,'staffName',r.redeemed_by,'usedAt',r.redeemed_at,'usedOrderNumber',r.redeemed_order_number) order by r.milestone) from public.rc_rewards r where r.member_id=m.id),'[]'::jsonb),
    'stampBatches',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'quantity',b.quantity,'active',b.active,'createdAt',b.created_at) order by b.created_at desc,b.id) from public.rc_stamp_batches b where b.member_id=m.id),'[]'::jsonb),
    'orders',coalesce((select jsonb_agg(jsonb_build_object('orderId',o.order_id,'orderNumber',d.order_number,'counts',o.counts,'version',o.version,'staffName',o.confirmed_by) order by d.created_at desc) from public.rc_order_members o join public.orders d on d.id=o.order_id where o.member_id=m.id),'[]'::jsonb),
    'audit',coalesce((select jsonb_agg(x order by x.id desc) from (select e.id,e.action,e.staff_name as "staffName",e.reason,e.order_id as "orderId",e.order_number as "orderNumber",e.before_state as "before",e.after_state as "after",e.created_at as "createdAt" from public.rc_events e where e.member_id=m.id order by e.id desc limit 100) x),'[]'::jsonb)
  ) from public.rc_members m join public.customers c on c.id=m.customer_id where m.id=p_member;
$$;

create function public.roll_call_apply(p_action text,p_payload jsonb,p_staff text,p_request uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  m public.rc_members; reward public.rc_rewards; linked public.rc_order_members; request public.rc_requests;
  member_key uuid; order_key uuid; customer_key uuid;
  fingerprint text; before_data jsonb; result_data jsonb; v_counts jsonb; item record;
  initial integer; unused integer; n integer; quantity integer; reason text; actor text;
  v_order_number text; paper_day date;
begin
  actor:=trim(p_staff);reason:=trim(coalesce(p_payload->>'reason',''));
  if actor is null or length(actor)<1 or length(actor)>80 or p_request is null then raise exception 'Staff name and request ID are required.'; end if;
  if length(reason)>500 then raise exception 'Reason is too long.'; end if;
  fingerprint:=md5(p_action||actor||(p_payload-'cardToken')::text);
  if p_action='enroll' then
    customer_key:=(p_payload->>'customerId')::uuid;
    perform 1 from public.customers where id=customer_key for update;
    if not found then raise exception 'Customer not found.'; end if;
    select * into m from public.rc_members where customer_id=customer_key for update;
    if found then
      select * into request from public.rc_requests where request_id=p_request;
      if found and request.member_id=m.id and request.fingerprint=fingerprint then return public.rc_snapshot(m.id); end if;
      raise exception 'Roll Call is already enabled for this customer.';
    end if;
    initial:=coalesce((p_payload->>'completedCards')::integer,0)*10+coalesce((p_payload->>'currentStamps')::integer,0);
    unused:=coalesce((p_payload->>'unusedRewards')::integer,0);
    if coalesce((p_payload->>'currentStamps')::integer,0) not between 0 and 9 or initial not between 0 and 10000 or unused not between 0 and initial/5 then raise exception 'Check the paper-card progress and unused rewards.'; end if;
    insert into public.rc_members(customer_id,card_token,opening_stamps) values(customer_key,p_payload->>'cardToken',initial) returning * into m;
  else
    member_key:=(p_payload->>'memberId')::uuid;
    select * into m from public.rc_members where id=member_key for update;
    if not found then raise exception 'Select an enrolled Roll Call member.'; end if;
    select * into request from public.rc_requests where request_id=p_request;
    if found then
      if request.member_id<>m.id or request.fingerprint<>fingerprint then raise exception 'Request ID was reused with different details.'; end if;
      return public.rc_snapshot(m.id);
    end if;
  end if;
  before_data:=jsonb_build_object('totalStamps',public.rc_total(m.id),'openingStamps',m.opening_stamps,'memberVersion',m.version,
    'orderCounts',(select counts from public.rc_order_members where order_id=nullif(p_payload->>'orderId','')::uuid),
    'rewardStatus',(select status from public.rc_rewards where id=nullif(p_payload->>'rewardId','')::uuid and member_id=m.id));
  if p_action in ('attach','confirm') then
    order_key:=(p_payload->>'orderId')::uuid;
    perform 1 from public.orders where id=order_key and customer_id=m.customer_id for update;
    if not found then raise exception 'This order must belong to the selected Registry customer.'; end if;
    if p_action='attach' then
      insert into public.rc_order_members(order_id,member_id) values(order_key,m.id) on conflict(order_id) do nothing;
    end if;
    select * into linked from public.rc_order_members where order_id=order_key for update;
    if not found or linked.member_id<>m.id then raise exception 'Attach this member to the order first.'; end if;
  end if;
  if p_action='confirm' then
    if p_payload->'completed' is distinct from 'true'::jsonb then raise exception 'Confirm development and scanning are both complete.'; end if;
    if linked.version<>coalesce((p_payload->>'expectedVersion')::integer,-1) then raise exception 'Order progress changed. Refresh before saving.'; end if;
    v_counts:=p_payload->'counts';
    if jsonb_typeof(v_counts)<>'object' or not v_counts ?& array['c41','bw','ecn','freeC41'] or (select count(*) from jsonb_object_keys(v_counts))<>4 then raise exception 'Enter all four roll counts.'; end if;
    for item in select key,value from jsonb_each_text(v_counts) loop
      if item.value !~ '^[0-9]{1,3}$' or item.value::integer>200 then raise exception 'Roll counts must be whole numbers from 0 to 200.'; end if;
      v_counts:=jsonb_set(v_counts,array[item.key],to_jsonb(item.value::integer));
    end loop;
    if linked.version>0 and linked.counts is distinct from v_counts and length(reason)<5 then raise exception 'Enter a reason for this correction.'; end if;
    update public.rc_rolls set active=false where order_id=order_key;
    for item in select key,value from jsonb_each_text(v_counts) loop
      quantity:=item.value::integer;
      for n in 1..quantity loop
        insert into public.rc_rolls(order_id,roll_key,process,complimentary,active)
          values(order_key,item.key||':'||n,case when item.key='freeC41' then 'c41' else item.key end,item.key='freeC41',true)
          on conflict(order_id,roll_key) do update set active=true;
      end loop;
    end loop;
    update public.rc_order_members set counts=v_counts,version=version+1,confirmed_by=actor,confirmed_at=now() where order_id=order_key;
  elsif p_action='add_stamps' then
    if m.version<>coalesce((p_payload->>'expectedVersion')::integer,-1) then raise exception 'This card changed. Refresh before adding stamps.'; end if;
    if coalesce(p_payload->>'quantity','') !~ '^[0-9]{1,3}$' then raise exception 'Enter a whole number of stamps from 1 to 200.'; end if;
    quantity:=(p_payload->>'quantity')::integer;
    if quantity not between 1 and 200 then raise exception 'Enter a whole number of stamps from 1 to 200.'; end if;
    insert into public.rc_stamp_batches(member_id,quantity,request_id) values(m.id,quantity,p_request);
  elsif p_action='undo_stamps' then
    update public.rc_stamp_batches set active=false where id=(p_payload->>'batchId')::uuid and member_id=m.id and active;
    if not found then raise exception 'These stamps have already been removed.'; end if;
  elsif p_action='remove_stamps' then
    if m.version<>coalesce((p_payload->>'expectedVersion')::integer,-1) then raise exception 'This card changed. Refresh before adjusting stamps.'; end if;
    if coalesce(p_payload->>'quantity','') !~ '^[0-9]{1,3}$' then raise exception 'Choose a whole number of stamps to remove.'; end if;
    quantity:=(p_payload->>'quantity')::integer;
    if quantity not between 1 and least(200,public.rc_total(m.id)) then raise exception 'Cannot remove more stamps than this member has.'; end if;
    insert into public.rc_stamp_batches(member_id,quantity,request_id) values(m.id,-quantity,p_request);
  elsif p_action='opening' then
    if m.version<>coalesce((p_payload->>'expectedVersion')::integer,-1) then raise exception 'This card changed. Refresh before adjusting stamps.'; end if;
    initial:=(p_payload->>'completedCards')::integer*10+(p_payload->>'currentStamps')::integer;
    unused:=(p_payload->>'unusedRewards')::integer;
    if (p_payload->>'currentStamps')::integer not between 0 and 9 or initial not between 0 and 10000 or unused not between 0 and initial/5 then raise exception 'Check the paper-card progress and unused rewards.'; end if;
    update public.rc_members set opening_stamps=initial where id=m.id;
  elsif p_action='redeem' then
    select * into reward from public.rc_rewards where id=(p_payload->>'rewardId')::uuid and member_id=m.id for update;
    if not found or reward.status<>'available' then raise exception 'This reward is no longer available.'; end if;
    if reward.expires_at is null then
      if coalesce(p_payload->>'paperEarnedOn','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Enter the stamp date from the paper card before redeeming.'; end if;
      paper_day:=(p_payload->>'paperEarnedOn')::date;
      if paper_day>current_date then raise exception 'Paper stamp date cannot be in the future.'; end if;
      reward.earned_at:=paper_day::timestamp at time zone 'Asia/Makassar';
      reward.expires_at:=(paper_day+30)::timestamp at time zone 'Asia/Makassar';
    end if;
    if reward.expires_at<=now() then raise exception 'This reward has expired.'; end if;
    v_order_number:=nullif(trim(coalesce(p_payload->>'orderNumber','')),'');
    if length(v_order_number)>80 then raise exception 'Order number is too long.'; end if;
    if v_order_number is not null then
      select id into order_key from public.orders where orders.order_number=v_order_number and orders.customer_id=m.customer_id;
      if exists(select 1 from public.orders where orders.order_number=v_order_number) and order_key is null then
        raise exception 'That order number belongs to another customer.';
      end if;
    end if;
    update public.rc_rewards set status='redeemed',earned_at=reward.earned_at,expires_at=reward.expires_at,
      redeemed_by=actor,redeemed_at=now(),redeemed_order_number=v_order_number,redeemed_order_id=order_key
      where id=reward.id and status='available';
  elsif p_action='reverse' then
    select * into reward from public.rc_rewards where id=(p_payload->>'rewardId')::uuid and member_id=m.id and status in ('redeemed','used_on_paper') for update;
    if not found then raise exception 'Matching redemption not found.'; end if;
    if p_payload ? 'expectedUsedAt' and (p_payload->>'expectedUsedAt')::timestamptz is distinct from reward.redeemed_at then
      raise exception 'This reward changed. Refresh before restoring it.';
    end if;
    update public.rc_rewards set status='available',manually_restored=true,redeemed_by=null,redeemed_at=null,
      redeemed_order_number=null,redeemed_order_id=null where id=reward.id;
  elsif p_action not in ('enroll','attach') then
    raise exception 'Unknown Roll Call action.';
  end if;
  if public.rc_total(m.id)<0 then raise exception 'Stamp total cannot be negative.'; end if;
  if p_action not in ('redeem','reverse') then perform public.rc_reconcile(m.id); end if;
  if p_action in ('enroll','opening') then
    update public.rc_rewards set status=case when milestone>initial-unused*5 then 'available' else 'used_on_paper' end,
      earned_at=null,expires_at=null
      where member_id=m.id and milestone<=initial and status<>'redeemed';
  end if;
  update public.rc_members set version=version+1 where id=m.id;
  result_data:=jsonb_build_object('totalStamps',public.rc_total(m.id),'input',p_payload-'cardToken');
  insert into public.rc_requests(request_id,member_id,fingerprint,result) values(p_request,m.id,fingerprint,jsonb_build_object('operation',p_action));
  insert into public.rc_events(member_id,order_id,order_number,request_id,action,staff_name,reason,before_state,after_state)
    values(m.id,order_key,v_order_number,p_request,p_action,actor,reason,before_data,result_data);
  return public.rc_snapshot(m.id);
end;
$$;

create function public.rc_staff_customers(p_search text,p_offset integer,p_members_only boolean) returns jsonb
language sql security invoker set search_path='' as $$
  with matches as (
    select coalesce(c.legacy_customer_id,c.id::text) as id,c.id as "supabaseId",c.name,c.email,c.phone,
      case when m.id is not null then 'RC-BALI-'||lpad(m.member_number::text,greatest(6,length(m.member_number::text)),'0') end as "memberNumber"
    from public.customers c left join public.rc_members m on m.customer_id=c.id
    where (not p_members_only or m.id is not null)
      and strpos(lower(concat_ws(' ',c.name,c.email,c.phone,
        case when m.id is not null then 'RC-BALI-'||lpad(m.member_number::text,greatest(6,length(m.member_number::text)),'0') end)),lower(trim(coalesce(p_search,''))))>0
  ), page as (select * from matches order by lower(name),id limit 100 offset greatest(0,p_offset))
  select jsonb_build_object('customers',coalesce((select jsonb_agg(p order by lower(p.name),p.id) from page p),'[]'::jsonb),
    'total',(select count(*) from matches),'offset',p_offset);
$$;

create function public.rc_daily_redemptions(p_day date) returns jsonb language sql security invoker set search_path='' as $$
  select jsonb_build_object('date',p_day,'items',coalesce(jsonb_agg(x order by x."usedAt",x."rewardId"),'[]'::jsonb))
  from (
    select r.id as "rewardId",c.name,c.email,
      'RC-BALI-'||lpad(m.member_number::text,greatest(6,length(m.member_number::text)),'0') as "memberNumber",
      (r.milestone-1)/10+1 as "cardNumber",case when r.milestone%10=0 then 10 else 5 end as "atStamp",
      greatest(case when r.milestone%10=0 then 10 else 5 end,
        least(10,coalesce((select (e.before_state->>'totalStamps')::integer from public.rc_events e
          where e.member_id=m.id and e.action='redeem' and e.after_state->'input'->>'rewardId'=r.id::text
          and e.created_at<=r.redeemed_at order by e.id desc limit 1),r.milestone)-((r.milestone-1)/10)*10)) as "cardStamps",
      r.redeemed_at as "usedAt"
    from public.rc_rewards r join public.rc_members m on m.id=r.member_id join public.customers c on c.id=m.customer_id
    where r.status='redeemed' and r.redeemed_at>=p_day::timestamp at time zone 'Asia/Makassar'
      and r.redeemed_at<(p_day+1)::timestamp at time zone 'Asia/Makassar'
  ) x;
$$;

create function public.rc_backup() returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('format','saujana-bali-roll-call','schemaVersion',1,'exportedAt',now(),
    'registryCustomers',coalesce((select jsonb_agg(c order by c.id) from public.customers c where exists(select 1 from public.rc_members m where m.customer_id=c.id)),'[]'::jsonb),
    'referencedOrders',coalesce((select jsonb_agg(o order by o.id) from public.orders o where exists(select 1 from public.rc_order_members m where m.order_id=o.id) or exists(select 1 from public.rc_events e where e.order_id=o.id) or exists(select 1 from public.rc_rewards r where r.redeemed_order_id=o.id)),'[]'::jsonb),
    'tables',jsonb_build_object(
      'rc_members',coalesce((select jsonb_agg(t order by t.id) from public.rc_members t),'[]'::jsonb),
      'rc_order_members',coalesce((select jsonb_agg(t order by t.order_id) from public.rc_order_members t),'[]'::jsonb),
      'rc_rolls',coalesce((select jsonb_agg(t order by t.id) from public.rc_rolls t),'[]'::jsonb),
      'rc_cards',coalesce((select jsonb_agg(t order by t.member_id,t.number) from public.rc_cards t),'[]'::jsonb),
      'rc_rewards',coalesce((select jsonb_agg(t order by t.id) from public.rc_rewards t),'[]'::jsonb),
      'rc_requests',coalesce((select jsonb_agg(t order by t.request_id) from public.rc_requests t),'[]'::jsonb),
      'rc_events',coalesce((select jsonb_agg(t order by t.id) from public.rc_events t),'[]'::jsonb),
      'rc_stamp_batches',coalesce((select jsonb_agg(t order by t.id) from public.rc_stamp_batches t),'[]'::jsonb)
    ));
$$;

do $$
declare t text; f record;
begin
  foreach t in array array['rc_members','rc_order_members','rc_rolls','rc_cards','rc_rewards','rc_requests','rc_events','rc_stamp_batches'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
  grant usage,select on sequence public.rc_members_member_number_seq,public.rc_events_id_seq to service_role;
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('rc_total','rc_reconcile','rc_snapshot','roll_call_apply','rc_daily_redemptions','rc_staff_customers','rc_backup') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end;
$$;
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('import_customers_from_raw','import_orders_from_raw','import_stock_from_raw','import_stock_sessions_from_raw','rls_auto_enable') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end;
$$;
notify pgrst,'reload schema';
commit;
