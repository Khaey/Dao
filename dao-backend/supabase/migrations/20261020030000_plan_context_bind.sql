-- #325 : rattacher le contexte de planning d'un projet à l'un de SES lots (service_role uniquement).
-- Sert à la recette DEV : la passerelle OCE n'admet qu'un couple (projet, lot) exact ; le contexte du projet peut ainsi réutiliser
-- le couple déjà admis sans toucher aux scripts d'exploitation. Refusé si l'identifiant n'est pas un lot de ce projet.
begin;

create function dao_private.oce_plan_context_bind(p_project_id uuid,p_context_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.project_requests r where r.id=p_context_id and r.project_id=p_project_id) then
    raise exception using errcode='22023',message='Le contexte doit être un lot du projet';
  end if;
  insert into public.project_plan_contexts(project_id,context_id,revision) values(p_project_id,p_context_id,2)
  on conflict(project_id) do update set context_id=excluded.context_id,revision=public.project_plan_contexts.revision+1,updated_at=now()
  where public.project_plan_contexts.context_id<>excluded.context_id;
  return true;
end;
$$;
create function public.oce_plan_context_bind(p_project_id uuid,p_context_id uuid) returns boolean
language sql security invoker set search_path='' as $$ select dao_private.oce_plan_context_bind($1,$2); $$;
revoke all on function dao_private.oce_plan_context_bind(uuid,uuid),public.oce_plan_context_bind(uuid,uuid) from public,anon,authenticated;
grant execute on function dao_private.oce_plan_context_bind(uuid,uuid),public.oce_plan_context_bind(uuid,uuid) to service_role;

commit;
