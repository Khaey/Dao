begin;

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
  if auth.uid() is null or not dao_private.owner(p_project_id) then
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
revoke all on function dao_private.update_project_draft(uuid,text,text,text,numeric,date,bigint,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function dao_private.update_project_draft(uuid,text,text,text,numeric,date,bigint,uuid,uuid,uuid) to authenticated,service_role;

create or replace function public.update_project_draft(
  p_project_id uuid,p_title text,p_description text,p_project_type text,p_surface_m2 numeric,
  p_desired_start_date date,p_indicative_budget_millimes bigint,p_governorate_id uuid,
  p_delegation_id uuid default null,p_locality_id uuid default null
) returns public.project_versions language sql security definer set search_path=''
as $$ select dao_private.update_project_draft($1,$2,$3,$4,$5,$6,$7,$8,$9,$10); $$;
revoke all on function public.update_project_draft(uuid,text,text,text,numeric,date,bigint,uuid,uuid,uuid) from public,anon;
grant execute on function public.update_project_draft(uuid,text,text,text,numeric,date,bigint,uuid,uuid,uuid) to authenticated,service_role;
commit;