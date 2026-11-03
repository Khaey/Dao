-- #551 — base de prix BTP sourcés et estimation budgétaire déterministe (Coordinateur Mission 1).
-- Additif. Ne modifie ni le catalogue (#541/#547), ni les métrés (#548), ni les offres, devis,
-- contrats, paiements ou situations. Aucun prix n'est créé par cette migration.
-- Garanties :
-- * un tarif observé n'est utilisable qu'après vérification par un Admin différent de son auteur ;
-- * prix observés (barème sourcé), hypothèses privées d'un chantier et prix d'offres ne se mélangent
--   jamais : les offres ne sont pas lues, les hypothèses privées exigent un choix explicite ;
-- * données réelles et données de test fictives sont séparées (mode « simulation » seulement) ;
-- * aucune TVA, conversion de devise, perte, marge ou frais n'est appliqué sans valeur explicite ;
-- * quantité inconnue, tarif absent/périmé ou unité incompatible => ligne manquante, jamais un total
--   complet trompeur ; révisions et événements append-only, approbation jamais modifiée en silence.
begin;

-- 1. Sources tarifaires (immuables).
create table public.btp_price_sources (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9][a-z0-9_.-]{2,59}$'),
  name text not null check (length(btrim(name)) between 3 and 160),
  publisher text not null check (length(btrim(publisher)) between 2 and 160),
  source_kind text not null check (source_kind in ('official_publication','professional_body','supplier_catalog','market_survey','human_entry','test_fixture')),
  data_nature text not null check (data_nature in ('real','fictitious_test')),
  uri text check (uri is null or (uri ~ '^https://[^[:space:]]+$' and length(uri) between 12 and 500)),
  license_note text not null check (length(btrim(license_note)) between 5 and 1000),
  created_by uuid not null references auth.users,
  created_at timestamptz not null default now(),
  check ((source_kind='test_fixture')=(data_nature='fictitious_test')),
  check (source_kind in ('human_entry','test_fixture') or uri is not null)
);

-- 2. Tarifs : identité (ouvrage canonique, unité de l'ouvrage, composante, zone) + révisions.
create table public.btp_price_items (
  id uuid primary key default gen_random_uuid(),
  price_kind text not null check (price_kind in ('observed','private_assumption')),
  project_id uuid references public.projects,
  source_id uuid references public.btp_price_sources,
  catalog_version_id uuid not null,
  work_id uuid not null,
  unit_code text not null,
  component text not null check (component in ('composite','material','labour','equipment')),
  country_code text not null default 'TN' check (country_code ~ '^[A-Z]{2}$'),
  governorate_id uuid references public.governorates,
  status text not null check (status in ('pending','verified','rejected','declared','retired')),
  current_revision integer not null check (current_revision>0),
  verified_revision integer check (verified_revision is null or (verified_revision>0 and verified_revision<=current_revision)),
  created_by uuid not null references auth.users,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (work_id,catalog_version_id,unit_code) references public.btp_works(id,catalog_version_id,unit_code),
  check ((price_kind='private_assumption')=(project_id is not null)),
  check ((price_kind='observed')=(source_id is not null)),
  check (price_kind='observed' or (status in ('declared','retired') and verified_revision is null and governorate_id is null)),
  check (price_kind='private_assumption' or status<>'declared')
);
create index btp_price_items_work_idx on public.btp_price_items(work_id,unit_code) where status<>'retired';
create index btp_price_items_project_idx on public.btp_price_items(project_id) where project_id is not null;

create table public.btp_price_item_revisions (
  item_id uuid not null references public.btp_price_items,
  revision integer not null check (revision>0),
  amount_min_minor bigint not null check (amount_min_minor between 0 and 1000000000000),
  amount_max_minor bigint not null check (amount_max_minor between 0 and 1000000000000),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  tax_basis text not null check (tax_basis in ('HT','TTC')),
  vat_rate_bp integer check (vat_rate_bp is null or vat_rate_bp between 0 and 10000),
  includes text[] not null default '{}' check (includes <@ array['supply','installation','transport','margin','equipment']::text[]),
  observed_on date not null,
  valid_from date not null,
  valid_to date,
  source_locator text not null check (length(btrim(source_locator)) between 2 and 300),
  conditions_fr text not null default '' check (length(conditions_fr)<=1000),
  recorded_by uuid not null references auth.users,
  recorded_at timestamptz not null default now(),
  primary key (item_id,revision),
  check (amount_max_minor>=amount_min_minor),
  check (valid_to is null or valid_to>=valid_from),
  check (observed_on<=coalesce(valid_to,observed_on))
);

create table public.btp_price_events (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null,
  revision integer not null,
  event_type text not null check (event_type in ('recorded','revised','verified','rejected','declared','retired')),
  actor_id uuid not null references auth.users,
  note text check (note is null or length(btrim(note)) between 1 and 1000),
  created_at timestamptz not null default now(),
  foreign key (item_id,revision) references public.btp_price_item_revisions(item_id,revision)
);
create index btp_price_events_item_idx on public.btp_price_events(item_id,created_at,id);

-- 3. Estimations : dossier + révisions immuables + événements.
create table public.btp_estimates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects,
  label text not null check (length(btrim(label)) between 1 and 160),
  status text not null default 'draft' check (status in ('draft','approved')),
  current_revision integer not null check (current_revision>0),
  approved_revision integer check (approved_revision is null or (approved_revision>0 and approved_revision<=current_revision)),
  created_by uuid not null references auth.users,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status='approved')=(approved_revision is not null and approved_revision=current_revision))
);
create index btp_estimates_project_idx on public.btp_estimates(project_id,updated_at desc,id);

create table public.btp_estimate_revisions (
  estimate_id uuid not null references public.btp_estimates,
  revision integer not null check (revision>0),
  mode text not null check (mode in ('reference','simulation')),
  reference_date date not null,
  coverage_status text not null check (coverage_status in ('complete','partial','unavailable')),
  total_lines integer not null check (total_lines>=0),
  priced_lines integer not null check (priced_lines between 0 and total_lines),
  inputs jsonb not null check (jsonb_typeof(inputs)='object'),
  result jsonb not null check (jsonb_typeof(result)='object'),
  input_sha256 text not null check (input_sha256 ~ '^[0-9a-f]{64}$'),
  result_sha256 text not null check (result_sha256 ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references auth.users,
  created_at timestamptz not null default now(),
  primary key (estimate_id,revision)
);

create table public.btp_estimate_events (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null,
  revision integer not null,
  event_type text not null check (event_type in ('calculated','approved','approval_superseded')),
  actor_id uuid not null references auth.users,
  note text check (note is null or length(btrim(note)) between 1 and 1000),
  created_at timestamptz not null default now(),
  foreign key (estimate_id,revision) references public.btp_estimate_revisions(estimate_id,revision)
);
create index btp_estimate_events_idx on public.btp_estimate_events(estimate_id,created_at,id);

create table dao_private.btp_price_command_receipts (
  actor_id uuid not null,
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9._:-]{8,100}$'),
  scope text not null check (scope in ('price','estimate')),
  action text not null,
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (actor_id,scope,idempotency_key)
);
alter table dao_private.btp_price_command_receipts enable row level security;
revoke all on dao_private.btp_price_command_receipts from public,anon,authenticated;

-- Historique append-only.
create trigger btp_price_sources_append_only before update or delete on public.btp_price_sources for each row execute function dao_private.append_only();
create trigger btp_price_item_revisions_append_only before update or delete on public.btp_price_item_revisions for each row execute function dao_private.append_only();
create trigger btp_price_events_append_only before update or delete on public.btp_price_events for each row execute function dao_private.append_only();
create trigger btp_estimate_revisions_append_only before update or delete on public.btp_estimate_revisions for each row execute function dao_private.append_only();
create trigger btp_estimate_events_append_only before update or delete on public.btp_estimate_events for each row execute function dao_private.append_only();
create function dao_private.btp_no_delete() returns trigger language plpgsql set search_path='' as $$
begin raise exception using errcode='42501',message='btp price/estimate rows are never deleted'; end; $$;
create trigger btp_price_items_no_delete before delete on public.btp_price_items for each row execute function dao_private.btp_no_delete();
create trigger btp_estimates_no_delete before delete on public.btp_estimates for each row execute function dao_private.btp_no_delete();

-- 4. Lecture : RLS en défense (les API passent par les RPC ci-dessous). Les Artisans et les autres
-- participants du chantier ne voient ni hypothèses privées ni estimations.
do $$ declare t text; begin
  foreach t in array array['btp_price_sources','btp_price_items','btp_price_item_revisions','btp_price_events','btp_estimates','btp_estimate_revisions','btp_estimate_events'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
end $$;

create function dao_private.btp_estimate_access(p_project_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and (dao_private.owner(p_project_id) or dao_private.manages_project(p_project_id));
$$;
create function dao_private.btp_price_item_visible(p_item_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.btp_price_items i where i.id=p_item_id and (
    dao_private.staff()
    or (i.price_kind='observed' and i.verified_revision is not null and i.status<>'retired')
    or (i.price_kind='private_assumption' and dao_private.btp_estimate_access(i.project_id))));
$$;
create policy btp_price_sources_read on public.btp_price_sources for select to authenticated using (true);
create policy btp_price_items_read on public.btp_price_items for select to authenticated using (dao_private.btp_price_item_visible(id));
create policy btp_price_revisions_read on public.btp_price_item_revisions for select to authenticated using (
  dao_private.staff() or exists(select 1 from public.btp_price_items i where i.id=item_id and (
    (i.price_kind='observed' and i.verified_revision=revision and i.status<>'retired')
    or (i.price_kind='private_assumption' and dao_private.btp_estimate_access(i.project_id)))));
create policy btp_price_events_read on public.btp_price_events for select to authenticated using (
  dao_private.staff() or exists(select 1 from public.btp_price_items i where i.id=item_id and i.price_kind='private_assumption' and dao_private.btp_estimate_access(i.project_id)));
create policy btp_estimates_read on public.btp_estimates for select to authenticated using (dao_private.btp_estimate_access(project_id));
create policy btp_estimate_revisions_read on public.btp_estimate_revisions for select to authenticated using (
  exists(select 1 from public.btp_estimates e where e.id=estimate_id and dao_private.btp_estimate_access(e.project_id)));
create policy btp_estimate_events_read on public.btp_estimate_events for select to authenticated using (
  exists(select 1 from public.btp_estimates e where e.id=estimate_id and dao_private.btp_estimate_access(e.project_id)));

-- 5. Utilitaires.
create function dao_private.btp_sha256(p jsonb) returns text language sql immutable set search_path='' as $$
  select encode(sha256(convert_to(p::text,'UTF8')),'hex');
$$;

-- Montant d'une ligne en millimes : quantité (micro-unités entières) × prix unitaire (millimes),
-- conversion HT/TTC uniquement avec un taux explicite (points de base), arrondi demi-supérieur
-- au millime, en arithmétique entière exacte (identique au vérificateur TypeScript).
create function dao_private.btp_estimate_amount(p_qty_micro numeric,p_amount bigint,p_basis text,p_rate integer,p_target text)
returns bigint language plpgsql immutable set search_path='' as $$
declare n numeric; d numeric;
begin
  if p_qty_micro is null or p_amount is null then return null; end if;
  if p_basis=p_target then n:=p_qty_micro*p_amount; d:=1000000;
  elsif p_rate is null then return null;
  elsif p_basis='HT' then n:=p_qty_micro*p_amount*(10000+p_rate); d:=10000000000;
  else n:=p_qty_micro*p_amount*10000; d:=1000000::numeric*(10000+p_rate);
  end if;
  return div(2*n+d,2*d)::bigint;
end;
$$;

create function dao_private.btp_parse_date(p text) returns date language plpgsql immutable set search_path='' as $$
begin
  if p is null then return null; end if;
  if p !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception using errcode='22023',message='invalid date'; end if;
  return p::date;
end;
$$;

create function dao_private.btp_revision_json(p_item_id uuid,p_revision integer) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('revision',r.revision,'amountMinMinor',r.amount_min_minor,'amountMaxMinor',r.amount_max_minor,
    'currency',r.currency,'taxBasis',r.tax_basis,'vatRateBp',r.vat_rate_bp,'includes',to_jsonb(r.includes),
    'observedOn',r.observed_on,'validFrom',r.valid_from,'validTo',r.valid_to,'sourceLocator',r.source_locator,
    'conditions',r.conditions_fr,'recordedBy',r.recorded_by,'recordedAt',r.recorded_at)
  from public.btp_price_item_revisions r where r.item_id=p_item_id and r.revision=p_revision;
$$;

create function dao_private.btp_price_item_json(p_item_id uuid,p_full boolean) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',i.id,'priceKind',i.price_kind,'projectId',i.project_id,'sourceId',i.source_id,
    'catalogVersionId',i.catalog_version_id,'workId',i.work_id,'workCode',w.code,'workLabel',w.label_fr,'unitCode',i.unit_code,
    'component',i.component,'countryCode',i.country_code,'governorateId',i.governorate_id,'governorate',g.name_fr,
    'status',i.status,'currentRevision',i.current_revision,'verifiedRevision',i.verified_revision,
    'createdBy',i.created_by,'createdAt',i.created_at,'updatedAt',i.updated_at,
    'verified',case when i.verified_revision is null then null else dao_private.btp_revision_json(i.id,i.verified_revision) end,
    'current',case when p_full or i.price_kind='private_assumption' then dao_private.btp_revision_json(i.id,i.current_revision) else null end,
    'events',case when p_full or i.price_kind='private_assumption' then (select coalesce(jsonb_agg(jsonb_build_object('type',e.event_type,'revision',e.revision,'actorId',e.actor_id,'note',e.note,'at',e.created_at) order by e.created_at,e.id),'[]'::jsonb)
      from public.btp_price_events e where e.item_id=i.id) else null end)
  from public.btp_price_items i
  join public.btp_works w on w.id=i.work_id and w.catalog_version_id=i.catalog_version_id
  left join public.governorates g on g.id=i.governorate_id
  where i.id=p_item_id;
$$;

-- 6. Commandes tarifaires.
create function dao_private.btp_price_command_v1(p_action text,p_input jsonb,p_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); v_hash text; prior dao_private.btp_price_command_receipts; result jsonb;
  v_item public.btp_price_items; v_source public.btp_price_sources; v_work record; v_rev public.btp_price_item_revisions;
  v_kind text; v_project uuid; v_gov uuid; v_min bigint; v_max bigint; v_expected integer; v_note text; v_new integer;
  v_includes text[]; v_id uuid;
begin
  if actor is null then raise exception using errcode='42501',message='authentication required'; end if;
  if p_action not in ('register_source','record','verify','reject','retire') then raise exception using errcode='22023',message='unknown price action'; end if;
  if p_input is null or jsonb_typeof(p_input)<>'object' then raise exception using errcode='22023',message='invalid payload'; end if;
  if p_key is null or p_key !~ '^[A-Za-z0-9._:-]{8,100}$' then raise exception using errcode='22023',message='invalid idempotency key'; end if;
  v_hash:=dao_private.btp_sha256(jsonb_build_object('action',p_action,'input',p_input));
  select * into prior from dao_private.btp_price_command_receipts where actor_id=actor and scope='price' and idempotency_key=p_key;
  if found then
    if prior.payload_sha256<>v_hash or prior.action<>p_action then raise exception using errcode='22023',message='idempotency key reused with another payload'; end if;
    return prior.result;
  end if;
  v_note:=nullif(btrim(coalesce(p_input->>'note','')),'');
  if v_note is not null and length(v_note)>1000 then raise exception using errcode='22023',message='note too long'; end if;

  if p_action='register_source' then
    if not dao_private.admin() then raise exception using errcode='42501',message='admin required to register a price source'; end if;
    if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('code','name','publisher','sourceKind','dataNature','uri','licenseNote')) then
      raise exception using errcode='22023',message='unexpected source field'; end if;
    insert into public.btp_price_sources(code,name,publisher,source_kind,data_nature,uri,license_note,created_by)
    values (p_input->>'code',btrim(p_input->>'name'),btrim(p_input->>'publisher'),p_input->>'sourceKind',p_input->>'dataNature',
      nullif(p_input->>'uri',''),btrim(p_input->>'licenseNote'),actor) returning * into v_source;
    result:=jsonb_build_object('source',to_jsonb(v_source));

  elsif p_action='record' then
    if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('itemId','expectedRevision','priceKind','projectId','sourceId','workId','component','governorateId',
      'amountMinMinor','amountMaxMinor','currency','taxBasis','vatRateBp','includes','observedOn','validFrom','validTo','sourceLocator','conditions','note')) then
      raise exception using errcode='22023',message='unexpected price field'; end if;
    if jsonb_typeof(p_input->'amountMinMinor')<>'number' or (p_input ? 'amountMaxMinor' and jsonb_typeof(p_input->'amountMaxMinor') not in ('number','null')) then
      raise exception using errcode='22023',message='amounts must be integer millimes'; end if;
    v_min:=(p_input->>'amountMinMinor')::bigint; v_max:=coalesce((p_input->>'amountMaxMinor')::bigint,v_min);
    if (p_input->>'amountMinMinor')::numeric<>v_min or (p_input->>'amountMaxMinor' is not null and (p_input->>'amountMaxMinor')::numeric<>v_max) then
      raise exception using errcode='22023',message='amounts must be integer millimes'; end if;
    if p_input ? 'includes' and jsonb_typeof(p_input->'includes')<>'array' then raise exception using errcode='22023',message='includes must be an array'; end if;
    select coalesce(array_agg(distinct x order by x),'{}') into v_includes from jsonb_array_elements_text(coalesce(p_input->'includes','[]'::jsonb)) x;

    if nullif(p_input->>'itemId','') is not null then
      select * into v_item from public.btp_price_items where id=(p_input->>'itemId')::uuid for update;
      if not found then raise exception using errcode='P0002',message='price item not found'; end if;
      if v_item.status='retired' then raise exception using errcode='22023',message='retired price item'; end if;
      if v_item.price_kind='observed' and not dao_private.staff() then raise exception using errcode='42501',message='staff required'; end if;
      if v_item.price_kind='private_assumption' and not dao_private.btp_estimate_access(v_item.project_id) then raise exception using errcode='42501',message='project access required'; end if;
      v_expected:=(p_input->>'expectedRevision')::integer;
      if v_expected is distinct from v_item.current_revision then raise exception using errcode='40001',message='stale price revision'; end if;
      if exists(select 1 from jsonb_object_keys(p_input) k where k in ('priceKind','projectId','sourceId','workId','component','governorateId')) then
        raise exception using errcode='22023',message='price identity is immutable; record a new item instead'; end if;
      v_new:=v_item.current_revision+1;
      update public.btp_price_items set current_revision=v_new,
        status=case when price_kind='observed' then 'pending' else 'declared' end,updated_at=now() where id=v_item.id returning * into v_item;
    else
      v_kind:=coalesce(p_input->>'priceKind','observed');
      select w.id,w.catalog_version_id,w.unit_code into v_work from public.btp_works w join public.btp_catalog_versions v on v.id=w.catalog_version_id
        where w.id=(p_input->>'workId')::uuid and w.active and v.status='published' and v.country_code='TN';
      if not found then raise exception using errcode='22023',message='work is not in the published catalogue'; end if;
      if v_kind='observed' then
        if not dao_private.staff() then raise exception using errcode='42501',message='staff required to record an observed price'; end if;
        if p_input ? 'projectId' then raise exception using errcode='22023',message='observed prices are not project-scoped'; end if;
        select * into v_source from public.btp_price_sources where id=(p_input->>'sourceId')::uuid;
        if not found then raise exception using errcode='22023',message='unknown price source'; end if;
        if v_source.source_kind='human_entry' and v_source.data_nature='real' and length(btrim(coalesce(p_input->>'sourceLocator','')))<10 then
          raise exception using errcode='22023',message='human entry requires a precise locator'; end if;
        v_gov:=nullif(p_input->>'governorateId','')::uuid;
      elsif v_kind='private_assumption' then
        v_project:=(p_input->>'projectId')::uuid;
        if v_project is null or not dao_private.btp_estimate_access(v_project) then raise exception using errcode='42501',message='project access required'; end if;
        if p_input ? 'sourceId' or p_input ? 'governorateId' then raise exception using errcode='22023',message='private assumptions carry no public source or zone'; end if;
      else raise exception using errcode='22023',message='invalid price kind'; end if;
      insert into public.btp_price_items(price_kind,project_id,source_id,catalog_version_id,work_id,unit_code,component,governorate_id,status,current_revision,created_by)
      values (v_kind,v_project,v_source.id,v_work.catalog_version_id,v_work.id,v_work.unit_code,coalesce(p_input->>'component','composite'),v_gov,
        case when v_kind='observed' then 'pending' else 'declared' end,1,actor) returning * into v_item;
      v_new:=1;
    end if;
    insert into public.btp_price_item_revisions(item_id,revision,amount_min_minor,amount_max_minor,currency,tax_basis,vat_rate_bp,includes,observed_on,valid_from,valid_to,source_locator,conditions_fr,recorded_by)
    values (v_item.id,v_new,v_min,v_max,coalesce(p_input->>'currency','TND'),p_input->>'taxBasis',(p_input->>'vatRateBp')::integer,v_includes,
      dao_private.btp_parse_date(p_input->>'observedOn'),dao_private.btp_parse_date(p_input->>'validFrom'),dao_private.btp_parse_date(p_input->>'validTo'),
      btrim(coalesce(p_input->>'sourceLocator','')),coalesce(btrim(p_input->>'conditions'),''),actor);
    if (p_input->>'vatRateBp') is not null and (p_input->>'vatRateBp')::numeric<>(p_input->>'vatRateBp')::integer then
      raise exception using errcode='22023',message='vat rate must be integer basis points'; end if;
    insert into public.btp_price_events(item_id,revision,event_type,actor_id,note)
    values (v_item.id,v_new,case when v_item.price_kind='private_assumption' then 'declared' when v_new=1 then 'recorded' else 'revised' end,actor,v_note);
    result:=jsonb_build_object('item',dao_private.btp_price_item_json(v_item.id,true));

  else
    if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('itemId','expectedRevision','note')) then
      raise exception using errcode='22023',message='unexpected field'; end if;
    select * into v_item from public.btp_price_items where id=(p_input->>'itemId')::uuid for update;
    if not found then raise exception using errcode='P0002',message='price item not found'; end if;
    v_expected:=(p_input->>'expectedRevision')::integer;
    if v_expected is distinct from v_item.current_revision then raise exception using errcode='40001',message='stale price revision'; end if;
    if p_action in ('verify','reject') then
      if v_item.price_kind<>'observed' then raise exception using errcode='22023',message='private assumptions are never verified'; end if;
      if not dao_private.admin() then raise exception using errcode='42501',message='admin required to verify prices'; end if;
      if v_item.status<>'pending' then raise exception using errcode='22023',message='only a pending revision can be reviewed'; end if;
      select * into v_rev from public.btp_price_item_revisions where item_id=v_item.id and revision=v_item.current_revision;
      if v_rev.recorded_by=actor then raise exception using errcode='42501',message='the author of a price cannot verify it'; end if;
      if p_action='reject' and v_note is null then raise exception using errcode='22023',message='a rejection reason is required'; end if;
      update public.btp_price_items set status=case when p_action='verify' then 'verified' else 'rejected' end,
        verified_revision=case when p_action='verify' then current_revision else verified_revision end,updated_at=now() where id=v_item.id;
      insert into public.btp_price_events(item_id,revision,event_type,actor_id,note) values (v_item.id,v_item.current_revision,case when p_action='verify' then 'verified' else 'rejected' end,actor,v_note);
    else
      if v_item.status='retired' then raise exception using errcode='22023',message='already retired'; end if;
      if v_item.price_kind='observed' and not dao_private.admin() then raise exception using errcode='42501',message='admin required'; end if;
      if v_item.price_kind='private_assumption' and not dao_private.btp_estimate_access(v_item.project_id) then raise exception using errcode='42501',message='project access required'; end if;
      if v_note is null then raise exception using errcode='22023',message='a retirement reason is required'; end if;
      update public.btp_price_items set status='retired',updated_at=now() where id=v_item.id;
      insert into public.btp_price_events(item_id,revision,event_type,actor_id,note) values (v_item.id,v_item.current_revision,'retired',actor,v_note);
    end if;
    result:=jsonb_build_object('item',dao_private.btp_price_item_json(v_item.id,true));
  end if;

  insert into dao_private.btp_price_command_receipts(actor_id,idempotency_key,scope,action,payload_sha256,result) values (actor,p_key,'price',p_action,v_hash,result);
  return result;
end;
$$;

create function dao_private.btp_price_list_v1(p_project_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_staff boolean; v_project boolean;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication required'; end if;
  v_staff:=dao_private.staff();
  v_project:=p_project_id is not null and dao_private.btp_estimate_access(p_project_id);
  if p_project_id is not null and not v_project then raise exception using errcode='42501',message='project access required'; end if;
  return jsonb_build_object(
    'canManage',v_staff,'canVerify',dao_private.admin(),
    'sources',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'code',s.code,'name',s.name,'publisher',s.publisher,'sourceKind',s.source_kind,
      'dataNature',s.data_nature,'uri',s.uri,'licenseNote',s.license_note,'createdAt',s.created_at) order by s.code),'[]'::jsonb) from public.btp_price_sources s),
    'items',(select coalesce(jsonb_agg(dao_private.btp_price_item_json(x.id,v_staff) order by x.updated_at desc,x.id),'[]'::jsonb) from (
      select i.id,i.updated_at from public.btp_price_items i
      where (i.price_kind='observed' and (v_staff or (i.verified_revision is not null and i.status<>'retired')))
         or (i.price_kind='private_assumption' and v_project and i.project_id=p_project_id)
      order by i.updated_at desc,i.id limit 500) x));
end;
$$;

-- 7. Moteur d'estimation (autoritaire, lecture seule). Règles documentées dans `rules`.
create function dao_private.btp_estimate_compute(p_project_id uuid,p_input jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  v_mode text:=coalesce(p_input->>'mode','reference');
  v_ref date; v_private boolean; v_scope boolean; v_takeoffs boolean;
  v_gov uuid; v_gov_name text; v_version public.btp_catalog_versions;
  v_raw jsonb:='[]'::jsonb; v_keys text[]:='{}'; v_lines jsonb:='[]'::jsonb; v_missing jsonb:='[]'::jsonb;
  item jsonb; v_work record; v_scope_key text; v_kind text; v_value numeric; v_unit text; v_qty numeric; v_qty_micro numeric;
  v_status text; v_codes text[]; v_warn text[]; v_qsource jsonb; v_cands jsonb; v_best int; v_has_composite boolean;
  v_line jsonb; v_ht_min bigint; v_ht_max bigint; v_ttc_min bigint; v_ttc_max bigint; v_ht_ok boolean; v_ttc_ok boolean;
  v_comp text; c record; v_tk record; v_has_takeoffs boolean:=to_regclass('public.btp_takeoffs') is not null;
  v_total int:=0; v_priced int:=0; v_complete int:=0; v_coverage text; v_totals jsonb; v_by_lot jsonb; v_inputs jsonb; v_reason text;
begin
  if v_mode not in ('reference','simulation') then raise exception using errcode='22023',message='invalid estimate mode'; end if;
  if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('projectId','estimateId','expectedRevision','label','mode','referenceDate',
    'includePrivateAssumptions','includeAssistantScope','includeValidatedTakeoffs','lines','note')) then
    raise exception using errcode='22023',message='unexpected estimate field'; end if;
  foreach v_kind in array array['includePrivateAssumptions','includeAssistantScope','includeValidatedTakeoffs'] loop
    if p_input ? v_kind and jsonb_typeof(p_input->v_kind)<>'boolean' then raise exception using errcode='22023',message='boolean option expected'; end if;
  end loop;
  v_private:=coalesce((p_input->>'includePrivateAssumptions')::boolean,false);
  v_scope:=coalesce((p_input->>'includeAssistantScope')::boolean,true);
  v_takeoffs:=coalesce((p_input->>'includeValidatedTakeoffs')::boolean,true);
  if v_mode='simulation' and v_private then raise exception using errcode='22023',message='simulation never mixes private assumptions'; end if;
  v_ref:=coalesce(dao_private.btp_parse_date(p_input->>'referenceDate'),current_date);
  if p_input ? 'lines' and jsonb_typeof(p_input->'lines')<>'array' then raise exception using errcode='22023',message='lines must be an array'; end if;
  if jsonb_array_length(coalesce(p_input->'lines','[]'::jsonb))>200 then raise exception using errcode='22023',message='too many lines'; end if;

  select pv.governorate_id,g.name_fr into v_gov,v_gov_name from public.project_versions pv left join public.governorates g on g.id=pv.governorate_id
    where pv.project_id=p_project_id order by pv.version_no desc limit 1;
  select * into v_version from public.btp_catalog_versions where country_code='TN' and status='published';
  if not found then raise exception using errcode='P0002',message='no published BTP catalogue'; end if;

  -- a) lignes explicites
  for item in select x from jsonb_array_elements(coalesce(p_input->'lines','[]'::jsonb)) x loop
    if jsonb_typeof(item)<>'object' or exists(select 1 from jsonb_object_keys(item) k where k not in ('workId','scopeKey','quantity','source')) then
      raise exception using errcode='22023',message='invalid estimate line'; end if;
    if coalesce(item->>'workId','') !~ '^[0-9a-fA-F-]{36}$' then raise exception using errcode='22023',message='invalid work id'; end if;
    if not exists(select 1 from public.btp_works w where w.id=(item->>'workId')::uuid and w.catalog_version_id=v_version.id and w.active) then
      raise exception using errcode='22023',message='work is not in the published catalogue'; end if;
    v_scope_key:=coalesce(nullif(item->>'scopeKey',''),'default');
    if v_scope_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$' then raise exception using errcode='22023',message='invalid scope key'; end if;
    if lower(item->>'workId')||'/'||v_scope_key = any(v_keys) then raise exception using errcode='22023',message='duplicate estimate line'; end if;
    v_kind:=coalesce(item->'source'->>'kind','none');
    if item ? 'source' and (jsonb_typeof(item->'source')<>'object' or exists(select 1 from jsonb_object_keys(item->'source') k where k not in ('kind','reference','takeoffId'))) then
      raise exception using errcode='22023',message='invalid quantity source'; end if;
    if v_kind='declared' then
      if jsonb_typeof(item->'quantity')<>'object' or coalesce(item->'quantity'->>'value','') !~ '^[0-9]{1,12}(\.[0-9]{1,6})?$' or (item->'quantity'->>'value')::numeric<=0 then
        raise exception using errcode='22023',message='declared quantity must be a positive decimal string'; end if;
      if length(btrim(coalesce(item->'source'->>'reference','')))<2 or length(item->'source'->>'reference')>300 then
        raise exception using errcode='22023',message='declared quantity needs a reference'; end if;
      if exists(select 1 from jsonb_object_keys(item->'quantity') k where k not in ('value','unit')) then raise exception using errcode='22023',message='invalid quantity'; end if;
      if item->'quantity'->>'unit' is not null and item->'quantity'->>'unit'<>(select w.unit_code from public.btp_works w where w.id=(item->>'workId')::uuid and w.catalog_version_id=v_version.id) then
        raise exception using errcode='22023',message='declared unit differs from the work unit; no implicit conversion'; end if;
    elsif v_kind='takeoff' then
      if item ? 'quantity' then raise exception using errcode='22023',message='takeoff quantities are read from the validated takeoff'; end if;
      if coalesce(item->'source'->>'takeoffId','') !~ '^[0-9a-fA-F-]{36}$' then raise exception using errcode='22023',message='invalid takeoff id'; end if;
      if not v_has_takeoffs then raise exception using errcode='22023',message='takeoff engine (#548) is not installed'; end if;
    elsif v_kind='none' then
      if item ? 'quantity' then raise exception using errcode='22023',message='a quantity needs a source'; end if;
    else raise exception using errcode='22023',message='invalid quantity source kind'; end if;
    v_keys:=v_keys||(lower(item->>'workId')||'/'||v_scope_key);
    v_raw:=v_raw||jsonb_build_array(jsonb_build_object('workId',lower(item->>'workId'),'scopeKey',v_scope_key,'origin','explicit',
      'source',case v_kind when 'declared' then jsonb_build_object('kind','declared','reference',btrim(item->'source'->>'reference'))
        when 'takeoff' then jsonb_build_object('kind','takeoff','takeoffId',lower(item->'source'->>'takeoffId')) else jsonb_build_object('kind','none') end,
      'declaredValue',case when v_kind='declared' then item->'quantity'->>'value' end));
  end loop;
  -- b) métrés validés du chantier (#548), lus par contrat si le moteur est installé
  if v_takeoffs and v_has_takeoffs then
    for v_tk in execute 'select t.id,t.work_id,t.scope_key from public.btp_takeoffs t where t.project_id=$1 and t.validated_revision is not null order by t.work_id,t.scope_key' using p_project_id loop
      if not ((v_tk.work_id::text)||'/'||v_tk.scope_key = any(v_keys)) then
        v_keys:=v_keys||((v_tk.work_id::text)||'/'||v_tk.scope_key);
        v_raw:=v_raw||jsonb_build_array(jsonb_build_object('workId',v_tk.work_id,'scopeKey',v_tk.scope_key,'origin','validated_takeoff','source',jsonb_build_object('kind','takeoff','takeoffId',v_tk.id)));
      end if;
    end loop;
  end if;
  -- c) ouvrages retenus par l'assistant (#543), sans quantité
  if v_scope then
    for v_tk in select distinct l.item_id from public.project_assistant_scope_links l where l.project_id=p_project_id and l.item_kind='work' and l.item_id ~ '^[0-9a-fA-F-]{36}$' order by l.item_id loop
      if not exists(select 1 from unnest(v_keys) k where k like lower(v_tk.item_id)||'/%') then
        v_keys:=v_keys||(lower(v_tk.item_id)||'/default');
        v_raw:=v_raw||jsonb_build_array(jsonb_build_object('workId',lower(v_tk.item_id),'scopeKey','default','origin','assistant_scope','source',jsonb_build_object('kind','none')));
      end if;
    end loop;
  end if;

  -- d) évaluation ligne par ligne, ordre canonique du référentiel
  for item in select r.x from jsonb_array_elements(v_raw) r(x)
    left join public.btp_works w on w.id=(r.x->>'workId')::uuid and w.catalog_version_id=v_version.id and w.active
    left join public.btp_sub_lots s on s.id=w.sub_lot_id and s.catalog_version_id=w.catalog_version_id
    left join public.btp_lots l on l.id=s.lot_id and l.catalog_version_id=s.catalog_version_id
    order by l.position nulls last,s.position nulls last,w.position nulls last,r.x->>'workId',r.x->>'scopeKey' loop
    v_total:=v_total+1; v_codes:='{}'; v_warn:='{}'; v_qty:=null; v_qty_micro:=null; v_cands:='[]'::jsonb; v_qsource:=item->'source';
    select w.id,w.code,w.label_fr,w.unit_code,s.id sub_lot_id,s.label_fr sub_lot_label,l.id lot_id,l.code lot_code,l.label_fr lot_label into v_work
      from public.btp_works w join public.btp_sub_lots s on s.id=w.sub_lot_id and s.catalog_version_id=w.catalog_version_id
      join public.btp_lots l on l.id=s.lot_id and l.catalog_version_id=s.catalog_version_id
      where w.id=(item->>'workId')::uuid and w.catalog_version_id=v_version.id and w.active;
    if not found then
      v_lines:=v_lines||jsonb_build_array(jsonb_build_object('workId',item->>'workId','scopeKey',item->>'scopeKey','origin',item->>'origin','status','missing',
        'missing',jsonb_build_array('work_not_in_catalog'),'quantitySource',v_qsource));
      v_missing:=v_missing||jsonb_build_array(jsonb_build_object('workId',item->>'workId','scopeKey',item->>'scopeKey','codes',jsonb_build_array('work_not_in_catalog')));
      continue;
    end if;
    -- quantité
    if v_qsource->>'kind'='declared' then
      v_qty:=(item->>'declaredValue')::numeric;
      v_warn:=v_warn||'declared_quantity_not_validated'::text;
    elsif v_qsource->>'kind'='takeoff' then
      execute 'select t.project_id,t.work_id,t.validated_revision,t.current_revision,r.calculation_status,r.justification->''result''->>''value'' as value,r.justification->''result''->>''unit'' as unit
        from public.btp_takeoffs t left join public.btp_takeoff_revisions r on r.takeoff_id=t.id and r.revision=t.validated_revision where t.id=$1'
        into v_tk using (v_qsource->>'takeoffId')::uuid;
      if v_tk.project_id is distinct from p_project_id or v_tk.work_id is distinct from v_work.id then
        raise exception using errcode='22023',message='takeoff does not belong to this project and work'; end if;
      v_qsource:=v_qsource||jsonb_build_object('revision',v_tk.validated_revision);
      if v_tk.validated_revision is null or v_tk.calculation_status is distinct from 'calculated' or v_tk.value is null then v_codes:=v_codes||'quantity_not_validated'::text;
      elsif v_tk.unit is distinct from v_work.unit_code then v_codes:=v_codes||'quantity_unit_mismatch'::text;
      else v_qty:=v_tk.value::numeric;
        if v_tk.current_revision>v_tk.validated_revision then v_warn:=v_warn||'newer_takeoff_revision_not_validated'::text; end if;
      end if;
    else v_codes:=v_codes||'quantity_missing'::text;
    end if;
    if v_qty is not null then
      v_qty_micro:=v_qty*1000000;
      if v_qty<=0 or v_qty_micro<>trunc(v_qty_micro) then v_codes:=v_codes||'quantity_precision_unsupported'::text; v_qty:=null; v_qty_micro:=null; end if;
    end if;
    -- tarifs applicables
    select min(case when i.price_kind='private_assumption' then 1 when i.governorate_id is not null then 2 else 3 end),
           bool_or(i.component='composite') into v_best,v_has_composite
      from public.btp_price_items i
      join public.btp_price_item_revisions r on r.item_id=i.id and r.revision=case when i.price_kind='private_assumption' then i.current_revision else i.verified_revision end
      left join public.btp_price_sources s on s.id=i.source_id
      where i.work_id=v_work.id and i.unit_code=v_work.unit_code and i.status<>'retired' and i.country_code='TN'
        and (i.governorate_id is null or i.governorate_id=v_gov) and r.currency='TND'
        and r.valid_from<=v_ref and (r.valid_to is null or r.valid_to>=v_ref)
        and ((i.price_kind='observed' and i.verified_revision is not null and s.data_nature=case when v_mode='simulation' then 'fictitious_test' else 'real' end)
          or (i.price_kind='private_assumption' and v_private and i.project_id=p_project_id));
    if v_best is not null then
      select bool_or(i.component='composite') into v_has_composite from public.btp_price_items i
        join public.btp_price_item_revisions r on r.item_id=i.id and r.revision=case when i.price_kind='private_assumption' then i.current_revision else i.verified_revision end
        left join public.btp_price_sources s on s.id=i.source_id
        where i.work_id=v_work.id and i.unit_code=v_work.unit_code and i.status<>'retired' and i.country_code='TN'
          and (i.governorate_id is null or i.governorate_id=v_gov) and r.currency='TND' and r.valid_from<=v_ref and (r.valid_to is null or r.valid_to>=v_ref)
          and ((i.price_kind='observed' and i.verified_revision is not null and s.data_nature=case when v_mode='simulation' then 'fictitious_test' else 'real' end)
            or (i.price_kind='private_assumption' and v_private and i.project_id=p_project_id))
          and v_best=case when i.price_kind='private_assumption' then 1 when i.governorate_id is not null then 2 else 3 end;
      for c in
        with base as (
          select i.id,i.price_kind,i.component,i.governorate_id,r.revision,r.amount_min_minor,r.amount_max_minor,r.tax_basis,r.vat_rate_bp,r.includes,
            r.observed_on,r.valid_from,r.valid_to,r.source_locator,r.conditions_fr,s.id source_id,s.code source_code,s.name source_name,s.publisher,s.uri,s.license_note,s.data_nature
          from public.btp_price_items i
          join public.btp_price_item_revisions r on r.item_id=i.id and r.revision=case when i.price_kind='private_assumption' then i.current_revision else i.verified_revision end
          left join public.btp_price_sources s on s.id=i.source_id
          where i.work_id=v_work.id and i.unit_code=v_work.unit_code and i.status<>'retired' and i.country_code='TN'
            and (i.governorate_id is null or i.governorate_id=v_gov) and r.currency='TND' and r.valid_from<=v_ref and (r.valid_to is null or r.valid_to>=v_ref)
            and ((i.price_kind='observed' and i.verified_revision is not null and s.data_nature=case when v_mode='simulation' then 'fictitious_test' else 'real' end)
              or (i.price_kind='private_assumption' and v_private and i.project_id=p_project_id))
            and v_best=case when i.price_kind='private_assumption' then 1 when i.governorate_id is not null then 2 else 3 end
            and (i.component='composite')=v_has_composite)
        select b.* from base b where b.observed_on=(select max(x.observed_on) from base x where x.component=b.component)
        order by b.component,b.id
      loop
        v_cands:=v_cands||jsonb_build_array(jsonb_build_object('itemId',c.id,'revision',c.revision,'priceKind',c.price_kind,'component',c.component,
          'zone',case when c.price_kind='private_assumption' then 'project' when c.governorate_id is null then 'national' else 'governorate' end,
          'amountMinMinor',c.amount_min_minor,'amountMaxMinor',c.amount_max_minor,'taxBasis',c.tax_basis,'vatRateBp',c.vat_rate_bp,
          'includes',to_jsonb(c.includes),'observedOn',c.observed_on,'validFrom',c.valid_from,'validTo',c.valid_to,'sourceLocator',c.source_locator,
          'conditions',c.conditions_fr,'source',case when c.source_id is null then null else jsonb_build_object('id',c.source_id,'code',c.source_code,'name',c.source_name,
            'publisher',c.publisher,'uri',c.uri,'licenseNote',c.license_note,'dataNature',c.data_nature) end,
          'totalHtMinMinor',dao_private.btp_estimate_amount(v_qty_micro,c.amount_min_minor,c.tax_basis,c.vat_rate_bp,'HT'),
          'totalHtMaxMinor',dao_private.btp_estimate_amount(v_qty_micro,c.amount_max_minor,c.tax_basis,c.vat_rate_bp,'HT'),
          'totalTtcMinMinor',dao_private.btp_estimate_amount(v_qty_micro,c.amount_min_minor,c.tax_basis,c.vat_rate_bp,'TTC'),
          'totalTtcMaxMinor',dao_private.btp_estimate_amount(v_qty_micro,c.amount_max_minor,c.tax_basis,c.vat_rate_bp,'TTC')));
        if c.observed_on<v_ref-365 then v_warn:=v_warn||'price_observation_older_than_12_months'::text; end if;
      end loop;
    else
      -- diagnostic honnête de l'absence de tarif
      select case
        when bool_or(r.currency<>'TND') and not bool_or(r.currency='TND') then 'price_currency_without_sourced_rate'
        when bool_or(r.valid_from>v_ref or (r.valid_to is not null and r.valid_to<v_ref)) then 'price_out_of_validity_period'
        else null end into v_reason
        from public.btp_price_items i join public.btp_price_item_revisions r on r.item_id=i.id and r.revision=coalesce(i.verified_revision,0)
        left join public.btp_price_sources s on s.id=i.source_id
        where i.work_id=v_work.id and i.unit_code=v_work.unit_code and i.status<>'retired' and i.price_kind='observed'
          and (i.governorate_id is null or i.governorate_id=v_gov) and s.data_nature=case when v_mode='simulation' then 'fictitious_test' else 'real' end;
      if v_reason is null and exists(select 1 from public.btp_price_items i where i.work_id=v_work.id and i.unit_code<>v_work.unit_code and i.status='verified') then
        v_reason:='price_unit_differs_from_work_unit'; end if;
      v_codes:=v_codes||coalesce(v_reason,'price_missing');
    end if;
    -- agrégation de la ligne : fourchette sur les sources ex aequo, somme des composantes
    v_ht_min:=null;v_ht_max:=null;v_ttc_min:=null;v_ttc_max:=null;v_ht_ok:=false;v_ttc_ok:=false;
    if v_qty is not null and jsonb_array_length(v_cands)>0 then
      select bool_and(ok_ht),bool_and(ok_ttc),sum(hmin),sum(hmax),sum(tmin),sum(tmax) into v_ht_ok,v_ttc_ok,v_ht_min,v_ht_max,v_ttc_min,v_ttc_max from (
        select x->>'component' comp,
          bool_and(x->>'totalHtMinMinor' is not null) ok_ht,bool_and(x->>'totalTtcMinMinor' is not null) ok_ttc,
          min((x->>'totalHtMinMinor')::bigint) hmin,max((x->>'totalHtMaxMinor')::bigint) hmax,
          min((x->>'totalTtcMinMinor')::bigint) tmin,max((x->>'totalTtcMaxMinor')::bigint) tmax
        from jsonb_array_elements(v_cands) x group by x->>'component') g;
      if not v_ht_ok then v_ht_min:=null; v_ht_max:=null; v_warn:=v_warn||'ht_not_derivable_without_explicit_vat_rate'::text; end if;
      if not v_ttc_ok then v_ttc_min:=null; v_ttc_max:=null; v_warn:=v_warn||'ttc_not_derivable_without_explicit_vat_rate'::text; end if;
      v_status:=case when v_has_composite then 'priced' else 'priced_components' end;
      if not v_has_composite then v_warn:=v_warn||'components_only_other_components_may_be_missing'::text; end if;
      if (select count(distinct x->>'amountMinMinor')+count(distinct x->>'amountMaxMinor') from jsonb_array_elements(v_cands) x)>2 then v_warn:=v_warn||'several_sources_range'::text; end if;
    else
      v_status:='missing';
      if v_qty is not null and jsonb_array_length(v_cands)=0 then null; end if;
      if v_qty is null and jsonb_array_length(v_cands)>0 then v_warn:=v_warn||'price_available_quantity_missing'::text; end if;
    end if;
    if v_status in ('priced','priced_components') then v_priced:=v_priced+1; end if;
    if v_status='priced' then v_complete:=v_complete+1; end if;
    v_line:=jsonb_build_object('workId',v_work.id,'workCode',v_work.code,'workLabel',v_work.label_fr,'unitCode',v_work.unit_code,
      'lotId',v_work.lot_id,'lotCode',v_work.lot_code,'lotLabel',v_work.lot_label,'subLotId',v_work.sub_lot_id,'subLotLabel',v_work.sub_lot_label,
      'scopeKey',item->>'scopeKey','origin',item->>'origin','status',v_status,
      'quantity',case when v_qty is null then null else jsonb_build_object('value',v_qty::text,'unit',v_work.unit_code) end,'quantitySource',v_qsource,
      'candidates',v_cands,'totals',jsonb_build_object('htMinMinor',v_ht_min,'htMaxMinor',v_ht_max,'ttcMinMinor',v_ttc_min,'ttcMaxMinor',v_ttc_max),
      'missing',to_jsonb(v_codes),'warnings',to_jsonb(array(select distinct w from unnest(v_warn) w order by w)),
      'formula','quantité × prix unitaire (arrondi au millime, demi supérieur)');
    v_lines:=v_lines||jsonb_build_array(v_line);
    if v_status='missing' then
      v_missing:=v_missing||jsonb_build_array(jsonb_build_object('workId',v_work.id,'workLabel',v_work.label_fr,'unitCode',v_work.unit_code,'scopeKey',item->>'scopeKey','codes',to_jsonb(v_codes)));
    end if;
  end loop;

  v_coverage:=case when v_total>0 and v_complete=v_total then 'complete' when v_priced=0 then 'unavailable' else 'partial' end;
  select jsonb_build_object(
      'scope',case when v_coverage='complete' then 'complete' when v_coverage='partial' then 'priced_lines_only' else 'none' end,
      'htMinMinor',case when bool_and(l->'totals'->>'htMinMinor' is not null) then sum((l->'totals'->>'htMinMinor')::bigint) end,
      'htMaxMinor',case when bool_and(l->'totals'->>'htMaxMinor' is not null) then sum((l->'totals'->>'htMaxMinor')::bigint) end,
      'ttcMinMinor',case when bool_and(l->'totals'->>'ttcMinMinor' is not null) then sum((l->'totals'->>'ttcMinMinor')::bigint) end,
      'ttcMaxMinor',case when bool_and(l->'totals'->>'ttcMaxMinor' is not null) then sum((l->'totals'->>'ttcMaxMinor')::bigint) end,
      'linesWithoutHt',count(*) filter (where l->'totals'->>'htMinMinor' is null),
      'linesWithoutTtc',count(*) filter (where l->'totals'->>'ttcMinMinor' is null))
    into v_totals from jsonb_array_elements(v_lines) l where l->>'status' in ('priced','priced_components');
  if v_priced=0 then v_totals:=jsonb_build_object('scope','none','htMinMinor',null,'htMaxMinor',null,'ttcMinMinor',null,'ttcMaxMinor',null,'linesWithoutHt',0,'linesWithoutTtc',0); end if;
  select coalesce(jsonb_agg(g order by g->>'position',g->>'lotId'),'[]'::jsonb) into v_by_lot from (
    select jsonb_build_object('lotId',l->>'lotId','lotCode',min(l->>'lotCode'),'lotLabel',min(l->>'lotLabel'),'position',lpad(coalesce(min(lt.position),9999)::text,6,'0'),
      'totalLines',count(*),'pricedLines',count(*) filter (where l->>'status' in ('priced','priced_components')),
      'htMinMinor',case when bool_and(l->'totals'->>'htMinMinor' is not null) filter (where l->>'status'<>'missing') then sum((l->'totals'->>'htMinMinor')::bigint) end,
      'htMaxMinor',case when bool_and(l->'totals'->>'htMaxMinor' is not null) filter (where l->>'status'<>'missing') then sum((l->'totals'->>'htMaxMinor')::bigint) end,
      'ttcMinMinor',case when bool_and(l->'totals'->>'ttcMinMinor' is not null) filter (where l->>'status'<>'missing') then sum((l->'totals'->>'ttcMinMinor')::bigint) end,
      'ttcMaxMinor',case when bool_and(l->'totals'->>'ttcMaxMinor' is not null) filter (where l->>'status'<>'missing') then sum((l->'totals'->>'ttcMaxMinor')::bigint) end) g
    from jsonb_array_elements(v_lines) l
    left join public.btp_lots lt on lt.id=(l->>'lotId')::uuid and lt.catalog_version_id=v_version.id
    where l->>'lotId' is not null group by l->>'lotId') x;

  v_inputs:=jsonb_build_object('mode',v_mode,'referenceDate',v_ref,'includePrivateAssumptions',v_private,'includeAssistantScope',v_scope,
    'includeValidatedTakeoffs',v_takeoffs,'lines',v_raw);
  return jsonb_build_object('inputs',v_inputs,'result',jsonb_build_object(
    'engine','dao-estimate-v1','nonContractual',true,'mode',v_mode,'referenceDate',v_ref,'currency','TND','countryCode','TN',
    'governorateId',v_gov,'governorate',v_gov_name,'catalogVersion',jsonb_build_object('id',v_version.id,'code',v_version.code),
    'takeoffEngineAvailable',v_has_takeoffs,
    'coverage',jsonb_build_object('status',v_coverage,'totalLines',v_total,'pricedLines',v_priced,'completeLines',v_complete,'missingLines',v_total-v_priced),
    'totals',v_totals,'byLot',v_by_lot,'lines',v_lines,'missing',v_missing,
    'warnings',to_jsonb(array_remove(array['non_contractual_estimate',
      case when v_mode='simulation' then 'simulation_fictitious_test_data' end,
      case when v_private then 'private_assumptions_requested' end,
      case when v_coverage<>'complete' then 'incomplete_estimate_total_is_not_a_budget' end],null)),
    'rules',jsonb_build_object('version','estimate-rules-v1','selection',jsonb_build_array(
      'Ouvrage canonique et unité de l''ouvrage identiques ; aucune conversion d''unité.',
      'Tarif observé vérifié (non retiré) ou, sur demande explicite, hypothèse privée du chantier ; jamais un prix d''offre.',
      'Période de validité couvrant la date de référence ; devise TND (aucun taux de change sourcé).',
      'Priorité : hypothèse privée demandée, puis gouvernorat du chantier, puis national ; jamais un autre gouvernorat.',
      'Prix global (composite) prioritaire ; à défaut, somme des composantes publiées signalée partielle.',
      'Observation la plus récente ; plusieurs sources ex aequo donnent une fourchette min–max.',
      'Mode simulation : uniquement des sources de test fictives ; mode référence : uniquement des données réelles.'),
      'rounding','Total de ligne = quantité × prix unitaire, arrondi au millime (demi supérieur), en arithmétique entière.',
      'tax','HT et TTC calculés séparément ; conversion uniquement avec le taux de TVA explicite du tarif.',
      'freshness','Observation de plus de 12 mois avant la date de référence : avertissement, sans exclusion.')));
end;
$$;

create function dao_private.btp_estimate_payload(p_estimate_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',e.id,'projectId',e.project_id,'label',e.label,'status',e.status,'currentRevision',e.current_revision,
    'approvedRevision',e.approved_revision,'createdBy',e.created_by,'createdAt',e.created_at,'updatedAt',e.updated_at,
    'current',(select jsonb_build_object('revision',r.revision,'mode',r.mode,'referenceDate',r.reference_date,'coverageStatus',r.coverage_status,
      'inputs',r.inputs,'result',r.result,'inputSha256',r.input_sha256,'resultSha256',r.result_sha256,'createdBy',r.created_by,'createdAt',r.created_at)
      from public.btp_estimate_revisions r where r.estimate_id=e.id and r.revision=e.current_revision),
    'approved',(select jsonb_build_object('revision',r.revision,'mode',r.mode,'referenceDate',r.reference_date,'coverageStatus',r.coverage_status,
      'result',r.result,'resultSha256',r.result_sha256,'createdAt',r.created_at)
      from public.btp_estimate_revisions r where r.estimate_id=e.id and r.revision=e.approved_revision and e.approved_revision<>e.current_revision),
    'history',(select coalesce(jsonb_agg(jsonb_build_object('revision',r.revision,'mode',r.mode,'coverageStatus',r.coverage_status,'pricedLines',r.priced_lines,
      'totalLines',r.total_lines,'totals',r.result->'totals','resultSha256',r.result_sha256,'createdBy',r.created_by,'createdAt',r.created_at) order by r.revision desc),'[]'::jsonb)
      from public.btp_estimate_revisions r where r.estimate_id=e.id),
    'events',(select coalesce(jsonb_agg(jsonb_build_object('type',v.event_type,'revision',v.revision,'actorId',v.actor_id,'note',v.note,'at',v.created_at) order by v.created_at,v.id),'[]'::jsonb)
      from public.btp_estimate_events v where v.estimate_id=e.id))
  from public.btp_estimates e where e.id=p_estimate_id;
$$;

create function dao_private.btp_estimate_command_v1(p_action text,p_input jsonb,p_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); v_hash text; prior dao_private.btp_price_command_receipts; result jsonb; v_project uuid;
  v_est public.btp_estimates; v_calc jsonb; v_new integer; v_note text; v_label text;
begin
  if actor is null then raise exception using errcode='42501',message='authentication required'; end if;
  if p_action not in ('preview','calculate','approve') then raise exception using errcode='22023',message='unknown estimate action'; end if;
  if p_input is null or jsonb_typeof(p_input)<>'object' then raise exception using errcode='22023',message='invalid payload'; end if;
  v_note:=nullif(btrim(coalesce(p_input->>'note','')),'');
  if v_note is not null and length(v_note)>1000 then raise exception using errcode='22023',message='note too long'; end if;

  if p_action='preview' then
    v_project:=(p_input->>'projectId')::uuid;
    if v_project is null or not dao_private.btp_estimate_access(v_project) then raise exception using errcode='42501',message='project estimate access required'; end if;
    return dao_private.btp_estimate_compute(v_project,p_input-'projectId'-'estimateId'-'expectedRevision'-'label'-'note');
  end if;

  if p_key is null or p_key !~ '^[A-Za-z0-9._:-]{8,100}$' then raise exception using errcode='22023',message='invalid idempotency key'; end if;
  v_hash:=dao_private.btp_sha256(jsonb_build_object('action',p_action,'input',p_input));
  select * into prior from dao_private.btp_price_command_receipts where actor_id=actor and scope='estimate' and idempotency_key=p_key;
  if found then
    if prior.payload_sha256<>v_hash or prior.action<>p_action then raise exception using errcode='22023',message='idempotency key reused with another payload'; end if;
    return prior.result;
  end if;

  if p_action='calculate' then
    v_project:=(p_input->>'projectId')::uuid;
    if v_project is null or not dao_private.btp_estimate_access(v_project) then raise exception using errcode='42501',message='project estimate access required'; end if;
    v_label:=btrim(coalesce(p_input->>'label',''));
    if nullif(p_input->>'estimateId','') is not null then
      select * into v_est from public.btp_estimates where id=(p_input->>'estimateId')::uuid for update;
      if not found or v_est.project_id<>v_project then raise exception using errcode='P0002',message='estimate not found'; end if;
      if (p_input->>'expectedRevision')::integer is distinct from v_est.current_revision then raise exception using errcode='40001',message='stale estimate revision'; end if;
    end if;
    v_calc:=dao_private.btp_estimate_compute(v_project,p_input-'projectId'-'estimateId'-'expectedRevision'-'label'-'note');
    if v_est.id is null then
      if length(v_label) not between 1 and 160 then raise exception using errcode='22023',message='label required'; end if;
      insert into public.btp_estimates(project_id,label,current_revision,created_by) values (v_project,v_label,1,actor) returning * into v_est;
      v_new:=1;
    else
      v_new:=v_est.current_revision+1;
      update public.btp_estimates set current_revision=v_new,status='draft',label=case when length(v_label) between 1 and 160 then v_label else label end,updated_at=now()
        where id=v_est.id;
    end if;
    insert into public.btp_estimate_revisions(estimate_id,revision,mode,reference_date,coverage_status,total_lines,priced_lines,inputs,result,input_sha256,result_sha256,created_by)
    values (v_est.id,v_new,v_calc->'result'->>'mode',(v_calc->'result'->>'referenceDate')::date,v_calc->'result'->'coverage'->>'status',
      (v_calc->'result'->'coverage'->>'totalLines')::integer,(v_calc->'result'->'coverage'->>'pricedLines')::integer,
      v_calc->'inputs',v_calc->'result',dao_private.btp_sha256(v_calc->'inputs'),dao_private.btp_sha256(v_calc->'result'),actor);
    insert into public.btp_estimate_events(estimate_id,revision,event_type,actor_id,note) values (v_est.id,v_new,'calculated',actor,v_note);
    if v_est.approved_revision is not null then
      insert into public.btp_estimate_events(estimate_id,revision,event_type,actor_id,note) values (v_est.id,v_new,'approval_superseded',actor,null);
    end if;
  else
    if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('estimateId','expectedRevision','note')) then raise exception using errcode='22023',message='unexpected field'; end if;
    select * into v_est from public.btp_estimates where id=(p_input->>'estimateId')::uuid for update;
    if not found then raise exception using errcode='P0002',message='estimate not found'; end if;
    if not dao_private.btp_estimate_access(v_est.project_id) then raise exception using errcode='42501',message='project estimate access required'; end if;
    if (p_input->>'expectedRevision')::integer is distinct from v_est.current_revision then raise exception using errcode='40001',message='stale estimate revision'; end if;
    if v_est.status='approved' then raise exception using errcode='22023',message='already approved'; end if;
    if (select coverage_status from public.btp_estimate_revisions where estimate_id=v_est.id and revision=v_est.current_revision)='unavailable' then
      raise exception using errcode='22023',message='an unavailable estimate cannot be retained'; end if;
    update public.btp_estimates set status='approved',approved_revision=current_revision,updated_at=now() where id=v_est.id;
    insert into public.btp_estimate_events(estimate_id,revision,event_type,actor_id,note) values (v_est.id,v_est.current_revision,'approved',actor,v_note);
  end if;
  result:=dao_private.btp_estimate_payload(v_est.id);
  insert into dao_private.btp_price_command_receipts(actor_id,idempotency_key,scope,action,payload_sha256,result) values (actor,p_key,'estimate',p_action,v_hash,result);
  return result;
end;
$$;

create function dao_private.btp_estimate_snapshot_v1(p_project_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_takeoffs jsonb:='[]'::jsonb;
begin
  if auth.uid() is null or not dao_private.btp_estimate_access(p_project_id) then raise exception using errcode='42501',message='project estimate access required'; end if;
  if to_regclass('public.btp_takeoffs') is not null then
    execute 'select coalesce(jsonb_agg(jsonb_build_object(''id'',t.id,''workId'',t.work_id,''scopeKey'',t.scope_key,''label'',t.label,''status'',t.status,''validatedRevision'',t.validated_revision,''currentRevision'',t.current_revision) order by t.label,t.id),''[]''::jsonb) from public.btp_takeoffs t where t.project_id=$1'
      into v_takeoffs using p_project_id;
  end if;
  return jsonb_build_object('projectId',p_project_id,
    'governorate',(select jsonb_build_object('id',g.id,'name',g.name_fr) from public.project_versions pv join public.governorates g on g.id=pv.governorate_id where pv.project_id=p_project_id order by pv.version_no desc limit 1),
    'takeoffEngineAvailable',to_regclass('public.btp_takeoffs') is not null,'takeoffs',v_takeoffs,
    'scopeWorks',(select coalesce(jsonb_agg(distinct jsonb_build_object('workId',l.item_id,'label',l.item_label,'unit',l.unit)),'[]'::jsonb) from public.project_assistant_scope_links l where l.project_id=p_project_id and l.item_kind='work'),
    'estimates',(select coalesce(jsonb_agg(dao_private.btp_estimate_payload(e.id) order by e.updated_at desc,e.id),'[]'::jsonb) from public.btp_estimates e where e.project_id=p_project_id));
end;
$$;

-- 8. Façades publiques (SECURITY INVOKER) et droits.
create function public.btp_price_command_v1(p_action text,p_input jsonb,p_idempotency_key text) returns jsonb
language sql security invoker set search_path='' as $$ select dao_private.btp_price_command_v1($1,$2,$3); $$;
create function public.btp_price_list_v1(p_project_id uuid default null) returns jsonb
language sql stable security invoker set search_path='' as $$ select dao_private.btp_price_list_v1($1); $$;
create function public.btp_estimate_command_v1(p_action text,p_input jsonb,p_idempotency_key text default null) returns jsonb
language sql security invoker set search_path='' as $$ select dao_private.btp_estimate_command_v1($1,$2,$3); $$;
create function public.btp_estimate_snapshot_v1(p_project_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$ select dao_private.btp_estimate_snapshot_v1($1); $$;

revoke all on function dao_private.btp_estimate_access(uuid),dao_private.btp_price_item_visible(uuid),dao_private.btp_sha256(jsonb),
  dao_private.btp_estimate_amount(numeric,bigint,text,integer,text),dao_private.btp_parse_date(text),dao_private.btp_revision_json(uuid,integer),
  dao_private.btp_price_item_json(uuid,boolean),dao_private.btp_price_command_v1(text,jsonb,text),dao_private.btp_price_list_v1(uuid),
  dao_private.btp_estimate_compute(uuid,jsonb),dao_private.btp_estimate_payload(uuid),dao_private.btp_estimate_command_v1(text,jsonb,text),
  dao_private.btp_estimate_snapshot_v1(uuid),dao_private.btp_no_delete() from public,anon,authenticated;
grant execute on function dao_private.btp_estimate_access(uuid),dao_private.btp_price_item_visible(uuid),
  dao_private.btp_price_command_v1(text,jsonb,text),dao_private.btp_price_list_v1(uuid),
  dao_private.btp_estimate_command_v1(text,jsonb,text),dao_private.btp_estimate_snapshot_v1(uuid) to authenticated,service_role;
revoke all on function public.btp_price_command_v1(text,jsonb,text),public.btp_price_list_v1(uuid),
  public.btp_estimate_command_v1(text,jsonb,text),public.btp_estimate_snapshot_v1(uuid) from public,anon;
grant execute on function public.btp_price_command_v1(text,jsonb,text),public.btp_price_list_v1(uuid),
  public.btp_estimate_command_v1(text,jsonb,text),public.btp_estimate_snapshot_v1(uuid) to authenticated,service_role;

commit;
