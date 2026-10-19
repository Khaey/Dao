-- OCE (#301) : l'état « synchronisé » d'un lot reposait sur la comparaison d'horodatages (dernier succès >= dernière modification
-- du plan). Une synchronisation qui avait lu une ANCIENNE version du plan et se terminait après une nouvelle sauvegarde
-- affichait « synchronisé » alors que la passerelle n'avait pas le nouveau plan. L'état dépend désormais de la RÉVISION réellement
-- appliquée : le mapping mémorise la plus haute révision synchronisée, et le lot est « synchronisé » seulement si elle atteint la
-- révision courante du plan. Additif (colonne nullable) ; oce_mark_synced prend la révision ; réservé au serveur (service_role).
begin;

alter table public.oce_sync_mappings add column synced_revision integer check (synced_revision is null or synced_revision>0);

-- L'ancienne oce_mark_synced(uuid) (migration 20261019170000) est conservée : migration purement additive, elle n'est plus appelée.

create function dao_private.oce_mark_synced(p_mapping_id uuid,p_revision integer) returns void
language plpgsql security definer set search_path='' as $$
declare m public.oce_sync_mappings;
begin
  if p_revision is null or p_revision<1 then raise exception using errcode='22023',message='Révision de plan invalide'; end if;
  select * into m from public.oce_sync_mappings where id=p_mapping_id for update;
  if m.id is null then raise exception using errcode='22023',message='Mapping OCE introuvable'; end if;
  if m.status='revoked' then raise exception using errcode='42501',message='Mapping OCE révoqué'; end if;
  update public.oce_sync_mappings set last_success_at=now(),updated_at=now(),last_error_kind=null,last_error_code=null,last_error_at=null,
    synced_revision=greatest(coalesce(synced_revision,0),p_revision),
    status=case when status='requested' then 'admitted' else status end,
    admitted_at=case when status='requested' then now() else admitted_at end
  where id=m.id;
end;
$$;

create function public.oce_mark_synced(p_mapping_id uuid,p_revision integer) returns void
language sql security invoker set search_path='' as $$ select dao_private.oce_mark_synced($1,$2); $$;

revoke all on function dao_private.oce_mark_synced(uuid,integer),public.oce_mark_synced(uuid,integer) from public,anon,authenticated;
grant execute on function dao_private.oce_mark_synced(uuid,integer),public.oce_mark_synced(uuid,integer) to service_role;

create or replace function dao_private.oce_get_lot_plan(p_project_id uuid,p_request_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v public.oce_lot_plans; m public.oce_sync_mappings; s text;
begin
  if not dao_private.oce_plan_access(p_project_id,p_request_id) then raise exception using errcode='42501',message='Accès au planning du lot refusé'; end if;
  select * into v from public.oce_lot_plans where project_id=p_project_id and request_id=p_request_id;
  if v.id is null then return jsonb_build_object('status','none','sync',jsonb_build_object('state','not_requested')); end if;
  select * into m from public.oce_sync_mappings where project_id=p_project_id and request_id=p_request_id;
  s:=case when v.status<>'ready' then 'not_requested'
    when m.id is null then 'pending'
    when coalesce(m.synced_revision,0)>=v.revision then 'synced'
    when m.last_error_at is not null and m.last_error_at>=v.updated_at then 'failed'
    else 'pending' end;
  return jsonb_build_object('status',v.status,'revision',v.revision,'planned_start',v.planned_start,'planned_end',v.planned_end,
    'sync',jsonb_build_object('state',s,'last_success_at',m.last_success_at,
      'error_kind',case when s='failed' then m.last_error_kind end,'error_code',case when s='failed' then m.last_error_code end));
end;
$$;

commit;
