-- OCE (#301) : rejouer l'enregistrement d'un plan IDENTIQUE ne doit ni changer la révision ni repasser l'état de
-- synchronisation à « en attente ». Seule une modification réelle (dates ou statut) met à jour updated_at.
-- Remplace uniquement dao_private.oce_save_lot_plan (même signature, mêmes droits) ; additif, aucune donnée modifiée.
begin;

create or replace function dao_private.oce_save_lot_plan(p_project_id uuid,p_request_id uuid,p_start date,p_end date,p_ready boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v public.oce_lot_plans;
begin
  if not dao_private.oce_plan_access(p_project_id,p_request_id) then raise exception using errcode='42501',message='Accès au planning du lot refusé'; end if;
  if p_start is null and p_end is not null or p_start is not null and p_end is null then raise exception using errcode='22023',message='Dates de début et de fin requises ensemble'; end if;
  if p_end<p_start then raise exception using errcode='22023',message='La fin précède le début'; end if;
  if p_ready and p_start is null then raise exception using errcode='22023',message='Un planning prêt exige des dates explicites'; end if;
  insert into public.oce_lot_plans(project_id,request_id,planned_start,planned_end,status,updated_by)
    values(p_project_id,p_request_id,p_start,p_end,case when p_ready then 'ready' else 'draft' end,auth.uid())
  on conflict(project_id,request_id) do update set planned_start=excluded.planned_start,planned_end=excluded.planned_end,
    status=excluded.status,
    updated_by=case when (public.oce_lot_plans.planned_start,public.oce_lot_plans.planned_end,public.oce_lot_plans.status)
      is distinct from (excluded.planned_start,excluded.planned_end,excluded.status) then auth.uid() else public.oce_lot_plans.updated_by end,
    updated_at=case when (public.oce_lot_plans.planned_start,public.oce_lot_plans.planned_end,public.oce_lot_plans.status)
      is distinct from (excluded.planned_start,excluded.planned_end,excluded.status) then now() else public.oce_lot_plans.updated_at end,
    revision=case when (public.oce_lot_plans.planned_start,public.oce_lot_plans.planned_end,public.oce_lot_plans.status)
      is distinct from (excluded.planned_start,excluded.planned_end,excluded.status) then public.oce_lot_plans.revision+1 else public.oce_lot_plans.revision end
  returning * into v;
  return jsonb_build_object('status',v.status,'revision',v.revision,'planned_start',v.planned_start,'planned_end',v.planned_end);
end;
$$;

commit;
