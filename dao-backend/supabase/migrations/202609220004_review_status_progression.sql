begin;
create or replace function dao_private.review_project(p_project_id uuid,p_approve boolean,p_comment text default null)
returns public.project_versions language plpgsql security definer set search_path=''
as $$
declare v public.project_versions; v_status text;
begin
 if auth.uid() is null or not dao_private.staff() then raise exception using errcode='42501',message='DAO reviewer required'; end if;
 select * into v from public.project_versions where project_id=p_project_id and status in ('client_review','dao_review') order by version_no desc limit 1;
 if v.id is null then raise exception using errcode='23514',message='project is not awaiting review'; end if;
 v_status:=case when not p_approve then 'rejected' when v.status='client_review' then 'dao_review' else 'approved' end;
 update public.project_versions set status=v_status where id=v.id returning * into v;
 return v;
end; $$;
revoke all on function dao_private.review_project(uuid,boolean,text) from public,anon,authenticated;
grant execute on function dao_private.review_project(uuid,boolean,text) to authenticated,service_role;
commit;