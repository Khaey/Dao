-- #325 : modifier / retirer / remplacer un lien du planning global (aucun lien irréversible), retraits OCE réconciliés.
-- Additif : 2 tables append-only (liens ajoutés par le Client ou la gestion, leurs retraits), 3 RPC, 2 RPC serveur de suivi d'objets OCE,
-- et remplacement de project_plan_data / decide_plan_link (mêmes signatures et droits). Aucun droit élargi.
begin;

create table public.project_plan_manual_links (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  project_id uuid not null references public.projects,
  pred_target text not null check (pred_target ~ '^(lot|node):[0-9a-f-]{36}$'),
  succ_target text not null check (succ_target ~ '^(lot|node):[0-9a-f-]{36}$' and succ_target<>pred_target),
  created_by uuid not null references auth.users
);
create index on public.project_plan_manual_links(project_id);
create table public.project_plan_manual_link_removals (
  link_id uuid primary key references public.project_plan_manual_links,
  removed_at timestamptz not null default now(),
  project_id uuid not null references public.projects,
  removed_by uuid not null references auth.users
);
alter table public.project_plan_manual_links enable row level security;
alter table public.project_plan_manual_link_removals enable row level security;
revoke all on public.project_plan_manual_links,public.project_plan_manual_link_removals from public,anon,authenticated;
create trigger project_plan_manual_links_append_only before update or delete on public.project_plan_manual_links
  for each row execute function dao_private.plan_decisions_append_only();
create trigger project_plan_manual_link_removals_append_only before update or delete on public.project_plan_manual_link_removals
  for each row execute function dao_private.plan_decisions_append_only();
create function dao_private.trg_bump_plan_manual() returns trigger language plpgsql security definer set search_path='' as $$
begin perform dao_private.bump_project_plan(new.project_id); return new; end;
$$;
create trigger plan_manual_links_bump after insert on public.project_plan_manual_links for each row execute function dao_private.trg_bump_plan_manual();
create trigger plan_manual_link_removals_bump after insert on public.project_plan_manual_link_removals for each row execute function dao_private.trg_bump_plan_manual();

create or replace function dao_private.project_plan_data(p_project_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
with lots as (
  select r.id,
    (select v.title from public.project_request_versions v where v.request_id=r.id order by v.version_no desc limit 1) as title,
    pl.planned_start,pl.planned_end,coalesce(pl.status='ready',false) as ready
  from public.project_requests r
  left join public.oce_lot_plans pl on pl.request_id=r.id and pl.project_id=r.project_id
  where r.project_id=p_project_id and r.status<>'withdrawn'
), awarded as (
  select ai.request_id,ai.bid_item_id,bi.bid_version_id,ai.contractor_id
  from public.award_items ai
  join public.awards a on a.id=ai.award_id and a.status<>'cancelled'
  join public.bid_items bi on bi.id=ai.bid_item_id
  where ai.project_id=p_project_id and ai.active
), nodes as (
  select s.id,s.request_id,s.node_key,s.title,s.start_date,s.end_date,s.official_sub_lot_id,s.bid_version_id,s.position
  from public.bid_sub_lots s join awarded aw on aw.bid_item_id=s.bid_item_id
), raw as (
  select l.id,l.bid_version_id,l.pred_kind,l.pred_ref,l.succ_kind,l.succ_ref,
    (select d.decision from public.project_plan_link_decisions d where d.link_id=l.id order by d.seq desc limit 1) as decision
  from public.bid_sub_lot_links l where l.bid_version_id in (select bid_version_id from awarded)
), res as (
  select raw.*,
    case raw.pred_kind
      when 'proposal' then (select 'node:'||n.id::text from nodes n where n.node_key=raw.pred_ref and n.bid_version_id=raw.bid_version_id and n.start_date is not null)
      when 'lot' then (select 'lot:'||t.id::text from lots t where t.id=raw.pred_ref and t.ready)
      else (select 'node:'||n.id::text from nodes n where n.official_sub_lot_id=raw.pred_ref and n.start_date is not null order by n.id limit 1) end as pred_target,
    case raw.succ_kind
      when 'proposal' then (select 'node:'||n.id::text from nodes n where n.node_key=raw.succ_ref and n.bid_version_id=raw.bid_version_id and n.start_date is not null)
      when 'lot' then (select 'lot:'||t.id::text from lots t where t.id=raw.succ_ref and t.ready)
      else (select 'node:'||n.id::text from nodes n where n.official_sub_lot_id=raw.succ_ref and n.start_date is not null order by n.id limit 1) end as succ_target
  from raw
), labelled as (
  select res.*,
    case res.pred_kind
      when 'proposal' then (select s.title from public.bid_sub_lots s where s.bid_version_id=res.bid_version_id and s.node_key=res.pred_ref)
      when 'lot' then (select t.title from lots t where t.id=res.pred_ref)
      else (select v.title from public.request_sub_lot_versions v where v.sub_lot_id=res.pred_ref order by v.created_at desc limit 1) end as pred_label,
    case res.succ_kind
      when 'proposal' then (select s.title from public.bid_sub_lots s where s.bid_version_id=res.bid_version_id and s.node_key=res.succ_ref)
      when 'lot' then (select t.title from lots t where t.id=res.succ_ref)
      else (select v.title from public.request_sub_lot_versions v where v.sub_lot_id=res.succ_ref order by v.created_at desc limit 1) end as succ_label
  from res
)
, tgt as (
  select 'node:'||n.id::text as target,n.title as label from nodes n where n.start_date is not null
  union all select 'lot:'||t.id::text,t.title from lots t where t.ready
), manual as (
  select m.id,m.pred_target,m.succ_target,
    (select g.target from tgt g where g.target=m.pred_target) as pred_ok,
    (select g.target from tgt g where g.target=m.succ_target) as succ_ok,
    (select g.label from tgt g where g.target=m.pred_target) as pred_label,
    (select g.label from tgt g where g.target=m.succ_target) as succ_label
  from public.project_plan_manual_links m
  where m.project_id=p_project_id and not exists(select 1 from public.project_plan_manual_link_removals r where r.link_id=m.id)
)
select jsonb_build_object(
  'revision',coalesce((select c.revision from public.project_plan_contexts c where c.project_id=p_project_id),1),
  'context_id',(select c.context_id from public.project_plan_contexts c where c.project_id=p_project_id),
  'lots',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'title',t.title,'planned_start',t.planned_start,'planned_end',t.planned_end,'ready',t.ready,
      'awarded',exists(select 1 from awarded aw where aw.request_id=t.id),
      'contractor',(select cp.business_name from awarded aw join public.contractor_profiles cp on cp.id=aw.contractor_id where aw.request_id=t.id limit 1)) order by t.title,t.id) from lots t),'[]'::jsonb),
  'nodes',coalesce((select jsonb_agg(jsonb_build_object('id',n.id,'request_id',n.request_id,'node_key',n.node_key,'title',n.title,'start_date',n.start_date,'end_date',n.end_date,
      'official_sub_lot_id',n.official_sub_lot_id) order by n.request_id,n.position) from nodes n),'[]'::jsonb),
  'links',coalesce((select jsonb_agg(l.j order by l.id) from (
    select x.id,jsonb_build_object('id',x.id,'manual',false,'pred_target',x.pred_target,'succ_target',x.succ_target,'pred_label',x.pred_label,'succ_label',x.succ_label,
      'state',case
        when x.decision='rejected' then 'rejected'
        when x.pred_target is null or x.succ_target is null then 'unresolved'
        when x.decision='confirmed' then 'effective'
        else 'awaiting_confirmation' end) as j from labelled x
    union all
    select m.id,jsonb_build_object('id',m.id,'manual',true,'pred_target',m.pred_ok,'succ_target',m.succ_ok,'pred_label',m.pred_label,'succ_label',m.succ_label,
      'state',case when m.pred_ok is null or m.succ_ok is null then 'unresolved' else 'effective' end) from manual m
  ) l),'[]'::jsonb)
);
$$;


-- Une extrémité est valide si c'est un lot au plan prêt ou un sous-lot daté d'un lot attribué.
create function dao_private.plan_target_ok(d jsonb,p_target text) returns boolean
language sql stable set search_path='' as $$
  select p_target is not null and (
    exists(select 1 from jsonb_array_elements(d->'lots') x where 'lot:'||(x.value->>'id')=p_target and (x.value->>'ready')::boolean)
    or exists(select 1 from jsonb_array_elements(d->'nodes') x where 'node:'||(x.value->>'id')=p_target and x.value->>'start_date' is not null));
$$;

-- Arêtes effectives (hors un lien exclu) + une arête candidate : refuse toute boucle.
create function dao_private.plan_would_cycle(d jsonb,p_exclude uuid,p_pred text,p_succ text) returns boolean
language plpgsql stable set search_path='' as $$
declare f text[]:='{}'; t text[]:='{}'; e jsonb;
begin
  for e in select value from jsonb_array_elements(d->'links') where value->>'state'='effective' and (p_exclude is null or value->>'id'<>p_exclude::text) loop
    f:=f||(e->>'pred_target'); t:=t||(e->>'succ_target');
  end loop;
  f:=f||p_pred; t:=t||p_succ;
  return dao_private.edges_have_cycle(f,t);
end;
$$;

-- Retrait d'un lien (proposé ou ajouté) : un lien proposé reçoit la décision « rejected », un lien ajouté son événement de retrait.
create function dao_private.plan_drop_link(p_project_id uuid,p_link_id uuid,p_manual boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
  if p_manual then
    insert into public.project_plan_manual_link_removals(link_id,project_id,removed_by) values(p_link_id,p_project_id,auth.uid()) on conflict do nothing;
  else
    insert into public.project_plan_link_decisions(project_id,link_id,decision,decided_by) values(p_project_id,p_link_id,'rejected',auth.uid());
  end if;
end;
$$;

create function dao_private.remove_plan_link(p_project_id uuid,p_link_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d jsonb; l jsonb;
begin
  if not dao_private.project_plan_access(p_project_id) then raise exception using errcode='42501',message='Accès au planning du projet refusé'; end if;
  d:=dao_private.project_plan_data(p_project_id);
  select value into l from jsonb_array_elements(d->'links') where value->>'id'=p_link_id::text;
  if l is null or l->>'state' in ('rejected') then raise exception using errcode='22023',message='Lien inconnu ou déjà retiré'; end if;
  perform dao_private.plan_drop_link(p_project_id,p_link_id,(l->>'manual')::boolean);
  return dao_private.get_project_plan(p_project_id);
end;
$$;

create function dao_private.add_plan_link(p_project_id uuid,p_pred text,p_succ text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d jsonb;
begin
  if not dao_private.project_plan_access(p_project_id) then raise exception using errcode='42501',message='Accès au planning du projet refusé'; end if;
  d:=dao_private.project_plan_data(p_project_id);
  if p_pred=p_succ or p_pred is null or p_succ is null then raise exception using errcode='22023',message='Lien invalide'; end if;
  if not dao_private.plan_target_ok(d,p_pred) or not dao_private.plan_target_ok(d,p_succ) then
    raise exception using errcode='22023',message='Extrémité non planifiée ou non attribuée';
  end if;
  if exists(select 1 from jsonb_array_elements(d->'links') x where x.value->>'state'='effective' and x.value->>'pred_target'=p_pred and x.value->>'succ_target'=p_succ) then
    raise exception using errcode='22023',message='link_duplicate';
  end if;
  if dao_private.plan_would_cycle(d,null,p_pred,p_succ) then raise exception using errcode='23514',message='dependency_cycle'; end if;
  insert into public.project_plan_manual_links(project_id,pred_target,succ_target,created_by) values(p_project_id,p_pred,p_succ,auth.uid());
  return dao_private.get_project_plan(p_project_id);
end;
$$;

-- « Modifier le lien » : une seule action métier. Le nouveau lien est validé (boucle, doublon) AVANT le retrait de l'ancien ; tout ou rien.
create function dao_private.replace_plan_link(p_project_id uuid,p_link_id uuid,p_pred text,p_succ text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d jsonb; l jsonb;
begin
  if not dao_private.project_plan_access(p_project_id) then raise exception using errcode='42501',message='Accès au planning du projet refusé'; end if;
  d:=dao_private.project_plan_data(p_project_id);
  select value into l from jsonb_array_elements(d->'links') where value->>'id'=p_link_id::text;
  if l is null or l->>'state'='rejected' then raise exception using errcode='22023',message='Lien inconnu ou déjà retiré'; end if;
  if p_pred=p_succ or p_pred is null or p_succ is null then raise exception using errcode='22023',message='Lien invalide'; end if;
  if not dao_private.plan_target_ok(d,p_pred) or not dao_private.plan_target_ok(d,p_succ) then
    raise exception using errcode='22023',message='Extrémité non planifiée ou non attribuée';
  end if;
  if exists(select 1 from jsonb_array_elements(d->'links') x where x.value->>'state'='effective' and x.value->>'id'<>p_link_id::text
            and x.value->>'pred_target'=p_pred and x.value->>'succ_target'=p_succ) then
    raise exception using errcode='22023',message='link_duplicate';
  end if;
  if dao_private.plan_would_cycle(d,p_link_id,p_pred,p_succ) then raise exception using errcode='23514',message='dependency_cycle'; end if;
  perform dao_private.plan_drop_link(p_project_id,p_link_id,(l->>'manual')::boolean);
  insert into public.project_plan_manual_links(project_id,pred_target,succ_target,created_by) values(p_project_id,p_pred,p_succ,auth.uid());
  return dao_private.get_project_plan(p_project_id);
end;
$$;

-- Un lien effectif n'est plus définitif : la réconciliation retire la dépendance d'OCE (passerelle remove-dependency).
create or replace function dao_private.decide_plan_link(p_project_id uuid,p_link_id uuid,p_decision text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d jsonb; l jsonb;
begin
  if not dao_private.project_plan_access(p_project_id) then raise exception using errcode='42501',message='Accès au planning du projet refusé'; end if;
  if p_decision not in ('confirmed','rejected') then raise exception using errcode='22023',message='Décision invalide'; end if;
  d:=dao_private.project_plan_data(p_project_id);
  select value into l from jsonb_array_elements(d->'links') where value->>'id'=p_link_id::text and (value->>'manual')::boolean is not true;
  if l is null then raise exception using errcode='22023',message='Lien inconnu ou lot non attribué'; end if;
  if p_decision='confirmed' then
    if l->>'pred_target' is null or l->>'succ_target' is null then raise exception using errcode='22023',message='Lien non résolu : les deux extrémités doivent être attribuées et planifiées'; end if;
    if dao_private.plan_would_cycle(d,p_link_id,l->>'pred_target',l->>'succ_target') then raise exception using errcode='23514',message='dependency_cycle'; end if;
  end if;
  insert into public.project_plan_link_decisions(project_id,link_id,decision,decided_by) values(p_project_id,p_link_id,p_decision,auth.uid());
  return dao_private.get_project_plan(p_project_id);
end;
$$;

-- Serveur uniquement : suivi des objets déjà appliqués dans OCE (codes D.A.O seulement), pour calculer les retraits.
create function dao_private.oce_list_objects(p_mapping_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'activities',coalesce((select jsonb_agg(a.activity_code order by a.activity_code) from public.oce_sync_activities a where a.mapping_id=p_mapping_id),'[]'::jsonb),
    'dependencies',coalesce((select jsonb_agg(jsonb_build_array(x.predecessor_code,x.successor_code) order by x.predecessor_code,x.successor_code)
      from public.oce_sync_dependencies x where x.mapping_id=p_mapping_id),'[]'::jsonb));
$$;
create function dao_private.oce_forget_object(p_mapping_id uuid,p_kind text,p_code text,p_code2 text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if p_kind='activity' then delete from public.oce_sync_activities where mapping_id=p_mapping_id and activity_code=p_code;
  elsif p_kind='dependency' then delete from public.oce_sync_dependencies where mapping_id=p_mapping_id and predecessor_code=p_code and successor_code=p_code2;
  else raise exception using errcode='22023',message='Type d’objet OCE non retirable'; end if;
end;
$$;

create function public.remove_plan_link(p_project_id uuid,p_link_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select dao_private.remove_plan_link($1,$2); $$;
create function public.add_plan_link(p_project_id uuid,p_pred text,p_succ text) returns jsonb language sql security invoker set search_path='' as $$ select dao_private.add_plan_link($1,$2,$3); $$;
create function public.replace_plan_link(p_project_id uuid,p_link_id uuid,p_pred text,p_succ text) returns jsonb language sql security invoker set search_path='' as $$ select dao_private.replace_plan_link($1,$2,$3,$4); $$;
create function public.oce_list_objects(p_mapping_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$ select dao_private.oce_list_objects($1); $$;
create function public.oce_forget_object(p_mapping_id uuid,p_kind text,p_code text,p_code2 text) returns void language sql security invoker set search_path='' as $$ select dao_private.oce_forget_object($1,$2,$3,$4); $$;

revoke all on function
  dao_private.trg_bump_plan_manual(),dao_private.plan_would_cycle(jsonb,uuid,text,text),dao_private.plan_target_ok(jsonb,text),dao_private.plan_drop_link(uuid,uuid,boolean),
  dao_private.remove_plan_link(uuid,uuid),dao_private.add_plan_link(uuid,text,text),dao_private.replace_plan_link(uuid,uuid,text,text),
  dao_private.oce_list_objects(uuid),dao_private.oce_forget_object(uuid,text,text,text),
  public.remove_plan_link(uuid,uuid),public.add_plan_link(uuid,text,text),public.replace_plan_link(uuid,uuid,text,text),
  public.oce_list_objects(uuid),public.oce_forget_object(uuid,text,text,text)
  from public,anon,authenticated;
grant execute on function dao_private.remove_plan_link(uuid,uuid),dao_private.add_plan_link(uuid,text,text),dao_private.replace_plan_link(uuid,uuid,text,text),
  public.remove_plan_link(uuid,uuid),public.add_plan_link(uuid,text,text),public.replace_plan_link(uuid,uuid,text,text) to authenticated,service_role;
grant execute on function dao_private.oce_list_objects(uuid),dao_private.oce_forget_object(uuid,text,text,text),
  public.oce_list_objects(uuid),public.oce_forget_object(uuid,text,text,text) to service_role;

commit;
