begin;
create or replace function public.create_project_draft(p_project_type text,p_surface_m2 numeric,p_desired_start_date date,p_indicative_budget_millimes bigint,p_governorate_id uuid,p_delegation_id uuid default null,p_locality_id uuid default null) returns public.projects language sql security definer set search_path='' as $$ select dao_private.create_project_draft($1,$2,$3,$4,$5,$6,$7); $$;
revoke all on function public.create_project_draft(text,numeric,date,bigint,uuid,uuid,uuid) from public,anon; grant execute on function public.create_project_draft(text,numeric,date,bigint,uuid,uuid,uuid) to authenticated,service_role;
create or replace function public.add_project_request(p_project_id uuid,p_trade_id uuid,p_title text,p_scope text) returns public.project_requests language sql security definer set search_path='' as $$ select dao_private.add_project_request($1,$2,$3,$4); $$;
revoke all on function public.add_project_request(uuid,uuid,text,text) from public,anon; grant execute on function public.add_project_request(uuid,uuid,text,text) to authenticated,service_role;
commit;
