-- #577 — décision du propriétaire (07/11/2026) : les métrés PRÉVISIONNELS ne changent plus après attribution.
-- Les quantités réalisées se suivent dans les situations de travaux (révisions et justificatifs propres) ;
-- un nouvel ouvrage après attribution passe par une modification de périmètre validée, jamais par un ouvrage privé.
-- Garde serveur : aucune création, aucun recalcul, aucune soumission ni validation d'un métré prévisionnel
-- dont le lot a une attribution active. Le seul changement encore admis est le rattachement d'un ancien métré
-- à une occurrence (historique). Rien n'est supprimé ni modifié dans les données existantes.

create function dao_private.btp_takeoff_forecast_frozen(p_project_id uuid, p_work_item_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select case
    when p_work_item_id is not null then exists (
      select 1 from public.project_work_items i join public.award_items ai on ai.request_id = i.request_id and ai.active
      where i.id = p_work_item_id)
    -- Ancien métré non rattaché : figé seulement si tous les lots actifs du chantier sont attribués.
    else exists (select 1 from public.project_requests r where r.project_id = p_project_id and r.status <> 'withdrawn')
      and not exists (select 1 from public.project_requests r where r.project_id = p_project_id and r.status <> 'withdrawn'
        and not exists (select 1 from public.award_items ai where ai.request_id = r.id and ai.active))
  end;
$$;
revoke all on function dao_private.btp_takeoff_forecast_frozen(uuid, uuid) from public, anon, authenticated;

create function dao_private.btp_takeoff_frozen_after_award_guard() returns trigger
language plpgsql set search_path='' as $$
begin
  if TG_OP = 'UPDATE' and (to_jsonb(new) - 'project_work_item_id' - 'updated_at') = (to_jsonb(old) - 'project_work_item_id' - 'updated_at') then
    return new; -- rattachement d'un ancien métré : historique, aucune quantité modifiée
  end if;
  if dao_private.btp_takeoff_forecast_frozen(new.project_id, new.project_work_item_id) then
    raise exception using errcode = '23514', message = 'forecast takeoff frozen after award',
      hint = 'takeoff_frozen_after_award';
  end if;
  return new;
end; $$;
revoke all on function dao_private.btp_takeoff_frozen_after_award_guard() from public;

create trigger btp_takeoffs_frozen_after_award before insert or update on public.btp_takeoffs
  for each row execute function dao_private.btp_takeoff_frozen_after_award_guard();
