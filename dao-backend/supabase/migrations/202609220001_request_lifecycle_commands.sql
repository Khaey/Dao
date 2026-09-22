begin;

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

  if v_request.id is null or not dao_private.owner(v_request.project_id) then
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

revoke all on function dao_private.update_project_request(uuid,uuid,text,text,bigint) from public,anon,authenticated;
grant execute on function dao_private.update_project_request(uuid,uuid,text,text,bigint) to authenticated,service_role;

create or replace function dao_private.withdraw_project_request(
  p_request_id uuid
) returns public.project_requests
language plpgsql
security definer
set search_path=''
as $$
declare
  v_request public.project_requests;
  v_project_version public.project_versions;
begin
  if auth.uid() is null then
    raise exception using errcode='42501', message='authentication required';
  end if;

  select * into v_request
  from public.project_requests
  where id = p_request_id;

  if v_request.id is null or not dao_private.owner(v_request.project_id) then
    raise exception using errcode='42501', message='project ownership required';
  end if;

  if v_request.status <> 'open' then
    raise exception using errcode='23514', message='only open requests can be removed';
  end if;

  if not exists (
    select 1 from public.projects
    where id = v_request.project_id and status = 'draft'
  ) then
    raise exception using errcode='23514', message='project must be draft';
  end if;

  select * into v_project_version
  from public.project_versions
  where project_id = v_request.project_id
    and status = 'draft'
  order by version_no desc
  limit 1;

  update public.project_requests
  set status = 'withdrawn'
  where id = p_request_id
  returning * into v_request;

  if v_project_version.id is not null then
    delete from public.project_version_requests pvr
    using public.project_request_versions prv
    where pvr.project_version_id = v_project_version.id
      and pvr.request_version_id = prv.id
      and prv.request_id = p_request_id;
  end if;

  return v_request;
end;
$$;

revoke all on function dao_private.withdraw_project_request(uuid) from public,anon,authenticated;
grant execute on function dao_private.withdraw_project_request(uuid) to authenticated,service_role;

create or replace function public.update_project_request(
  p_request_id uuid,
  p_trade_id uuid,
  p_title text,
  p_scope text,
  p_budget_millimes bigint default null
) returns public.project_request_versions
language sql
security definer
set search_path=''
as $$
  select dao_private.update_project_request($1,$2,$3,$4,$5);
$$;

revoke all on function public.update_project_request(uuid,uuid,text,text,bigint) from public,anon;
grant execute on function public.update_project_request(uuid,uuid,text,text,bigint) to authenticated,service_role;

create or replace function public.withdraw_project_request(
  p_request_id uuid
) returns public.project_requests
language sql
security definer
set search_path=''
as $$
  select dao_private.withdraw_project_request($1);
$$;

revoke all on function public.withdraw_project_request(uuid) from public,anon;
grant execute on function public.withdraw_project_request(uuid) to authenticated,service_role;

commit;
