begin;

create function dao_private.create_collaborative_project(
  p_origin text,p_title text,p_description text,p_governorate_id uuid,
  p_delegation_id uuid,p_locality_id uuid,p_stage text,p_payment_status text
) returns public.projects language plpgsql security definer set search_path='' as $$
declare v public.projects; v_actor uuid:=auth.uid();
begin
  if v_actor is null then raise exception using errcode='42501',message='authentication required'; end if;
  if p_origin is null or p_origin not in ('client_existing_team','contractor_existing_client') then
    raise exception using errcode='22023',message='invalid project origin';
  end if;
  if not exists(select 1 from public.user_roles where user_id=v_actor
    and role=case when p_origin='client_existing_team' then 'client' else 'contractor' end) then
    raise exception using errcode='42501',message='account role does not match project origin';
  end if;
  if nullif(btrim(p_title),'') is null or p_governorate_id is null then
    raise exception using errcode='22023',message='title and governorate are required';
  end if;
  insert into public.projects(initiator_id,client_id,project_origin,project_stage,payment_status)
  values(v_actor,case when p_origin='client_existing_team' then v_actor else null end,
    p_origin,p_stage,p_payment_status) returning * into v;
  insert into public.project_versions(project_id,version_no,title,description,governorate_id,delegation_id,locality_id)
  values(v.id,1,btrim(p_title),coalesce(p_description,''),p_governorate_id,p_delegation_id,p_locality_id);
  insert into public.audit_events(actor_id,action,entity_type,entity_id)
  values(v_actor,'project_created','project',v.id);
  return v;
end;
$$;

create function dao_private.issue_project_invitation(
  p_project_id uuid,p_expected_role text,p_recipient_email text,p_can_view_private_details boolean
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_project public.projects; v public.project_invitations; v_token text; v_email text;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication required'; end if;
  select * into v_project from public.projects where id=p_project_id for update;
  if v_project.id is null or not dao_private.can_prepare_project(p_project_id) then
    raise exception using errcode='42501',message='project management required';
  end if;
  if p_expected_role is null or p_expected_role not in ('client','contractor') then
    raise exception using errcode='22023',message='invalid invitation role';
  end if;
  if v_project.status='archived' then raise exception using errcode='23514',message='project is archived'; end if;
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
  update public.project_invitations set status='expired'
    where project_id=p_project_id and status='pending' and expires_at<=now();
  -- UUID v4 uses PostgreSQL's cryptographic generator. Two UUIDs provide
  -- 244 random bits; only SHA-256 of the opaque token is stored.
  v_token:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
  insert into public.project_invitations(project_id,created_by,expected_role,recipient_email,
    token_hash,expires_at,can_view_private_details)
  values(p_project_id,auth.uid(),p_expected_role,v_email,
    encode(sha256(convert_to(v_token,'UTF8')),'hex'),now()+interval '7 days',
    p_expected_role='client' or coalesce(p_can_view_private_details,false)) returning * into v;
  insert into public.audit_events(actor_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),'invitation_created','project',p_project_id,jsonb_build_object('expected_role',p_expected_role));
  return jsonb_build_object('id',v.id,'token',v_token,'expires_at',v.expires_at,'expected_role',v.expected_role);
end;
$$;

create function dao_private.preview_project_invitation(p_token text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v public.project_invitations; p public.projects; pv public.project_versions;
  v_name text; v_location text; v_lots jsonb;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then return null; end if;
  select * into v from public.project_invitations
  where token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex')
    and status='pending' and expires_at>now();
  if v.id is null then return null; end if;
  select * into p from public.projects where id=v.project_id;
  if p.status='archived' then return null; end if;
  select * into pv from public.project_versions where project_id=p.id order by version_no desc limit 1;
  select coalesce(c.business_name,pr.display_name,'Participant D.A.O') into v_name
  from auth.users u left join public.contractor_profiles c on c.user_id=u.id
  left join public.profiles pr on pr.user_id=u.id where u.id=v.created_by;
  select concat_ws(' · ',g.name_fr,d.name_fr,l.name_fr) into v_location
  from public.governorates g left join public.delegations d on d.id=pv.delegation_id
  left join public.localities l on l.id=pv.locality_id where g.id=pv.governorate_id;
  select coalesce(jsonb_agg(jsonb_build_object('title',r.title,'scope',r.scope) order by r.title),'[]'::jsonb)
  into v_lots from public.project_requests q join lateral (
    select title,scope from public.project_request_versions where request_id=q.id order by version_no desc limit 1
  ) r on true where q.project_id=p.id and q.status<>'withdrawn';
  return jsonb_build_object('project_id',p.id,'title',pv.title,'description',pv.description,
    'inviter_name',v_name,'location',v_location,'expected_role',v.expected_role,
    'project_stage',p.project_stage,'payment_status',p.payment_status,'lots',v_lots);
end;
$$;

-- Every invitation mutation locks PROJECT then INVITATION. Resolving the hash
-- first does not authorize anything; all checks repeat after acquiring locks.
create function dao_private.respond_project_invitation(p_token text,p_accept boolean) returns uuid
language plpgsql security definer set search_path='' as $$
declare v public.project_invitations; p public.projects; v_id uuid; v_actor uuid:=auth.uid(); v_email text;
begin
  if v_actor is null then raise exception using errcode='42501',message='authentication required'; end if;
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' or p_accept is null then
    raise exception using errcode='22023',message='invalid invitation';
  end if;
  select project_id into v_id from public.project_invitations
    where token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');
  select * into p from public.projects where id=v_id for update;
  select * into v from public.project_invitations
    where token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') for update;
  if v.id is null or v.status<>'pending' or v.expires_at<=now() or p.status='archived' then
    raise exception using errcode='23514',message='invitation unavailable or expired';
  end if;
  if not exists(select 1 from public.user_roles where user_id=v_actor and role=v.expected_role) then
    raise exception using errcode='42501',message='account role does not match invitation';
  end if;
  if v.expected_role='client' and v_actor=p.initiator_id then
    raise exception using errcode='42501',message='contractor initiator cannot confirm as client';
  end if;
  if v.recipient_email is not null then
    select lower(email) into v_email from auth.users where id=v_actor and email_confirmed_at is not null;
    if v_email is distinct from v.recipient_email then
      raise exception using errcode='42501',message='invitation belongs to another email';
    end if;
  end if;
  if not p_accept then
    update public.project_invitations set status='declined',declined_at=now(),declined_by=v_actor where id=v.id;
    insert into public.audit_events(actor_id,action,entity_type,entity_id,metadata)
    values(v_actor,'invitation_declined','project',p.id,jsonb_build_object('expected_role',v.expected_role));
    return p.id;
  end if;
  if exists(select 1 from public.project_members where project_id=p.id and user_id=v_actor and status='accepted') then
    raise exception using errcode='23514',message='already a project member';
  end if;
  if v.expected_role='client' then
    if p.client_id is not null or p.project_origin<>'contractor_existing_client' then
      raise exception using errcode='23514',message='client already confirmed';
    end if;
    update public.projects set client_id=v_actor,confirmed_by=v_actor,confirmed_at=now() where id=p.id;
  elsif not exists(select 1 from public.contractor_profiles where user_id=v_actor) then
    raise exception using errcode='42501',message='contractor profile required';
  end if;
  insert into public.project_members(project_id,user_id,participation_role,can_view_private_details)
  values(p.id,v_actor,v.expected_role,v.expected_role='client' or v.can_view_private_details)
  on conflict(project_id,user_id) do update set status='accepted',revoked_at=null,
    accepted_at=now(),can_view_private_details=excluded.can_view_private_details;
  update public.project_invitations set status='accepted',accepted_at=now(),accepted_by=v_actor where id=v.id;
  insert into public.audit_events(actor_id,action,entity_type,entity_id,metadata)
  values(v_actor,case when v.expected_role='client' then 'client_confirmed' else 'member_joined' end,
    'project',p.id,jsonb_build_object('expected_role',v.expected_role));
  return p.id;
end;
$$;

create function dao_private.revoke_project_invitation(p_invitation_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare v public.project_invitations; v_project_id uuid;
begin
  select project_id into v_project_id from public.project_invitations where id=p_invitation_id;
  perform 1 from public.projects where id=v_project_id for update;
  select * into v from public.project_invitations where id=p_invitation_id for update;
  if auth.uid() is null or v.id is null or not dao_private.can_prepare_project(v.project_id)
     or (not dao_private.owner(v.project_id) and v.created_by<>auth.uid()) then
    raise exception using errcode='42501',message='invitation management required';
  end if;
  if v.status<>'pending' then raise exception using errcode='23514',message='invitation is not pending'; end if;
  update public.project_invitations set status='revoked',revoked_at=now(),revoked_by=auth.uid() where id=v.id;
  insert into public.audit_events(actor_id,action,entity_type,entity_id)
  values(auth.uid(),'invitation_revoked','project',v.project_id);
  return v.project_id;
end;
$$;

create function dao_private.update_project_member(p_member_id uuid,p_revoke boolean,p_can_view_private_details boolean) returns public.project_members
language plpgsql security definer set search_path='' as $$
declare v public.project_members; v_project_id uuid;
begin
  select project_id into v_project_id from public.project_members where id=p_member_id;
  perform 1 from public.projects where id=v_project_id for update;
  select * into v from public.project_members where id=p_member_id for update;
  if auth.uid() is null or v.id is null or not dao_private.owner(v.project_id) then
    raise exception using errcode='42501',message='client membership management required';
  end if;
  if v.participation_role<>'contractor' or v.status<>'accepted' then
    raise exception using errcode='23514',message='accepted contractor member required';
  end if;
  if p_revoke then
    update public.project_members set status='revoked',revoked_at=now() where id=v.id returning * into v;
    update public.project_requests set contractor_member_id=null where contractor_member_id=v.id;
    update public.document_grants set revoked_at=now()
      where user_id=v.user_id and revoked_at is null and document_id in (
        select id from public.documents where project_id=v.project_id);
  else
    if p_can_view_private_details is null then raise exception using errcode='22023',message='explicit permission required'; end if;
    update public.project_members set can_view_private_details=p_can_view_private_details where id=v.id returning * into v;
  end if;
  insert into public.audit_events(actor_id,action,entity_type,entity_id)
  values(auth.uid(),case when p_revoke then 'member_revoked' else 'private_permission_updated' end,'project',v.project_id);
  return v;
end;
$$;

create function dao_private.update_project_tracking(p_project_id uuid,p_stage text,p_payment_status text) returns public.projects
language plpgsql security definer set search_path='' as $$
declare v public.projects;
begin
  if auth.uid() is null or not dao_private.can_prepare_project(p_project_id) then
    raise exception using errcode='42501',message='project preparation required';
  end if;
  update public.projects set project_stage=p_stage,payment_status=p_payment_status
    where id=p_project_id and status<>'archived' returning * into v;
  if v.id is null then raise exception using errcode='23514',message='project is unavailable'; end if;
  insert into public.audit_events(actor_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),'tracking_updated','project',v.id,jsonb_build_object('project_stage',p_stage,'payment_status',p_payment_status));
  return v;
end;
$$;

create function dao_private.assign_project_request_member(p_request_id uuid,p_member_id uuid) returns public.project_requests
language plpgsql security definer set search_path='' as $$
declare v public.project_requests; v_project_id uuid;
begin
  select project_id into v_project_id from public.project_requests where id=p_request_id;
  perform 1 from public.projects where id=v_project_id for update;
  select * into v from public.project_requests where id=p_request_id for update;
  if auth.uid() is null or v.id is null or not dao_private.can_prepare_project(v.project_id) then
    raise exception using errcode='42501',message='project preparation required';
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

create function dao_private.set_project_document_sharing(p_document_id uuid,p_share_scope text) returns public.documents
language plpgsql security definer set search_path='' as $$
declare v public.documents;
begin
  select * into v from public.documents where id=p_document_id for update;
  if auth.uid() is null or v.id is null or not (
    dao_private.staff() or (v.owner_id=auth.uid() and dao_private.project_member(v.project_id))) then
    raise exception using errcode='42501',message='document owner participation required';
  end if;
  if p_share_scope is null or p_share_scope not in ('owner_only','project_members') then
    raise exception using errcode='22023',message='invalid document sharing scope';
  end if;
  update public.documents set share_scope=p_share_scope where id=v.id returning * into v;
  return v;
end;
$$;

create function dao_private.project_team(p_project_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_members jsonb; v_invitations jsonb:='[]'::jsonb; v_events jsonb;
begin
  if not dao_private.can_view_project(p_project_id) then
    raise exception using errcode='42501',message='project participation required';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'user_id',m.user_id,
    'participation_role',m.participation_role,'status',m.status,
    'can_view_private_details',m.can_view_private_details,
    'name',coalesce(c.business_name,pr.display_name,'Participant D.A.O')) order by m.accepted_at),'[]'::jsonb)
  into v_members from public.project_members m left join public.contractor_profiles c on c.user_id=m.user_id
    and m.participation_role='contractor' left join public.profiles pr on pr.user_id=m.user_id
    where m.project_id=p_project_id;
  if dao_private.can_prepare_project(p_project_id) then
    select coalesce(jsonb_agg(jsonb_build_object('id',id,'expected_role',expected_role,
      'recipient_email',recipient_email,'status',case when status='pending' and expires_at<=now() then 'expired' else status end,
      'expires_at',expires_at) order by created_at desc),'[]'::jsonb) into v_invitations
    from public.project_invitations where project_id=p_project_id;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'action',action,'created_at',created_at) order by created_at desc),'[]'::jsonb)
    into v_events from public.audit_events where entity_type='project' and entity_id=p_project_id
    and action in ('project_created','client_confirmed','member_joined','member_revoked','invitation_created',
      'invitation_declined','invitation_revoked','tracking_updated','lot_participant_updated','private_permission_updated');
  return jsonb_build_object('members',v_members,'invitations',v_invitations,'events',v_events,
    'is_client',dao_private.owner(p_project_id),'can_prepare',dao_private.can_prepare_project(p_project_id),
    'can_view_private_details',dao_private.can_view_project_private_details(p_project_id));
end;
$$;

-- Confirmation cannot leave a mismatched/duplicate client membership even
-- for privileged callers. Deferred validation permits the atomic RPC sequence.
create function dao_private.check_project_client_membership() returns trigger
language plpgsql security definer set search_path='' as $$
declare p public.projects; v_project_id uuid; v_count integer;
begin
  if tg_table_name='projects' then v_project_id:=new.id;
  elsif tg_op='DELETE' then v_project_id:=old.project_id;
  else v_project_id:=new.project_id; end if;
  select * into p from public.projects where id=v_project_id;
  if p.id is null then return null; end if;
  select count(*) into v_count from public.project_members
    where project_id=p.id and participation_role='client' and status='accepted';
  if (p.client_id is null and v_count<>0) or (p.client_id is not null and (
    v_count<>1 or not exists(select 1 from public.project_members where project_id=p.id
      and user_id=p.client_id and participation_role='client' and status='accepted'))) then
    raise exception using errcode='23514',message='confirmed client membership must match the project';
  end if;
  return null;
end;
$$;
create constraint trigger project_client_membership_consistent after insert or update on public.projects
  deferrable initially deferred for each row execute function dao_private.check_project_client_membership();
create constraint trigger membership_client_consistent after insert or update or delete on public.project_members
  deferrable initially deferred for each row execute function dao_private.check_project_client_membership();
revoke all on function dao_private.check_project_client_membership() from public,anon,authenticated;

-- Guard membership identity independently of mutable permission/status fields.
create function dao_private.preserve_project_member_identity() returns trigger
language plpgsql set search_path='' as $$
begin
  if row(new.project_id,new.user_id,new.participation_role) is distinct from
     row(old.project_id,old.user_id,old.participation_role) then
    raise exception using errcode='23514',message='project member identity is immutable';
  end if;
  return new;
end;
$$;
create trigger preserve_project_member_identity before update on public.project_members
  for each row execute function dao_private.preserve_project_member_identity();
revoke all on function dao_private.preserve_project_member_identity() from public,anon,authenticated;

-- Legacy owner-only explicit grants remain supported. A file explicitly
-- shared with project_members always requires current accepted membership.
alter policy read_allowed on public.documents to authenticated using (
  dao_private.staff() or owner_id=auth.uid() or (status='approved' and (
    (share_scope='project_members' and dao_private.project_member(project_id))
    or (share_scope='owner_only' and exists(select 1 from public.document_grants g
      where g.document_id=documents.id and g.user_id=auth.uid() and g.revoked_at is null)))));

-- Preserve all old overloads and lifecycle checks; only preparation predicates change.
create or replace function dao_private.add_project_request(
  p_project_id uuid,
  p_trade_id uuid,
  p_title text,
  p_scope text
)
returns public.project_requests
language plpgsql
security definer
set search_path=''
as $$
begin
  return dao_private.add_project_request(
    p_project_id,
    p_trade_id,
    p_title,
    p_scope,
    null::bigint
  );
end;
$$;

create or replace function dao_private.add_project_request(
  p_project_id uuid,p_trade_id uuid,p_title text,p_scope text,p_budget_millimes bigint
) returns public.project_requests
language plpgsql security definer set search_path=''
as $$
declare v_request public.project_requests; v_version public.project_versions; v_request_version public.project_request_versions;
begin
  if auth.uid() is null or not dao_private.can_prepare_project(p_project_id) then raise exception using errcode='42501',message='project ownership required'; end if;
  if not exists(select 1 from public.projects where id=p_project_id and status='draft') then raise exception using errcode='23514',message='project must be draft'; end if;
  if nullif(btrim(p_title),'') is null or nullif(btrim(p_scope),'') is null then raise exception using errcode='23514',message='title and scope are required'; end if;
  select * into v_version from public.project_versions where project_id=p_project_id and status='draft' order by version_no desc limit 1;
  if v_version.id is null then raise exception using errcode='23503',message='draft project version required'; end if;
  insert into public.project_requests(project_id) values(p_project_id) returning * into v_request;
  insert into public.project_request_versions(request_id,project_id,version_no,trade_id,title,scope,budget_millimes)
  values(v_request.id,p_project_id,1,p_trade_id,btrim(p_title),btrim(p_scope),p_budget_millimes) returning * into v_request_version;
  insert into public.project_version_requests(project_id,project_version_id,request_version_id)
  values(p_project_id,v_version.id,v_request_version.id);
  return v_request;
end;
$$;

create or replace function dao_private.create_project_document(
  p_project_id uuid,p_object_path text,p_original_name text,p_mime_type text,p_size_bytes bigint
) returns public.documents language plpgsql security definer set search_path=''
as $$
declare v public.documents;
begin
  if auth.uid() is null or not dao_private.project_member(p_project_id) then raise exception using errcode='42501',message='project ownership required'; end if;
  if p_object_path is null or p_object_path not like ('project/'||p_project_id::text||'/%') then raise exception using errcode='23514',message='invalid project document path'; end if;
  if p_mime_type not in ('application/pdf','image/jpeg','image/png','image/webp') then raise exception using errcode='23514',message='unsupported document type'; end if;
  if p_size_bytes < 1 or p_size_bytes > 20971520 then raise exception using errcode='23514',message='document size must be at most 20 MB'; end if;
  insert into public.documents(project_id,owner_id,object_path,original_name,mime_type,size_bytes)
  values(p_project_id,auth.uid(),p_object_path,p_original_name,p_mime_type,p_size_bytes)
  returning * into v;
  return v;
end;
$$;

create or replace function dao_private.update_project_draft(
  p_project_id uuid,
  p_title text,
  p_description text,
  p_project_type text,
  p_surface_m2 numeric,
  p_desired_start_date date,
  p_indicative_budget_millimes bigint,
  p_governorate_id uuid,
  p_delegation_id uuid default null,
  p_locality_id uuid default null
) returns public.project_versions
language plpgsql security definer set search_path=''
as $$
declare v_version public.project_versions;
begin
  if auth.uid() is null or not dao_private.can_prepare_project(p_project_id) then
    raise exception using errcode='42501', message='project ownership required';
  end if;
  if not exists(select 1 from public.projects p where p.id=p_project_id and p.status='draft') then
    raise exception using errcode='23514', message='project must be draft';
  end if;
  if nullif(btrim(p_title),'') is null or p_governorate_id is null then
    raise exception using errcode='23514', message='title and governorate are required';
  end if;
  select * into v_version from public.project_versions
    where project_id=p_project_id and status='draft'
    order by version_no desc limit 1;
  if v_version.id is null then raise exception using errcode='23503', message='draft project version required'; end if;
  update public.projects set project_type=p_project_type,surface_m2=p_surface_m2,
    desired_start_date=p_desired_start_date,indicative_budget_millimes=p_indicative_budget_millimes
    where id=p_project_id;
  update public.project_versions set title=btrim(p_title),description=coalesce(p_description,''),
    governorate_id=p_governorate_id,delegation_id=p_delegation_id,locality_id=p_locality_id,
    project_type=p_project_type,surface_m2=p_surface_m2,desired_start_date=p_desired_start_date,
    indicative_budget_millimes=p_indicative_budget_millimes
    where id=v_version.id returning * into v_version;
  return v_version;
end; $$;

create or replace function dao_private.update_project_draft(
  p_project_id uuid, p_title text, p_description text, p_project_type text,
  p_surface_m2 numeric, p_desired_start_date date, p_desired_end_date date,
  p_indicative_budget_millimes bigint, p_governorate_id uuid,
  p_delegation_id uuid default null, p_locality_id uuid default null
) returns public.project_versions
language plpgsql security definer set search_path=''
as $$
declare v_version public.project_versions;
begin
  if auth.uid() is null or not dao_private.can_prepare_project(p_project_id) then
    raise exception using errcode='42501', message='project ownership required';
  end if;
  if p_desired_start_date is not null and p_desired_end_date is not null
     and p_desired_end_date < p_desired_start_date then
    raise exception using errcode='23514', message='desired end date must be on or after start date';
  end if;
  if nullif(btrim(p_title),'') is null or p_governorate_id is null then
    raise exception using errcode='23514', message='title and governorate are required';
  end if;
  select * into v_version from public.project_versions where project_id=p_project_id
    and status='draft' order by version_no desc limit 1;
  if v_version.id is null then
    select * into v_version from dao_private.create_project_correction(p_project_id);
  end if;
  if not exists(select 1 from public.projects where id=p_project_id and status='draft') then
    raise exception using errcode='23514', message='project must be draft';
  end if;
  update public.projects set project_type=p_project_type,surface_m2=p_surface_m2,
    desired_start_date=p_desired_start_date,desired_end_date=p_desired_end_date,
    indicative_budget_millimes=p_indicative_budget_millimes where id=p_project_id;
  update public.project_versions set title=btrim(p_title),description=coalesce(p_description,''),
    governorate_id=p_governorate_id,delegation_id=p_delegation_id,locality_id=p_locality_id,
    project_type=p_project_type,surface_m2=p_surface_m2,desired_start_date=p_desired_start_date,
    desired_end_date=p_desired_end_date,indicative_budget_millimes=p_indicative_budget_millimes
  where id=v_version.id returning * into v_version;
  return v_version;
end;
$$;

create or replace function dao_private.update_project_request(
  p_request_id uuid,
  p_trade_id uuid,
  p_title text,
  p_scope text,
  p_budget_millimes bigint default null
) returns public.project_request_versions
language plpgsql
security definer
set search_path=''
as $$
declare
  v_request public.project_requests;
  v_previous public.project_request_versions;
  v_version public.project_request_versions;
  v_project_version public.project_versions;
  v_next_version integer;
begin
  if auth.uid() is null then
    raise exception using errcode='42501', message='authentication required';
  end if;

  select * into v_request
  from public.project_requests
  where id = p_request_id;

  if v_request.id is null or not dao_private.can_prepare_project(v_request.project_id) then
    raise exception using errcode='42501', message='project ownership required';
  end if;

  if v_request.status <> 'open' then
    raise exception using errcode='23514', message='only open requests can be modified';
  end if;

  if not exists (
    select 1 from public.projects
    where id = v_request.project_id and status = 'draft'
  ) then
    raise exception using errcode='23514', message='project must be draft';
  end if;

  if nullif(btrim(p_title), '') is null or nullif(btrim(p_scope), '') is null then
    raise exception using errcode='23514', message='title and scope are required';
  end if;

  select * into v_previous
  from public.project_request_versions
  where request_id = p_request_id
  order by version_no desc
  limit 1;

  if v_previous.id is null then
    raise exception using errcode='23503', message='request version required';
  end if;

  select * into v_project_version
  from public.project_versions
  where project_id = v_request.project_id
    and status = 'draft'
  order by version_no desc
  limit 1;

  if v_project_version.id is null then
    raise exception using errcode='23503', message='draft project version required';
  end if;

  v_next_version := v_previous.version_no + 1;

  insert into public.project_request_versions(
    request_id, project_id, version_no, trade_id, title, scope, budget_millimes
  )
  values(
    p_request_id,
    v_request.project_id,
    v_next_version,
    p_trade_id,
    btrim(p_title),
    btrim(p_scope),
    coalesce(p_budget_millimes, v_previous.budget_millimes)
  )
  returning * into v_version;

  delete from public.project_version_requests pvr
  using public.project_request_versions prv
  where pvr.project_version_id = v_project_version.id
    and pvr.request_version_id = prv.id
    and prv.request_id = p_request_id;

  insert into public.project_version_requests(project_id, project_version_id, request_version_id)
  values(v_request.project_id, v_project_version.id, v_version.id);

  return v_version;
end;
$$;

create or replace function dao_private.upsert_project_private_details(
  p_project_id uuid,p_exact_address text default null,p_access_instructions text default null,
  p_contact_phone text default null,p_contact_email text default null
) returns public.project_private_details
language plpgsql security definer set search_path=''
as $$
declare v public.project_private_details;
begin
  if auth.uid() is null or (not (dao_private.can_prepare_project(p_project_id) and dao_private.can_view_project_private_details(p_project_id)) and not dao_private.staff()) then
    raise exception using errcode='42501',message='project access required';
  end if;
  if p_contact_phone is not null and p_contact_phone !~ '^\+216[0-9]{8}$' then
    raise exception using errcode='23514',message='invalid Tunisian phone number';
  end if;
  insert into public.project_private_details(project_id,exact_address,access_instructions,contact_phone,contact_email)
  values(p_project_id,p_exact_address,p_access_instructions,p_contact_phone,p_contact_email)
  on conflict(project_id) do update set exact_address=excluded.exact_address,
    access_instructions=excluded.access_instructions,contact_phone=excluded.contact_phone,
    contact_email=excluded.contact_email returning * into v;
  return v;
end;
$$;

create or replace function dao_private.withdraw_project_request(p_request_id uuid)
returns public.project_requests
language plpgsql security definer set search_path=''
as $$
declare
  v_request public.project_requests;
  v_project_version public.project_versions;
begin
  if auth.uid() is null then
    raise exception using errcode='42501',message='authentication required';
  end if;

  select * into v_request
  from public.project_requests
  where id=p_request_id
  for update;
  if v_request.id is null or not dao_private.can_prepare_project(v_request.project_id) then
    raise exception using errcode='42501',message='project ownership required';
  end if;
  if v_request.status<>'open' then
    raise exception using errcode='23514',message='only open requests can be removed';
  end if;
  if not exists (
    select 1 from public.projects
    where id=v_request.project_id and status='draft'
  ) then
    raise exception using errcode='23514',message='project must be draft';
  end if;

  select * into v_project_version
  from public.project_versions
  where project_id=v_request.project_id
  order by version_no desc
  limit 1
  for update;
  if v_project_version.id is null or v_project_version.status<>'draft' then
    raise exception using errcode='23514',message='project version must be draft to remove requests';
  end if;

  update public.project_requests set status='withdrawn'
  where id=p_request_id
  returning * into v_request;
  delete from public.project_version_requests pvr
  using public.project_request_versions prv
  where pvr.project_version_id=v_project_version.id
    and pvr.request_version_id=prv.id
    and prv.request_id=p_request_id;

  return v_request;
end;
$$;

create function public.create_collaborative_project(p_origin text,p_title text,p_description text,p_governorate_id uuid,p_delegation_id uuid,p_locality_id uuid,p_stage text,p_payment_status text) returns public.projects
language sql security invoker set search_path='' as $$ select dao_private.create_collaborative_project($1,$2,$3,$4,$5,$6,$7,$8); $$;
revoke all on function dao_private.create_collaborative_project(text,text,text,uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function dao_private.create_collaborative_project(text,text,text,uuid,uuid,uuid,text,text) to authenticated,service_role;
revoke all on function public.create_collaborative_project(text,text,text,uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.create_collaborative_project(text,text,text,uuid,uuid,uuid,text,text) to authenticated,service_role;
create function public.issue_project_invitation(p_project_id uuid,p_expected_role text,p_recipient_email text,p_can_view_private_details boolean) returns jsonb
language sql security invoker set search_path='' as $$ select dao_private.issue_project_invitation($1,$2,$3,$4); $$;
revoke all on function dao_private.issue_project_invitation(uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function dao_private.issue_project_invitation(uuid,text,text,boolean) to authenticated,service_role;
revoke all on function public.issue_project_invitation(uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function public.issue_project_invitation(uuid,text,text,boolean) to authenticated,service_role;
create function public.preview_project_invitation(p_token text) returns jsonb
language sql security invoker set search_path='' as $$ select dao_private.preview_project_invitation($1); $$;
revoke all on function dao_private.preview_project_invitation(text) from public,anon,authenticated;
grant execute on function dao_private.preview_project_invitation(text) to authenticated,service_role;
grant execute on function dao_private.preview_project_invitation(text) to anon;
revoke all on function public.preview_project_invitation(text) from public,anon,authenticated;
grant execute on function public.preview_project_invitation(text) to authenticated,service_role;
grant execute on function public.preview_project_invitation(text) to anon;
create function public.respond_project_invitation(p_token text,p_accept boolean) returns uuid
language sql security invoker set search_path='' as $$ select dao_private.respond_project_invitation($1,$2); $$;
revoke all on function dao_private.respond_project_invitation(text,boolean) from public,anon,authenticated;
grant execute on function dao_private.respond_project_invitation(text,boolean) to authenticated,service_role;
revoke all on function public.respond_project_invitation(text,boolean) from public,anon,authenticated;
grant execute on function public.respond_project_invitation(text,boolean) to authenticated,service_role;
create function public.revoke_project_invitation(p_invitation_id uuid) returns uuid
language sql security invoker set search_path='' as $$ select dao_private.revoke_project_invitation($1); $$;
revoke all on function dao_private.revoke_project_invitation(uuid) from public,anon,authenticated;
grant execute on function dao_private.revoke_project_invitation(uuid) to authenticated,service_role;
revoke all on function public.revoke_project_invitation(uuid) from public,anon,authenticated;
grant execute on function public.revoke_project_invitation(uuid) to authenticated,service_role;
create function public.update_project_member(p_member_id uuid,p_revoke boolean,p_can_view_private_details boolean) returns public.project_members
language sql security invoker set search_path='' as $$ select dao_private.update_project_member($1,$2,$3); $$;
revoke all on function dao_private.update_project_member(uuid,boolean,boolean) from public,anon,authenticated;
grant execute on function dao_private.update_project_member(uuid,boolean,boolean) to authenticated,service_role;
revoke all on function public.update_project_member(uuid,boolean,boolean) from public,anon,authenticated;
grant execute on function public.update_project_member(uuid,boolean,boolean) to authenticated,service_role;
create function public.update_project_tracking(p_project_id uuid,p_stage text,p_payment_status text) returns public.projects
language sql security invoker set search_path='' as $$ select dao_private.update_project_tracking($1,$2,$3); $$;
revoke all on function dao_private.update_project_tracking(uuid,text,text) from public,anon,authenticated;
grant execute on function dao_private.update_project_tracking(uuid,text,text) to authenticated,service_role;
revoke all on function public.update_project_tracking(uuid,text,text) from public,anon,authenticated;
grant execute on function public.update_project_tracking(uuid,text,text) to authenticated,service_role;
create function public.assign_project_request_member(p_request_id uuid,p_member_id uuid) returns public.project_requests
language sql security invoker set search_path='' as $$ select dao_private.assign_project_request_member($1,$2); $$;
revoke all on function dao_private.assign_project_request_member(uuid,uuid) from public,anon,authenticated;
grant execute on function dao_private.assign_project_request_member(uuid,uuid) to authenticated,service_role;
revoke all on function public.assign_project_request_member(uuid,uuid) from public,anon,authenticated;
grant execute on function public.assign_project_request_member(uuid,uuid) to authenticated,service_role;
create function public.set_project_document_sharing(p_document_id uuid,p_share_scope text) returns public.documents
language sql security invoker set search_path='' as $$ select dao_private.set_project_document_sharing($1,$2); $$;
revoke all on function dao_private.set_project_document_sharing(uuid,text) from public,anon,authenticated;
grant execute on function dao_private.set_project_document_sharing(uuid,text) to authenticated,service_role;
revoke all on function public.set_project_document_sharing(uuid,text) from public,anon,authenticated;
grant execute on function public.set_project_document_sharing(uuid,text) to authenticated,service_role;
create function public.project_team(p_project_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select dao_private.project_team($1); $$;
revoke all on function dao_private.project_team(uuid) from public,anon,authenticated;
grant execute on function dao_private.project_team(uuid) to authenticated,service_role;
revoke all on function public.project_team(uuid) from public,anon,authenticated;
grant execute on function public.project_team(uuid) to authenticated,service_role;

notify pgrst, 'reload schema';
commit;
