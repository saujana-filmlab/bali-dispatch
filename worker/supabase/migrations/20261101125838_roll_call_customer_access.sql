create table public.rc_access_settings (
 scope text primary key, member_id uuid unique references public.rc_members(id),
 enabled boolean not null default true, version integer not null default 0,
 updated_at timestamptz not null default now(),
 check(scope=case when member_id is null then 'system' else 'member:'||member_id::text end)
);
insert into public.rc_access_settings(scope) values('system');
create table public.rc_access_attempts (
 id boolean primary key default true check(id), attempts integer not null default 0,
 window_start timestamptz not null default now()
);
insert into public.rc_access_attempts(id) values(true);
create table public.rc_access_events (
 request_id uuid primary key, scope text not null references public.rc_access_settings(scope),
 enabled boolean not null, previous_enabled boolean not null,
 created_at timestamptz not null default now(), actor text not null default 'Authorized Roll Call administrator'
);
create index rc_access_events_scope on public.rc_access_events(scope,created_at desc);
alter table public.rc_access_settings enable row level security;
alter table public.rc_access_attempts enable row level security;
alter table public.rc_access_events enable row level security;
revoke all on public.rc_access_settings,public.rc_access_attempts,public.rc_access_events from public,anon,authenticated;
grant select,insert,update,delete on public.rc_access_settings,public.rc_access_attempts,public.rc_access_events to service_role;
create function public.rc_customer_access(p_member uuid default null) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('systemEnabled',s.enabled,'systemVersion',s.version,
 'memberEnabled',coalesce(m.enabled,true),'memberVersion',coalesce(m.version,0))
 from public.rc_access_settings s left join public.rc_access_settings m on m.member_id=p_member where s.scope='system';
$$;
create function public.rc_access_attempt() returns boolean
language plpgsql security invoker set search_path='' as $$
declare a public.rc_access_attempts;
begin
 select * into strict a from public.rc_access_attempts where id=true for update;
 if a.window_start<=now()-interval '15 minutes' then
  update public.rc_access_attempts set attempts=1,window_start=now() where id=true; return true;
 end if;
 if a.attempts>=5 then return false; end if;
 update public.rc_access_attempts set attempts=attempts+1 where id=true; return true;
end; $$;
create function public.rc_set_customer_access(p_member uuid,p_enabled boolean,p_expected_version integer,p_request uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare k text:=case when p_member is null then 'system' else 'member:'||p_member::text end;
 s public.rc_access_settings; e public.rc_access_events;
begin
 if p_enabled is null or p_expected_version is null or p_request is null then raise exception 'Missing access settings'; end if;
 insert into public.rc_access_settings(scope,member_id) values(k,p_member) on conflict(scope) do nothing;
 select * into strict s from public.rc_access_settings where scope=k for update;
 select * into e from public.rc_access_events where request_id=p_request;
 if found then
  if e.scope<>k or e.enabled<>p_enabled then raise exception 'Request already used'; end if;
  return public.rc_customer_access(p_member);
 end if;
 if s.version<>p_expected_version then raise exception 'Access changed on another device. Refresh and try again.'; end if;
 update public.rc_access_settings set enabled=p_enabled,version=version+1,updated_at=now() where scope=k;
 insert into public.rc_access_events(request_id,scope,enabled,previous_enabled) values(p_request,k,p_enabled,s.enabled);
 update public.rc_access_attempts set attempts=0,window_start=now() where id=true;
 return public.rc_customer_access(p_member);
end; $$;
revoke all on function public.rc_customer_access(uuid),public.rc_access_attempt(),public.rc_set_customer_access(uuid,boolean,integer,uuid) from public,anon,authenticated;
grant execute on function public.rc_customer_access(uuid),public.rc_access_attempt(),public.rc_set_customer_access(uuid,boolean,integer,uuid) to service_role;
create function public.rc_access_backup() returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('settings',coalesce((select jsonb_agg(s order by scope) from public.rc_access_settings s),'[]'::jsonb),
 'events',coalesce((select jsonb_agg(e order by created_at,request_id) from public.rc_access_events e),'[]'::jsonb));
$$;
revoke all on function public.rc_access_backup() from public,anon,authenticated;
grant execute on function public.rc_access_backup() to service_role;
alter function public.rc_backup() rename to rc_ledger_backup;
create function public.rc_backup() returns jsonb
language sql stable security invoker set search_path='' as $$
 select public.rc_ledger_backup()||jsonb_build_object('customerAccess',public.rc_access_backup());
$$;
revoke all on function public.rc_backup() from public,anon,authenticated;
grant execute on function public.rc_backup() to service_role;
