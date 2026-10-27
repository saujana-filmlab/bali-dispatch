create function public.rc_skip_assigned_member_number()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  while exists(select 1 from public.rc_members where member_number=new.member_number) loop
    new.member_number:=pg_catalog.nextval(pg_catalog.pg_get_serial_sequence('public.rc_members','member_number')::regclass);
  end loop;
  return new;
end;
$$;
revoke all on function public.rc_skip_assigned_member_number() from public,anon,authenticated;
grant execute on function public.rc_skip_assigned_member_number() to service_role;
create trigger rc_member_number_skip_assigned
before insert on public.rc_members
for each row execute function public.rc_skip_assigned_member_number();
