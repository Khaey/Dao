begin;

create or replace function dao_private.submit_project_for_review(p_project_id uuid)
returns public.project_versions
language plpgsql security definer set search_path=''
as $$
declare v public.project_versions;
begin
 if auth.uid() is null or not dao_private.owner(p_project_id) then raise exception using errcode='42501',message='project ownership required'; end if;
 select * into v from public.project_versions where project_id=p_project_id and status='draft' order by version_no desc limit 1;
 if v.id is null then raise exception using errcode='23514',message='draft project version required'; end if;
 if not exists(select 1 from public.project_requests r where r.project_id=p_project_id and r.status='open') then raise exception using errcode='23514',message='at least one open request required'; end if;
 update public.project_versions set status='client_review' where id=v.id returning * into v;
 return v;
end; $$;

create or replace function dao_private.review_project(p_project_id uuid,p_approve boolean,p_comment text default null)
returns public.project_versions
language plpgsql security definer set search_path=''
as $$
declare v public.project_versions;
begin
 if auth.uid() is null or not dao_private.staff() then raise exception using errcode='42501',message='DAO reviewer required'; end if;
 select * into v from public.project_versions where project_id=p_project_id and status='client_review' order by version_no desc limit 1;
 if v.id is null then raise exception using errcode='23514',message='project is not awaiting review'; end if;
 update public.project_versions set status=case when p_approve then 'approved' else 'rejected' end where id=v.id returning * into v;
 return v;
end; $$;

create or replace function dao_private.publish_project(
 p_project_id uuid,p_visibility text,p_request_ids uuid[] default null,
 p_contractor_ids uuid[] default null,p_submission_deadline timestamptz default null)
returns public.publications
language plpgsql security definer set search_path=''
as $$
declare v public.project_versions; p public.publications; rid uuid; rv public.project_request_versions; c uuid;
begin
 if auth.uid() is null or not dao_private.staff() then raise exception using errcode='42501',message='DAO reviewer required'; end if;
 select * into v from public.project_versions where project_id=p_project_id and status='approved' order by version_no desc limit 1;
 if v.id is null then raise exception using errcode='23514',message='approved project version required'; end if;
 if p_visibility not in ('public','targeted','invite_only') then raise exception using errcode='23514',message='invalid visibility'; end if;
 if p_visibility<>'public' and coalesce(array_length(p_contractor_ids,1),0)=0 then raise exception using errcode='23514',message='recipients required'; end if;
 insert into public.publications(project_id,project_version_id,visibility,safe_title,safe_description,governorate_id,delegation_id,project_type,surface_m2,desired_start_date,indicative_budget_millimes,submission_deadline)
 values(p_project_id,v.id,p_visibility,v.title,v.description,v.governorate_id,v.delegation_id,v.project_type,v.surface_m2,v.desired_start_date,v.indicative_budget_millimes,p_submission_deadline) returning * into p;
 for rid in select unnest(coalesce(p_request_ids, array[]::uuid[])) loop
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
 update public.project_versions set status='approved' where id=v.id;
 return p;
end; $$;

revoke all on function dao_private.submit_project_for_review(uuid) from public,anon,authenticated;
revoke all on function dao_private.review_project(uuid,boolean,text) from public,anon,authenticated;
revoke all on function dao_private.publish_project(uuid,text,uuid[],uuid[],timestamptz) from public,anon,authenticated;
grant execute on function dao_private.submit_project_for_review(uuid) to authenticated,service_role;
grant execute on function dao_private.review_project(uuid,boolean,text) to authenticated,service_role;
grant execute on function dao_private.publish_project(uuid,text,uuid[],uuid[],timestamptz) to authenticated,service_role;

create or replace function public.submit_project_for_review(p_project_id uuid) returns public.project_versions language sql security definer set search_path='' as $$ select dao_private.submit_project_for_review($1); $$;
create or replace function public.review_project(p_project_id uuid,p_approve boolean,p_comment text default null) returns public.project_versions language sql security definer set search_path='' as $$ select dao_private.review_project($1,$2,$3); $$;
create or replace function public.publish_project(p_project_id uuid,p_visibility text,p_request_ids uuid[] default null,p_contractor_ids uuid[] default null,p_submission_deadline timestamptz default null) returns public.publications language sql security definer set search_path='' as $$ select dao_private.publish_project($1,$2,$3,$4,$5); $$;
revoke all on function public.submit_project_for_review(uuid) from public,anon;
revoke all on function public.review_project(uuid,boolean,text) from public,anon;
revoke all on function public.publish_project(uuid,text,uuid[],uuid[],timestamptz) from public,anon;
grant execute on function public.submit_project_for_review(uuid) to authenticated,service_role;
grant execute on function public.review_project(uuid,boolean,text) to authenticated,service_role;
grant execute on function public.publish_project(uuid,text,uuid[],uuid[],timestamptz) to authenticated,service_role;

commit;