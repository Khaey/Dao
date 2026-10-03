begin;

alter table public.project_invitations
  add column recipient_name text
  check (recipient_name is null or char_length(btrim(recipient_name)) between 1 and 160);

create function dao_private.issue_project_invitation(
  p_project_id uuid,
  p_expected_role text,
  p_recipient_email text,
  p_recipient_name text,
  p_can_view_private_details boolean
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_project public.projects;
  v public.project_invitations;
  v_token text;
  v_email text;
  v_name text;
begin
  if auth.uid() is null then
    raise exception using errcode='42501',message='authentication required';
  end if;
  select * into v_project from public.projects where id=p_project_id for update;
  if v_project.id is null or not dao_private.can_prepare_project(p_project_id) then
    raise exception using errcode='42501',message='project management required';
  end if;
  if p_expected_role is null or p_expected_role not in ('client','contractor') then
    raise exception using errcode='22023',message='invalid invitation role';
  end if;
  if v_project.status='archived' then
    raise exception using errcode='23514',message='project is archived';
  end if;
  if p_expected_role='client' then
    if v_project.client_id is not null or not dao_private.contractor_initiator(p_project_id) then
      raise exception using errcode='42501',message='pending client invitation requires contractor initiator';
    end if;
  elsif not dao_private.owner(p_project_id) then
    raise exception using errcode='42501',message='only the client can invite contractors';
  end if;

  v_email:=nullif(lower(btrim(p_recipient_email)),'');
  if v_email is not null and v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception using errcode='22023',message='invalid recipient email';
  end if;
  v_name:=nullif(btrim(p_recipient_name),'');
  if v_name is not null and char_length(v_name)>160 then
    raise exception using errcode='22023',message='invalid recipient name';
  end if;

  update public.project_invitations set status='expired'
    where project_id=p_project_id and status='pending' and expires_at<=now();

  v_token:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
  insert into public.project_invitations(
    project_id,created_by,expected_role,recipient_email,recipient_name,
    token_hash,expires_at,can_view_private_details
  )
  values(
    p_project_id,auth.uid(),p_expected_role,v_email,v_name,
    encode(sha256(convert_to(v_token,'UTF8')),'hex'),now()+interval '7 days',
    p_expected_role='client' or coalesce(p_can_view_private_details,false)
  )
  returning * into v;

  insert into public.audit_events(actor_id,action,entity_type,entity_id,metadata)
  values(
    auth.uid(),'invitation_created','project',p_project_id,
    jsonb_build_object('expected_role',p_expected_role)
  );

  return jsonb_build_object(
    'id',v.id,
    'token',v_token,
    'expires_at',v.expires_at,
    'expected_role',v.expected_role
  );
end;
$$;

create or replace function dao_private.issue_project_invitation(
  p_project_id uuid,
  p_expected_role text,
  p_recipient_email text,
  p_can_view_private_details boolean
) returns jsonb
language sql
security definer
set search_path=''
as $$
  select dao_private.issue_project_invitation($1,$2,$3,null,$4);
$$;

create function public.issue_project_invitation(
  p_project_id uuid,
  p_expected_role text,
  p_recipient_email text,
  p_recipient_name text,
  p_can_view_private_details boolean
) returns jsonb
language sql
security invoker
set search_path=''
as $$
  select dao_private.issue_project_invitation($1,$2,$3,$4,$5);
$$;

revoke all on function dao_private.issue_project_invitation(uuid,text,text,text,boolean) from public,anon,authenticated;
grant execute on function dao_private.issue_project_invitation(uuid,text,text,text,boolean) to authenticated,service_role;
revoke all on function public.issue_project_invitation(uuid,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.issue_project_invitation(uuid,text,text,text,boolean) to authenticated,service_role;

create or replace function dao_private.preview_project_invitation(p_token text) returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v public.project_invitations;
  p public.projects;
  pv public.project_versions;
  v_name text;
  v_location text;
  v_lots jsonb;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then return null; end if;

  select * into v
  from public.project_invitations
  where token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex')
    and status='pending'
    and expires_at>now();

  if v.id is null then return null; end if;

  select * into p from public.projects where id=v.project_id;
  if p.status='archived' then return null; end if;

  select * into pv
  from public.project_versions
  where project_id=p.id
  order by version_no desc
  limit 1;

  select coalesce(c.business_name,pr.display_name,'Participant D.A.O') into v_name
  from auth.users u
  left join public.contractor_profiles c on c.user_id=u.id
  left join public.profiles pr on pr.user_id=u.id
  where u.id=v.created_by;

  select concat_ws(' · ',g.name_fr,d.name_fr,l.name_fr) into v_location
  from public.governorates g
  left join public.delegations d on d.id=pv.delegation_id
  left join public.localities l on l.id=pv.locality_id
  where g.id=pv.governorate_id;

  select coalesce(
    jsonb_agg(jsonb_build_object('title',r.title,'scope',r.scope) order by r.title),
    '[]'::jsonb
  )
  into v_lots
  from public.project_requests q
  join lateral (
    select title,scope
    from public.project_request_versions
    where request_id=q.id
    order by version_no desc
    limit 1
  ) r on true
  where q.project_id=p.id and q.status<>'withdrawn';

  return jsonb_build_object(
    'project_id',p.id,
    'title',pv.title,
    'description',pv.description,
    'inviter_name',v_name,
    'location',v_location,
    'expected_role',v.expected_role,
    'recipient_email',v.recipient_email,
    'recipient_name',v.recipient_name,
    'project_stage',p.project_stage,
    'payment_status',p.payment_status,
    'lots',v_lots
  );
end;
$$;

grant select(recipient_name) on public.project_invitations to authenticated;

notify pgrst, 'reload schema';
commit;
