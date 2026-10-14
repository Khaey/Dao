-- Project-context permissions: only the real Client may assign participating contractors to lots.
-- A contractor initiator keeps existing preparation/invitation rights, not client assignment.
-- Messaging must never create/return a conversation where sender and recipient are the same user.
begin;
create or replace function dao_private.assign_project_request_member(p_request_id uuid,p_member_id uuid) returns public.project_requests
language plpgsql security definer set search_path='' as $$
declare v public.project_requests; v_project_id uuid;
begin
  select project_id into v_project_id from public.project_requests where id=p_request_id;
  perform 1 from public.projects where id=v_project_id for update;
  select * into v from public.project_requests where id=p_request_id for update;
  if auth.uid() is null or v.id is null or not dao_private.owner(v.project_id) then
    raise exception using errcode='42501',message='Attribution du lot réservée au Client responsable';
  end if;
  if v.status='withdrawn' or exists(select 1 from public.projects where id=v.project_id and status='archived') then
    raise exception using errcode='23514',message='lot is unavailable';
  end if;
  if p_member_id is not null and not exists(select 1 from public.project_members
    where id=p_member_id and project_id=v.project_id and participation_role='contractor' and status='accepted') then
    raise exception using errcode='23514',message='accepted contractor from this project required';
  end if;
  update public.project_requests set contractor_member_id=p_member_id where id=v.id returning * into v;
  insert into public.audit_events(actor_id,action,entity_type,entity_id)
  values(auth.uid(),'lot_participant_updated','project',v.project_id);
  return v;
end;
$$;

create or replace function dao_private.messaging_pair(p_project_id uuid,p_contractor_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1
    from public.projects p
    join public.contractor_profiles cp on cp.id=p_contractor_id
    join public.project_members client_member on client_member.project_id=p.id
      and client_member.user_id=p.client_id and client_member.participation_role='client'
      and client_member.status='accepted'
    join public.project_members contractor_member on contractor_member.project_id=p.id
      and contractor_member.user_id=cp.user_id and contractor_member.participation_role='contractor'
      and contractor_member.status='accepted'
    where p.id=p_project_id and p.client_id is not null and p.confirmed_at is not null
      and p.client_id<>cp.user_id
      and p.status<>'archived' and cp.verification_status<>'suspended'
      and dao_private.account_active(p.client_id) and dao_private.account_active(cp.user_id)
  );
$$;
commit;
