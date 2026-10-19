-- OCE (#301) : une synchronisation entièrement rejouée (toutes les étapes déjà faites, ex. retour à un contenu déjà synchronisé
-- ou relance sans changement) n'écrit aucune entrée de journal : l'état « synchronisé » du lot restait donc « en attente ».
-- Ajoute l'enregistrement explicite du succès d'une synchronisation complète. Réservé au serveur (service_role) ; additif.
begin;

create function dao_private.oce_mark_synced(p_mapping_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare m public.oce_sync_mappings;
begin
  select * into m from public.oce_sync_mappings where id=p_mapping_id for update;
  if m.id is null then raise exception using errcode='22023',message='Mapping OCE introuvable'; end if;
  if m.status='revoked' then raise exception using errcode='42501',message='Mapping OCE révoqué'; end if;
  update public.oce_sync_mappings set last_success_at=now(),updated_at=now(),last_error_kind=null,last_error_code=null,last_error_at=null,
    status=case when status='requested' then 'admitted' else status end,
    admitted_at=case when status='requested' then now() else admitted_at end
  where id=m.id;
end;
$$;

create function public.oce_mark_synced(p_mapping_id uuid) returns void
language sql security invoker set search_path='' as $$ select dao_private.oce_mark_synced($1); $$;

revoke all on function dao_private.oce_mark_synced(uuid),public.oce_mark_synced(uuid) from public,anon,authenticated;
grant execute on function dao_private.oce_mark_synced(uuid),public.oce_mark_synced(uuid) to service_role;

commit;
