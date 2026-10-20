-- #325 : un lien effectif (confirmé) ne peut plus être retiré. Le contrat de la passerelle OCE n'a aucune opération de suppression
-- d'activité ou de dépendance : retirer un lien côté D.A.O laisserait la dépendance active dans OCE (chemin critique faux).
-- Remplace uniquement dao_private.decide_plan_link (même signature, mêmes droits) ; additif.
begin;

create or replace function dao_private.decide_plan_link(p_project_id uuid,p_link_id uuid,p_decision text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d jsonb; l jsonb; f text[]:='{}'; t text[]:='{}'; e jsonb;
begin
  if not dao_private.project_plan_access(p_project_id) then raise exception using errcode='42501',message='Accès au planning du projet refusé'; end if;
  if p_decision not in ('confirmed','rejected') then raise exception using errcode='22023',message='Décision invalide'; end if;
  d:=dao_private.project_plan_data(p_project_id);
  select value into l from jsonb_array_elements(d->'links') where value->>'id'=p_link_id::text;
  if l is null then raise exception using errcode='22023',message='Lien inconnu ou lot non attribué'; end if;
  -- La passerelle OCE ne sait pas retirer une dépendance déjà appliquée : une confirmation effective est donc définitive.
  if p_decision='rejected' and l->>'state'='effective' then raise exception using errcode='22023',message='confirmed_link_final'; end if;
  if p_decision='confirmed' then
    if l->>'pred_target' is null or l->>'succ_target' is null then raise exception using errcode='22023',message='Lien non résolu : les deux extrémités doivent être attribuées et planifiées'; end if;
    for e in select value from jsonb_array_elements(d->'links') where value->>'state'='effective' and value->>'id'<>p_link_id::text loop
      f:=f||(e->>'pred_target'); t:=t||(e->>'succ_target');
    end loop;
    f:=f||(l->>'pred_target'); t:=t||(l->>'succ_target');
    if dao_private.edges_have_cycle(f,t) then raise exception using errcode='23514',message='dependency_cycle'; end if;
  end if;
  insert into public.project_plan_link_decisions(project_id,link_id,decision,decided_by) values(p_project_id,p_link_id,p_decision,auth.uid());
  return dao_private.get_project_plan(p_project_id);
end;
$$;

commit;
