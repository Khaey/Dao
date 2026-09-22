begin;

-- Priority 1 metadata.  These fields are deliberately nullable so existing
-- projects and publications remain valid while clients progressively enrich
-- their drafts.
alter table public.projects add column if not exists desired_end_date date;
alter table public.project_versions add column if not exists desired_end_date date;
alter table public.publications add column if not exists desired_end_date date;

-- The proposal is linked to the request it can improve.  Existing AI rows do
-- not need a request and remain valid for audit/history purposes.
alter table public.ai_proposals add column if not exists request_id uuid;
create index if not exists ai_proposals_request_id_idx on public.ai_proposals(request_id);

-- A single, JWT-scoped account initialization command keeps registration and
-- the first authenticated session idempotent.  It never trusts a user id
-- supplied by the client.
create or replace function dao_private.initialize_my_account(
  p_display_name text default null,
  p_phone_e164 text default null
) returns public.profiles
language plpgsql security definer set search_path=''
as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
  v_profile public.profiles;
begin
  if v_uid is null then
    raise exception using errcode='42501', message='authentication required';
  end if;
  if p_phone_e164 is not null and p_phone_e164 !~ '^\+216[0-9]{8}$' then
    raise exception using errcode='23514', message='invalid Tunisian phone number';
  end if;
  select coalesce(
    nullif(btrim(p_display_name), ''),
    nullif(btrim(existing.display_name), ''),
    nullif(split_part(coalesce((auth.jwt() ->> 'email'), ''), '@', 1), ''),
    'Utilisateur'
  ) into v_name
  from public.profiles existing where existing.user_id = v_uid;
  if v_name is null then v_name := 'Utilisateur'; end if;

  insert into public.profiles(user_id, display_name)
  values(v_uid, v_name)
  on conflict(user_id) do update set display_name = excluded.display_name
  returning * into v_profile;

  if p_phone_e164 is not null then
    insert into public.profile_contacts(user_id, phone_e164, contact_email)
    values(v_uid, p_phone_e164, (auth.jwt() ->> 'email'))
    on conflict(user_id) do update set phone_e164 = excluded.phone_e164,
      contact_email = coalesce(excluded.contact_email, public.profile_contacts.contact_email);
  else
    insert into public.profile_contacts(user_id, contact_email)
    values(v_uid, (auth.jwt() ->> 'email'))
    on conflict(user_id) do update set contact_email = coalesce(public.profile_contacts.contact_email, excluded.contact_email);
  end if;

  if not exists(select 1 from public.user_roles ur where ur.user_id = v_uid) then
    insert into public.user_roles(user_id, role) values(v_uid, 'client')
    on conflict(user_id, role) do nothing;
  end if;
  return v_profile;
end;
$$;
revoke all on function dao_private.initialize_my_account(text,text) from public, anon, authenticated;
grant execute on function dao_private.initialize_my_account(text,text) to authenticated, service_role;

create or replace function public.initialize_my_account(
  p_display_name text default null,
  p_phone_e164 text default null
) returns public.profiles
language sql security definer set search_path=''
as $$ select dao_private.initialize_my_account($1, $2); $$;
revoke all on function public.initialize_my_account(text,text) from public, anon;
grant execute on function public.initialize_my_account(text,text) to authenticated, service_role;

create or replace function public.update_my_profile(
  p_display_name text default null,
  p_phone_e164 text default null
) returns public.profiles
language sql security definer set search_path=''
as $$ select dao_private.initialize_my_account($1, $2); $$;
revoke all on function public.update_my_profile(text,text) from public, anon;
grant execute on function public.update_my_profile(text,text) to authenticated, service_role;

-- New project creation command carrying the optional end date.  The legacy
-- seven-argument function remains available for older clients.
create or replace function dao_private.create_project_draft(
  p_project_type text,
  p_surface_m2 numeric,
  p_desired_start_date date,
  p_desired_end_date date,
  p_indicative_budget_millimes bigint,
  p_governorate_id uuid,
  p_delegation_id uuid default null,
  p_locality_id uuid default null
) returns public.projects
language plpgsql security definer set search_path=''
as $$
declare v_project public.projects;
begin
  if auth.uid() is null then raise exception using errcode='42501', message='authentication required'; end if;
  if p_desired_start_date is not null and p_desired_end_date is not null
     and p_desired_end_date < p_desired_start_date then
    raise exception using errcode='23514', message='desired end date must be on or after start date';
  end if;
  if p_governorate_id is null then
    raise exception using errcode='23514', message='governorate is required';
  end if;
  insert into public.projects(client_id, project_type, surface_m2, desired_start_date,
    desired_end_date, indicative_budget_millimes)
  values(auth.uid(), p_project_type, p_surface_m2, p_desired_start_date,
    p_desired_end_date, p_indicative_budget_millimes)
  returning * into v_project;
  insert into public.project_versions(project_id, version_no, title, description,
    governorate_id, delegation_id, locality_id, project_type, surface_m2,
    desired_start_date, desired_end_date, indicative_budget_millimes)
  values(v_project.id, 1, 'Nouveau projet', 'Brouillon', p_governorate_id,
    p_delegation_id, p_locality_id, p_project_type, p_surface_m2,
    p_desired_start_date, p_desired_end_date, p_indicative_budget_millimes);
  return v_project;
end;
$$;
revoke all on function dao_private.create_project_draft(text,numeric,date,date,bigint,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function dao_private.create_project_draft(text,numeric,date,date,bigint,uuid,uuid,uuid) to authenticated,service_role;

create or replace function public.create_project_draft(
  p_project_type text, p_surface_m2 numeric, p_desired_start_date date,
  p_desired_end_date date, p_indicative_budget_millimes bigint,
  p_governorate_id uuid, p_delegation_id uuid default null, p_locality_id uuid default null
) returns public.projects language sql security definer set search_path=''
as $$ select dao_private.create_project_draft($1,$2,$3,$4,$5,$6,$7,$8); $$;
revoke all on function public.create_project_draft(text,numeric,date,date,bigint,uuid,uuid,uuid) from public,anon;
grant execute on function public.create_project_draft(text,numeric,date,date,bigint,uuid,uuid,uuid) to authenticated,service_role;

-- A rejected version is immutable.  Corrections always fork a new draft and
-- preserve the request links so the audit trail remains complete.
create or replace function dao_private.create_project_correction(p_project_id uuid)
returns public.project_versions
language plpgsql security definer set search_path=''
as $$
declare v_old public.project_versions; v_new public.project_versions; v_next integer;
begin
  if auth.uid() is null or not dao_private.owner(p_project_id) then
    raise exception using errcode='42501', message='project ownership required';
  end if;
  select * into v_old from public.project_versions
    where project_id = p_project_id and status = 'rejected'
    order by version_no desc limit 1;
  if v_old.id is null then raise exception using errcode='23514', message='rejected version required'; end if;
  select coalesce(max(version_no),0)+1 into v_next from public.project_versions where project_id=p_project_id;
  insert into public.project_versions(project_id,version_no,title,description,governorate_id,
    delegation_id,locality_id,status,project_type,surface_m2,desired_start_date,
    desired_end_date,indicative_budget_millimes)
  values(p_project_id,v_next,v_old.title,v_old.description,v_old.governorate_id,
    v_old.delegation_id,v_old.locality_id,'draft',v_old.project_type,v_old.surface_m2,
    v_old.desired_start_date,v_old.desired_end_date,v_old.indicative_budget_millimes)
  returning * into v_new;
  insert into public.project_version_requests(project_id,project_version_id,request_version_id)
  select pvr.project_id,v_new.id,pvr.request_version_id
  from public.project_version_requests pvr
  where pvr.project_version_id=v_old.id;
  update public.projects set status='draft', project_type=v_new.project_type,
    surface_m2=v_new.surface_m2, desired_start_date=v_new.desired_start_date,
    desired_end_date=v_new.desired_end_date, indicative_budget_millimes=v_new.indicative_budget_millimes
  where id=p_project_id;
  return v_new;
end;
$$;
revoke all on function dao_private.create_project_correction(uuid) from public,anon,authenticated;
grant execute on function dao_private.create_project_correction(uuid) to authenticated,service_role;

create or replace function public.create_project_correction(p_project_id uuid)
returns public.project_versions language sql security definer set search_path=''
as $$ select dao_private.create_project_correction($1); $$;
revoke all on function public.create_project_correction(uuid) from public,anon;
grant execute on function public.create_project_correction(uuid) to authenticated,service_role;

-- Draft updates happen in place.  If the current version is rejected, the
-- command creates a correction version first and then applies the edit there.
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
  if auth.uid() is null or not dao_private.owner(p_project_id) then
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
revoke all on function dao_private.update_project_draft(uuid,text,text,text,numeric,date,bigint,uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function dao_private.update_project_draft(uuid,text,text,text,numeric,date,date,bigint,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function dao_private.update_project_draft(uuid,text,text,text,numeric,date,bigint,uuid,uuid,uuid) to authenticated,service_role;
grant execute on function dao_private.update_project_draft(uuid,text,text,text,numeric,date,date,bigint,uuid,uuid,uuid) to authenticated,service_role;

create or replace function public.update_project_draft(
  p_project_id uuid,p_title text,p_description text,p_project_type text,p_surface_m2 numeric,
  p_desired_start_date date,p_desired_end_date date,p_indicative_budget_millimes bigint,
  p_governorate_id uuid,p_delegation_id uuid default null,p_locality_id uuid default null
) returns public.project_versions language sql security definer set search_path=''
as $$ select dao_private.update_project_draft($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11); $$;
revoke all on function public.update_project_draft(uuid,text,text,text,numeric,date,date,bigint,uuid,uuid,uuid) from public,anon;
grant execute on function public.update_project_draft(uuid,text,text,text,numeric,date,date,bigint,uuid,uuid,uuid) to authenticated,service_role;

create or replace function dao_private.archive_project(p_project_id uuid)
returns public.projects language plpgsql security definer set search_path=''
as $$
declare v public.projects;
begin
  if auth.uid() is null or not dao_private.owner(p_project_id) then raise exception using errcode='42501',message='project ownership required'; end if;
  update public.projects set status='archived' where id=p_project_id and status in ('draft','closed') returning * into v;
  if v.id is null then raise exception using errcode='23514',message='project cannot be archived in its current state'; end if;
  return v;
end;
$$;
revoke all on function dao_private.archive_project(uuid) from public,anon,authenticated;
grant execute on function dao_private.archive_project(uuid) to authenticated,service_role;
create or replace function public.archive_project(p_project_id uuid)
returns public.projects language sql security definer set search_path=''
as $$ select dao_private.archive_project($1); $$;
revoke all on function public.archive_project(uuid) from public,anon;
grant execute on function public.archive_project(uuid) to authenticated,service_role;

create or replace function dao_private.upsert_project_private_details(
  p_project_id uuid,p_exact_address text default null,p_access_instructions text default null,
  p_contact_phone text default null,p_contact_email text default null
) returns public.project_private_details
language plpgsql security definer set search_path=''
as $$
declare v public.project_private_details;
begin
  if auth.uid() is null or (not dao_private.owner(p_project_id) and not dao_private.staff()) then
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
revoke all on function dao_private.upsert_project_private_details(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function dao_private.upsert_project_private_details(uuid,text,text,text,text) to authenticated,service_role;
create or replace function public.upsert_project_private_details(
  p_project_id uuid,p_exact_address text default null,p_access_instructions text default null,
  p_contact_phone text default null,p_contact_email text default null
) returns public.project_private_details language sql security definer set search_path=''
as $$ select dao_private.upsert_project_private_details($1,$2,$3,$4,$5); $$;
revoke all on function public.upsert_project_private_details(uuid,text,text,text,text) from public,anon;
grant execute on function public.upsert_project_private_details(uuid,text,text,text,text) to authenticated,service_role;

-- First lot creation includes its budget in v1.  The previous four-argument
-- facade stays intact for compatibility; the new facade is used by the UI.
create or replace function dao_private.add_project_request(
  p_project_id uuid,p_trade_id uuid,p_title text,p_scope text,p_budget_millimes bigint default null
) returns public.project_requests
language plpgsql security definer set search_path=''
as $$
declare v_request public.project_requests; v_version public.project_versions; v_request_version public.project_request_versions;
begin
  if auth.uid() is null or not dao_private.owner(p_project_id) then raise exception using errcode='42501',message='project ownership required'; end if;
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
revoke all on function dao_private.add_project_request(uuid,uuid,text,text,bigint) from public,anon,authenticated;
grant execute on function dao_private.add_project_request(uuid,uuid,text,text,bigint) to authenticated,service_role;
create or replace function public.add_project_request(
  p_project_id uuid,p_trade_id uuid,p_title text,p_scope text,p_budget_millimes bigint default null
) returns public.project_requests language sql security definer set search_path=''
as $$ select dao_private.add_project_request($1,$2,$3,$4,$5); $$;
revoke all on function public.add_project_request(uuid,uuid,text,text,bigint) from public,anon;
grant execute on function public.add_project_request(uuid,uuid,text,text,bigint) to authenticated,service_role;

-- Client -> DAO review progression.  Every decision is also recorded in the
-- existing review table so comments survive later corrections.
create or replace function dao_private.submit_project_for_review(p_project_id uuid)
returns public.project_versions language plpgsql security definer set search_path=''
as $$
declare v public.project_versions;
begin
  if auth.uid() is null or not dao_private.owner(p_project_id) then raise exception using errcode='42501',message='project ownership required'; end if;
  select * into v from public.project_versions where project_id=p_project_id and status='draft' order by version_no desc limit 1;
  if v.id is null then raise exception using errcode='23514',message='draft project version required'; end if;
  if not exists(select 1 from public.project_requests where project_id=p_project_id and status='open') then raise exception using errcode='23514',message='at least one open request required'; end if;
  update public.project_versions set status='client_review' where id=v.id returning * into v;
  insert into public.project_reviews(project_version_id,actor_id,actor_role,decision,reason)
  values(v.id,auth.uid(),'client','approved',null);
  return v;
end;
$$;
revoke all on function dao_private.submit_project_for_review(uuid) from public,anon,authenticated;
grant execute on function dao_private.submit_project_for_review(uuid) to authenticated,service_role;

create or replace function dao_private.review_project(p_project_id uuid,p_approve boolean,p_comment text default null)
returns public.project_versions language plpgsql security definer set search_path=''
as $$
declare v public.project_versions; v_status text; v_decision text;
begin
  if auth.uid() is null or not dao_private.staff() then raise exception using errcode='42501',message='DAO reviewer required'; end if;
  select * into v from public.project_versions where project_id=p_project_id and status in ('client_review','dao_review') order by version_no desc limit 1;
  if v.id is null then raise exception using errcode='23514',message='project is not awaiting review'; end if;
  v_status := case when not p_approve then 'rejected' when v.status='client_review' then 'dao_review' else 'approved' end;
  v_decision := case when p_approve then 'approved' else 'rejected' end;
  update public.project_versions set status=v_status where id=v.id returning * into v;
  insert into public.project_reviews(project_version_id,actor_id,actor_role,decision,reason)
  values(v.id,auth.uid(),'dao',v_decision,nullif(btrim(p_comment),''));
  return v;
end;
$$;
revoke all on function dao_private.review_project(uuid,boolean,text) from public,anon,authenticated;
grant execute on function dao_private.review_project(uuid,boolean,text) to authenticated,service_role;

create or replace function dao_private.publish_project(
  p_project_id uuid,p_visibility text,p_request_ids uuid[] default null,
  p_contractor_ids uuid[] default null,p_submission_deadline timestamptz default null
) returns public.publications language plpgsql security definer set search_path=''
as $$
declare v public.project_versions; p public.publications; rid uuid; rv public.project_request_versions; c uuid;
begin
  if auth.uid() is null or not dao_private.staff() then raise exception using errcode='42501',message='DAO reviewer required'; end if;
  select * into v from public.project_versions where project_id=p_project_id and status='approved' order by version_no desc limit 1;
  if v.id is null then raise exception using errcode='23514',message='approved project version required'; end if;
  if p_visibility not in ('public','targeted','invite_only') then raise exception using errcode='23514',message='invalid visibility'; end if;
  if p_visibility<>'public' and coalesce(array_length(p_contractor_ids,1),0)=0 then raise exception using errcode='23514',message='recipients required'; end if;
  insert into public.publications(project_id,project_version_id,visibility,safe_title,safe_description,
    governorate_id,delegation_id,project_type,surface_m2,desired_start_date,desired_end_date,
    indicative_budget_millimes,submission_deadline)
  values(p_project_id,v.id,p_visibility,v.title,v.description,v.governorate_id,v.delegation_id,
    v.project_type,v.surface_m2,v.desired_start_date,v.desired_end_date,v.indicative_budget_millimes,
    p_submission_deadline) returning * into p;
  for rid in select unnest(coalesce(p_request_ids,array[]::uuid[])) loop
    select * into rv from public.project_request_versions where request_id=rid order by version_no desc limit 1;
    if rv.id is null or rv.project_id<>p_project_id then raise exception using errcode='23514',message='request not in project'; end if;
    insert into public.publication_requests(publication_id,request_version_id,trade_id,safe_title,safe_scope)
    values(p.id,rv.id,rv.trade_id,rv.title,rv.scope);
  end loop;
  if p_visibility<>'public' then
    foreach c in array p_contractor_ids loop
      insert into public.publication_recipients(publication_id,contractor_id,source)
      values(p.id,c,case when p_visibility='targeted' then 'targeted' else 'invitation' end);
    end loop;
  end if;
  update public.projects set status='open' where id=p_project_id;
  return p;
end;
$$;
revoke all on function dao_private.publish_project(uuid,text,uuid[],uuid[],timestamptz) from public,anon,authenticated;
grant execute on function dao_private.publish_project(uuid,text,uuid[],uuid[],timestamptz) to authenticated,service_role;

-- Project documents are separate from bid_documents.  The path is still
-- private and can only be turned into a signed upload/download after this
-- JWT-scoped command has authorized it.
create or replace function dao_private.create_project_document(
  p_project_id uuid,p_object_path text,p_original_name text,p_mime_type text,p_size_bytes bigint
) returns public.documents language plpgsql security definer set search_path=''
as $$
declare v public.documents;
begin
  if auth.uid() is null or not dao_private.owner(p_project_id) then raise exception using errcode='42501',message='project ownership required'; end if;
  if p_object_path is null or p_object_path not like ('project/'||p_project_id::text||'/%') then raise exception using errcode='23514',message='invalid project document path'; end if;
  if p_mime_type not in ('application/pdf','image/jpeg','image/png','image/webp') then raise exception using errcode='23514',message='unsupported document type'; end if;
  if p_size_bytes < 1 or p_size_bytes > 20971520 then raise exception using errcode='23514',message='document size must be at most 20 MB'; end if;
  insert into public.documents(project_id,owner_id,object_path,original_name,mime_type,size_bytes)
  values(p_project_id,auth.uid(),p_object_path,p_original_name,p_mime_type,p_size_bytes)
  returning * into v;
  return v;
end;
$$;
revoke all on function dao_private.create_project_document(uuid,text,text,text,bigint) from public,anon,authenticated;
grant execute on function dao_private.create_project_document(uuid,text,text,text,bigint) to authenticated,service_role;
create or replace function public.create_project_document(
  p_project_id uuid,p_object_path text,p_original_name text,p_mime_type text,p_size_bytes bigint
) returns public.documents language sql security definer set search_path=''
as $$ select dao_private.create_project_document($1,$2,$3,$4,$5); $$;
revoke all on function public.create_project_document(uuid,text,text,text,bigint) from public,anon;
grant execute on function public.create_project_document(uuid,text,text,text,bigint) to authenticated,service_role;

create or replace function dao_private.delete_project_document(p_document_id uuid)
returns public.documents language plpgsql security definer set search_path=''
as $$
declare v public.documents;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication required'; end if;
  delete from public.documents where id=p_document_id and (owner_id=auth.uid() or dao_private.staff()) returning * into v;
  if v.id is null then raise exception using errcode='42501',message='document access denied'; end if;
  return v;
end;
$$;
revoke all on function dao_private.delete_project_document(uuid) from public,anon,authenticated;
grant execute on function dao_private.delete_project_document(uuid) to authenticated,service_role;
create or replace function public.delete_project_document(p_document_id uuid)
returns public.documents language sql security definer set search_path=''
as $$ select dao_private.delete_project_document($1); $$;
revoke all on function public.delete_project_document(uuid) from public,anon;
grant execute on function public.delete_project_document(uuid) to authenticated,service_role;

-- Mock AI provider for the MVP.  It produces a proposal only; accepting it
-- creates a normal immutable request version through the same audit model.
create or replace function dao_private.generate_ai_proposal(
  p_project_id uuid,p_request_id uuid,p_source_description text default null
) returns public.ai_proposals
language plpgsql security definer set search_path=''
as $$
declare v_run public.ai_runs; v_request public.project_requests; v_req_version public.project_request_versions; v public.ai_proposals;
begin
  if auth.uid() is null or not dao_private.owner(p_project_id) then raise exception using errcode='42501',message='project ownership required'; end if;
  select * into v_request from public.project_requests where id=p_request_id and project_id=p_project_id;
  if v_request.id is null or v_request.status<>'open' then raise exception using errcode='23514',message='open request required'; end if;
  select * into v_req_version from public.project_request_versions where request_id=p_request_id order by version_no desc limit 1;
  insert into public.ai_runs(project_id,status,provider,model,raw_result)
  values(p_project_id,'succeeded','mock','dao-mvp-mock-v1',jsonb_build_object('request_id',p_request_id)) returning * into v_run;
  insert into public.ai_proposals(run_id,request_id,trade_id,proposed_scope,status)
  values(v_run.id,p_request_id,v_req_version.trade_id,
    coalesce(nullif(btrim(p_source_description),''),v_req_version.scope)||E'\n\nDécoupage proposé : fournitures, préparation, exécution, essais et remise en état.',
    'proposed') returning * into v;
  return v;
end;
$$;
revoke all on function dao_private.generate_ai_proposal(uuid,uuid,text) from public,anon,authenticated;
grant execute on function dao_private.generate_ai_proposal(uuid,uuid,text) to authenticated,service_role;
create or replace function public.generate_ai_proposal(p_project_id uuid,p_request_id uuid,p_source_description text default null)
returns public.ai_proposals language sql security definer set search_path=''
as $$ select dao_private.generate_ai_proposal($1,$2,$3); $$;
revoke all on function public.generate_ai_proposal(uuid,uuid,text) from public,anon;
grant execute on function public.generate_ai_proposal(uuid,uuid,text) to authenticated,service_role;

create or replace function dao_private.accept_ai_proposal(p_proposal_id uuid)
returns public.project_request_versions
language plpgsql security definer set search_path=''
as $$
declare v_prop public.ai_proposals; v_run public.ai_runs; v_old public.project_request_versions; v_new public.project_request_versions;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication required'; end if;
  select ap.* into v_prop from public.ai_proposals ap where ap.id=p_proposal_id and ap.status='proposed';
  if v_prop.id is null or not exists(select 1 from public.ai_runs ar where ar.id=v_prop.run_id and dao_private.owner(ar.project_id)) then
    raise exception using errcode='42501',message='proposal access denied';
  end if;
  select * into v_run from public.ai_runs where id=v_prop.run_id;
  if v_prop.request_id is null then raise exception using errcode='23514',message='proposal is not linked to a request'; end if;
  select * into v_old from public.project_request_versions where request_id=v_prop.request_id order by version_no desc limit 1;
  if v_old.id is null then raise exception using errcode='23503',message='request version required'; end if;
  if not exists(select 1 from public.project_versions pv where pv.project_id=v_run.project_id and pv.status='draft') then
    raise exception using errcode='23514',message='draft project version required';
  end if;
  insert into public.project_request_versions(request_id,project_id,version_no,trade_id,title,scope,budget_millimes)
  values(v_old.request_id,v_old.project_id,v_old.version_no+1,v_old.trade_id,v_old.title,v_prop.proposed_scope,v_old.budget_millimes)
  returning * into v_new;
  delete from public.project_version_requests pvr using public.project_request_versions prv, public.project_versions pv
  where pvr.request_version_id=prv.id and prv.request_id=v_old.request_id and pvr.project_version_id=pv.id
    and pv.project_id=v_old.project_id and pv.status='draft';
  insert into public.project_version_requests(project_id,project_version_id,request_version_id)
  select pv.project_id,pv.id,v_new.id from public.project_versions pv where pv.project_id=v_old.project_id and pv.status='draft' order by pv.version_no desc limit 1;
  update public.ai_proposals set status='accepted' where id=v_prop.id;
  return v_new;
end;
$$;
revoke all on function dao_private.accept_ai_proposal(uuid) from public,anon,authenticated;
grant execute on function dao_private.accept_ai_proposal(uuid) to authenticated,service_role;
create or replace function public.accept_ai_proposal(p_proposal_id uuid)
returns public.project_request_versions language sql security definer set search_path=''
as $$ select dao_private.accept_ai_proposal($1); $$;
revoke all on function public.accept_ai_proposal(uuid) from public,anon;
grant execute on function public.accept_ai_proposal(uuid) to authenticated,service_role;

create or replace function dao_private.reject_ai_proposal(p_proposal_id uuid)
returns public.ai_proposals language plpgsql security definer set search_path=''
as $$
declare v public.ai_proposals;
begin
  update public.ai_proposals ap set status='rejected'
  where ap.id=p_proposal_id and ap.status='proposed'
    and exists(select 1 from public.ai_runs ar where ar.id=ap.run_id and dao_private.owner(ar.project_id))
  returning ap.* into v;
  if v.id is null then raise exception using errcode='42501',message='proposal access denied'; end if;
  return v;
end;
$$;
revoke all on function dao_private.reject_ai_proposal(uuid) from public,anon,authenticated;
grant execute on function dao_private.reject_ai_proposal(uuid) to authenticated,service_role;
create or replace function public.reject_ai_proposal(p_proposal_id uuid)
returns public.ai_proposals language sql security definer set search_path=''
as $$ select dao_private.reject_ai_proposal($1); $$;
revoke all on function public.reject_ai_proposal(uuid) from public,anon;
grant execute on function public.reject_ai_proposal(uuid) to authenticated,service_role;

commit;
