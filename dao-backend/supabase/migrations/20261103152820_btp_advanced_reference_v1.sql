-- #541 — référentiel BTP avancé V1 (Tunisie), additif et sans données tarifaires.
-- La taxonomie prépare métrés et estimations, mais aucune quantité, durée, prix
-- ou conformité n'est déduite sans entrées/sources explicites.
begin;

create table public.btp_catalog_versions (
  id uuid primary key,
  code text not null unique check (code ~ '^[A-Z]{2}-[0-9]{4}\.[0-9]+$'),
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  region_code text,
  status text not null check (status in ('draft','published','retired')),
  effective_from date not null,
  effective_to date,
  provenance jsonb not null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to>=effective_from),
  check ((status='published')=(published_at is not null)),
  check (jsonb_typeof(provenance)='object' and length(coalesce(provenance->>'label',''))>0)
);

create table public.btp_units (
  code text primary key check (code ~ '^[a-z][a-z0-9_]{0,19}$'),
  symbol text not null,
  label_fr text not null,
  dimension text not null check (dimension in ('length','area','volume','count','mass','time','package')),
  decimal_scale smallint not null default 2 check (decimal_scale between 0 and 6),
  active boolean not null default true
);

create table public.btp_lots (
  id uuid primary key,
  catalog_version_id uuid not null references public.btp_catalog_versions,
  code text not null check (code ~ '^btp_lot_[a-z0-9_]+$'),
  trade_id uuid not null references public.trades,
  label_fr text not null check (length(label_fr) between 2 and 120),
  description_fr text not null default '',
  default_relevance text not null check (default_relevance in ('usual','conditional','optional','verify')),
  project_types text[] not null check (cardinality(project_types)>0 and project_types<@array['construction','renovation','extension','repair','other']::text[]),
  position integer not null check (position>0),
  source_ref text not null check (length(source_ref) between 3 and 300),
  active boolean not null default true,
  unique(catalog_version_id,code),
  unique(id,catalog_version_id)
);
create index btp_lots_trade_idx on public.btp_lots(trade_id) where active;

create table public.btp_sub_lots (
  id uuid primary key,
  catalog_version_id uuid not null,
  lot_id uuid not null,
  code text not null check (code ~ '^btp_sub_[a-z0-9_]+$'),
  label_fr text not null check (length(label_fr) between 2 and 120),
  description_fr text not null default '',
  default_relevance text not null check (default_relevance in ('usual','conditional','optional','verify')),
  project_types text[] not null check (cardinality(project_types)>0 and project_types<@array['construction','renovation','extension','repair','other']::text[]),
  position integer not null check (position>0),
  source_ref text not null check (length(source_ref) between 3 and 300),
  active boolean not null default true,
  foreign key(lot_id,catalog_version_id) references public.btp_lots(id,catalog_version_id),
  unique(catalog_version_id,code),
  unique(id,catalog_version_id)
);
create index btp_sub_lots_lot_idx on public.btp_sub_lots(lot_id) where active;

create table public.btp_works (
  id uuid primary key,
  catalog_version_id uuid not null,
  sub_lot_id uuid not null,
  code text not null check (code ~ '^btp_work_[a-z0-9_]+$'),
  label_fr text not null check (length(label_fr) between 2 and 160),
  description_fr text not null default '',
  unit_code text not null references public.btp_units,
  default_relevance text not null check (default_relevance in ('usual','conditional','optional','verify')),
  project_types text[] not null check (cardinality(project_types)>0 and project_types<@array['construction','renovation','extension','repair','other']::text[]),
  aliases_fr text[] not null default '{}',
  required_inputs text[] not null default '{}',
  measurement_note text not null default '',
  position integer not null check (position>0),
  source_ref text not null check (length(source_ref) between 3 and 300),
  active boolean not null default true,
  foreign key(sub_lot_id,catalog_version_id) references public.btp_sub_lots(id,catalog_version_id),
  unique(catalog_version_id,code),
  unique(id,catalog_version_id),
  unique(id,catalog_version_id,unit_code)
);
create index btp_works_sub_lot_idx on public.btp_works(sub_lot_id) where active;
create index btp_works_unit_idx on public.btp_works(unit_code) where active;

create table public.btp_rules (
  id uuid primary key,
  catalog_version_id uuid not null references public.btp_catalog_versions,
  code text not null,
  rule_type text not null check (rule_type in ('applicability','prerequisite','exclusion','warning','validation')),
  severity text not null check (severity in ('info','warning','blocking')),
  subject_codes text[] not null check (cardinality(subject_codes)>0),
  condition jsonb not null,
  effect jsonb not null,
  explanation_fr text not null check (length(explanation_fr) between 3 and 500),
  source_ref text not null,
  active boolean not null default true,
  unique(catalog_version_id,code),
  check (jsonb_typeof(condition)='object' and jsonb_typeof(effect)='object')
);

create table public.btp_work_dependencies (
  id uuid primary key,
  catalog_version_id uuid not null,
  predecessor_work_id uuid not null,
  successor_work_id uuid not null,
  relation_type text not null check (relation_type in ('finish_to_start','information','interface')),
  applicability jsonb not null default '{}',
  mandatory boolean not null default false,
  explanation_fr text not null,
  source_ref text not null,
  foreign key(predecessor_work_id,catalog_version_id) references public.btp_works(id,catalog_version_id),
  foreign key(successor_work_id,catalog_version_id) references public.btp_works(id,catalog_version_id),
  unique(catalog_version_id,predecessor_work_id,successor_work_id,relation_type),
  check (predecessor_work_id<>successor_work_id and jsonb_typeof(applicability)='object')
);
create index btp_dependencies_successor_idx on public.btp_work_dependencies(successor_work_id);

create table public.btp_measurement_templates (
  id uuid primary key,
  catalog_version_id uuid not null,
  work_id uuid not null,
  output_unit_code text not null references public.btp_units,
  input_schema jsonb not null,
  formula_ast jsonb not null,
  rounding_scale smallint not null default 2 check (rounding_scale between 0 and 6),
  assumptions_fr text[] not null default '{}',
  source_ref text not null,
  active boolean not null default true,
  foreign key(work_id,catalog_version_id) references public.btp_works(id,catalog_version_id),
  unique(catalog_version_id,work_id),
  check (jsonb_typeof(input_schema)='object' and jsonb_typeof(formula_ast)='object')
);

-- Structures futures d'estimation. Elles restent vides en V1 : publier un prix
-- exige source, date, région, devise et unité cohérentes.
create table public.btp_price_books (
  id uuid primary key default gen_random_uuid(),
  catalog_version_id uuid not null references public.btp_catalog_versions,
  name text not null,
  source_name text not null,
  source_uri text not null check (source_uri ~ '^https://'),
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  region_code text,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  valid_from date not null,
  valid_to date,
  verified_at timestamptz not null,
  status text not null check (status in ('draft','published','retired')),
  check (valid_to is null or valid_to>=valid_from),
  unique(id,catalog_version_id)
);
create table public.btp_work_prices (
  id uuid primary key default gen_random_uuid(),
  catalog_version_id uuid not null,
  price_book_id uuid not null,
  work_id uuid not null,
  unit_code text not null,
  amount_minor bigint not null check (amount_minor>=0),
  min_quantity numeric check (min_quantity is null or min_quantity>=0),
  max_quantity numeric check (max_quantity is null or max_quantity>=min_quantity),
  applicability jsonb not null default '{}',
  provenance_note text not null,
  foreign key(price_book_id,catalog_version_id) references public.btp_price_books(id,catalog_version_id),
  foreign key(work_id,catalog_version_id,unit_code) references public.btp_works(id,catalog_version_id,unit_code),
  unique(price_book_id,work_id,unit_code),
  check (jsonb_typeof(applicability)='object')
);

-- Every public table is read-only for app users. Catalogue mutation stays in
-- reviewed migrations/Admin service; no parallel Settings engine is created.
do $$ declare t text; begin
  foreach t in array array['btp_catalog_versions','btp_units','btp_lots','btp_sub_lots','btp_works','btp_rules','btp_work_dependencies','btp_measurement_templates','btp_price_books','btp_work_prices'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon,authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
end $$;
create policy btp_versions_read on public.btp_catalog_versions for select to authenticated using (status='published');
create policy btp_units_read on public.btp_units for select to authenticated using (active);
create policy btp_lots_read on public.btp_lots for select to authenticated using (active and exists(select 1 from public.btp_catalog_versions v where v.id=catalog_version_id and v.status='published'));
create policy btp_sub_lots_read on public.btp_sub_lots for select to authenticated using (active and exists(select 1 from public.btp_catalog_versions v where v.id=catalog_version_id and v.status='published'));
create policy btp_works_read on public.btp_works for select to authenticated using (active and exists(select 1 from public.btp_catalog_versions v where v.id=catalog_version_id and v.status='published'));
create policy btp_rules_read on public.btp_rules for select to authenticated using (active and exists(select 1 from public.btp_catalog_versions v where v.id=catalog_version_id and v.status='published'));
create policy btp_dependencies_read on public.btp_work_dependencies for select to authenticated using (exists(select 1 from public.btp_catalog_versions v where v.id=catalog_version_id and v.status='published'));
create policy btp_measurements_read on public.btp_measurement_templates for select to authenticated using (active and exists(select 1 from public.btp_catalog_versions v where v.id=catalog_version_id and v.status='published'));
create policy btp_price_books_read on public.btp_price_books for select to authenticated using (status='published' and verified_at<=now());
create policy btp_prices_read on public.btp_work_prices for select to authenticated using (exists(select 1 from public.btp_price_books b where b.id=price_book_id and b.status='published' and b.verified_at<=now()));

insert into public.btp_catalog_versions(id,code,country_code,status,effective_from,provenance,published_at) values
('54110000-0000-4000-8000-000000000001','TN-2026.1','TN','published','2026-11-03',
 jsonb_build_object('label','Référentiel éditorial D.A.O.','scope','Classification métier V1 ; ne vaut ni norme, ni étude, ni bordereau de prix','verified_on','2026-11-03'),now());
insert into public.btp_units(code,symbol,label_fr,dimension,decimal_scale) values
('m','m','Mètre linéaire','length',2),('m2','m²','Mètre carré','area',2),('m3','m³','Mètre cube','volume',3),
('unit','u','Unité','count',0),('kg','kg','Kilogramme','mass',2),('hour','h','Heure','time',2),('package','forfait','Forfait','package',2);

with v as (select id from public.btp_catalog_versions where code='TN-2026.1'), t as (select id,code from public.trades), x(id,code,trade_code,label,relevance,types,pos) as (values
('54110000-0000-4000-8000-000000000101'::uuid,'btp_lot_studies','general_contractor','Études et préparation','usual',array['construction','extension'],10),
('54110000-0000-4000-8000-000000000102','btp_lot_earth_structure','trade_masonry','Terrassement et gros œuvre','usual',array['construction','extension'],20),
('54110000-0000-4000-8000-000000000103','btp_lot_roof_waterproofing','trade_waterproofing','Toiture et étanchéité','conditional',array['construction','renovation','extension'],30),
('54110000-0000-4000-8000-000000000104','btp_lot_plumbing','plumbing','Plomberie et sanitaires','usual',array['construction','renovation','extension'],40),
('54110000-0000-4000-8000-000000000105','btp_lot_electrical','electrical','Électricité et courants faibles','usual',array['construction','renovation','extension'],50),
('54110000-0000-4000-8000-000000000106','btp_lot_joinery','trade_alu_joinery','Menuiseries','conditional',array['construction','renovation','extension'],60),
('54110000-0000-4000-8000-000000000107','btp_lot_finishes','trade_tiling','Revêtements et finitions','usual',array['construction','renovation','extension'],70),
('54110000-0000-4000-8000-000000000108','btp_lot_kitchen','trade_kitchen','Cuisine et agencement','optional',array['construction','renovation','extension'],80),
('54110000-0000-4000-8000-000000000109','btp_lot_outdoor','trade_landscaping','Aménagements extérieurs','optional',array['construction','renovation','extension'],90),
('54110000-0000-4000-8000-00000000010a','btp_lot_existing','trade_demolition','Dépose et interfaces avec l’existant','conditional',array['renovation','extension'],15))
insert into public.btp_lots(id,catalog_version_id,code,trade_id,label_fr,default_relevance,project_types,position,source_ref)
select x.id,v.id,x.code,t.id,x.label,x.relevance,x.types,x.pos,'D.A.O. TN-2026.1 — classification éditoriale' from x cross join v join t on t.code=x.trade_code;

with v as (select id from public.btp_catalog_versions where code='TN-2026.1'), x(id,code,lot_code,label,relevance,types,pos) as (values
('54110000-0000-4000-8000-000000000201'::uuid,'btp_sub_design','btp_lot_studies','Conception et études préalables','usual',array['construction','extension'],10),
('54110000-0000-4000-8000-000000000202','btp_sub_earthworks','btp_lot_earth_structure','Terrassement','conditional',array['construction','extension'],10),
('54110000-0000-4000-8000-000000000203','btp_sub_foundations','btp_lot_earth_structure','Fondations','verify',array['construction','extension'],20),
('54110000-0000-4000-8000-000000000204','btp_sub_superstructure','btp_lot_earth_structure','Structure et élévation','usual',array['construction','extension'],30),
('54110000-0000-4000-8000-000000000205','btp_sub_waterproofing','btp_lot_roof_waterproofing','Étanchéité des supports','verify',array['construction','renovation','extension'],10),
('54110000-0000-4000-8000-000000000206','btp_sub_sanitary','btp_lot_plumbing','Réseaux et équipements sanitaires','usual',array['construction','renovation','extension'],10),
('54110000-0000-4000-8000-000000000207','btp_sub_electrical','btp_lot_electrical','Installation électrique','usual',array['construction','renovation','extension'],10),
('54110000-0000-4000-8000-000000000208','btp_sub_openings','btp_lot_joinery','Portes et fenêtres','conditional',array['construction','renovation','extension'],10),
('54110000-0000-4000-8000-000000000209','btp_sub_floor_walls','btp_lot_finishes','Sols, murs et peinture','usual',array['construction','renovation','extension'],10),
('54110000-0000-4000-8000-00000000020a','btp_sub_kitchen','btp_lot_kitchen','Cuisine et rangements','optional',array['construction','renovation','extension'],10),
('54110000-0000-4000-8000-00000000020b','btp_sub_outdoor','btp_lot_outdoor','Terrasse, jardin et annexes','optional',array['construction','renovation','extension'],10),
('54110000-0000-4000-8000-00000000020c','btp_sub_existing_interface','btp_lot_existing','Dépose sélective et raccords','conditional',array['renovation','extension'],10))
insert into public.btp_sub_lots(id,catalog_version_id,lot_id,code,label_fr,default_relevance,project_types,position,source_ref)
select x.id,v.id,l.id,x.code,x.label,x.relevance,x.types,x.pos,'D.A.O. TN-2026.1 — classification éditoriale' from x cross join v join public.btp_lots l on l.catalog_version_id=v.id and l.code=x.lot_code;

with v as (select id from public.btp_catalog_versions where code='TN-2026.1'), x(id,code,sub_code,label,unit_code,relevance,types,aliases,inputs,note,pos) as (values
('54110000-0000-4000-8000-000000000301'::uuid,'btp_work_architectural_plans','btp_sub_design','Plans architecturaux','package','verify',array['construction','extension'],array['plans','architecte'],array[]::text[],'Étendue à confirmer par un professionnel habilité.',10),
('54110000-0000-4000-8000-000000000302','btp_work_soil_study','btp_sub_design','Étude géotechnique selon besoin','package','conditional',array['construction','extension'],array['étude de sol','géotechnique'],array[]::text[],'Applicabilité à confirmer selon terrain et conception.',20),
('54110000-0000-4000-8000-000000000303','btp_work_earthworks','btp_sub_earthworks','Fouilles et terrassement préparatoire','m3','conditional',array['construction','extension'],array['fouille','terrassement'],array['length_m','width_m','depth_m'],'Volume uniquement à partir de dimensions confirmées.',10),
('54110000-0000-4000-8000-000000000304','btp_work_foundations','btp_sub_foundations','Fondations selon études','m3','verify',array['construction','extension'],array['semelle','radier','fondation'],array['engineered_volume_m3'],'Aucun type ni volume sans étude.',10),
('54110000-0000-4000-8000-000000000305','btp_work_structure','btp_sub_superstructure','Ossature et planchers selon études','m3','verify',array['construction','extension'],array['poteau','poutre','dalle'],array['engineered_volume_m3'],'Quantité issue des plans structure uniquement.',10),
('54110000-0000-4000-8000-000000000306','btp_work_masonry','btp_sub_superstructure','Maçonnerie et cloisons','m2','usual',array['construction','extension'],array['mur','cloison'],array['wall_length_m','wall_height_m','openings_area_m2'],'Déduire uniquement les ouvertures connues.',20),
('54110000-0000-4000-8000-000000000307','btp_work_waterproofing','btp_sub_waterproofing','Étanchéité selon support','m2','verify',array['construction','renovation','extension'],array['étanchéité'],array['surface_area_m2'],'Support et système restent à confirmer.',10),
('54110000-0000-4000-8000-000000000308','btp_work_water_network','btp_sub_sanitary','Réseaux alimentation et évacuation','m','usual',array['construction','renovation','extension'],array['canalisation','évacuation'],array['verified_route_length_m'],'Longueur selon tracé validé.',10),
('54110000-0000-4000-8000-000000000309','btp_work_bathroom_equipment','btp_sub_sanitary','Équipements sanitaires','unit','conditional',array['construction','renovation','extension'],array['salle de bain','sanitaire'],array['fixture_count'],'Nombre déclaré, sans ratio automatique.',20),
('54110000-0000-4000-8000-00000000030a','btp_work_electrical_network','btp_sub_electrical','Tableau, circuits et appareillage','unit','verify',array['construction','renovation','extension'],array['prise','éclairage','tableau'],array['verified_point_count'],'Dimensionnement électrique exclu du calcul automatique.',10),
('54110000-0000-4000-8000-00000000030b','btp_work_external_joinery','btp_sub_openings','Menuiseries extérieures','unit','conditional',array['construction','renovation','extension'],array['fenêtre','baie'],array['opening_count'],'Dimensions et performances à confirmer.',10),
('54110000-0000-4000-8000-00000000030c','btp_work_tiling','btp_sub_floor_walls','Carrelage et faïence','m2','conditional',array['construction','renovation','extension'],array['carrelage','faïence'],array['surface_area_m2'],'Surface nette confirmée, aucune perte par défaut.',10),
('54110000-0000-4000-8000-00000000030d','btp_work_painting','btp_sub_floor_walls','Préparation des supports et peinture','m2','usual',array['construction','renovation','extension'],array['peinture','enduit'],array['surface_area_m2'],'Surface des supports à confirmer.',20),
('54110000-0000-4000-8000-00000000030e','btp_work_kitchen','btp_sub_kitchen','Cuisine et agencement','package','optional',array['construction','renovation','extension'],array['cuisine séparée','agencement'],array[]::text[],'Configuration choisie par le Client.',10),
('54110000-0000-4000-8000-00000000030f','btp_work_terrace','btp_sub_outdoor','Terrasse extérieure','m2','optional',array['construction','renovation','extension'],array['terrasse'],array['length_m','width_m'],'Faisabilité et emprise à confirmer.',10),
('54110000-0000-4000-8000-000000000310','btp_work_garden','btp_sub_outdoor','Aménagement du jardin','m2','optional',array['construction','renovation','extension'],array['jardin'],array['surface_area_m2'],'Périmètre paysager à confirmer.',20),
('54110000-0000-4000-8000-000000000311','btp_work_garage','btp_sub_outdoor','Garage','unit','optional',array['construction','renovation','extension'],array['garage'],array['vehicle_count'],'Gabarit et règles locales à vérifier.',30),
('54110000-0000-4000-8000-000000000312','btp_work_pool','btp_sub_outdoor','Piscine','unit','optional',array['construction','renovation','extension'],array['piscine'],array[]::text[],'Jamais suggérée sans demande explicite.',40),
('54110000-0000-4000-8000-000000000313','btp_work_selective_demolition','btp_sub_existing_interface','Dépose ou démolition sélective','package','verify',array['renovation','extension'],array['dépose','démolition'],array[]::text[],'Diagnostic préalable requis.',10),
('54110000-0000-4000-8000-000000000314','btp_work_existing_connections','btp_sub_existing_interface','Raccordement aux ouvrages existants','package','verify',array['extension'],array['raccord existant','interface'],array[]::text[],'Interfaces structure/réseaux à vérifier.',20))
insert into public.btp_works(id,catalog_version_id,sub_lot_id,code,label_fr,unit_code,default_relevance,project_types,aliases_fr,required_inputs,measurement_note,position,source_ref)
select x.id,v.id,s.id,x.code,x.label,x.unit_code,x.relevance,x.types,x.aliases,x.inputs,x.note,x.pos,'D.A.O. TN-2026.1 — classification éditoriale' from x cross join v join public.btp_sub_lots s on s.catalog_version_id=v.id and s.code=x.sub_code;

with v as (select id from public.btp_catalog_versions where code='TN-2026.1'), x(id,code,type,severity,subjects,condition,effect,explanation) as (values
('54110000-0000-4000-8000-000000000401'::uuid,'renovation_no_new_foundations','exclusion','warning',array['btp_work_earthworks','btp_work_foundations'],jsonb_build_object('project_type','renovation'),jsonb_build_object('default','excluded','allow_if','diagnostic_and_scope_confirmed'),'Une rénovation ne reçoit pas automatiquement terrassement ou fondations.'),
('54110000-0000-4000-8000-000000000402','extension_existing_interfaces','prerequisite','warning',array['btp_work_existing_connections'],jsonb_build_object('project_type','extension'),jsonb_build_object('requires',array['existing_diagnostic','interface_review']),'Une extension doit qualifier ses interfaces avec l’existant.'),
('54110000-0000-4000-8000-000000000403','plans_before_structural_quantities','prerequisite','blocking',array['btp_work_foundations','btp_work_structure'],jsonb_build_object('measurement_requested',true),jsonb_build_object('requires',array['technical_study','confirmed_dimensions']),'Les quantités structurelles exigent des études et dimensions confirmées.'),
('54110000-0000-4000-8000-000000000404','pool_explicit_only','applicability','info',array['btp_work_pool'],jsonb_build_object('explicit_user_choice',false),jsonb_build_object('default','excluded'),'La piscine reste facultative et n’est jamais ajoutée silencieusement.'),
('54110000-0000-4000-8000-000000000405','price_source_required','validation','blocking',array['btp_work_earthworks','btp_work_masonry','btp_work_tiling','btp_work_painting'],jsonb_build_object('estimate_requested',true),jsonb_build_object('requires',array['published_price_book','matching_region','valid_date','matching_unit']),'Toute estimation exige une source tarifaire vérifiée et applicable.'))
insert into public.btp_rules(id,catalog_version_id,code,rule_type,severity,subject_codes,condition,effect,explanation_fr,source_ref)
select x.id,v.id,x.code,x.type,x.severity,x.subjects,x.condition,x.effect,x.explanation,'D.A.O. TN-2026.1 — règle éditoriale explicite' from x cross join v;

with v as (select id from public.btp_catalog_versions where code='TN-2026.1'), x(id,pred,succ,relation,mandatory,explanation) as (values
('54110000-0000-4000-8000-000000000501'::uuid,'btp_work_architectural_plans','btp_work_earthworks','information',true,'Les terrassements dépendent du périmètre étudié ; aucune date n’est déduite.'),
('54110000-0000-4000-8000-000000000502','btp_work_earthworks','btp_work_foundations','finish_to_start',true,'Séquence logique à confirmer dans le planning réel.'),
('54110000-0000-4000-8000-000000000503','btp_work_foundations','btp_work_structure','finish_to_start',true,'Séquence logique, sans durée automatique.'),
('54110000-0000-4000-8000-000000000504','btp_work_structure','btp_work_waterproofing','interface',false,'Le support concerné doit être prêt et vérifié.'),
('54110000-0000-4000-8000-000000000505','btp_work_selective_demolition','btp_work_existing_connections','interface',true,'Les interfaces sont qualifiées après dépose/diagnostic.'))
insert into public.btp_work_dependencies(id,catalog_version_id,predecessor_work_id,successor_work_id,relation_type,mandatory,explanation_fr,source_ref)
select x.id,v.id,p.id,s.id,x.relation,x.mandatory,x.explanation,'D.A.O. TN-2026.1 — dépendance logique à confirmer' from x cross join v
join public.btp_works p on p.catalog_version_id=v.id and p.code=x.pred join public.btp_works s on s.catalog_version_id=v.id and s.code=x.succ;

with v as (select id from public.btp_catalog_versions where code='TN-2026.1'), x(id,work_code,unit_code,input_schema,formula) as (values
('54110000-0000-4000-8000-000000000601'::uuid,'btp_work_earthworks','m3',jsonb_build_object('required',array['length_m','width_m','depth_m'],'properties',jsonb_build_object('length_m',jsonb_build_object('type','number','minimum',0),'width_m',jsonb_build_object('type','number','minimum',0),'depth_m',jsonb_build_object('type','number','minimum',0))),jsonb_build_object('op','multiply','args',array['length_m','width_m','depth_m'])),
('54110000-0000-4000-8000-000000000602','btp_work_masonry','m2',jsonb_build_object('required',array['wall_length_m','wall_height_m','openings_area_m2']),jsonb_build_object('op','subtract','args',jsonb_build_array(jsonb_build_object('op','multiply','args',array['wall_length_m','wall_height_m']),'openings_area_m2'))),
('54110000-0000-4000-8000-000000000603','btp_work_tiling','m2',jsonb_build_object('required',array['surface_area_m2']),jsonb_build_object('op','identity','arg','surface_area_m2')),
('54110000-0000-4000-8000-000000000604','btp_work_painting','m2',jsonb_build_object('required',array['surface_area_m2']),jsonb_build_object('op','identity','arg','surface_area_m2')),
('54110000-0000-4000-8000-000000000605','btp_work_terrace','m2',jsonb_build_object('required',array['length_m','width_m']),jsonb_build_object('op','multiply','args',array['length_m','width_m'])))
insert into public.btp_measurement_templates(id,catalog_version_id,work_id,output_unit_code,input_schema,formula_ast,assumptions_fr,source_ref)
select x.id,v.id,w.id,x.unit_code,x.input_schema,x.formula,array['Toutes les dimensions doivent être saisies ou confirmées ; aucune valeur par défaut.'],'D.A.O. TN-2026.1 — formule déterministe sans ratio' from x cross join v join public.btp_works w on w.catalog_version_id=v.id and w.code=x.work_code;

-- Typed, nested read API. Filters may only narrow a published catalogue.
create function public.btp_catalog_snapshot(p_project_type text default null,p_country_code text default 'TN') returns jsonb
language sql stable security invoker set search_path='' as $$
  select coalesce((select jsonb_build_object(
    'catalogVersion',jsonb_build_object('id',v.id,'code',v.code,'countryCode',v.country_code,'regionCode',v.region_code,'effectiveFrom',v.effective_from,'provenance',v.provenance),
    'units',(select coalesce(jsonb_agg(jsonb_build_object('code',u.code,'symbol',u.symbol,'label',u.label_fr,'dimension',u.dimension,'decimalScale',u.decimal_scale) order by u.code),'[]'::jsonb) from public.btp_units u),
    'lots',(select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'code',l.code,'tradeId',l.trade_id,'label',l.label_fr,'relevance',l.default_relevance,'projectTypes',l.project_types,'sourceRef',l.source_ref,
      'subLots',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'code',s.code,'label',s.label_fr,'relevance',s.default_relevance,'projectTypes',s.project_types,'sourceRef',s.source_ref,
        'works',(select coalesce(jsonb_agg(jsonb_build_object('id',w.id,'code',w.code,'label',w.label_fr,'unitCode',w.unit_code,'relevance',w.default_relevance,'projectTypes',w.project_types,'aliases',w.aliases_fr,'requiredInputs',w.required_inputs,'measurementNote',w.measurement_note,'sourceRef',w.source_ref) order by w.position),'[]'::jsonb) from public.btp_works w where w.sub_lot_id=s.id and (p_project_type is null or p_project_type=any(w.project_types)))) order by s.position),'[]'::jsonb) from public.btp_sub_lots s where s.lot_id=l.id and (p_project_type is null or p_project_type=any(s.project_types)))) order by l.position),'[]'::jsonb) from public.btp_lots l where l.catalog_version_id=v.id and (p_project_type is null or p_project_type=any(l.project_types))),
    'rules',(select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'code',r.code,'type',r.rule_type,'severity',r.severity,'subjects',r.subject_codes,'condition',r.condition,'effect',r.effect,'explanation',r.explanation_fr,'sourceRef',r.source_ref) order by r.code),'[]'::jsonb) from public.btp_rules r where r.catalog_version_id=v.id),
    'dependencies',(select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'predecessorWorkId',d.predecessor_work_id,'successorWorkId',d.successor_work_id,'relationType',d.relation_type,'mandatory',d.mandatory,'applicability',d.applicability,'explanation',d.explanation_fr,'sourceRef',d.source_ref) order by d.id),'[]'::jsonb) from public.btp_work_dependencies d where d.catalog_version_id=v.id and (p_project_type is null or (exists(select 1 from public.btp_works pw where pw.id=d.predecessor_work_id and p_project_type=any(pw.project_types)) and exists(select 1 from public.btp_works sw where sw.id=d.successor_work_id and p_project_type=any(sw.project_types))))),
    'measurementTemplates',(select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'workId',m.work_id,'outputUnitCode',m.output_unit_code,'inputSchema',m.input_schema,'formulaAst',m.formula_ast,'roundingScale',m.rounding_scale,'assumptions',m.assumptions_fr,'sourceRef',m.source_ref) order by m.id),'[]'::jsonb) from public.btp_measurement_templates m where m.catalog_version_id=v.id and (p_project_type is null or exists(select 1 from public.btp_works mw where mw.id=m.work_id and p_project_type=any(mw.project_types)))),
    'priceSources',(select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'sourceName',b.source_name,'sourceUri',b.source_uri,'countryCode',b.country_code,'regionCode',b.region_code,'currency',b.currency,'validFrom',b.valid_from,'validTo',b.valid_to,'verifiedAt',b.verified_at) order by b.valid_from desc),'[]'::jsonb) from public.btp_price_books b where b.catalog_version_id=v.id and b.country_code=p_country_code and b.status='published' and b.verified_at<=now() and b.valid_from<=current_date and (b.valid_to is null or b.valid_to>=current_date))
  ) from public.btp_catalog_versions v where v.status='published' and v.country_code=p_country_code order by v.effective_from desc limit 1),'{}'::jsonb);
$$;
revoke all on function public.btp_catalog_snapshot(text,text) from public,anon;
grant execute on function public.btp_catalog_snapshot(text,text) to authenticated,service_role;

commit;
