begin;

-- PostgreSQL rejects removing an existing parameter default with CREATE OR
-- REPLACE (42P13). Recreate the two five-argument overloads in this transaction
-- and restore their current owner and ACL exactly.
drop function public.add_project_request(uuid,uuid,text,text,bigint);
drop function dao_private.add_project_request(uuid,uuid,text,text,bigint);

create or replace function dao_private.add_project_request(
  p_project_id uuid,p_trade_id uuid,p_title text,p_scope text,p_budget_millimes bigint
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
alter function dao_private.add_project_request(uuid,uuid,text,text,bigint) owner to postgres;
revoke all on function dao_private.add_project_request(uuid,uuid,text,text,bigint) from public,anon,authenticated,service_role;
grant execute on function dao_private.add_project_request(uuid,uuid,text,text,bigint) to authenticated,service_role;

-- Preserve the private four-argument legacy contract through the current checks.
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

-- Keep the five-argument public RPC exact and delegate explicitly to its
-- matching private overload.
create or replace function public.add_project_request(
  p_project_id uuid,
  p_trade_id uuid,
  p_title text,
  p_scope text,
  p_budget_millimes bigint
)
returns public.project_requests
language sql
security definer
set search_path=''
as $$
  select dao_private.add_project_request($1,$2,$3,$4,$5);
$$;
alter function public.add_project_request(uuid,uuid,text,text,bigint) owner to postgres;
revoke all on function public.add_project_request(uuid,uuid,text,text,bigint) from public,anon,authenticated,service_role;
grant execute on function public.add_project_request(uuid,uuid,text,text,bigint) to authenticated,service_role;

-- Keep four-key PostgREST calls bound to the legacy public arity while still
-- invoking the secured five-argument implementation.
create or replace function public.add_project_request(
  p_project_id uuid,
  p_trade_id uuid,
  p_title text,
  p_scope text
)
returns public.project_requests
language sql
security definer
set search_path=''
as $$
  select dao_private.add_project_request($1,$2,$3,$4,null::bigint);
$$;

notify pgrst, 'reload schema';

commit;
