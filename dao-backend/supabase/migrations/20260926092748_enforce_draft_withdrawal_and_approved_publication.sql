begin;

-- These canonical trades are needed by the first-lot UI and the DEV E2E flow.
-- Key by the stable catalog code; existing rows and their labels are preserved.
insert into public.trades(code,name_fr,active)
values
  ('general_contractor','Entreprise générale',true),
  ('plumbing','Plomberie',true),
  ('electrical','Électricité',true)
on conflict(code) do nothing;

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
  if v_request.id is null or not dao_private.owner(v_request.project_id) then
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
revoke all on function dao_private.withdraw_project_request(uuid) from public,anon,authenticated;
grant execute on function dao_private.withdraw_project_request(uuid) to authenticated,service_role;

create or replace function dao_private.publish_project(
  p_project_id uuid,p_visibility text,p_request_ids uuid[] default null,
  p_contractor_ids uuid[] default null,p_submission_deadline timestamptz default null
) returns public.publications
language plpgsql security definer set search_path=''
as $$
declare
  v public.project_versions;
  p public.publications;
  rid uuid;
  rv public.project_request_versions;
  v_request public.project_requests;
  c uuid;
begin
  if auth.uid() is null or not dao_private.staff() then
    raise exception using errcode='42501',message='DAO reviewer required';
  end if;
  select * into v
  from public.project_versions
  where project_id=p_project_id and status='approved'
  order by version_no desc
  limit 1
  for update;
  if v.id is null then
    raise exception using errcode='23514',message='approved project version required';
  end if;
  if p_visibility is null or p_visibility not in ('public','targeted','invite_only') then
    raise exception using errcode='23514',message='invalid visibility';
  end if;
  if p_visibility<>'public' and coalesce(cardinality(p_contractor_ids),0)=0 then
    raise exception using errcode='23514',message='recipients required';
  end if;
  if p_request_ids is null or cardinality(p_request_ids)=0 then
    raise exception using errcode='23514',message='at least one request must be selected';
  end if;
  if exists (
    select 1 from unnest(p_request_ids) as selected(request_id)
    where selected.request_id is null
  ) then
    raise exception using errcode='23514',message='request selection cannot contain null';
  end if;
  if (select count(*) from unnest(p_request_ids)) <>
     (select count(distinct selected.request_id) from unnest(p_request_ids) as selected(request_id)) then
    raise exception using errcode='23514',message='request selection cannot contain duplicates';
  end if;

  -- Validate every request against the exact snapshots attached to the
  -- approved project version before creating any publication rows.
  for rid in select selected.request_id from unnest(p_request_ids) as selected(request_id) loop
    select * into v_request
    from public.project_requests r
    where r.id=rid and r.project_id=p_project_id and r.status='open'
    for update;
    if v_request.id is null then
      raise exception using errcode='23514',message='selected request must be active in this project';
    end if;

    select snapshot.* into rv
    from public.project_version_requests pvr
    join public.project_request_versions snapshot
      on snapshot.id=pvr.request_version_id and snapshot.project_id=pvr.project_id
    where pvr.project_id=p_project_id
      and pvr.project_version_id=v.id
      and snapshot.request_id=rid;
    if rv.id is null then
      raise exception using errcode='23514',message='selected request is not included in the approved project version';
    end if;
  end loop;

  insert into public.publications(project_id,project_version_id,visibility,safe_title,safe_description,
    governorate_id,delegation_id,project_type,surface_m2,desired_start_date,desired_end_date,
    indicative_budget_millimes,submission_deadline)
  values(p_project_id,v.id,p_visibility,v.title,v.description,v.governorate_id,v.delegation_id,
    v.project_type,v.surface_m2,v.desired_start_date,v.desired_end_date,v.indicative_budget_millimes,
    p_submission_deadline)
  returning * into p;

  for rid in select selected.request_id from unnest(p_request_ids) as selected(request_id) loop
    select snapshot.* into rv
    from public.project_version_requests pvr
    join public.project_request_versions snapshot
      on snapshot.id=pvr.request_version_id and snapshot.project_id=pvr.project_id
    where pvr.project_id=p_project_id
      and pvr.project_version_id=v.id
      and snapshot.request_id=rid;
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

commit;
