begin;

-- Dual-role accounts retain the last explicitly selected customer or contractor
-- workspace. Existing accounts keep the historical client-first default.
alter table public.profiles
  add column last_workspace text not null default 'client'
  check (last_workspace in ('client','contractor'));

alter table public.bid_versions
  add column withdrawn_at timestamptz,
  add column withdrawn_by uuid references auth.users,
  add constraint bid_version_withdrawal_state check (
    (status='withdrawn')=(withdrawn_at is not null and withdrawn_by is not null)
  );

create or replace function dao_private.lock_submitted_version() returns trigger
language plpgsql set search_path='' as $$
begin
  if OLD.submitted_at is not null then
    if TG_OP='DELETE' then
      raise exception 'submitted_version_immutable' using errcode='23514';
    end if;
    if (to_jsonb(NEW)-'status'-'validity'-'withdrawn_at'-'withdrawn_by')
       is distinct from
       (to_jsonb(OLD)-'status'-'validity'-'withdrawn_at'-'withdrawn_by') then
      raise exception 'submitted_version_immutable' using errcode='23514';
    end if;
    if row(NEW.withdrawn_at,NEW.withdrawn_by) is distinct from row(OLD.withdrawn_at,OLD.withdrawn_by)
       and not (
         OLD.status='submitted' and NEW.status='withdrawn'
         and NEW.validity='obsolete'
         and OLD.withdrawn_at is null and OLD.withdrawn_by is null
         and NEW.withdrawn_at is not null and NEW.withdrawn_by is not null
       ) then
      raise exception 'submitted_version_immutable' using errcode='23514';
    end if;
  end if;
  if TG_OP='DELETE' then return OLD; end if;
  return NEW;
end;
$$;

create function dao_private.set_my_workspace(p_workspace text) returns text
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then
    raise exception using errcode='42501',message='authentication required';
  end if;
  if p_workspace not in ('client','contractor')
     or not exists(
       select 1 from public.user_roles
       where user_id=auth.uid() and role=p_workspace
     ) then
    raise exception using errcode='42501',message='workspace role required';
  end if;
  update public.profiles set last_workspace=p_workspace where user_id=auth.uid();
  if not found then raise exception using errcode='23503',message='profile required'; end if;
  return p_workspace;
end;
$$;

create function public.set_my_workspace(p_workspace text) returns text
language sql security invoker set search_path='' as $$
  select dao_private.set_my_workspace($1);
$$;

-- Identity, activity type and trades are the only professional changes that
-- restart DAO verification. A suspension can only be lifted by DAO staff.
create function dao_private.update_my_contractor_profile(
  p_business_name text,
  p_contractor_type text,
  p_public_trade_name text,
  p_public_presentation text,
  p_years_experience integer,
  p_availability text,
  p_available_from date,
  p_trade_ids uuid[]
) returns public.contractor_profiles
language plpgsql security definer set search_path='' as $$
declare
  v public.contractor_profiles;
  v_old_trades uuid[];
  v_new_trades uuid[];
  v_revalidate boolean;
  v_changed text[]:=array[]::text[];
begin
  if auth.uid() is null or not exists(
    select 1 from public.user_roles where user_id=auth.uid() and role='contractor'
  ) then raise exception using errcode='42501',message='contractor role required'; end if;

  select * into v from public.contractor_profiles where user_id=auth.uid() for update;
  if v.id is null then raise exception using errcode='23503',message='contractor profile required'; end if;
  if nullif(btrim(p_business_name),'') is null or char_length(btrim(p_business_name))>160
     or nullif(btrim(p_public_trade_name),'') is null or char_length(btrim(p_public_trade_name))>160
     or p_contractor_type not in ('artisan','company','general_contractor','independent_professional')
     or coalesce(char_length(p_public_presentation),0)>3000
     or p_years_experience is not null and p_years_experience not between 0 and 100
     or p_availability not in ('available','scheduled','unavailable','to_discuss')
     or (p_availability='scheduled') <> (p_available_from is not null)
  then raise exception using errcode='22023',message='invalid professional profile'; end if;
  if p_trade_ids is null or cardinality(p_trade_ids)=0 or cardinality(p_trade_ids)>20
     or cardinality(p_trade_ids)<>(select count(distinct x) from unnest(p_trade_ids) x)
     or exists(select 1 from unnest(p_trade_ids) x left join public.trades t on t.id=x and t.active where t.id is null)
  then raise exception using errcode='22023',message='active unique trades required'; end if;

  select coalesce(array_agg(trade_id order by trade_id),array[]::uuid[]) into v_old_trades
  from public.contractor_trades where contractor_id=v.id;
  select array_agg(x order by x) into v_new_trades from unnest(p_trade_ids) x;
  v_revalidate := v.business_name is distinct from btrim(p_business_name)
    or v.contractor_type is distinct from p_contractor_type
    or v.public_trade_name is distinct from btrim(p_public_trade_name)
    or v_old_trades is distinct from v_new_trades;
  if v.business_name is distinct from btrim(p_business_name) then v_changed:=array_append(v_changed,'business_name'); end if;
  if v.contractor_type is distinct from p_contractor_type then v_changed:=array_append(v_changed,'contractor_type'); end if;
  if v.public_trade_name is distinct from btrim(p_public_trade_name) then v_changed:=array_append(v_changed,'public_trade_name'); end if;
  if v.public_presentation is distinct from coalesce(p_public_presentation,'') then v_changed:=array_append(v_changed,'public_presentation'); end if;
  if v.years_experience is distinct from p_years_experience then v_changed:=array_append(v_changed,'years_experience'); end if;
  if v.availability is distinct from p_availability then v_changed:=array_append(v_changed,'availability'); end if;
  if v.available_from is distinct from p_available_from then v_changed:=array_append(v_changed,'available_from'); end if;
  if v_old_trades is distinct from v_new_trades then v_changed:=array_append(v_changed,'trades'); end if;

  update public.contractor_profiles set
    business_name=btrim(p_business_name), contractor_type=p_contractor_type,
    public_trade_name=btrim(p_public_trade_name), public_presentation=coalesce(p_public_presentation,''),
    years_experience=p_years_experience, availability=p_availability,
    available_from=p_available_from,
    verification_status=case
      when verification_status='suspended' then 'suspended'
      when v_revalidate then 'pending'
      else verification_status end
  where id=v.id returning * into v;

  delete from public.contractor_trades where contractor_id=v.id and not (trade_id=any(p_trade_ids));
  insert into public.contractor_trades(contractor_id,trade_id)
  select v.id,x from unnest(p_trade_ids) x on conflict(contractor_id,trade_id) do nothing;
  insert into public.audit_events(actor_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),'contractor_profile_updated','contractor_profile',v.id,
    jsonb_build_object('changed_fields',v_changed,'verification_restarted',v_revalidate and v.verification_status='pending'));
  return v;
end;
$$;

create function public.update_my_contractor_profile(
  p_business_name text,p_contractor_type text,p_public_trade_name text,
  p_public_presentation text,p_years_experience integer,p_availability text,
  p_available_from date,p_trade_ids uuid[]
) returns public.contractor_profiles
language sql security invoker set search_path='' as $$
  select dao_private.update_my_contractor_profile($1,$2,$3,$4,$5,$6,$7,$8);
$$;

create function dao_private.my_project_invitations() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_email text; v_result jsonb;
begin
  if v_actor is null then raise exception using errcode='42501',message='authentication required'; end if;
  select lower(email) into v_email from auth.users where id=v_actor and email_confirmed_at is not null;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',i.id,'project_id',i.project_id,'expected_role',i.expected_role,
    'recipient_name',i.recipient_name,'status',case when i.status='pending' and i.expires_at<=now() then 'expired' else i.status end,
    'created_at',i.created_at,'expires_at',i.expires_at,'project_title',coalesce(pv.title,'Chantier'),
    'principal_request_id',i.principal_request_id,'lot_title',rv.title
  ) order by i.created_at desc),'[]'::jsonb) into v_result
  from public.project_invitations i
  left join lateral(select title from public.project_versions where project_id=i.project_id order by version_no desc limit 1) pv on true
  left join public.project_requests pr on pr.id=i.principal_request_id and pr.project_id=i.project_id
  left join lateral(select title from public.project_request_versions where request_id=pr.id order by version_no desc limit 1) rv on true
  where (i.recipient_email=v_email or i.accepted_by=v_actor or i.declined_by=v_actor)
    and exists(select 1 from public.user_roles where user_id=v_actor and role=i.expected_role);
  return v_result;
end;
$$;

create function public.my_project_invitations() returns jsonb
language sql stable security invoker set search_path='' as $$ select dao_private.my_project_invitations(); $$;

create function dao_private.respond_my_project_invitation(p_invitation_id uuid,p_accept boolean) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  v public.project_invitations; p public.projects; v_actor uuid:=auth.uid();
  v_email text; v_member_id uuid;
begin
  if v_actor is null or p_accept is null then raise exception using errcode='42501',message='authentication required'; end if;
  select project_id into v.project_id from public.project_invitations where id=p_invitation_id;
  select * into p from public.projects where id=v.project_id for update;
  select * into v from public.project_invitations where id=p_invitation_id for update;
  if v.id is null or v.status<>'pending' or v.expires_at<=now() or p.status='archived' then
    raise exception using errcode='23514',message='invitation unavailable or expired';
  end if;
  if not exists(select 1 from public.user_roles where user_id=v_actor and role=v.expected_role) then
    raise exception using errcode='42501',message='account role does not match invitation';
  end if;
  select lower(email) into v_email from auth.users where id=v_actor and email_confirmed_at is not null;
  if v.recipient_email is null or v_email is distinct from v.recipient_email then
    raise exception using errcode='42501',message='invitation belongs to another email';
  end if;
  if v.expected_role='client' and v_actor=p.initiator_id then
    raise exception using errcode='42501',message='contractor initiator cannot confirm as client';
  end if;
  if not p_accept then
    update public.project_invitations set status='declined',declined_at=now(),declined_by=v_actor where id=v.id;
    insert into public.audit_events(actor_id,action,entity_type,entity_id,metadata)
    values(v_actor,'invitation_declined','project',p.id,jsonb_build_object('expected_role',v.expected_role,'principal_request_id',v.principal_request_id));
    return p.id;
  end if;
  if exists(select 1 from public.project_members where project_id=p.id and user_id=v_actor and status='accepted') then
    raise exception using errcode='23514',message='already a project member';
  end if;
  if v.expected_role='client' then
    if p.client_id is not null or p.project_origin<>'contractor_existing_client' then raise exception using errcode='23514',message='client already confirmed'; end if;
    update public.projects set client_id=v_actor,confirmed_by=v_actor,confirmed_at=now() where id=p.id;
  elsif not exists(select 1 from public.contractor_profiles where user_id=v_actor) then
    raise exception using errcode='42501',message='contractor profile required';
  end if;
  insert into public.project_members(project_id,user_id,participation_role,can_view_private_details)
  values(p.id,v_actor,v.expected_role,v.expected_role='client' or v.can_view_private_details)
  on conflict(project_id,user_id) do update set status='accepted',revoked_at=null,accepted_at=now(),can_view_private_details=excluded.can_view_private_details
  returning id into v_member_id;
  if v.expected_role='contractor' then
    if v.principal_request_id is null then raise exception using errcode='23514',message='contractor invitation has no principal lot'; end if;
    update public.project_requests set contractor_member_id=v_member_id
    where id=v.principal_request_id and project_id=p.id and status<>'withdrawn' and contractor_member_id is null;
    if not found then raise exception using errcode='23514',message='principal lot is unavailable'; end if;
  end if;
  update public.project_invitations set status='accepted',accepted_at=now(),accepted_by=v_actor where id=v.id;
  insert into public.audit_events(actor_id,action,entity_type,entity_id,metadata)
  values(v_actor,case when v.expected_role='client' then 'client_confirmed' else 'member_joined' end,'project',p.id,
    jsonb_build_object('expected_role',v.expected_role,'principal_request_id',v.principal_request_id));
  return p.id;
end;
$$;

create function public.respond_my_project_invitation(p_invitation_id uuid,p_accept boolean) returns uuid
language sql security invoker set search_path='' as $$ select dao_private.respond_my_project_invitation($1,$2); $$;

create function dao_private.my_bid_summaries() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_contractor uuid; v_result jsonb;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication required'; end if;
  select id into v_contractor from public.contractor_profiles where user_id=auth.uid();
  if v_contractor is null then raise exception using errcode='42501',message='contractor profile required'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',bv.id,'publication_id',bv.publication_id,'project_id',bv.project_id,'version_no',bv.version_no,
    'status',bv.status,'validity',bv.validity,'created_at',bv.created_at,'submitted_at',bv.submitted_at,
    'withdrawn_at',bv.withdrawn_at,'expires_at',bv.expires_at,'publication_title',coalesce(pub.safe_title,'DAO'),
    'publication_status',pub.status,'submission_deadline',pub.submission_deadline,
    'lot_count',(select count(*) from public.bid_items bi where bi.bid_version_id=bv.id),
    'total_millimes',(select coalesce(sum(bi.price_millimes),0) from public.bid_items bi where bi.bid_version_id=bv.id),
    'selected_count',(select count(*) from public.bid_items bi where bi.bid_version_id=bv.id and (select bir.status from public.bid_item_results bir where bir.bid_item_id=bi.id order by bir.id desc limit 1)='selected'),
    'not_selected_count',(select count(*) from public.bid_items bi where bi.bid_version_id=bv.id and (select bir.status from public.bid_item_results bir where bir.bid_item_id=bi.id order by bir.id desc limit 1)='not_selected')
  ) order by coalesce(bv.submitted_at,bv.created_at) desc),'[]'::jsonb) into v_result
  from public.bid_versions bv left join public.publications pub on pub.id=bv.publication_id
  where bv.contractor_id=v_contractor;
  return v_result;
end;
$$;

create function public.my_bid_summaries() returns jsonb
language sql stable security invoker set search_path='' as $$ select dao_private.my_bid_summaries(); $$;

create function dao_private.withdraw_bid_version(p_version_id uuid) returns public.bid_versions
language plpgsql security definer set search_path='' as $$
declare v public.bid_versions;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication required'; end if;
  perform 1 from public.projects where id=(select project_id from public.bid_versions where id=p_version_id) for update;
  select bv.* into v from public.bid_versions bv
  where bv.id=p_version_id and bv.status='submitted' and bv.validity='current'
    and dao_private.pro(bv.contractor_id)
    and exists(select 1 from public.user_roles where user_id=auth.uid() and role='contractor')
  for update;
  if v.id is null then raise exception using errcode='42501',message='owned submitted offer required'; end if;
  if exists(select 1 from public.bid_items bi join public.award_items ai on ai.bid_item_id=bi.id and ai.active where bi.bid_version_id=v.id) then
    raise exception using errcode='23514',message='awarded offer cannot be withdrawn';
  end if;
  update public.bid_versions set status='withdrawn',validity='obsolete',withdrawn_at=now(),withdrawn_by=auth.uid()
  where id=v.id returning * into v;
  insert into public.audit_events(actor_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),'bid_withdrawn','bid_version',v.id,jsonb_build_object('project_id',v.project_id,'publication_id',v.publication_id,'version_no',v.version_no));
  return v;
end;
$$;

create function public.withdraw_bid_version(p_version_id uuid) returns public.bid_versions
language sql security invoker set search_path='' as $$ select dao_private.withdraw_bid_version($1); $$;

revoke all on function dao_private.set_my_workspace(text),dao_private.update_my_contractor_profile(text,text,text,text,integer,text,date,uuid[]),
  dao_private.my_project_invitations(),dao_private.respond_my_project_invitation(uuid,boolean),
  dao_private.my_bid_summaries(),dao_private.withdraw_bid_version(uuid) from public,anon,authenticated;
grant execute on function dao_private.set_my_workspace(text),dao_private.update_my_contractor_profile(text,text,text,text,integer,text,date,uuid[]),
  dao_private.my_project_invitations(),dao_private.respond_my_project_invitation(uuid,boolean),
  dao_private.my_bid_summaries(),dao_private.withdraw_bid_version(uuid) to authenticated,service_role;
revoke all on function public.set_my_workspace(text),public.update_my_contractor_profile(text,text,text,text,integer,text,date,uuid[]),
  public.my_project_invitations(),public.respond_my_project_invitation(uuid,boolean),
  public.my_bid_summaries(),public.withdraw_bid_version(uuid) from public,anon,authenticated;
grant execute on function public.set_my_workspace(text),public.update_my_contractor_profile(text,text,text,text,integer,text,date,uuid[]),
  public.my_project_invitations(),public.respond_my_project_invitation(uuid,boolean),
  public.my_bid_summaries(),public.withdraw_bid_version(uuid) to authenticated,service_role;

notify pgrst, 'reload schema';
commit;
