-- #325 tranche B : planning GLOBAL du projet (tous les lots), calculé par OCE via la passerelle privée.
-- * D.A.O reste la source de vérité. Le plan commun est DÉRIVÉ : lots (planning de lot prêt), sous-lots datés des offres RETENUES,
--   liens FS confirmés. Rien n'est inventé ni additionné : OCE calcule un chemin critique unique sur tout le graphe.
-- * L'attribution reste PAR LOT. Un lien proposé par l'Artisan n'est effectif qu'après (1) attribution des lots concernés et
--   (2) confirmation du Client propriétaire ou de la gestion D.A.O (décisions append-only).
-- * Le contexte OCE du projet (context_id) occupe le rôle de « lot » dans l'admission exacte de la passerelle : la table de
--   correspondance accepte donc un lot du projet OU son contexte.
-- Additive, sauf le remplacement de la clé étrangère de oce_sync_mappings par un garde équivalent (lot OU contexte).
begin;

create table public.project_plan_contexts (
  project_id uuid primary key references public.projects,
  context_id uuid not null unique default gen_random_uuid(),
  revision integer not null default 1 check (revision>0),
  updated_at timestamptz not null default now()
);

create table public.project_plan_link_decisions (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  created_at timestamptz not null default now(),
  project_id uuid not null references public.projects,
  link_id uuid not null references public.bid_sub_lot_links,
  decision text not null check (decision in ('confirmed','rejected')),
  decided_by uuid not null references auth.users
);
create index on public.project_plan_link_decisions(link_id, seq);

create table public.project_plan_results (
  project_id uuid primary key references public.projects,
  revision integer not null check (revision>0),
  duration_days integer check (duration_days is null or duration_days>=0),
  critical_codes text[] not null default '{}',
  error_code text check (error_code is null or error_code ~ '^[a-z0-9_]{1,64}$'),
  updated_at timestamptz not null default now()
);

alter table public.project_plan_contexts enable row level security;
alter table public.project_plan_link_decisions enable row level security;
alter table public.project_plan_results enable row level security;
revoke all on public.project_plan_contexts,public.project_plan_link_decisions,public.project_plan_results from public,anon,authenticated;

create function dao_private.plan_decisions_append_only() returns trigger language plpgsql set search_path='' as $$
begin raise exception using errcode='23514',message='Les décisions sur les liens sont append-only'; end;
$$;
create trigger project_plan_link_decisions_append_only before update or delete on public.project_plan_link_decisions
  for each row execute function dao_private.plan_decisions_append_only();

-- La correspondance OCE accepte un lot du projet OU le contexte de planning du projet.
do $$ declare c text; begin
  select conname into c from pg_constraint
   where conrelid='public.oce_sync_mappings'::regclass and contype='f' and confrelid='public.project_requests'::regclass;
  if c is not null then execute format('alter table public.oce_sync_mappings drop constraint %I',c); end if;
end $$;

create function dao_private.oce_mapping_target_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.project_requests r where r.id=new.request_id and r.project_id=new.project_id)
     and not exists(select 1 from public.project_plan_contexts c where c.context_id=new.request_id and c.project_id=new.project_id) then
    raise exception using errcode='23503',message='Correspondance OCE vers un lot ou un contexte inconnu';
  end if;
  return new;
end;
$$;
create trigger oce_sync_mappings_target before insert or update of project_id,request_id on public.oce_sync_mappings
  for each row execute function dao_private.oce_mapping_target_guard();

create or replace function dao_private.oce_request_mapping(p_project_id uuid,p_request_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  if not exists(select 1 from public.project_requests r join public.projects p on p.id=r.project_id
      where r.id=p_request_id and r.project_id=p_project_id and p.status<>'archived' and r.status<>'withdrawn')
     and not exists(select 1 from public.project_plan_contexts c join public.projects p on p.id=c.project_id
      where c.context_id=p_request_id and c.project_id=p_project_id and p.status<>'archived') then
    raise exception using errcode='22023',message='Lot ou projet non synchronisable';
  end if;
  insert into public.oce_sync_mappings(project_id,request_id) values(p_project_id,p_request_id)
  on conflict(project_id,request_id) do nothing returning id into v_id;
  if v_id is null then select id into v_id from public.oce_sync_mappings where project_id=p_project_id and request_id=p_request_id; end if;
  return v_id;
end;
$$;

-- Révision du plan commun : +1 à chaque changement réel d'une entrée (plan de lot, attribution, décision).
create function dao_private.bump_project_plan(p_project_id uuid) returns void
language sql security definer set search_path='' as $$
  -- L'état implicite « sans contexte » vaut révision 1 : la première modification crée donc la révision 2.
  insert into public.project_plan_contexts(project_id,revision) values(p_project_id,2)
  on conflict(project_id) do update set revision=public.project_plan_contexts.revision+1,updated_at=now();
$$;
create function dao_private.trg_bump_plan_lot() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='INSERT' or (old.planned_start,old.planned_end,old.status) is distinct from (new.planned_start,new.planned_end,new.status) then
    perform dao_private.bump_project_plan(new.project_id);
  end if;
  return new;
end;
$$;
create function dao_private.trg_bump_plan_award() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='INSERT' or old.active is distinct from new.active then perform dao_private.bump_project_plan(new.project_id); end if;
  return new;
end;
$$;
create function dao_private.trg_bump_plan_decision() returns trigger language plpgsql security definer set search_path='' as $$
begin perform dao_private.bump_project_plan(new.project_id); return new; end;
$$;
create trigger oce_lot_plans_bump_project_plan after insert or update on public.oce_lot_plans for each row execute function dao_private.trg_bump_plan_lot();
create trigger award_items_bump_project_plan after insert or update on public.award_items for each row execute function dao_private.trg_bump_plan_award();
create trigger plan_decisions_bump_project_plan after insert on public.project_plan_link_decisions for each row execute function dao_private.trg_bump_plan_decision();

-- Qui voit et décide : Client propriétaire ou gestion D.A.O du projet (jamais un Artisan).
create function dao_private.project_plan_access(p_project_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and dao_private.account_active(auth.uid())
    and (dao_private.owner(p_project_id) or dao_private.manages_project(p_project_id))
    and exists(select 1 from public.projects p where p.id=p_project_id and p.status<>'archived');
$$;

-- Graphe commun du projet (interne, sans contrôle d'accès : appelé par les RPC contrôlées et par le serveur).
create function dao_private.project_plan_data(p_project_id uuid) returns jsonb
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
select jsonb_build_object(
  'revision',coalesce((select c.revision from public.project_plan_contexts c where c.project_id=p_project_id),1),
  'context_id',(select c.context_id from public.project_plan_contexts c where c.project_id=p_project_id),
  'lots',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'title',t.title,'planned_start',t.planned_start,'planned_end',t.planned_end,'ready',t.ready,
      'awarded',exists(select 1 from awarded aw where aw.request_id=t.id),
      'contractor',(select cp.business_name from awarded aw join public.contractor_profiles cp on cp.id=aw.contractor_id where aw.request_id=t.id limit 1)) order by t.title,t.id) from lots t),'[]'::jsonb),
  'nodes',coalesce((select jsonb_agg(jsonb_build_object('id',n.id,'request_id',n.request_id,'node_key',n.node_key,'title',n.title,'start_date',n.start_date,'end_date',n.end_date,
      'official_sub_lot_id',n.official_sub_lot_id) order by n.request_id,n.position) from nodes n),'[]'::jsonb),
  'links',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'pred_target',x.pred_target,'succ_target',x.succ_target,'pred_label',x.pred_label,'succ_label',x.succ_label,
      'state',case
        when x.decision='rejected' then 'rejected'
        when x.pred_target is null or x.succ_target is null then 'unresolved'
        when x.decision='confirmed' then 'effective'
        else 'awaiting_confirmation' end) order by x.id) from labelled x),'[]'::jsonb)
);
$$;

-- Écran Client / gestion : graphe + résultat OCE + état de synchronisation.
create function dao_private.get_project_plan(p_project_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare d jsonb; r public.project_plan_results; s text;
begin
  if not dao_private.project_plan_access(p_project_id) then raise exception using errcode='42501',message='Accès au planning du projet refusé'; end if;
  d:=dao_private.project_plan_data(p_project_id);
  select * into r from public.project_plan_results where project_id=p_project_id;
  s:=case when not exists(select 1 from jsonb_array_elements(d->'lots') x where (x.value->>'ready')::boolean)
         and not exists(select 1 from jsonb_array_elements(d->'nodes') x where x.value->>'start_date' is not null) then 'none'
    when r.project_id is null then 'pending' when r.revision<>(d->>'revision')::int then 'pending' when r.error_code is not null then 'failed' else 'synced' end;
  return (d - 'context_id') || jsonb_build_object('sync',jsonb_build_object('state',s,'duration_days',case when s='synced' then r.duration_days end,
    'critical_codes',case when s='synced' then to_jsonb(r.critical_codes) else '[]'::jsonb end,'error_code',case when s='failed' then r.error_code end));
end;
$$;

-- Confirmation / rejet d'un lien par le Client ou la gestion. Un lien qui créerait une boucle est refusé.
create function dao_private.decide_plan_link(p_project_id uuid,p_link_id uuid,p_decision text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d jsonb; l jsonb; f text[]:='{}'; t text[]:='{}'; e jsonb;
begin
  if not dao_private.project_plan_access(p_project_id) then raise exception using errcode='42501',message='Accès au planning du projet refusé'; end if;
  if p_decision not in ('confirmed','rejected') then raise exception using errcode='22023',message='Décision invalide'; end if;
  d:=dao_private.project_plan_data(p_project_id);
  select value into l from jsonb_array_elements(d->'links') where value->>'id'=p_link_id::text;
  if l is null then raise exception using errcode='22023',message='Lien inconnu ou lot non attribué'; end if;
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

-- Serveur uniquement : entrée de la synchronisation. Null s'il n'y a rien de planifiable.
create function dao_private.oce_project_plan_for_sync(p_project_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d jsonb;
begin
  if not exists(select 1 from public.projects p where p.id=p_project_id and p.status<>'archived') then return null; end if;
  d:=dao_private.project_plan_data(p_project_id);
  if not exists(select 1 from jsonb_array_elements(d->'lots') x where (x.value->>'ready')::boolean)
     and not exists(select 1 from jsonb_array_elements(d->'nodes') x where x.value->>'start_date' is not null) then return null; end if;
  -- Le contexte existe dès qu'un plan de lot est prêt (le déclencheur le crée) ; sinon on le crée ici.
  insert into public.project_plan_contexts(project_id) values(p_project_id) on conflict(project_id) do nothing;
  d:=dao_private.project_plan_data(p_project_id);
  return d || jsonb_build_object('project_title',(select pv.title from public.project_versions pv where pv.project_id=p_project_id order by pv.version_no desc limit 1),
    'region',(select g.name_fr from public.project_versions pv join public.governorates g on g.id=pv.governorate_id where pv.project_id=p_project_id order by pv.version_no desc limit 1));
end;
$$;

create function dao_private.oce_record_project_plan_result(p_project_id uuid,p_revision integer,p_duration integer,p_critical text[],p_error text) returns void
language sql security definer set search_path='' as $$
  insert into public.project_plan_results(project_id,revision,duration_days,critical_codes,error_code)
  values(p_project_id,p_revision,p_duration,coalesce(p_critical,'{}'),p_error)
  on conflict(project_id) do update set revision=excluded.revision,duration_days=excluded.duration_days,
    critical_codes=excluded.critical_codes,error_code=excluded.error_code,updated_at=now()
  where public.project_plan_results.revision<=excluded.revision;
$$;

create function public.get_project_plan(p_project_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$ select dao_private.get_project_plan($1); $$;
create function public.decide_plan_link(p_project_id uuid,p_link_id uuid,p_decision text) returns jsonb language sql security invoker set search_path='' as $$ select dao_private.decide_plan_link($1,$2,$3); $$;
create function public.oce_project_plan_for_sync(p_project_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select dao_private.oce_project_plan_for_sync($1); $$;
create function public.oce_record_project_plan_result(p_project_id uuid,p_revision integer,p_duration integer,p_critical text[],p_error text) returns void
  language sql security invoker set search_path='' as $$ select dao_private.oce_record_project_plan_result($1,$2,$3,$4,$5); $$;

revoke all on function
  dao_private.plan_decisions_append_only(),dao_private.oce_mapping_target_guard(),dao_private.bump_project_plan(uuid),dao_private.trg_bump_plan_lot(),
  dao_private.trg_bump_plan_award(),dao_private.trg_bump_plan_decision(),dao_private.project_plan_access(uuid),dao_private.project_plan_data(uuid),
  dao_private.get_project_plan(uuid),dao_private.decide_plan_link(uuid,uuid,text),dao_private.oce_project_plan_for_sync(uuid),
  dao_private.oce_record_project_plan_result(uuid,integer,integer,text[],text),
  public.get_project_plan(uuid),public.decide_plan_link(uuid,uuid,text),public.oce_project_plan_for_sync(uuid),
  public.oce_record_project_plan_result(uuid,integer,integer,text[],text)
  from public,anon,authenticated;
grant execute on function dao_private.project_plan_access(uuid),dao_private.get_project_plan(uuid),dao_private.decide_plan_link(uuid,uuid,text),
  public.get_project_plan(uuid),public.decide_plan_link(uuid,uuid,text) to authenticated,service_role;
grant execute on function dao_private.project_plan_data(uuid),dao_private.oce_project_plan_for_sync(uuid),dao_private.oce_record_project_plan_result(uuid,integer,integer,text[],text),
  public.oce_project_plan_for_sync(uuid),public.oce_record_project_plan_result(uuid,integer,integer,text[],text) to service_role;

commit;
