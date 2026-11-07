-- #577 — décision du propriétaire (07/11/2026) : « Suivi du chantier : les métrés d'exécution restent possibles
-- après attribution, avec leurs propres révisions et justificatifs. »
-- Un métré d'exécution réutilise le moteur déterministe des métrés (#548) : mêmes dimensions avec provenance,
-- mêmes révisions immuables, même soumission/validation tracée. Il est distinct du prévisionnel :
--   * kind = 'execution', immuable ; uniquement sur une occurrence d'un lot ATTRIBUÉ ;
--   * jamais lu par l'estimation ni le budget prévisionnel ;
--   * le prévisionnel reste figé après attribution (20261107010000).
-- Aucune facture, aucun paiement, aucune situation de travaux créés ; aucune donnée existante modifiée.

alter table public.btp_takeoffs add column kind text not null default 'forecast' check (kind in ('forecast','execution'));
-- Le point d'entrée « exécution » fixe le type pour la transaction ; toute autre écriture reste prévisionnelle.
alter table public.btp_takeoffs alter column kind set default coalesce(nullif(current_setting('dao.takeoff_kind', true), ''), 'forecast');

create or replace function dao_private.btp_takeoff_frozen_after_award_guard() returns trigger
language plpgsql set search_path='' as $$
begin
  if TG_OP = 'UPDATE' and new.kind is distinct from old.kind then
    raise exception using errcode = '23514', message = 'takeoff kind is immutable';
  end if;
  if TG_OP = 'UPDATE' and (to_jsonb(new) - 'project_work_item_id' - 'updated_at') = (to_jsonb(old) - 'project_work_item_id' - 'updated_at') then
    return new; -- rattachement d'un ancien métré : historique, aucune quantité modifiée
  end if;
  if new.kind = 'execution' then
    if new.project_work_item_id is null or not dao_private.btp_takeoff_forecast_frozen(new.project_id, new.project_work_item_id) then
      raise exception using errcode = '23514', message = 'execution takeoff requires an awarded lot',
        hint = 'execution_takeoff_requires_award';
    end if;
    return new;
  end if;
  if dao_private.btp_takeoff_forecast_frozen(new.project_id, new.project_work_item_id) then
    raise exception using errcode = '23514', message = 'forecast takeoff frozen after award',
      hint = 'takeoff_frozen_after_award';
  end if;
  return new;
end; $$;

-- Le type est exposé dans chaque métré.
do $$
declare d text; n text;
begin
  d := pg_get_functiondef('dao_private.btp_takeoff_payload(uuid)'::regprocedure);
  n := replace(d, $a$'workItemId',t.project_work_item_id,$a$, $b$'workItemId',t.project_work_item_id,'kind',t.kind,$b$);
  if n = d then raise exception 'btp_takeoff_payload: anchor not found'; end if;
  execute n;

  -- L'estimation et le budget prévisionnel ne lisent jamais un métré d'exécution.
  d := pg_get_functiondef('dao_private.btp_estimate_compute(uuid,jsonb)'::regprocedure);
  n := replace(d, $a$where t.project_id=p_project_id and t.validated_revision is not null$a$,
                  $b$where t.project_id=p_project_id and t.validated_revision is not null and t.kind='forecast'$b$);
  n := replace(n, $a$where t.id=$1'$a$, $b$where t.id=$1 and t.kind=''forecast'''$b$);
  if n = d or position($b$t.kind=''forecast''$b$ in n) = 0 or position($b$t.validated_revision is not null and t.kind='forecast'$b$ in n) = 0 then
    raise exception 'btp_estimate_compute: anchors not found';
  end if;
  execute n;

  d := pg_get_functiondef('dao_private.btp_estimate_snapshot_v1(uuid)'::regprocedure);
  n := replace(d, $a$from public.btp_takeoffs t where t.project_id=p_project_id),$a$, $b$from public.btp_takeoffs t where t.project_id=p_project_id and t.kind='forecast'),$b$);
  if n = d then raise exception 'btp_estimate_snapshot_v1: anchor not found'; end if;
  execute n;
end $$;

-- Point d'entrée des métrés d'exécution : mêmes contrôles que le prévisionnel (droits, révisions, idempotence),
-- plus le type « exécution » ; une soumission/validation par ce point vérifie que le métré est bien d'exécution.
create function dao_private.btp_execution_takeoff_command_v1(p_action text, p_input jsonb, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_result jsonb; v_takeoff uuid;
begin
  v_takeoff := nullif(p_input->>'takeoffId', '')::uuid;
  if v_takeoff is not null and not exists (select 1 from public.btp_takeoffs t where t.id = v_takeoff and t.kind = 'execution') then
    raise exception using errcode = '22023', message = 'not an execution takeoff';
  end if;
  perform set_config('dao.takeoff_kind', 'execution', true);
  v_result := dao_private.btp_takeoff_command_v1(p_action, p_input, p_idempotency_key);
  perform set_config('dao.takeoff_kind', '', true);
  return v_result;
end; $$;
revoke all on function dao_private.btp_execution_takeoff_command_v1(text, jsonb, text) from public, anon, authenticated;
grant execute on function dao_private.btp_execution_takeoff_command_v1(text, jsonb, text) to authenticated, service_role;

create function public.btp_execution_takeoff_command_v1(p_action text, p_input jsonb, p_idempotency_key text) returns jsonb
language sql security invoker set search_path='' as $$ select dao_private.btp_execution_takeoff_command_v1($1, $2, $3); $$;
revoke all on function public.btp_execution_takeoff_command_v1(text, jsonb, text) from public, anon;
grant execute on function public.btp_execution_takeoff_command_v1(text, jsonb, text) to authenticated, service_role;
