alter table public.orders add column delivery_revision integer not null default 0;
alter table public.orders add column delivery_email_override boolean not null default false;
create table public.delivery_edits (
 request_id uuid primary key, order_id uuid not null references public.orders(id),
 revision integer not null, payload jsonb not null, before_state jsonb not null, after_state jsonb not null,
 created_at timestamptz not null default now(), actor text not null default 'Dispatch staff'
);
create index delivery_edits_order on public.delivery_edits(order_id,revision desc);
alter table public.delivery_edits enable row level security;
revoke all on public.delivery_edits from public,anon,authenticated;
grant select,insert,update,delete on public.delivery_edits to service_role;
create function public.dispatch_correct_delivery(p_order uuid,p_revision integer,p_details jsonb,p_sheets jsonb,p_request uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare o public.orders; e public.delivery_edits; before_data jsonb; after_data jsonb; item jsonb;
 fingerprint jsonb:=jsonb_build_object('details',p_details,'sheets',p_sheets);
begin
 if p_order is null or p_revision is null or p_request is null then raise exception 'Missing delivery revision'; end if;
 select * into strict o from public.orders where id=p_order for update;
 select * into e from public.delivery_edits where request_id=p_request;
 if found then
  if e.order_id<>p_order or e.payload<>fingerprint then raise exception 'Request already used'; end if;
  return jsonb_build_object('revision',e.revision,'success',true);
 end if;
 if o.delivery_revision<>p_revision then raise exception 'This delivery changed on another device. Reload it before saving.'; end if;
 before_data:=jsonb_build_object('order',to_jsonb(o),'sheets',coalesce((select jsonb_agg(s order by roll_index) from public.contact_sheets s where order_id=p_order),'[]'::jsonb),'recipients',coalesce((select jsonb_agg(r order by id) from public.order_recipients r where order_id=p_order),'[]'::jsonb));
 if p_details is not null then
  if nullif(trim(p_details->>'name'),'') is null or nullif(trim(p_details->>'film'),'') is null or nullif(trim(p_details->>'driveLink'),'') is null or nullif(p_details->>'deliveryUrl','') is null then raise exception 'Incomplete delivery details'; end if;
  update public.orders set delivery_display_name=p_details->>'name',film=p_details->>'film',drive_link=p_details->>'driveLink',notes=nullif(p_details->>'notes',''),delivery_url=p_details->>'deliveryUrl' where id=p_order;
  if p_details ? 'email' then
   if length(p_details->>'email')>320 or (p_details->>'email'<>'' and p_details->>'email' !~ '^[^[:space:]@,;]+@[^[:space:]@,;]+\.[^[:space:]@,;]+$') or jsonb_typeof(p_details->'extraEmails')<>'array' or jsonb_array_length(p_details->'extraEmails')>10 then raise exception 'Invalid delivery email'; end if;
   if exists(select 1 from jsonb_array_elements_text(p_details->'extraEmails') value where length(value)>320 or value !~ '^[^[:space:]@,;]+@[^[:space:]@,;]+\.[^[:space:]@,;]+$') then raise exception 'Invalid delivery email'; end if;
   if p_details->>'email'='' and jsonb_array_length(p_details->'extraEmails')>0 then raise exception 'Primary email required'; end if;
   update public.orders set customer_email=nullif(p_details->>'email',''),delivery_email_override=true where id=p_order;
   delete from public.order_recipients where order_id=p_order;
   if p_details->>'email'<>'' then
    insert into public.order_recipients(order_id,email,is_primary) values(p_order,p_details->>'email',true);
    insert into public.order_recipients(order_id,email,is_primary) select p_order,value,false from (select distinct on(lower(value)) value from jsonb_array_elements_text(p_details->'extraEmails') value order by lower(value)) emails where lower(value)<>lower(p_details->>'email');
   end if;
  end if;
 end if;
 if p_sheets is not null then
  if jsonb_typeof(p_sheets)<>'array' or jsonb_array_length(p_sheets)>20 then raise exception 'Invalid contact sheets'; end if;
  if (select count(*)<>count(distinct (v->>'rollIndex')::integer) from jsonb_array_elements(p_sheets) v) then raise exception 'Duplicate roll'; end if;
  delete from public.contact_sheets where order_id=p_order and roll_index not in(select (v->>'rollIndex')::integer from jsonb_array_elements(p_sheets) v);
  for item in select value from jsonb_array_elements(p_sheets) loop
   if (item->>'rollIndex')::integer not between 0 and 19 or nullif(item->>'deliveryUrl','') is null or nullif(item->>'storyUrl','') is null then raise exception 'Both sheet formats are required'; end if;
   insert into public.contact_sheets(order_id,roll_index,film_name,frame_count,landscape_url,portrait_url,status,published_at)
   values(p_order,(item->>'rollIndex')::integer,item->>'filmName',(item->>'frameCount')::integer,item->>'deliveryUrl',item->>'storyUrl','ready',now())
   on conflict(order_id,roll_index) do update set film_name=excluded.film_name,frame_count=excluded.frame_count,landscape_url=excluded.landscape_url,portrait_url=excluded.portrait_url,status='ready',published_at=now()
   where (contact_sheets.film_name,contact_sheets.frame_count,contact_sheets.landscape_url,contact_sheets.portrait_url,contact_sheets.status) is distinct from (excluded.film_name,excluded.frame_count,excluded.landscape_url,excluded.portrait_url,excluded.status);
  end loop;
  update public.orders set contact_sheets_enabled=jsonb_array_length(p_sheets)>0 where id=p_order;
 end if;
 update public.orders set delivery_revision=delivery_revision+1 where id=p_order returning * into o;
 after_data:=jsonb_build_object('order',to_jsonb(o),'sheets',coalesce((select jsonb_agg(s order by roll_index) from public.contact_sheets s where order_id=p_order),'[]'::jsonb),'recipients',coalesce((select jsonb_agg(r order by id) from public.order_recipients r where order_id=p_order),'[]'::jsonb));
 insert into public.delivery_edits(request_id,order_id,revision,payload,before_state,after_state) values(p_request,p_order,o.delivery_revision,fingerprint,before_data,after_data);
 return jsonb_build_object('revision',o.delivery_revision,'success',true);
end; $$;
revoke all on function public.dispatch_correct_delivery(uuid,integer,jsonb,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.dispatch_correct_delivery(uuid,integer,jsonb,jsonb,uuid) to service_role;
create function public.dispatch_delivery_backup() returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('format','saujana-delivery-corrections','schemaVersion',1,'exportedAt',now(),
 'orders',coalesce((select jsonb_agg(o order by id) from public.orders o),'[]'::jsonb),
 'contactSheets',coalesce((select jsonb_agg(s order by order_id,roll_index) from public.contact_sheets s),'[]'::jsonb),
 'recipients',coalesce((select jsonb_agg(r order by order_id,id) from public.order_recipients r),'[]'::jsonb),
 'edits',coalesce((select jsonb_agg(e order by order_id,revision) from public.delivery_edits e),'[]'::jsonb));
$$;
revoke all on function public.dispatch_delivery_backup() from public,anon,authenticated;
grant execute on function public.dispatch_delivery_backup() to service_role;
