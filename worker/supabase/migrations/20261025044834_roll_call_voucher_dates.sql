create function public.rc_set_reward_date(
  p_member uuid, p_reward uuid, p_earned_on date, p_expected_version integer,
  p_staff text, p_request uuid
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  member_row public.rc_members; reward_row public.rc_rewards; saved_request public.rc_requests;
  fingerprint text; actor text; before_data jsonb; after_data jsonb;
  earned_time time; new_earned_at timestamptz; new_expires_at timestamptz;
begin
  actor:=trim(p_staff);
  if actor is null or length(actor) not between 1 and 80 or p_request is null then
    raise exception 'Staff access and a request ID are required.';
  end if;
  if p_earned_on is null or p_earned_on<date '1900-01-01' or p_earned_on>(now() at time zone 'Asia/Makassar')::date then
    raise exception 'Enter a valid voucher stamp date that is not in the future.';
  end if;
  select * into member_row from public.rc_members where id=p_member for update;
  if not found then raise exception 'Select an enrolled Roll Call member.'; end if;
  fingerprint:=md5(jsonb_build_object('operation','set_reward_date','memberId',p_member,'rewardId',p_reward,'earnedOn',p_earned_on,'expectedVersion',p_expected_version,'staff',actor)::text);
  select * into saved_request from public.rc_requests where request_id=p_request;
  if found then
    if saved_request.member_id<>p_member or saved_request.fingerprint<>fingerprint then
      raise exception 'Request ID was reused with different details.';
    end if;
    return public.rc_snapshot(p_member);
  end if;
  if member_row.version<>coalesce(p_expected_version,-1) then
    raise exception 'This card changed. Refresh before confirming the voucher date.';
  end if;
  select * into reward_row from public.rc_rewards where id=p_reward and member_id=p_member for update;
  if not found or reward_row.status='void' then raise exception 'Select an existing voucher on this card.'; end if;
  before_data:=jsonb_build_object('rewardId',p_reward,'earnedAt',reward_row.earned_at,'expiresAt',reward_row.expires_at,'rewardStatus',reward_row.status,'totalStamps',public.rc_total(p_member),'memberVersion',member_row.version);
  -- Preserve a digital stamp's time of day; paper dates begin at midnight in Bali.
  earned_time:=coalesce((reward_row.earned_at at time zone 'Asia/Makassar')::time,time '00:00:00');
  new_earned_at:=(p_earned_on+earned_time) at time zone 'Asia/Makassar';
  new_expires_at:=((p_earned_on+30)+earned_time) at time zone 'Asia/Makassar';
  update public.rc_rewards set earned_at=new_earned_at,expires_at=new_expires_at where id=p_reward;
  update public.rc_members set version=version+1 where id=p_member;
  after_data:=jsonb_build_object('rewardId',p_reward,'earnedAt',new_earned_at,'expiresAt',new_expires_at,'rewardStatus',reward_row.status,'totalStamps',public.rc_total(p_member),'input',jsonb_build_object('earnedOn',p_earned_on));
  insert into public.rc_requests(request_id,member_id,fingerprint,result)
    values(p_request,p_member,fingerprint,jsonb_build_object('operation','set_reward_date'));
  insert into public.rc_events(member_id,request_id,action,staff_name,reason,before_state,after_state)
    values(p_member,p_request,'set_reward_date',actor,'',before_data,after_data);
  return public.rc_snapshot(p_member);
end;
$$;
revoke all on function public.rc_set_reward_date(uuid,uuid,date,integer,text,uuid) from public,anon,authenticated;
grant execute on function public.rc_set_reward_date(uuid,uuid,date,integer,text,uuid) to service_role;
