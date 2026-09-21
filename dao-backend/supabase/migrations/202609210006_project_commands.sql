begin;
create or replace function dao_private.create_project_draft(
  p_project_type text, p_surface_m2 numeric, p_desired_start_date date,
  p_indicative_budget_millimes bigint, p_governorate_id uuid,
  p_delegation_id uuid default null, p_locality_id uuid default null
) returns public.projects language plpgsql security definer set search_path='' as $$
declare v_project public.projects;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication required'; end if;
  insert into public.projects(client_id,project_type,surface_m2,desired_start_date,indicative_budget_millimes)
  values(auth.uid(),p_project_type, p_surface_m2,p_desired_start_date,p_indicative_budget_millimes) returning * into v_project;
  insert into public.project_versions(project_id,version_no,title,description,governorate_id,delegation_id,locality_id,project_type,surface_m2,desired_start_date,indicative_budget_millimes)
  values(v_project.id,1,'Nouveau projet','Brouillon',p_governorate_id,p_delegation_id,p_locality_id,p_project_type,p_surface_m2,p_desired_start_date,p_indicative_budget_millimes);
  return v_project;
end; $$;
revoke all on function dao_private.create_project_draft(text,numeric,date,bigint,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function dao_private.create_project_draft(text,numeric,date,bigint,uuid,uuid,uuid) to authenticated,service_role;

create or replace function dao_private.add_project_request(p_project_id uuid,p_trade_id uuid,p_title text,p_scope text)
returns public.project_requests language plpgsql security definer set search_path='' as $$
declare v_request public.project_requests; v_version public.project_versions;
begin
  if auth.uid() is null or not dao_private.owner(p_project_id) then raise exception using errcode='42501',message='project ownership required'; end if;
  select * into v_version from public.project_versions where project_id=p_project_id order by version_no desc limit 1;
  if v_version.id is null then raise exception using errcode='23503',message='project version required'; end if;
  insert into public.project_requests(project_id) values(p_project_id) returning * into v_request;
  insert into public.project_request_versions(request_id,project_id,version_no,trade_id,title,scope) values(v_request.id,p_project_id,1,p_trade_id,p_title,p_scope);
  insert into public.project_version_requests(project_id,project_version_id,request_version_id) values(p_project_id,v_version.id,(select id from public.project_request_versions where request_id=v_request.id and version_no=1));
  return v_request;
end; $$;
revoke all on function dao_private.add_project_request(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function dao_private.add_project_request(uuid,uuid,text,text) to authenticated,service_role;
commit;
