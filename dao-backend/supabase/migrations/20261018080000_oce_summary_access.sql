-- OCE Engine V1 (#58) : règle d'accès à la lecture du résumé technique de planning d'un lot.
-- Lecture seule, informatif. Autorisés : le Client propriétaire du projet et la gestion D.A.O du projet
-- (dao_admin, ou relecteur assigné). Les autres membres (professionnels) ne sont PAS autorisés dans cette version.
-- Le lot doit appartenir au projet, ne pas être retiré, le projet ne pas être archivé et le mapping être admis.
-- Retourne uniquement un booléen : aucun détail ne permet d'énumérer des projets ou des lots.
begin;

create function dao_private.oce_summary_access(p_project_id uuid,p_request_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and dao_private.account_active(auth.uid())
    and (dao_private.owner(p_project_id) or dao_private.manages_project(p_project_id))
    and exists(
      select 1 from public.oce_sync_mappings m
      join public.project_requests r on r.id=m.request_id and r.project_id=m.project_id
      join public.projects p on p.id=m.project_id
      where m.project_id=p_project_id and m.request_id=p_request_id and m.status='admitted'
        and p.status<>'archived' and r.status<>'withdrawn');
$$;

create function public.oce_summary_access(p_project_id uuid,p_request_id uuid) returns boolean
language sql stable security invoker set search_path='' as $$ select dao_private.oce_summary_access($1,$2); $$;

revoke all on function dao_private.oce_summary_access(uuid,uuid),public.oce_summary_access(uuid,uuid) from public,anon,authenticated;
grant execute on function dao_private.oce_summary_access(uuid,uuid),public.oce_summary_access(uuid,uuid) to authenticated,service_role;

commit;
