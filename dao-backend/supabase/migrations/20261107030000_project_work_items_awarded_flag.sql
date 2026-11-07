-- #577 — recette DEV du 07/11/2026 : un lot attribué d'un chantier sorti de préparation a pour motif de verrou
-- « project_not_draft » (motif prioritaire), jamais « awarded ». L'écran des métrés ne reconnaissait donc pas
-- les lots attribués (avis de gel absent, aucun ouvrage proposé aux métrés d'exécution).
-- Le lot expose désormais un indicateur explicite « awarded » (attribution active), indépendant du motif de verrou.
-- Lecture seule : aucune donnée modifiée.

do $$
declare d text; n text;
begin
  d := pg_get_functiondef('dao_private.project_work_items_snapshot_v1(uuid)'::regprocedure);
  n := replace(d, $a$'lockReason', dao_private.project_work_item_lock_reason(r.id),$a$,
    $b$'lockReason', dao_private.project_work_item_lock_reason(r.id),
        'awarded', exists (select 1 from public.award_items ai where ai.request_id = r.id and ai.active),$b$);
  if n = d then raise exception 'project_work_items_snapshot_v1: anchor not found'; end if;
  execute n;
end $$;
