begin;

alter table public.project_requests
  add constraint project_requests_id_project_unique unique(id,project_id);

alter table public.project_invitations
  add column principal_request_id uuid,
  add constraint project_invitation_principal_request_fk
    foreign key(principal_request_id,project_id)
    references public.project_requests(id,project_id),
  add constraint project_invitation_contractor_requires_lot
    check (
      (expected_role='client' and principal_request_id is null)
      or (expected_role='contractor' and principal_request_id is not null)
    ) not valid;

create unique index project_one_pending_invitation_per_lot_idx
  on public.project_invitations(principal_request_id)
  where expected_role='contractor' and status='pending' and principal_request_id is not null;

create function dao_private.issue_project_invitation(
  p_project_id uuid,
  p_expected_role text,
  p_recipient_email text,
  p_recipient_name text,
  p_principal_request_id uuid,
  p_can_view_private_details boolean
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_project public.projects;
  v_request public.project_requests;
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
    if p_principal_request_id is not null then
      raise exception using errcode='22023',message='client invitation cannot target a lot';
    end if;
    if v_project.client_id is not null or not dao_private.contractor_initiator(p_project_id) then
      raise exception using errcode='42501',message='pending client invitation requires contractor initiator';
    end if;
  else
    if not dao_private.owner(p_project_id) then
      raise exception using errcode='42501',message='only the client can invite contractors';
    end if;
    if p_principal_request_id is null then
      raise exception using errcode='23514',message='contractor invitation requires a principal lot';
    end if;

    select * into v_request
    from public.project_requests
    where id=p_principal_request_id and project_id=p_project_id
    for update;

    if v_request.id is null or v_request.status='withdrawn' then
      raise exception using errcode='23514',message='principal lot is unavailable';
    end if;
    if v_request.contractor_member_id is not null then
      raise exception using errcode='23514',message='principal lot already has a contractor';
    end if;

    update public.project_invitations
    set status='expired'
    where project_id=p_project_id and status='pending' and expires_at<=now();

    if exists(
      select 1 from public.project_invitations
      where principal_request_id=p_principal_request_id
        and expected_role='contractor'
        and status='pending'
    ) then
      raise exception using errcode='23514',message='principal lot already has a pending invitation';
    end if;
  end if;

  v_email:=nullif(lower(btrim(p_recipient_email)),'');
  if v_email is not null and v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception using errcode='22023',message='invalid recipient email';
  end if;

  v_name:=nullif(btrim(p_recipient_name),'');
  if v_name is not null and char_length(v_name)>160 then
    raise exception using errcode='22023',message='invalid recipient name';
  end if;

  update public.project_invitations
  set status='expired'
  where project_id=p_project_id and status='pending' and expires_at<=now();

  v_token:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');

  insert into public.project_invitations(
    project_id,created_by,expected_role,recipient_email,recipient_name,principal_request_id,
    token_hash,expires_at,can_view_private_details
  )
  values(
    p_project_id,auth.uid(),p_expected_role,v_email,v_name,p_principal_request_id,
    encode(sha256(convert_to(v_token,'UTF8')),'hex'),now()+interval '7 days',
    p_expected_role='client' or coalesce(p_can_view_private_details,false)
  )
  returning * into v;

  insert into public.audit_events(actor_id,action,entity_type,entity_id,metadata)
  values(
    auth.uid(),'invitation_created','project',p_project_id,
    jsonb_build_object('expected_role',p_expected_role,'principal_request_id',p_principal_request_id)
  );

  return jsonb_build_object(
    'id',v.id,
    'token',v_token,
    'expires_at',v.expires_at,
    'expected_role',v.expected_role,
    'principal_request_id',v.principal_request_id
  );
end;
$$;

create or replace function dao_private.issue_project_invitation(
  p_project_id uuid,
  p_expected_role text,
  p_recipient_email text,
  p_recipient_name text,
  p_can_view_private_details boolean
) returns jsonb
language sql
security definer
set search_path=''
as $$
  select dao_private.issue_project_invitation($1,$2,$3,$4,null,$5);
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
  select dao_private.issue_project_invitation($1,$2,$3,null,null,$4);
$$;

create or replace function public.issue_project_invitation(
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
  select dao_private.issue_project_invitation($1,$2,$3,$4,null,$5);
$$;

create function public.issue_project_invitation(
  p_project_id uuid,
  p_expected_role text,
  p_recipient_email text,
  p_recipient_name text,
  p_principal_request_id uuid,
  p_can_view_private_details boolean
) returns jsonb
language sql
security invoker
set search_path=''
as $$
  select dao_private.issue_project_invitation($1,$2,$3,$4,$5,$6);
$$;

revoke all on function dao_private.issue_project_invitation(uuid,text,text,text,uuid,boolean) from public,anon,authenticated;
grant execute on function dao_private.issue_project_invitation(uuid,text,text,text,uuid,boolean) to authenticated,service_role;
revoke all on function public.issue_project_invitation(uuid,text,text,text,uuid,boolean) from public,anon,authenticated;
grant execute on function public.issue_project_invitation(uuid,text,text,text,uuid,boolean) to authenticated,service_role;

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
    jsonb_agg(
      jsonb_build_object(
        'id',q.id,
        'title',r.title,
        'scope',r.scope,
        'budget_millimes',r.budget_millimes
      )
      order by r.title
    ),
    '[]'::jsonb
  )
  into v_lots
  from public.project_requests q
  join lateral (
    select title,scope,budget_millimes
    from public.project_request_versions
    where request_id=q.id
    order by version_no desc
    limit 1
  ) r on true
  where q.project_id=p.id
    and q.status<>'withdrawn'
    and (v.principal_request_id is null or q.id=v.principal_request_id);

  return jsonb_build_object(
    'project_id',p.id,
    'title',pv.title,
    'description',pv.description,
    'inviter_name',v_name,
    'location',v_location,
    'expected_role',v.expected_role,
    'principal_request_id',v.principal_request_id,
    'project_stage',p.project_stage,
    'payment_status',p.payment_status,
    'lots',v_lots
  );
end;
$$;

create or replace function dao_private.respond_project_invitation(p_token text,p_accept boolean) returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v public.project_invitations;
  p public.projects;
  v_id uuid;
  v_actor uuid:=auth.uid();
  v_email text;
  v_member_id uuid;
begin
  if v_actor is null then
    raise exception using errcode='42501',message='authentication required';
  end if;
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' or p_accept is null then
    raise exception using errcode='22023',message='invalid invitation';
  end if;

  select project_id into v_id
  from public.project_invitations
  where token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');

  select * into p from public.projects where id=v_id for update;
  select * into v from public.project_invitations
  where token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex')
  for update;

  if v.id is null or v.status<>'pending' or v.expires_at<=now() or p.status='archived' then
    raise exception using errcode='23514',message='invitation unavailable or expired';
  end if;

  if not exists(
    select 1 from public.user_roles where user_id=v_actor and role=v.expected_role
  ) then
    raise exception using errcode='42501',message='account role does not match invitation';
  end if;

  if v.expected_role='client' and v_actor=p.initiator_id then
    raise exception using errcode='42501',message='contractor initiator cannot confirm as client';
  end if;

  if v.recipient_email is not null then
    select lower(email) into v_email
    from auth.users
    where id=v_actor and email_confirmed_at is not null;
    if v_email is distinct from v.recipient_email then
      raise exception using errcode='42501',message='invitation belongs to another email';
    end if;
  end if;

  if not p_accept then
    update public.project_invitations
    set status='declined',declined_at=now(),declined_by=v_actor
    where id=v.id;
    insert into public.audit_events(actor_id,action,entity_type,entity_id,metadata)
    values(
      v_actor,'invitation_declined','project',p.id,
      jsonb_build_object('expected_role',v.expected_role,'principal_request_id',v.principal_request_id)
    );
    return p.id;
  end if;

  if exists(
    select 1 from public.project_members
    where project_id=p.id and user_id=v_actor and status='accepted'
  ) then
    raise exception using errcode='23514',message='already a project member';
  end if;

  if v.expected_role='client' then
    if p.client_id is not null or p.project_origin<>'contractor_existing_client' then
      raise exception using errcode='23514',message='client already confirmed';
    end if;
    update public.projects
    set client_id=v_actor,confirmed_by=v_actor,confirmed_at=now()
    where id=p.id;
  elsif not exists(
    select 1 from public.contractor_profiles where user_id=v_actor
  ) then
    raise exception using errcode='42501',message='contractor profile required';
  end if;

  insert into public.project_members(
    project_id,user_id,participation_role,can_view_private_details
  )
  values(
    p.id,v_actor,v.expected_role,
    v.expected_role='client' or v.can_view_private_details
  )
  on conflict(project_id,user_id) do update
    set status='accepted',revoked_at=null,accepted_at=now(),
        can_view_private_details=excluded.can_view_private_details
  returning id into v_member_id;

  if v.expected_role='contractor' then
    if v.principal_request_id is null then
      raise exception using errcode='23514',message='contractor invitation has no principal lot';
    end if;

    update public.project_requests
    set contractor_member_id=v_member_id
    where id=v.principal_request_id
      and project_id=p.id
      and status<>'withdrawn'
      and contractor_member_id is null;

    if not found then
      raise exception using errcode='23514',message='principal lot is unavailable';
    end if;
  end if;

  update public.project_invitations
  set status='accepted',accepted_at=now(),accepted_by=v_actor
  where id=v.id;

  insert into public.audit_events(actor_id,action,entity_type,entity_id,metadata)
  values(
    v_actor,
    case when v.expected_role='client' then 'client_confirmed' else 'member_joined' end,
    'project',
    p.id,
    jsonb_build_object(
      'expected_role',v.expected_role,
      'principal_request_id',v.principal_request_id
    )
  );

  return p.id;
end;
$$;

create or replace function dao_private.project_team(p_project_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_members jsonb;
  v_invitations jsonb:='[]'::jsonb;
  v_events jsonb;
begin
  if not dao_private.can_view_project(p_project_id) then
    raise exception using errcode='42501',message='project participation required';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',m.id,
        'user_id',m.user_id,
        'participation_role',m.participation_role,
        'status',m.status,
        'can_view_private_details',m.can_view_private_details,
        'name',coalesce(c.business_name,pr.display_name,'Participant D.A.O')
      )
      order by m.accepted_at
    ),
    '[]'::jsonb
  )
  into v_members
  from public.project_members m
  left join public.contractor_profiles c
    on c.user_id=m.user_id and m.participation_role='contractor'
  left join public.profiles pr on pr.user_id=m.user_id
  where m.project_id=p_project_id;

  if dao_private.can_prepare_project(p_project_id) then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id',i.id,
          'expected_role',i.expected_role,
          'recipient_email',i.recipient_email,
          'recipient_name',i.recipient_name,
          'principal_request_id',i.principal_request_id,
          'status',case when i.status='pending' and i.expires_at<=now() then 'expired' else i.status end,
          'expires_at',i.expires_at
        )
        order by i.created_at desc
      ),
      '[]'::jsonb
    )
    into v_invitations
    from public.project_invitations i
    where i.project_id=p_project_id;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object('id',id,'action',action,'created_at',created_at)
      order by created_at desc
    ),
    '[]'::jsonb
  )
  into v_events
  from public.audit_events
  where entity_type='project'
    and entity_id=p_project_id
    and action in (
      'project_created','client_confirmed','member_joined','member_revoked',
      'invitation_created','invitation_declined','invitation_revoked',
      'tracking_updated','lot_participant_updated','private_permission_updated'
    );

  return jsonb_build_object(
    'members',v_members,
    'invitations',v_invitations,
    'events',v_events,
    'is_client',dao_private.owner(p_project_id),
    'can_prepare',dao_private.can_prepare_project(p_project_id),
    'can_view_private_details',dao_private.can_view_project_private_details(p_project_id)
  );
end;
$$;

create function dao_private.create_client_existing_team_project(
  p_title text,
  p_description text,
  p_governorate_id uuid,
  p_delegation_id uuid,
  p_locality_id uuid,
  p_stage text,
  p_payment_status text,
  p_team jsonb
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_project public.projects;
  v_item jsonb;
  v_request public.project_requests;
  v_invitation jsonb;
  v_invitations jsonb:='[]'::jsonb;
  v_name text;
  v_email text;
  v_lot_title text;
  v_trade_id uuid;
  v_budget bigint;
begin
  if auth.uid() is null then
    raise exception using errcode='42501',message='authentication required';
  end if;
  if not exists(
    select 1 from public.user_roles where user_id=auth.uid() and role='client'
  ) then
    raise exception using errcode='42501',message='client account required';
  end if;
  if jsonb_typeof(p_team)<>'array'
     or jsonb_array_length(p_team)<1
     or jsonb_array_length(p_team)>20 then
    raise exception using errcode='22023',message='between 1 and 20 artisans are required';
  end if;

  if exists(
    select 1
    from (
      select lower(btrim(value->>'recipient_email')) email
      from jsonb_array_elements(p_team)
    ) x
    group by email
    having email='' or email is null or count(*)>1
  ) then
    raise exception using errcode='22023',message='each artisan requires a unique email';
  end if;

  select dao_private.create_collaborative_project(
    'client_existing_team',
    p_title,
    p_description,
    p_governorate_id,
    p_delegation_id,
    p_locality_id,
    p_stage,
    p_payment_status
  )
  into v_project;

  for v_item in select value from jsonb_array_elements(p_team)
  loop
    v_name:=nullif(btrim(v_item->>'recipient_name'),'');
    v_email:=nullif(lower(btrim(v_item->>'recipient_email')),'');
    v_lot_title:=nullif(btrim(v_item->>'lot_title'),'');
    v_trade_id:=nullif(v_item->>'trade_id','')::uuid;
    v_budget:=nullif(v_item->>'budget_millimes','')::bigint;

    if v_name is null or char_length(v_name)>160 then
      raise exception using errcode='22023',message='artisan name is required';
    end if;
    if v_email is null or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
      raise exception using errcode='22023',message='artisan email is required';
    end if;
    if v_lot_title is null or char_length(v_lot_title)>200 then
      raise exception using errcode='22023',message='lot title is required';
    end if;
    if v_trade_id is null or not exists(
      select 1 from public.trades where id=v_trade_id and active=true
    ) then
      raise exception using errcode='22023',message='active trade is required';
    end if;
    if v_budget is not null and v_budget<0 then
      raise exception using errcode='22023',message='lot budget cannot be negative';
    end if;

    select dao_private.add_project_request(
      v_project.id,
      v_trade_id,
      v_lot_title,
      v_lot_title,
      v_budget
    )
    into v_request;

    v_invitation:=dao_private.issue_project_invitation(
      v_project.id,
      'contractor',
      v_email,
      v_name,
      v_request.id,
      coalesce((v_item->>'can_view_private_details')::boolean,false)
    );

    v_invitations:=v_invitations || jsonb_build_array(
      v_invitation || jsonb_build_object(
        'request_id',v_request.id,
        'recipient_name',v_name,
        'recipient_email',v_email,
        'lot_title',v_lot_title
      )
    );
  end loop;

  return jsonb_build_object(
    'id',v_project.id,
    'invitations',v_invitations
  );
end;
$$;

create function public.create_client_existing_team_project(
  p_title text,
  p_description text,
  p_governorate_id uuid,
  p_delegation_id uuid,
  p_locality_id uuid,
  p_stage text,
  p_payment_status text,
  p_team jsonb
) returns jsonb
language sql
security invoker
set search_path=''
as $$
  select dao_private.create_client_existing_team_project($1,$2,$3,$4,$5,$6,$7,$8);
$$;

revoke all on function dao_private.create_client_existing_team_project(text,text,uuid,uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function dao_private.create_client_existing_team_project(text,text,uuid,uuid,uuid,text,text,jsonb) to authenticated,service_role;
revoke all on function public.create_client_existing_team_project(text,text,uuid,uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.create_client_existing_team_project(text,text,uuid,uuid,uuid,text,text,jsonb) to authenticated,service_role;

grant select(principal_request_id) on public.project_invitations to authenticated;

notify pgrst, 'reload schema';
commit;
