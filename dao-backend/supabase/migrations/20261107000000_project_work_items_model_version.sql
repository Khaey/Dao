-- #577 — revue contractuelle #578, écart 3 : une occurrence garde sa version du référentiel.
-- « Dimensions » n'est proposé que si un modèle actif existe dans la version EXACTE de l'occurrence
-- et que cette version est la version publiée (seul cas que le moteur de métrés sait calculer).
-- Sinon l'occurrence garde son unité/version historique et affiche « modèle historique indisponible ».
-- Aucune donnée existante n'est modifiée ; aucun remapping vers une version plus récente.

create or replace function dao_private.project_work_item_json(p_item_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'id', i.id, 'requestId', i.request_id, 'subLotId', i.sub_lot_id, 'workId', i.work_id, 'workCode', i.work_code,
    'catalogVersionId', i.catalog_version_id, 'catalogVersionCode', cv.code, 'label', i.label, 'unitCode', i.unit_code,
    'custom', i.work_id is null, 'confirmation', i.confirmation, 'origin', i.origin, 'ordinal', i.ordinal,
    'status', i.status, 'revision', i.revision, 'createdAt', i.created_at, 'updatedAt', i.updated_at,
    'catalogPath', case when w.id is null then null else jsonb_build_object('lot', cl.label_fr, 'subLot', cs.label_fr) end,
    'measurable', coalesce(mm.exact, false),
    'modelState', case when i.work_id is null then 'custom' when mm.exact then 'available'
                       when mm.any_model then 'historical_unavailable' else 'no_model' end,
    'takeoffs', (select count(*) from public.btp_takeoffs t where t.project_work_item_id = i.id),
    'validatedTakeoffs', (select count(*) from public.btp_takeoffs t where t.project_work_item_id = i.id and t.validated_revision is not null))
  from public.project_work_items i
  left join public.btp_catalog_versions cv on cv.id = i.catalog_version_id
  left join public.btp_works w on w.id = i.work_id and w.catalog_version_id = i.catalog_version_id
  left join public.btp_sub_lots cs on cs.id = w.sub_lot_id and cs.catalog_version_id = w.catalog_version_id
  left join public.btp_lots cl on cl.id = cs.lot_id and cl.catalog_version_id = cs.catalog_version_id
  left join lateral (select
      exists (select 1 from public.btp_measurement_templates m join public.btp_catalog_versions v on v.id = m.catalog_version_id
              join public.btp_works pw on pw.id = m.work_id and pw.catalog_version_id = m.catalog_version_id
              where m.work_id = i.work_id and m.catalog_version_id = i.catalog_version_id
                and m.active and pw.active and v.status = 'published') as exact,
      exists (select 1 from public.btp_measurement_templates m where m.work_id = i.work_id and m.active) as any_model
    ) mm on i.work_id is not null
  where i.id = p_item_id;
$$;

-- Garde serveur : un métré rattaché à une occurrence utilise un modèle de la même version et du même ouvrage.
create function dao_private.btp_takeoff_work_item_version_guard() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.project_work_item_id is not null and not exists (
    select 1 from public.project_work_items i
    where i.id = new.project_work_item_id and i.work_id = new.work_id and i.catalog_version_id = new.catalog_version_id) then
    raise exception using errcode = '22023', message = 'measurement model not in the work item catalogue version',
      hint = 'work_item_model_unavailable';
  end if;
  return new;
end; $$;
revoke all on function dao_private.btp_takeoff_work_item_version_guard() from public;

create trigger btp_takeoffs_work_item_version_guard before insert on public.btp_takeoffs
  for each row execute function dao_private.btp_takeoff_work_item_version_guard();
