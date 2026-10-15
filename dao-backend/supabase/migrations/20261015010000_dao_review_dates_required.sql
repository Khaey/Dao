-- #175: A DAO can be kept as an incomplete draft, but client submission
-- must not present missing desired dates as a reviewable/ready dossier.
-- Keep the original JWT ownership, lot and audit guarantees unchanged.
begin;

create or replace function dao_private.submit_project_for_review(p_project_id uuid)
returns public.project_versions
language plpgsql security definer set search_path=''
as $$
declare v public.project_versions;
begin
  if auth.uid() is null or not dao_private.owner(p_project_id) then
    raise exception using errcode='42501', message='project ownership required';
  end if;

  select * into v
  from public.project_versions
  where project_id=p_project_id and status='draft'
  order by version_no desc
  limit 1;
  if v.id is null then
    raise exception using errcode='23514', message='draft project version required';
  end if;
  if not exists(
    select 1 from public.project_requests
    where project_id=p_project_id and status='open'
  ) then
    raise exception using errcode='23514', message='at least one open request required';
  end if;

  if v.desired_start_date is null or v.desired_end_date is null then
    raise exception using errcode='23514',
      message='desired start and end dates required for DAO review';
  end if;
  if v.desired_end_date < v.desired_start_date then
    raise exception using errcode='23514',
      message='desired end date must be on or after start date';
  end if;

  update public.project_versions
  set status='client_review'
  where id=v.id
  returning * into v;
  insert into public.project_reviews(project_version_id,actor_id,actor_role,decision,reason)
  values(v.id,auth.uid(),'client','approved',null);
  return v;
end;
$$;

revoke all on function dao_private.submit_project_for_review(uuid)
  from public,anon,authenticated;
grant execute on function dao_private.submit_project_for_review(uuid)
  to authenticated,service_role;

commit;
