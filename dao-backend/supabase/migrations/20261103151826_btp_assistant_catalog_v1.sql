-- #541 — additive BTP catalogue and client-owned assistant drafts.
-- Catalogue suggestions are canonical references only: no prices, quantities,
-- durations or regulatory assertions are stored or inferred here.
begin;

create table public.btp_catalog_items (
  id uuid primary key,
  code text not null unique check (code ~ '^btp_[a-z0-9_]+$'),
  parent_id uuid references public.btp_catalog_items,
  item_kind text not null check (item_kind in ('lot','sub_lot','work')),
  trade_id uuid references public.trades,
  label_fr text not null check (length(label_fr) between 2 and 120),
  description_fr text not null default '',
  unit_code text check (unit_code is null or unit_code in ('m','m2','m3','unit','package')),
  relevance text not null check (relevance in ('usual','conditional','optional','verify')),
  project_types text[] not null default '{}',
  aliases text[] not null default '{}',
  country_code text not null default 'TN' check (country_code ~ '^[A-Z]{2}$'),
  source jsonb not null,
  catalogue_version integer not null default 1 check (catalogue_version > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check ((item_kind='lot' and parent_id is null and trade_id is not null)
    or (item_kind<>'lot' and parent_id is not null)),
  check (jsonb_typeof(source)='object' and length(coalesce(source->>'label',''))>0)
);
create index btp_catalog_parent_idx on public.btp_catalog_items(parent_id) where active;
create index btp_catalog_trade_idx on public.btp_catalog_items(trade_id) where active;
alter table public.btp_catalog_items enable row level security;
revoke all on public.btp_catalog_items from anon,authenticated;
grant select on public.btp_catalog_items to authenticated;
grant all on public.btp_catalog_items to service_role;
create policy btp_catalog_authenticated_read on public.btp_catalog_items for select to authenticated using (active);

create table public.btp_assistant_drafts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  owner_id uuid not null references auth.users,
  project_type text not null check (project_type in ('construction','renovation','extension','other')),
  source_description text not null check (length(source_description) between 3 and 8000),
  title text not null check (length(title) between 2 and 200),
  governorate_id uuid references public.governorates,
  structured jsonb not null default '{}',
  selected_item_ids uuid[] not null default '{}',
  removed_item_ids uuid[] not null default '{}',
  question text,
  engine_mode text not null default 'deterministic' check (engine_mode in ('deterministic','llm_validated')),
  revision integer not null default 1 check (revision > 0),
  created_project_id uuid references public.projects,
  creation_key text,
  check (jsonb_typeof(structured)='object'),
  check (cardinality(selected_item_ids) <= 150 and cardinality(removed_item_ids) <= 150),
  check (created_project_id is null or governorate_id is not null),
  unique(owner_id,creation_key)
);
create index btp_assistant_drafts_owner_idx on public.btp_assistant_drafts(owner_id,updated_at desc);
alter table public.btp_assistant_drafts enable row level security;
revoke all on public.btp_assistant_drafts from anon,authenticated;
grant select,insert,update on public.btp_assistant_drafts to authenticated;
grant all on public.btp_assistant_drafts to service_role;
create policy btp_assistant_draft_read on public.btp_assistant_drafts for select to authenticated
  using ((select auth.uid())=owner_id);
create policy btp_assistant_draft_insert on public.btp_assistant_drafts for insert to authenticated
  with check ((select auth.uid())=owner_id and created_project_id is null);
create policy btp_assistant_draft_update on public.btp_assistant_drafts for update to authenticated
  using ((select auth.uid())=owner_id and created_project_id is null)
  with check ((select auth.uid())=owner_id);

create table public.project_btp_scope_items (
  project_id uuid not null references public.projects,
  request_id uuid not null,
  catalog_item_id uuid not null references public.btp_catalog_items,
  assistant_draft_id uuid not null references public.btp_assistant_drafts,
  relevance text not null check (relevance in ('usual','conditional','optional','verify')),
  confirmed_by_client boolean not null default true,
  created_at timestamptz not null default now(),
  primary key(project_id,catalog_item_id),
  foreign key(request_id,project_id) references public.project_requests(id,project_id)
);
create index project_btp_scope_request_idx on public.project_btp_scope_items(request_id);
alter table public.project_btp_scope_items enable row level security;
revoke all on public.project_btp_scope_items from anon,authenticated;
grant select on public.project_btp_scope_items to authenticated;
grant all on public.project_btp_scope_items to service_role;
create policy project_btp_scope_read on public.project_btp_scope_items for select to authenticated
  using (dao_private.can_view_project(project_id));

-- Curated V1 seed. Provenance records that this is a D.A.O. editorial taxonomy,
-- not a price book, engineering calculation or regulatory source.
with trade as (select id,code from public.trades), rows(id,code,parent_id,item_kind,trade_code,label,relevance,types,aliases,unit_code) as (values
  ('54100000-0000-4000-8000-000000000001'::uuid,'btp_lot_studies',null::uuid,'lot','general_contractor','Études et préparation','usual',array['construction','extension'],array['étude','plans','architecte','sol'],'package'),
  ('54100000-0000-4000-8000-000000000002','btp_lot_structure',null,'lot','trade_masonry','Gros œuvre et structure','usual',array['construction','extension'],array['gros oeuvre','maçonnerie','structure'],'package'),
  ('54100000-0000-4000-8000-000000000003','btp_lot_plumbing',null,'lot','plumbing','Plomberie et sanitaires','usual',array['construction','renovation','extension'],array['plomberie','sanitaire','salle de bain'],'package'),
  ('54100000-0000-4000-8000-000000000004','btp_lot_electrical',null,'lot','electrical','Électricité','usual',array['construction','renovation','extension'],array['électricité','electrique','courant'],'package'),
  ('54100000-0000-4000-8000-000000000005','btp_lot_finishes',null,'lot','trade_tiling','Revêtements et finitions','usual',array['construction','renovation','extension'],array['carrelage','peinture','finition'],'package'),
  ('54100000-0000-4000-8000-000000000006','btp_lot_joinery',null,'lot','trade_alu_joinery','Menuiseries','conditional',array['construction','renovation','extension'],array['fenêtre','porte','menuiserie'],'package'),
  ('54100000-0000-4000-8000-000000000007','btp_lot_outdoor',null,'lot','trade_landscaping','Aménagements extérieurs','optional',array['construction','renovation','extension'],array['jardin','terrasse','garage','piscine'],'package'),
  ('54100000-0000-4000-8000-000000000008','btp_lot_demolition',null,'lot','trade_demolition','Dépose et démolition','conditional',array['renovation','extension'],array['démolition','dépose','existant'],'package'),
  ('54100000-0000-4000-8000-000000000009','btp_lot_roof',null,'lot','trade_roofing','Toiture et étanchéité','conditional',array['construction','renovation','extension'],array['toiture','couverture','étanchéité'],'package'),
  ('54100000-0000-4000-8000-00000000000a','btp_lot_kitchen',null,'lot','trade_kitchen','Cuisine et agencement','optional',array['construction','renovation','extension'],array['cuisine','agencement'],'package'),

  ('54100000-0000-4000-8000-000000000101','btp_sub_design','54100000-0000-4000-8000-000000000001','sub_lot',null,'Conception et études préalables','usual',array['construction','extension'],array['plans','études'],'package'),
  ('54100000-0000-4000-8000-000000000102','btp_work_architectural_plans','54100000-0000-4000-8000-000000000101','work',null,'Plans architecturaux','verify',array['construction','extension'],array['plan architecte'],'package'),
  ('54100000-0000-4000-8000-000000000103','btp_work_soil_study','54100000-0000-4000-8000-000000000101','work',null,'Étude géotechnique selon besoin','conditional',array['construction','extension'],array['étude sol','geotechnique'],'package'),
  ('54100000-0000-4000-8000-000000000201','btp_sub_foundations','54100000-0000-4000-8000-000000000002','sub_lot',null,'Fondations','usual',array['construction','extension'],array['fondation'],'package'),
  ('54100000-0000-4000-8000-000000000202','btp_work_earthworks','54100000-0000-4000-8000-000000000201','work',null,'Terrassement préparatoire','conditional',array['construction','extension'],array['terrassement','fouille'],'m3'),
  ('54100000-0000-4000-8000-000000000203','btp_work_foundations','54100000-0000-4000-8000-000000000201','work',null,'Réalisation des fondations selon études','verify',array['construction','extension'],array['semelle','radier'],'m3'),
  ('54100000-0000-4000-8000-000000000204','btp_sub_superstructure','54100000-0000-4000-8000-000000000002','sub_lot',null,'Structure et élévation','usual',array['construction','extension'],array['élévation','dalle','poteau'],'package'),
  ('54100000-0000-4000-8000-000000000205','btp_work_structure','54100000-0000-4000-8000-000000000204','work',null,'Ossature et planchers selon études','verify',array['construction','extension'],array['béton','dalle','poteau'],'m3'),
  ('54100000-0000-4000-8000-000000000206','btp_work_masonry','54100000-0000-4000-8000-000000000204','work',null,'Maçonnerie et cloisons','usual',array['construction','extension'],array['mur','cloison'],'m2'),
  ('54100000-0000-4000-8000-000000000301','btp_sub_sanitary','54100000-0000-4000-8000-000000000003','sub_lot',null,'Réseaux et équipements sanitaires','usual',array['construction','renovation','extension'],array['sanitaire','eau'],'package'),
  ('54100000-0000-4000-8000-000000000302','btp_work_water_network','54100000-0000-4000-8000-000000000301','work',null,'Réseaux alimentation et évacuation','usual',array['construction','renovation','extension'],array['evacuation','canalisation'],'m'),
  ('54100000-0000-4000-8000-000000000303','btp_work_bathrooms','54100000-0000-4000-8000-000000000301','work',null,'Équipements des salles de bain','conditional',array['construction','renovation','extension'],array['salle de bain','douche'],'unit'),
  ('54100000-0000-4000-8000-000000000401','btp_sub_electrical_installation','54100000-0000-4000-8000-000000000004','sub_lot',null,'Installation électrique','usual',array['construction','renovation','extension'],array['installation électrique'],'package'),
  ('54100000-0000-4000-8000-000000000402','btp_work_electrical_network','54100000-0000-4000-8000-000000000401','work',null,'Tableau, circuits et appareillage','verify',array['construction','renovation','extension'],array['tableau','prise','éclairage'],'package'),
  ('54100000-0000-4000-8000-000000000501','btp_sub_floor_wall_finishes','54100000-0000-4000-8000-000000000005','sub_lot',null,'Sols, murs et peinture','usual',array['construction','renovation','extension'],array['sol','mur','peinture'],'package'),
  ('54100000-0000-4000-8000-000000000502','btp_work_tiling','54100000-0000-4000-8000-000000000501','work',null,'Carrelage et faïence','conditional',array['construction','renovation','extension'],array['carrelage','faïence'],'m2'),
  ('54100000-0000-4000-8000-000000000503','btp_work_painting','54100000-0000-4000-8000-000000000501','work',null,'Préparation des supports et peinture','usual',array['construction','renovation','extension'],array['peinture','enduit'],'m2'),
  ('54100000-0000-4000-8000-000000000601','btp_sub_openings','54100000-0000-4000-8000-000000000006','sub_lot',null,'Portes et fenêtres','conditional',array['construction','renovation','extension'],array['porte','fenêtre'],'package'),
  ('54100000-0000-4000-8000-000000000602','btp_work_external_joinery','54100000-0000-4000-8000-000000000601','work',null,'Menuiseries extérieures','conditional',array['construction','renovation','extension'],array['fenêtre','baie'],'unit'),
  ('54100000-0000-4000-8000-000000000701','btp_sub_outdoor_spaces','54100000-0000-4000-8000-000000000007','sub_lot',null,'Espaces extérieurs','optional',array['construction','renovation','extension'],array['extérieur'],'package'),
  ('54100000-0000-4000-8000-000000000702','btp_work_terrace','54100000-0000-4000-8000-000000000701','work',null,'Terrasse extérieure','optional',array['construction','renovation','extension'],array['terrasse'],'m2'),
  ('54100000-0000-4000-8000-000000000703','btp_work_garden','54100000-0000-4000-8000-000000000701','work',null,'Aménagement du jardin','optional',array['construction','renovation','extension'],array['jardin'],'m2'),
  ('54100000-0000-4000-8000-000000000704','btp_work_garage','54100000-0000-4000-8000-000000000701','work',null,'Garage','optional',array['construction','renovation','extension'],array['garage'],'unit'),
  ('54100000-0000-4000-8000-000000000705','btp_work_pool','54100000-0000-4000-8000-000000000701','work',null,'Piscine','optional',array['construction','renovation','extension'],array['piscine'],'unit'),
  ('54100000-0000-4000-8000-000000000801','btp_sub_existing_interface','54100000-0000-4000-8000-000000000008','sub_lot',null,'Interfaces avec l’existant','conditional',array['renovation','extension'],array['existant','dépose'],'package'),
  ('54100000-0000-4000-8000-000000000802','btp_work_selective_demolition','54100000-0000-4000-8000-000000000801','work',null,'Dépose ou démolition sélective après vérification','verify',array['renovation','extension'],array['dépose','démolition'],'package'),
  ('54100000-0000-4000-8000-000000000901','btp_sub_roof_waterproofing','54100000-0000-4000-8000-000000000009','sub_lot',null,'Toiture et protection à l’eau','conditional',array['construction','renovation','extension'],array['toiture','étanchéité'],'package'),
  ('54100000-0000-4000-8000-000000000902','btp_work_waterproofing','54100000-0000-4000-8000-000000000901','work',null,'Étanchéité selon support à confirmer','verify',array['construction','renovation','extension'],array['étanchéité'],'m2'),
  ('54100000-0000-4000-8000-000000000a01','btp_sub_kitchen_layout','54100000-0000-4000-8000-00000000000a','sub_lot',null,'Cuisine et rangements','optional',array['construction','renovation','extension'],array['cuisine'],'package'),
  ('54100000-0000-4000-8000-000000000a02','btp_work_kitchen','54100000-0000-4000-8000-000000000a01','work',null,'Cuisine séparée ou ouverte selon choix','optional',array['construction','renovation','extension'],array['cuisine séparée','cuisine ouverte'],'package')
)
insert into public.btp_catalog_items(id,code,parent_id,item_kind,trade_id,label_fr,relevance,project_types,aliases,unit_code,source)
select r.id,r.code,r.parent_id,r.item_kind,t.id,r.label,r.relevance,r.types,r.aliases,r.unit_code,
  jsonb_build_object('label','Référentiel éditorial D.A.O.','version','1','verified_on','2026-11-03','scope','Taxonomie uniquement — aucun prix, métré, durée ou conformité')
from rows r left join trade t on t.code=r.trade_code;

create function dao_private.create_project_from_btp_assistant(p_draft_id uuid,p_creation_key text) returns uuid
language plpgsql security definer set search_path='' as $$
declare d public.btp_assistant_drafts; project_row public.projects; lot record; request_row public.project_requests;
  ids uuid[]; scope_text text; invalid_count integer;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication required'; end if;
  select * into d from public.btp_assistant_drafts where id=p_draft_id and owner_id=auth.uid() for update;
  if d.id is null then raise exception using errcode='42501',message='assistant draft access denied'; end if;
  if d.created_project_id is not null then return d.created_project_id; end if;
  if d.governorate_id is null then raise exception using errcode='23514',message='governorate confirmation required'; end if;
  if nullif(btrim(p_creation_key),'') is null or length(p_creation_key)>120 then raise exception using errcode='22023',message='creation key required'; end if;
  ids:=array(select distinct unnest(d.selected_item_ids));
  select count(*) into invalid_count from unnest(ids) x(id) left join public.btp_catalog_items c on c.id=x.id and c.active where c.id is null;
  if invalid_count>0 or cardinality(ids)=0 then raise exception using errcode='23514',message='canonical catalogue selection required'; end if;

  project_row:=dao_private.create_project_draft(d.project_type,null,null,null,null,d.governorate_id,null,null);
  update public.project_versions set title=d.title,description=d.source_description where project_id=project_row.id and status='draft';

  for lot in
    select l.* from public.btp_catalog_items l where l.item_kind='lot' and l.active and (
      l.id=any(ids) or exists(select 1 from public.btp_catalog_items s where s.id=any(ids) and (s.parent_id=l.id or exists(
        select 1 from public.btp_catalog_items p where p.id=s.parent_id and p.parent_id=l.id)))) order by l.code
  loop
    select string_agg(case when c.item_kind='sub_lot' then 'Sous-lot : ' else 'Ouvrage : ' end||c.label_fr,E'\n' order by c.item_kind,c.code)
      into scope_text from public.btp_catalog_items c where c.id=any(ids) and (c.parent_id=lot.id or exists(
        select 1 from public.btp_catalog_items p where p.id=c.parent_id and p.parent_id=lot.id));
    request_row:=dao_private.add_project_request(project_row.id,lot.trade_id,lot.label_fr,
      coalesce(scope_text,'Périmètre issu du référentiel D.A.O. à confirmer.'),null);
    insert into public.project_btp_scope_items(project_id,request_id,catalog_item_id,assistant_draft_id,relevance)
      select project_row.id,request_row.id,c.id,d.id,c.relevance from public.btp_catalog_items c
      where c.id=any(ids) and (c.id=lot.id or c.parent_id=lot.id or exists(
        select 1 from public.btp_catalog_items p where p.id=c.parent_id and p.parent_id=lot.id));
  end loop;
  update public.btp_assistant_drafts set created_project_id=project_row.id,creation_key=p_creation_key,updated_at=now()
    where id=d.id;
  return project_row.id;
end;
$$;
revoke all on function dao_private.create_project_from_btp_assistant(uuid,text) from public,anon;
grant execute on function dao_private.create_project_from_btp_assistant(uuid,text) to authenticated,service_role;
create function public.create_project_from_btp_assistant(p_draft_id uuid,p_creation_key text) returns uuid
language sql security invoker set search_path='' as $$ select dao_private.create_project_from_btp_assistant($1,$2); $$;
revoke all on function public.create_project_from_btp_assistant(uuid,text) from public,anon;
grant execute on function public.create_project_from_btp_assistant(uuid,text) to authenticated,service_role;

commit;
