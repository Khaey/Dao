-- OCE (#301) : la synchronisation doit savoir quelle révision du plan elle applique. Les clés d'idempotence ne dépendaient que du
-- contenu : revenir à un contenu déjà synchronisé (ex. 18/12 → 31/12 → 18/12) rejouait l'ancien journal et ne mettait
-- jamais la passerelle à jour. La révision (monotone, +1 à chaque vrai changement) devient la « génération » des clés.
-- Remplace uniquement dao_private.oce_lot_plan_for_sync (même signature, mêmes droits : service_role) ; additif.
begin;

create or replace function dao_private.oce_lot_plan_for_sync(p_project_id uuid,p_request_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('lot_title',rv.title,'region',g.name_fr,'planned_start',pl.planned_start,'planned_end',pl.planned_end,'revision',pl.revision)
  from public.oce_lot_plans pl
  join public.project_requests r on r.id=pl.request_id and r.project_id=pl.project_id and r.status<>'withdrawn'
  join public.projects p on p.id=pl.project_id and p.status<>'archived'
  join lateral (select title from public.project_request_versions v where v.request_id=r.id order by version_no desc limit 1) rv on true
  join lateral (select governorate_id from public.project_versions pv where pv.project_id=p.id order by version_no desc limit 1) pvv on true
  join public.governorates g on g.id=pvv.governorate_id
  where pl.project_id=p_project_id and pl.request_id=p_request_id and pl.status='ready';
$$;

commit;
