-- #547 — administration versionnée du référentiel BTP (Coordinateur Mission 2).
-- Réutilise le catalogue de DEV 5 (#541/#542), sans second catalogue :
-- * une version publiée n'est jamais modifiée ; on prépare un BROUILLON (copie de la
--   version publiée qui garde les mêmes ids canoniques), on le valide puis on le publie
--   atomiquement (l'ancienne version passe « retired », ses lignes restent conservées) ;
-- * ids canoniques stables d'une version à l'autre (contrat v1 de l'assistant #543) :
--   la clé des lignes devient (id, catalog_version_id) ;
-- * `btp_catalog_snapshot` garde exactement la même forme JSON ; il filtre désormais
--   explicitement la version et les éléments actifs ;
-- * Admin D.A.O. uniquement (`settings_require_admin`) ; le catalogue métiers reste non
--   délégable (catalog.trades.active, delegable=false) : aucun Gestionnaire, Client ni
--   Artisan n'administre le référentiel ;
-- * aucun prix, quantité, durée ni réglementation n'est créé ou déduit ici.
begin;

-- 1. Identité canonique stable entre versions.
alter table public.btp_lots drop constraint btp_lots_pkey, add primary key (id, catalog_version_id);
alter table public.btp_sub_lots drop constraint btp_sub_lots_pkey, add primary key (id, catalog_version_id);
alter table public.btp_works drop constraint btp_works_pkey, add primary key (id, catalog_version_id);
alter table public.btp_rules drop constraint btp_rules_pkey, add primary key (id, catalog_version_id);
alter table public.btp_work_dependencies drop constraint btp_work_dependencies_pkey, add primary key (id, catalog_version_id);
alter table public.btp_measurement_templates drop constraint btp_measurement_templates_pkey, add primary key (id, catalog_version_id);
create index btp_sub_lots_version_idx on public.btp_sub_lots(catalog_version_id, lot_id);
create index btp_works_version_idx on public.btp_works(catalog_version_id, sub_lot_id);

-- 2. Cycle de vie des versions.
alter table public.btp_catalog_versions
  add column based_on_version_id uuid references public.btp_catalog_versions,
  add column created_by uuid references auth.users,
  add column published_by uuid references auth.users,
  add column retired_at timestamptz;
-- Une version archivée garde sa date de publication (historique) : published_at reste
-- obligatoire pour « published », interdit pour « draft », libre pour « retired ».
do $$ declare c text; begin
  select conname into c from pg_constraint where conrelid='public.btp_catalog_versions'::regclass and contype='c'
    and pg_get_constraintdef(oid) like '%published_at IS NOT NULL%' and pg_get_constraintdef(oid) not like '%draft%';
  if c is null then raise exception 'btp_catalog_versions publication check not found'; end if;
  execute format('alter table public.btp_catalog_versions drop constraint %I', c);
end $$;
alter table public.btp_catalog_versions add constraint btp_catalog_versions_publication_state check (
  (status='published' and published_at is not null) or (status='draft' and published_at is null) or status='retired');
create unique index btp_catalog_versions_one_published on public.btp_catalog_versions(country_code) where status='published';
create unique index btp_catalog_versions_one_draft on public.btp_catalog_versions(country_code) where status='draft';

create table dao_private.btp_catalog_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  actor_id uuid references auth.users,
  version_id uuid not null references public.btp_catalog_versions,
  action text not null check (action in ('draft_create','item_create','item_update','dependency_remove','draft_publish','draft_abandon','version_retire')),
  entity_kind text check (entity_kind in ('lot','sub_lot','work','rule','measurement','dependency')),
  entity_id uuid,
  entity_code text,
  before jsonb,
  after jsonb,
  reason text not null check (length(btrim(reason)) between 5 and 500)
);
create index btp_catalog_events_version_idx on dao_private.btp_catalog_events(version_id, created_at desc);
alter table dao_private.btp_catalog_events enable row level security;
revoke all on dao_private.btp_catalog_events from public, anon, authenticated;
create trigger btp_catalog_events_append_only before update or delete on dao_private.btp_catalog_events
  for each row execute function dao_private.append_only();

-- 3. Garde-fous en base : seules les lignes d'un brouillon sont modifiables. Une
-- migration de maintenance revue peut lever le garde avec `set local dao.btp_catalog_maintenance='on'`.
create function dao_private.btp_guard_version_rows() returns trigger
language plpgsql set search_path='' as $$
declare v uuid; st text;
begin
  if current_setting('dao.btp_catalog_maintenance', true) = 'on' then return coalesce(new, old); end if;
  foreach v in array array[case when tg_op <> 'INSERT' then old.catalog_version_id end, case when tg_op <> 'DELETE' then new.catalog_version_id end] loop
    continue when v is null;
    select status into st from public.btp_catalog_versions where id = v;
    if st is distinct from 'draft' then
      raise exception using errcode='42501', message='Version du référentiel publiée ou archivée : préparez un brouillon pour la modifier';
    end if;
  end loop;
  return coalesce(new, old);
end; $$;
revoke all on function dao_private.btp_guard_version_rows() from public, anon, authenticated;
do $$ declare t text; begin
  foreach t in array array['btp_lots','btp_sub_lots','btp_works','btp_rules','btp_work_dependencies','btp_measurement_templates'] loop
    execute format('create trigger %I before insert or update or delete on public.%I for each row execute function dao_private.btp_guard_version_rows()', t||'_draft_only', t);
  end loop;
end $$;

create function dao_private.btp_guard_versions() returns trigger
language plpgsql set search_path='' as $$
begin
  if current_setting('dao.btp_catalog_maintenance', true) = 'on' then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    raise exception using errcode='42501', message='Une version du référentiel est conservée : suppression interdite';
  end if;
  if new.id <> old.id or new.code <> old.code or new.country_code <> old.country_code
     or new.based_on_version_id is distinct from old.based_on_version_id or new.created_at <> old.created_at then
    raise exception using errcode='42501', message='Identité de version immuable';
  end if;
  if old.status = 'retired' then
    raise exception using errcode='42501', message='Version archivée : immuable';
  end if;
  if old.status = 'published' and (new.status <> 'retired' or new.effective_to is null or new.retired_at is null
     or (to_jsonb(new) - 'status' - 'effective_to' - 'retired_at') <> (to_jsonb(old) - 'status' - 'effective_to' - 'retired_at')) then
    raise exception using errcode='42501', message='Version publiée : seul son archivage est possible';
  end if;
  return new;
end; $$;
revoke all on function dao_private.btp_guard_versions() from public, anon, authenticated;
create trigger btp_catalog_versions_guard before update or delete on public.btp_catalog_versions
  for each row execute function dao_private.btp_guard_versions();

-- 4. Lecture publique inchangée dans sa forme ; jointures bornées à la version publiée.
create or replace function public.btp_catalog_snapshot(p_project_type text default null,p_country_code text default 'TN') returns jsonb
language sql stable security invoker set search_path='' as $$
  select coalesce((select jsonb_build_object(
    'catalogVersion',jsonb_build_object('id',v.id,'code',v.code,'countryCode',v.country_code,'regionCode',v.region_code,'effectiveFrom',v.effective_from,'provenance',v.provenance),
    'units',(select coalesce(jsonb_agg(jsonb_build_object('code',u.code,'symbol',u.symbol,'label',u.label_fr,'dimension',u.dimension,'decimalScale',u.decimal_scale) order by u.code),'[]'::jsonb) from public.btp_units u where u.active),
    'lots',(select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'code',l.code,'tradeId',l.trade_id,'label',l.label_fr,'relevance',l.default_relevance,'projectTypes',l.project_types,'sourceRef',l.source_ref,
      'subLots',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'code',s.code,'label',s.label_fr,'relevance',s.default_relevance,'projectTypes',s.project_types,'sourceRef',s.source_ref,
        'works',(select coalesce(jsonb_agg(jsonb_build_object('id',w.id,'code',w.code,'label',w.label_fr,'unitCode',w.unit_code,'relevance',w.default_relevance,'projectTypes',w.project_types,'aliases',w.aliases_fr,'requiredInputs',w.required_inputs,'measurementNote',w.measurement_note,'sourceRef',w.source_ref) order by w.position),'[]'::jsonb)
          from public.btp_works w where w.catalog_version_id=v.id and w.sub_lot_id=s.id and w.active and (p_project_type is null or p_project_type=any(w.project_types)))) order by s.position),'[]'::jsonb)
        from public.btp_sub_lots s where s.catalog_version_id=v.id and s.lot_id=l.id and s.active and (p_project_type is null or p_project_type=any(s.project_types)))) order by l.position),'[]'::jsonb)
      from public.btp_lots l where l.catalog_version_id=v.id and l.active and (p_project_type is null or p_project_type=any(l.project_types))),
    'rules',(select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'code',r.code,'type',r.rule_type,'severity',r.severity,'subjects',r.subject_codes,'condition',r.condition,'effect',r.effect,'explanation',r.explanation_fr,'sourceRef',r.source_ref) order by r.code),'[]'::jsonb)
      from public.btp_rules r where r.catalog_version_id=v.id and r.active),
    'dependencies',(select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'predecessorWorkId',d.predecessor_work_id,'successorWorkId',d.successor_work_id,'relationType',d.relation_type,'mandatory',d.mandatory,'applicability',d.applicability,'explanation',d.explanation_fr,'sourceRef',d.source_ref) order by d.id),'[]'::jsonb)
      from public.btp_work_dependencies d where d.catalog_version_id=v.id
        and exists(select 1 from public.btp_works pw where pw.catalog_version_id=v.id and pw.id=d.predecessor_work_id and pw.active and (p_project_type is null or p_project_type=any(pw.project_types)))
        and exists(select 1 from public.btp_works sw where sw.catalog_version_id=v.id and sw.id=d.successor_work_id and sw.active and (p_project_type is null or p_project_type=any(sw.project_types)))),
    'measurementTemplates',(select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'workId',m.work_id,'outputUnitCode',m.output_unit_code,'inputSchema',m.input_schema,'formulaAst',m.formula_ast,'roundingScale',m.rounding_scale,'assumptions',m.assumptions_fr,'sourceRef',m.source_ref) order by m.id),'[]'::jsonb)
      from public.btp_measurement_templates m where m.catalog_version_id=v.id and m.active
        and exists(select 1 from public.btp_works mw where mw.catalog_version_id=v.id and mw.id=m.work_id and mw.active and (p_project_type is null or p_project_type=any(mw.project_types)))),
    'priceSources',(select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'sourceName',b.source_name,'sourceUri',b.source_uri,'countryCode',b.country_code,'regionCode',b.region_code,'currency',b.currency,'validFrom',b.valid_from,'validTo',b.valid_to,'verifiedAt',b.verified_at) order by b.valid_from desc),'[]'::jsonb) from public.btp_price_books b where b.catalog_version_id=v.id and b.country_code=p_country_code and b.status='published' and b.verified_at<=now() and b.valid_from<=current_date and (b.valid_to is null or b.valid_to>=current_date))
  ) from public.btp_catalog_versions v where v.status='published' and v.country_code=p_country_code order by v.effective_from desc limit 1),'{}'::jsonb);
$$;

-- 5. Outils internes.
create function dao_private.btp_reason(p_reason text) returns text
language plpgsql immutable set search_path='' as $$
begin
  if length(btrim(coalesce(p_reason,''))) not between 5 and 500 then
    raise exception using errcode='22023', message='Motif obligatoire (5 à 500 caractères)';
  end if;
  return btrim(p_reason);
end; $$;

create function dao_private.btp_label(p_value text, p_max integer) returns text
language plpgsql immutable set search_path='' as $$
declare clean text := btrim(regexp_replace(coalesce(p_value,''),'\s+',' ','g'));
begin
  if length(clean) not between 2 and p_max or clean ~ '[<>{}]' then
    raise exception using errcode='22023', message=format('Libellé invalide (2 à %s caractères, sans < > { })', p_max);
  end if;
  return clean;
end; $$;

create function dao_private.btp_text_array(p_value jsonb) returns text[]
language sql immutable set search_path='' as $$
  select case when p_value is null or jsonb_typeof(p_value) <> 'array' then null
    else coalesce((select array_agg(distinct btrim(x)) from jsonb_array_elements_text(p_value) x where btrim(x) <> ''), '{}') end;
$$;

create function dao_private.btp_require_draft(p_version_id uuid) returns public.btp_catalog_versions
language plpgsql set search_path='' as $$
declare v public.btp_catalog_versions;
begin
  select * into v from public.btp_catalog_versions where id = p_version_id for update;
  if not found then raise exception using errcode='22023', message='Version introuvable'; end if;
  if v.status <> 'draft' then
    raise exception using errcode='42501', message='Seul un brouillon peut être modifié ; une version publiée reste intacte';
  end if;
  return v;
end; $$;

create function dao_private.btp_version_json(p_version public.btp_catalog_versions) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object('id',p_version.id,'code',p_version.code,'countryCode',p_version.country_code,'regionCode',p_version.region_code,
    'status',p_version.status,'effectiveFrom',p_version.effective_from,'effectiveTo',p_version.effective_to,'provenance',p_version.provenance,
    'publishedAt',p_version.published_at,'retiredAt',p_version.retired_at,'createdAt',p_version.created_at,
    'basedOnVersionId',p_version.based_on_version_id,
    'basedOnCode',(select b.code from public.btp_catalog_versions b where b.id=p_version.based_on_version_id),
    'createdBy',(select p.display_name from public.profiles p where p.user_id=p_version.created_by),
    'publishedBy',(select p.display_name from public.profiles p where p.user_id=p_version.published_by),
    'counts',jsonb_build_object(
      'lots',(select count(*) from public.btp_lots x where x.catalog_version_id=p_version.id and x.active),
      'subLots',(select count(*) from public.btp_sub_lots x where x.catalog_version_id=p_version.id and x.active),
      'works',(select count(*) from public.btp_works x where x.catalog_version_id=p_version.id and x.active),
      'rules',(select count(*) from public.btp_rules x where x.catalog_version_id=p_version.id and x.active),
      'dependencies',(select count(*) from public.btp_work_dependencies x where x.catalog_version_id=p_version.id),
      'measurementTemplates',(select count(*) from public.btp_measurement_templates x where x.catalog_version_id=p_version.id and x.active)));
$$;

-- Comparable content of a version (ids and business fields, never the version id).
create function dao_private.btp_version_content(p_version_id uuid) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_array(
    (select coalesce(jsonb_agg(to_jsonb(x)-'catalog_version_id' order by x.id),'[]') from public.btp_lots x where x.catalog_version_id=p_version_id),
    (select coalesce(jsonb_agg(to_jsonb(x)-'catalog_version_id' order by x.id),'[]') from public.btp_sub_lots x where x.catalog_version_id=p_version_id),
    (select coalesce(jsonb_agg(to_jsonb(x)-'catalog_version_id' order by x.id),'[]') from public.btp_works x where x.catalog_version_id=p_version_id),
    (select coalesce(jsonb_agg(to_jsonb(x)-'catalog_version_id' order by x.id),'[]') from public.btp_rules x where x.catalog_version_id=p_version_id),
    (select coalesce(jsonb_agg(to_jsonb(x)-'catalog_version_id' order by x.id),'[]') from public.btp_work_dependencies x where x.catalog_version_id=p_version_id),
    (select coalesce(jsonb_agg(to_jsonb(x)-'catalog_version_id' order by x.id),'[]') from public.btp_measurement_templates x where x.catalog_version_id=p_version_id));
$$;

create function dao_private.btp_dependency_cycle(p_version_id uuid) returns boolean
language sql stable set search_path='' as $$
  with recursive paths(current, path, cycle) as (
    select d.successor_work_id, array[d.predecessor_work_id, d.successor_work_id], d.predecessor_work_id = d.successor_work_id
    from public.btp_work_dependencies d where d.catalog_version_id = p_version_id
    union all
    select d.successor_work_id, p.path || d.successor_work_id, d.successor_work_id = any(p.path)
    from paths p join public.btp_work_dependencies d on d.catalog_version_id = p_version_id and d.predecessor_work_id = p.current
    where not p.cycle
  ) select exists(select 1 from paths where cycle);
$$;

-- 6. Validation serveur d'une version (erreurs bloquantes / avertissements).
create function dao_private.btp_validation_issues(p_version_id uuid) returns jsonb
language sql stable set search_path='' as $$
  with v as (select * from public.btp_catalog_versions where id = p_version_id),
  issues(severity, code, message, ref) as (
    select 'error', 'no_active_lot', 'Aucun lot actif : la version serait vide.', null::text
      where not exists(select 1 from public.btp_lots l where l.catalog_version_id=p_version_id and l.active)
    union all
    select 'error', 'lot_trade_inactive', format('Lot « %s » : son métier « %s » est inactif.', l.label_fr, t.name_fr), l.code
      from public.btp_lots l join public.trades t on t.id=l.trade_id where l.catalog_version_id=p_version_id and l.active and not t.active
    union all
    select 'error', 'sub_lot_parent_inactive', format('Sous-lot « %s » actif sous un lot désactivé.', s.label_fr), s.code
      from public.btp_sub_lots s join public.btp_lots l on l.catalog_version_id=s.catalog_version_id and l.id=s.lot_id
      where s.catalog_version_id=p_version_id and s.active and not l.active
    union all
    select 'error', 'work_parent_inactive', format('Ouvrage « %s » actif sous un sous-lot désactivé.', w.label_fr), w.code
      from public.btp_works w join public.btp_sub_lots s on s.catalog_version_id=w.catalog_version_id and s.id=w.sub_lot_id
      where w.catalog_version_id=p_version_id and w.active and not s.active
    union all
    select 'error', 'work_unit_inactive', format('Ouvrage « %s » : unité « %s » inactive.', w.label_fr, w.unit_code), w.code
      from public.btp_works w join public.btp_units u on u.code=w.unit_code where w.catalog_version_id=p_version_id and w.active and not u.active
    union all
    select 'error', 'dependency_inactive_work', format('Dépendance « %s → %s » vers un ouvrage désactivé.', p.label_fr, s.label_fr), d.id::text
      from public.btp_work_dependencies d
      join public.btp_works p on p.catalog_version_id=d.catalog_version_id and p.id=d.predecessor_work_id
      join public.btp_works s on s.catalog_version_id=d.catalog_version_id and s.id=d.successor_work_id
      where d.catalog_version_id=p_version_id and not (p.active and s.active)
    union all
    select 'error', 'dependency_cycle', 'Les dépendances forment un cycle.', null where dao_private.btp_dependency_cycle(p_version_id)
    union all
    select 'error', 'measurement_work_inactive', format('Modèle de métré actif pour l’ouvrage désactivé « %s ».', w.label_fr), w.code
      from public.btp_measurement_templates m join public.btp_works w on w.catalog_version_id=m.catalog_version_id and w.id=m.work_id
      where m.catalog_version_id=p_version_id and m.active and not w.active
    union all
    select 'error', 'measurement_unit_inactive', format('Modèle de métré « %s » : unité « %s » inactive.', w.label_fr, m.output_unit_code), w.code
      from public.btp_measurement_templates m join public.btp_works w on w.catalog_version_id=m.catalog_version_id and w.id=m.work_id
      join public.btp_units u on u.code=m.output_unit_code where m.catalog_version_id=p_version_id and m.active and not u.active
    union all
    select 'warning', 'measurement_unit_mismatch', format('Modèle de métré « %s » : unité produite %s ≠ unité de l’ouvrage %s.', w.label_fr, m.output_unit_code, w.unit_code), w.code
      from public.btp_measurement_templates m join public.btp_works w on w.catalog_version_id=m.catalog_version_id and w.id=m.work_id
      where m.catalog_version_id=p_version_id and m.active and w.active and m.output_unit_code <> w.unit_code
    union all
    select 'warning', 'lot_without_sub_lot', format('Lot « %s » sans sous-lot actif.', l.label_fr), l.code
      from public.btp_lots l where l.catalog_version_id=p_version_id and l.active
        and not exists(select 1 from public.btp_sub_lots s where s.catalog_version_id=p_version_id and s.lot_id=l.id and s.active)
    union all
    select 'warning', 'sub_lot_without_work', format('Sous-lot « %s » sans ouvrage actif.', s.label_fr), s.code
      from public.btp_sub_lots s where s.catalog_version_id=p_version_id and s.active
        and not exists(select 1 from public.btp_works w where w.catalog_version_id=p_version_id and w.sub_lot_id=s.id and w.active)
    union all
    select 'warning', 'rule_unknown_subject', format('Règle « %s » : élément « %s » absent ou désactivé.', r.code, subject), r.code
      from public.btp_rules r cross join lateral unnest(r.subject_codes) subject
      where r.catalog_version_id=p_version_id and r.active
        and not exists(select 1 from public.btp_works w where w.catalog_version_id=p_version_id and w.code=subject and w.active)
        and not exists(select 1 from public.btp_sub_lots s where s.catalog_version_id=p_version_id and s.code=subject and s.active)
        and not exists(select 1 from public.btp_lots l where l.catalog_version_id=p_version_id and l.code=subject and l.active)
    union all
    select 'warning', 'duplicate_label', format('Libellé « %s » utilisé plusieurs fois sous le même parent.', x.label_fr), null
      from (select w.label_fr from public.btp_works w where w.catalog_version_id=p_version_id and w.active group by w.sub_lot_id, w.label_fr having count(*)>1
            union all select s.label_fr from public.btp_sub_lots s where s.catalog_version_id=p_version_id and s.active group by s.lot_id, s.label_fr having count(*)>1
            union all select l.label_fr from public.btp_lots l where l.catalog_version_id=p_version_id and l.active group by l.label_fr having count(*)>1) x
    union all
    select 'warning', 'no_change', 'Aucune différence avec la version de base.', null
      from v where v.based_on_version_id is not null
        and dao_private.btp_version_content(v.id) = dao_private.btp_version_content(v.based_on_version_id)
  )
  select jsonb_build_object(
    'ok', not exists(select 1 from issues where severity='error'),
    'errors', (select count(*) from issues where severity='error'),
    'warnings', (select count(*) from issues where severity='warning'),
    'issues', coalesce((select jsonb_agg(jsonb_build_object('severity',severity,'code',code,'message',message,'ref',ref) order by severity, code, ref) from issues), '[]'::jsonb));
$$;

-- 7. Lecture Admin complète d'une version (brouillon compris, éléments inactifs compris).
create function dao_private.btp_admin_catalog(p_version_id uuid, p_country_code text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid := dao_private.settings_require_admin(); v public.btp_catalog_versions; country text := upper(coalesce(p_country_code,'TN'));
begin
  if p_version_id is null then
    select * into v from public.btp_catalog_versions x where x.country_code=country and x.status='published' order by x.effective_from desc limit 1;
  else
    select * into v from public.btp_catalog_versions x where x.id=p_version_id;
    if not found then raise exception using errcode='22023', message='Version introuvable'; end if;
    country := v.country_code;
  end if;
  return jsonb_build_object(
    'countryCode', country,
    'versions', (select coalesce(jsonb_agg(dao_private.btp_version_json(x) order by x.created_at desc),'[]') from public.btp_catalog_versions x where x.country_code=country),
    'version', case when v.id is null then null else dao_private.btp_version_json(v) end,
    'trades', (select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'code',t.code,'name',t.name_fr,'active',t.active) order by t.name_fr),'[]') from public.trades t),
    'units', (select coalesce(jsonb_agg(jsonb_build_object('code',u.code,'symbol',u.symbol,'label',u.label_fr,'dimension',u.dimension,'decimalScale',u.decimal_scale,'active',u.active,
        'workCount',(select count(*) from public.btp_works w where w.catalog_version_id=v.id and w.unit_code=u.code and w.active),
        'templateCount',(select count(*) from public.btp_measurement_templates m where m.catalog_version_id=v.id and m.output_unit_code=u.code and m.active)) order by u.code),'[]') from public.btp_units u),
    'lots', (select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'code',l.code,'tradeId',l.trade_id,'label',l.label_fr,'description',l.description_fr,'relevance',l.default_relevance,
        'projectTypes',l.project_types,'position',l.position,'sourceRef',l.source_ref,'active',l.active) order by l.position),'[]') from public.btp_lots l where l.catalog_version_id=v.id),
    'subLots', (select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'code',s.code,'lotId',s.lot_id,'label',s.label_fr,'description',s.description_fr,'relevance',s.default_relevance,
        'projectTypes',s.project_types,'position',s.position,'sourceRef',s.source_ref,'active',s.active) order by s.position),'[]') from public.btp_sub_lots s where s.catalog_version_id=v.id),
    'works', (select coalesce(jsonb_agg(jsonb_build_object('id',w.id,'code',w.code,'subLotId',w.sub_lot_id,'label',w.label_fr,'description',w.description_fr,'unitCode',w.unit_code,
        'relevance',w.default_relevance,'projectTypes',w.project_types,'aliases',w.aliases_fr,'requiredInputs',w.required_inputs,'measurementNote',w.measurement_note,
        'position',w.position,'sourceRef',w.source_ref,'active',w.active) order by w.position),'[]') from public.btp_works w where w.catalog_version_id=v.id),
    'rules', (select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'code',r.code,'type',r.rule_type,'severity',r.severity,'subjects',r.subject_codes,'condition',r.condition,
        'effect',r.effect,'explanation',r.explanation_fr,'sourceRef',r.source_ref,'active',r.active) order by r.code),'[]') from public.btp_rules r where r.catalog_version_id=v.id),
    'dependencies', (select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'predecessorWorkId',d.predecessor_work_id,'successorWorkId',d.successor_work_id,'relationType',d.relation_type,
        'mandatory',d.mandatory,'applicability',d.applicability,'explanation',d.explanation_fr,'sourceRef',d.source_ref) order by d.id),'[]') from public.btp_work_dependencies d where d.catalog_version_id=v.id),
    'measurementTemplates', (select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'workId',m.work_id,'outputUnitCode',m.output_unit_code,'inputSchema',m.input_schema,'formulaAst',m.formula_ast,
        'roundingScale',m.rounding_scale,'assumptions',m.assumptions_fr,'sourceRef',m.source_ref,'active',m.active) order by m.id),'[]') from public.btp_measurement_templates m where m.catalog_version_id=v.id),
    'priceBooks', (select count(*) from public.btp_price_books b where b.catalog_version_id=v.id),
    'validation', case when v.status='draft' then dao_private.btp_validation_issues(v.id) else null end,
    'events', (select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'createdAt',e.created_at,'action',e.action,'entityKind',e.entity_kind,'entityId',e.entity_id,'entityCode',e.entity_code,
        'before',e.before,'after',e.after,'reason',e.reason,'actor',(select p.display_name from public.profiles p where p.user_id=e.actor_id)) order by e.created_at desc, e.id),'[]')
      from (select * from dao_private.btp_catalog_events x where x.version_id=v.id order by x.created_at desc limit 200) e)
  );
end; $$;

-- 8. Préparer un brouillon : copie intégrale de la version publiée, mêmes ids.
create function dao_private.btp_admin_create_draft(p_country_code text, p_code text, p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid := dao_private.settings_require_admin(); why text := dao_private.btp_reason(p_reason);
  v_country text := upper(btrim(coalesce(p_country_code,''))); v_code text := upper(btrim(coalesce(p_code,'')));
  base public.btp_catalog_versions; draft public.btp_catalog_versions;
begin
  if v_code !~ '^[A-Z]{2}-[0-9]{4}\.[0-9]+$' or left(v_code,2) <> v_country then
    raise exception using errcode='22023', message='Code de version invalide (ex. TN-2026.2, préfixé par le pays)';
  end if;
  if exists(select 1 from public.btp_catalog_versions x where x.country_code=v_country and x.status='draft') then
    raise exception using errcode='23505', message='Un brouillon existe déjà pour ce pays : terminez-le ou abandonnez-le';
  end if;
  if exists(select 1 from public.btp_catalog_versions x where x.code=v_code) then
    raise exception using errcode='23505', message='Ce code de version existe déjà';
  end if;
  select * into base from public.btp_catalog_versions x where x.country_code=v_country and x.status='published' order by x.effective_from desc limit 1 for update;
  if not found then raise exception using errcode='22023', message='Aucune version publiée à reprendre pour ce pays'; end if;
  insert into public.btp_catalog_versions(id,code,country_code,region_code,status,effective_from,provenance,based_on_version_id,created_by)
  values(gen_random_uuid(),v_code,v_country,base.region_code,'draft',current_date,base.provenance || jsonb_build_object('based_on',base.code),base.id,actor)
  returning * into draft;
  insert into public.btp_lots(id,catalog_version_id,code,trade_id,label_fr,description_fr,default_relevance,project_types,position,source_ref,active)
    select id,draft.id,x.code,trade_id,label_fr,description_fr,default_relevance,project_types,position,source_ref,active from public.btp_lots x where x.catalog_version_id=base.id;
  insert into public.btp_sub_lots(id,catalog_version_id,lot_id,code,label_fr,description_fr,default_relevance,project_types,position,source_ref,active)
    select id,draft.id,lot_id,x.code,label_fr,description_fr,default_relevance,project_types,position,source_ref,active from public.btp_sub_lots x where x.catalog_version_id=base.id;
  insert into public.btp_works(id,catalog_version_id,sub_lot_id,code,label_fr,description_fr,unit_code,default_relevance,project_types,aliases_fr,required_inputs,measurement_note,position,source_ref,active)
    select id,draft.id,sub_lot_id,x.code,label_fr,description_fr,unit_code,default_relevance,project_types,aliases_fr,required_inputs,measurement_note,position,source_ref,active from public.btp_works x where x.catalog_version_id=base.id;
  insert into public.btp_rules(id,catalog_version_id,code,rule_type,severity,subject_codes,condition,effect,explanation_fr,source_ref,active)
    select id,draft.id,x.code,rule_type,severity,subject_codes,condition,effect,explanation_fr,source_ref,active from public.btp_rules x where x.catalog_version_id=base.id;
  insert into public.btp_work_dependencies(id,catalog_version_id,predecessor_work_id,successor_work_id,relation_type,applicability,mandatory,explanation_fr,source_ref)
    select id,draft.id,predecessor_work_id,successor_work_id,relation_type,applicability,mandatory,explanation_fr,source_ref from public.btp_work_dependencies x where x.catalog_version_id=base.id;
  insert into public.btp_measurement_templates(id,catalog_version_id,work_id,output_unit_code,input_schema,formula_ast,rounding_scale,assumptions_fr,source_ref,active)
    select id,draft.id,work_id,output_unit_code,input_schema,formula_ast,rounding_scale,assumptions_fr,source_ref,active from public.btp_measurement_templates x where x.catalog_version_id=base.id;
  insert into dao_private.btp_catalog_events(actor_id,version_id,action,before,after,reason)
  values(actor,draft.id,'draft_create',jsonb_build_object('basedOn',base.code),jsonb_build_object('code',draft.code),why);
  return jsonb_build_object('versionId',draft.id,'code',draft.code,'basedOn',base.code);
end; $$;

-- 9. Modifier un brouillon (création ou mise à jour d'un élément).
create function dao_private.btp_admin_save_item(p_version_id uuid, p_kind text, p_item jsonb, p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid := dao_private.settings_require_admin(); why text := dao_private.btp_reason(p_reason);
  v public.btp_catalog_versions := dao_private.btp_require_draft(p_version_id);
  item jsonb := coalesce(p_item, '{}'::jsonb); item_id uuid; before jsonb; after jsonb; new_code text;
  types text[] := dao_private.btp_text_array(item->'projectTypes'); trade uuid; unit text; parent uuid;
  allowed text[];
begin
  if jsonb_typeof(item) <> 'object' then raise exception using errcode='22023', message='Élément invalide'; end if;
  allowed := case p_kind
    when 'lot' then array['id','code','tradeId','label','description','relevance','projectTypes','sourceRef','active','position']
    when 'sub_lot' then array['id','code','lotId','label','description','relevance','projectTypes','sourceRef','active','position']
    when 'work' then array['id','code','subLotId','label','description','unitCode','relevance','projectTypes','aliases','measurementNote','sourceRef','active','position']
    when 'rule' then array['id','severity','explanation','active']
    when 'measurement' then array['id','active']
    when 'dependency' then array['id','predecessorWorkId','successorWorkId','relationType','mandatory','explanation','sourceRef']
    else null end;
  if allowed is null then raise exception using errcode='22023', message='Type d’élément inconnu'; end if;
  if exists(select 1 from jsonb_object_keys(item) k where k <> all(allowed)) then
    raise exception using errcode='22023', message='Champ non modifiable pour ce type d’élément';
  end if;
  item_id := nullif(item->>'id','')::uuid;
  new_code := nullif(btrim(coalesce(item->>'code','')),'');

  if p_kind in ('lot','sub_lot','work') and item_id is null then
    if new_code is null then raise exception using errcode='22023', message='Code canonique obligatoire pour un nouvel élément'; end if;
    if exists(select 1 from public.btp_lots x where x.code=new_code) or exists(select 1 from public.btp_sub_lots x where x.code=new_code)
       or exists(select 1 from public.btp_works x where x.code=new_code) then
      raise exception using errcode='23505', message='Code déjà utilisé dans le référentiel (un code n’est jamais réutilisé)';
    end if;
    if types is null or cardinality(types)=0 or item->>'relevance' is null or item->>'sourceRef' is null then
      raise exception using errcode='22023', message='Pertinence, types de chantier et source sont obligatoires';
    end if;
  elsif p_kind in ('lot','sub_lot','work') and new_code is not null then
    raise exception using errcode='22023', message='Le code canonique d’un élément existant ne change pas';
  end if;
  if item ? 'sourceRef' and length(btrim(item->>'sourceRef')) not between 3 and 300 then
    raise exception using errcode='22023', message='Source obligatoire (3 à 300 caractères)';
  end if;

  if p_kind = 'lot' then
    trade := nullif(item->>'tradeId','')::uuid;
    if trade is not null and not exists(select 1 from public.trades t where t.id=trade and t.active) then
      raise exception using errcode='22023', message='Métier inconnu ou inactif';
    end if;
    if item_id is null then
      if trade is null then raise exception using errcode='22023', message='Métier obligatoire pour un lot'; end if;
      item_id := gen_random_uuid();
      insert into public.btp_lots(id,catalog_version_id,code,trade_id,label_fr,description_fr,default_relevance,project_types,position,source_ref,active)
      values(item_id,v.id,new_code,trade,dao_private.btp_label(item->>'label',120),coalesce(btrim(item->>'description'),''),item->>'relevance',types,
        coalesce((item->>'position')::int,(select coalesce(max(position),0)+1 from public.btp_lots x where x.catalog_version_id=v.id)),btrim(item->>'sourceRef'),coalesce((item->>'active')::boolean,true));
    else
      select to_jsonb(x)-'catalog_version_id' into before from public.btp_lots x where x.id=item_id and x.catalog_version_id=v.id for update;
      if before is null then raise exception using errcode='22023', message='Lot introuvable dans ce brouillon'; end if;
      update public.btp_lots x set trade_id=coalesce(trade,x.trade_id),
        label_fr=case when item ? 'label' then dao_private.btp_label(item->>'label',120) else x.label_fr end,
        description_fr=coalesce(btrim(item->>'description'),x.description_fr), default_relevance=coalesce(item->>'relevance',x.default_relevance),
        project_types=coalesce(types,x.project_types), position=coalesce((item->>'position')::int,x.position),
        source_ref=coalesce(btrim(item->>'sourceRef'),x.source_ref), active=coalesce((item->>'active')::boolean,x.active)
      where x.id=item_id and x.catalog_version_id=v.id;
    end if;
    select to_jsonb(x)-'catalog_version_id', x.code into after, new_code from public.btp_lots x where x.id=item_id and x.catalog_version_id=v.id;

  elsif p_kind = 'sub_lot' then
    parent := nullif(item->>'lotId','')::uuid;
    if item_id is null then
      if parent is null or not exists(select 1 from public.btp_lots l where l.id=parent and l.catalog_version_id=v.id) then
        raise exception using errcode='22023', message='Lot parent introuvable dans ce brouillon';
      end if;
      item_id := gen_random_uuid();
      insert into public.btp_sub_lots(id,catalog_version_id,lot_id,code,label_fr,description_fr,default_relevance,project_types,position,source_ref,active)
      values(item_id,v.id,parent,new_code,dao_private.btp_label(item->>'label',120),coalesce(btrim(item->>'description'),''),item->>'relevance',types,
        coalesce((item->>'position')::int,(select coalesce(max(position),0)+1 from public.btp_sub_lots x where x.catalog_version_id=v.id and x.lot_id=parent)),btrim(item->>'sourceRef'),coalesce((item->>'active')::boolean,true));
    else
      select to_jsonb(x)-'catalog_version_id' into before from public.btp_sub_lots x where x.id=item_id and x.catalog_version_id=v.id for update;
      if before is null then raise exception using errcode='22023', message='Sous-lot introuvable dans ce brouillon'; end if;
      if parent is not null and parent <> (before->>'lot_id')::uuid then
        raise exception using errcode='22023', message='Un sous-lot ne change pas de lot : créez-en un nouveau';
      end if;
      update public.btp_sub_lots x set label_fr=case when item ? 'label' then dao_private.btp_label(item->>'label',120) else x.label_fr end,
        description_fr=coalesce(btrim(item->>'description'),x.description_fr), default_relevance=coalesce(item->>'relevance',x.default_relevance),
        project_types=coalesce(types,x.project_types), position=coalesce((item->>'position')::int,x.position),
        source_ref=coalesce(btrim(item->>'sourceRef'),x.source_ref), active=coalesce((item->>'active')::boolean,x.active)
      where x.id=item_id and x.catalog_version_id=v.id;
    end if;
    select to_jsonb(x)-'catalog_version_id', x.code into after, new_code from public.btp_sub_lots x where x.id=item_id and x.catalog_version_id=v.id;

  elsif p_kind = 'work' then
    parent := nullif(item->>'subLotId','')::uuid; unit := nullif(item->>'unitCode','');
    if unit is not null and not exists(select 1 from public.btp_units u where u.code=unit and u.active) then
      raise exception using errcode='22023', message='Unité inconnue ou inactive';
    end if;
    if item_id is null then
      if parent is null or not exists(select 1 from public.btp_sub_lots s where s.id=parent and s.catalog_version_id=v.id) then
        raise exception using errcode='22023', message='Sous-lot parent introuvable dans ce brouillon';
      end if;
      if unit is null then raise exception using errcode='22023', message='Unité obligatoire pour un ouvrage'; end if;
      item_id := gen_random_uuid();
      insert into public.btp_works(id,catalog_version_id,sub_lot_id,code,label_fr,description_fr,unit_code,default_relevance,project_types,aliases_fr,measurement_note,position,source_ref,active)
      values(item_id,v.id,parent,new_code,dao_private.btp_label(item->>'label',160),coalesce(btrim(item->>'description'),''),unit,item->>'relevance',types,
        coalesce(dao_private.btp_text_array(item->'aliases'),'{}'),coalesce(btrim(item->>'measurementNote'),''),
        coalesce((item->>'position')::int,(select coalesce(max(position),0)+1 from public.btp_works x where x.catalog_version_id=v.id and x.sub_lot_id=parent)),btrim(item->>'sourceRef'),coalesce((item->>'active')::boolean,true));
    else
      select to_jsonb(x)-'catalog_version_id' into before from public.btp_works x where x.id=item_id and x.catalog_version_id=v.id for update;
      if before is null then raise exception using errcode='22023', message='Ouvrage introuvable dans ce brouillon'; end if;
      if parent is not null and parent <> (before->>'sub_lot_id')::uuid then
        raise exception using errcode='22023', message='Un ouvrage ne change pas de sous-lot : créez-en un nouveau';
      end if;
      update public.btp_works x set label_fr=case when item ? 'label' then dao_private.btp_label(item->>'label',160) else x.label_fr end,
        description_fr=coalesce(btrim(item->>'description'),x.description_fr), unit_code=coalesce(unit,x.unit_code),
        default_relevance=coalesce(item->>'relevance',x.default_relevance), project_types=coalesce(types,x.project_types),
        aliases_fr=coalesce(dao_private.btp_text_array(item->'aliases'),x.aliases_fr), measurement_note=coalesce(btrim(item->>'measurementNote'),x.measurement_note),
        position=coalesce((item->>'position')::int,x.position), source_ref=coalesce(btrim(item->>'sourceRef'),x.source_ref), active=coalesce((item->>'active')::boolean,x.active)
      where x.id=item_id and x.catalog_version_id=v.id;
    end if;
    select to_jsonb(x)-'catalog_version_id', x.code into after, new_code from public.btp_works x where x.id=item_id and x.catalog_version_id=v.id;

  elsif p_kind = 'rule' then
    select to_jsonb(x)-'catalog_version_id' into before from public.btp_rules x where x.id=item_id and x.catalog_version_id=v.id for update;
    if before is null then raise exception using errcode='22023', message='Règle introuvable dans ce brouillon'; end if;
    if item ? 'explanation' and length(btrim(item->>'explanation')) not between 3 and 500 then
      raise exception using errcode='22023', message='Explication obligatoire (3 à 500 caractères)';
    end if;
    update public.btp_rules x set severity=coalesce(item->>'severity',x.severity), explanation_fr=coalesce(btrim(item->>'explanation'),x.explanation_fr),
      active=coalesce((item->>'active')::boolean,x.active) where x.id=item_id and x.catalog_version_id=v.id;
    select to_jsonb(x)-'catalog_version_id', x.code into after, new_code from public.btp_rules x where x.id=item_id and x.catalog_version_id=v.id;

  elsif p_kind = 'measurement' then
    select to_jsonb(x)-'catalog_version_id' into before from public.btp_measurement_templates x where x.id=item_id and x.catalog_version_id=v.id for update;
    if before is null then raise exception using errcode='22023', message='Modèle de métré introuvable dans ce brouillon'; end if;
    update public.btp_measurement_templates x set active=coalesce((item->>'active')::boolean,x.active) where x.id=item_id and x.catalog_version_id=v.id;
    select to_jsonb(x)-'catalog_version_id', w.code into after, new_code from public.btp_measurement_templates x
      join public.btp_works w on w.catalog_version_id=x.catalog_version_id and w.id=x.work_id where x.id=item_id and x.catalog_version_id=v.id;

  else -- dependency
    if item ? 'explanation' and length(btrim(item->>'explanation')) not between 3 and 500 then
      raise exception using errcode='22023', message='Explication obligatoire (3 à 500 caractères)';
    end if;
    if item_id is null then
      if not exists(select 1 from public.btp_works w where w.catalog_version_id=v.id and w.id=nullif(item->>'predecessorWorkId','')::uuid and w.active)
         or not exists(select 1 from public.btp_works w where w.catalog_version_id=v.id and w.id=nullif(item->>'successorWorkId','')::uuid and w.active) then
        raise exception using errcode='22023', message='Les deux ouvrages doivent être actifs dans ce brouillon';
      end if;
      if item->>'explanation' is null or item->>'sourceRef' is null then
        raise exception using errcode='22023', message='Explication et source obligatoires';
      end if;
      item_id := gen_random_uuid();
      insert into public.btp_work_dependencies(id,catalog_version_id,predecessor_work_id,successor_work_id,relation_type,mandatory,explanation_fr,source_ref)
      values(item_id,v.id,(item->>'predecessorWorkId')::uuid,(item->>'successorWorkId')::uuid,coalesce(item->>'relationType','finish_to_start'),
        coalesce((item->>'mandatory')::boolean,false),btrim(item->>'explanation'),btrim(item->>'sourceRef'));
      if dao_private.btp_dependency_cycle(v.id) then
        raise exception using errcode='22023', message='Cette dépendance créerait un cycle';
      end if;
    else
      if item ? 'predecessorWorkId' or item ? 'successorWorkId' or item ? 'relationType' then
        raise exception using errcode='22023', message='Les ouvrages d’une dépendance ne changent pas : supprimez-la et créez-en une autre';
      end if;
      select to_jsonb(x)-'catalog_version_id' into before from public.btp_work_dependencies x where x.id=item_id and x.catalog_version_id=v.id for update;
      if before is null then raise exception using errcode='22023', message='Dépendance introuvable dans ce brouillon'; end if;
      update public.btp_work_dependencies x set mandatory=coalesce((item->>'mandatory')::boolean,x.mandatory),
        explanation_fr=coalesce(btrim(item->>'explanation'),x.explanation_fr), source_ref=coalesce(btrim(item->>'sourceRef'),x.source_ref)
      where x.id=item_id and x.catalog_version_id=v.id;
    end if;
    select to_jsonb(x)-'catalog_version_id' into after from public.btp_work_dependencies x where x.id=item_id and x.catalog_version_id=v.id;
  end if;

  if before is not null and before = after then
    return jsonb_build_object('id',item_id,'changed',false);
  end if;
  insert into dao_private.btp_catalog_events(actor_id,version_id,action,entity_kind,entity_id,entity_code,before,after,reason)
  values(actor,v.id,case when before is null then 'item_create' else 'item_update' end,p_kind,item_id,new_code,before,after,why);
  return jsonb_build_object('id',item_id,'code',new_code,'changed',true);
end; $$;

create function dao_private.btp_admin_remove_dependency(p_version_id uuid, p_dependency_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid := dao_private.settings_require_admin(); why text := dao_private.btp_reason(p_reason);
  v public.btp_catalog_versions := dao_private.btp_require_draft(p_version_id); before jsonb;
begin
  delete from public.btp_work_dependencies x where x.id=p_dependency_id and x.catalog_version_id=v.id returning to_jsonb(x)-'catalog_version_id' into before;
  if before is null then raise exception using errcode='22023', message='Dépendance introuvable dans ce brouillon'; end if;
  insert into dao_private.btp_catalog_events(actor_id,version_id,action,entity_kind,entity_id,before,reason)
  values(actor,v.id,'dependency_remove','dependency',p_dependency_id,before,why);
  return jsonb_build_object('id',p_dependency_id,'removed',true);
end; $$;

create function dao_private.btp_admin_validate_draft(p_version_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid := dao_private.settings_require_admin(); st text;
begin
  select status into st from public.btp_catalog_versions where id=p_version_id;
  if st is null then raise exception using errcode='22023', message='Version introuvable'; end if;
  return dao_private.btp_validation_issues(p_version_id);
end; $$;

-- 10. Publication atomique : validation, archivage de la version courante, publication.
create function dao_private.btp_admin_publish_draft(p_version_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid := dao_private.settings_require_admin(); why text := dao_private.btp_reason(p_reason);
  v public.btp_catalog_versions := dao_private.btp_require_draft(p_version_id); cur public.btp_catalog_versions; report jsonb;
begin
  report := dao_private.btp_validation_issues(v.id);
  if not (report->>'ok')::boolean then
    raise exception using errcode='22023', message=format('Publication refusée : %s erreur(s) de validation à corriger', report->>'errors');
  end if;
  select * into cur from public.btp_catalog_versions x where x.country_code=v.country_code and x.status='published' for update;
  if found then
    update public.btp_catalog_versions set status='retired', effective_to=greatest(current_date, cur.effective_from), retired_at=now() where id=cur.id;
    insert into dao_private.btp_catalog_events(actor_id,version_id,action,after,reason)
    values(actor,cur.id,'version_retire',jsonb_build_object('replacedBy',v.code),why);
  end if;
  update public.btp_catalog_versions set status='published', published_at=now(), published_by=actor,
    effective_from=greatest(current_date, coalesce(cur.effective_from, current_date))
  where id=v.id;
  insert into dao_private.btp_catalog_events(actor_id,version_id,action,before,after,reason)
  values(actor,v.id,'draft_publish',case when cur.id is null then null else jsonb_build_object('replaced',cur.code) end,
    jsonb_build_object('warnings',report->'warnings'),why);
  return jsonb_build_object('versionId',v.id,'code',v.code,'published',true,'retired',cur.code,'warnings',report->'warnings');
end; $$;

create function dao_private.btp_admin_abandon_draft(p_version_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid := dao_private.settings_require_admin(); why text := dao_private.btp_reason(p_reason);
  v public.btp_catalog_versions := dao_private.btp_require_draft(p_version_id);
begin
  -- Le brouillon est conservé (archive) mais ne peut plus être publié ni modifié.
  update public.btp_catalog_versions set status='retired', effective_to=effective_from, retired_at=now() where id=v.id;
  insert into dao_private.btp_catalog_events(actor_id,version_id,action,reason) values(actor,v.id,'draft_abandon',why);
  return jsonb_build_object('versionId',v.id,'abandoned',true);
end; $$;

-- 11. Façade publique (security invoker) ; l'autorisation est revérifiée côté base.
create function public.btp_admin_catalog(p_version_id uuid default null, p_country_code text default 'TN') returns jsonb
language sql stable security invoker set search_path='' as $$ select dao_private.btp_admin_catalog($1,$2); $$;
create function public.btp_admin_create_draft(p_country_code text, p_code text, p_reason text) returns jsonb
language sql security invoker set search_path='' as $$ select dao_private.btp_admin_create_draft($1,$2,$3); $$;
create function public.btp_admin_save_item(p_version_id uuid, p_kind text, p_item jsonb, p_reason text) returns jsonb
language sql security invoker set search_path='' as $$ select dao_private.btp_admin_save_item($1,$2,$3,$4); $$;
create function public.btp_admin_remove_dependency(p_version_id uuid, p_dependency_id uuid, p_reason text) returns jsonb
language sql security invoker set search_path='' as $$ select dao_private.btp_admin_remove_dependency($1,$2,$3); $$;
create function public.btp_admin_validate_draft(p_version_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$ select dao_private.btp_admin_validate_draft($1); $$;
create function public.btp_admin_publish_draft(p_version_id uuid, p_reason text) returns jsonb
language sql security invoker set search_path='' as $$ select dao_private.btp_admin_publish_draft($1,$2); $$;
create function public.btp_admin_abandon_draft(p_version_id uuid, p_reason text) returns jsonb
language sql security invoker set search_path='' as $$ select dao_private.btp_admin_abandon_draft($1,$2); $$;

revoke all on function dao_private.btp_reason(text), dao_private.btp_label(text,integer), dao_private.btp_text_array(jsonb),
  dao_private.btp_require_draft(uuid), dao_private.btp_version_json(public.btp_catalog_versions), dao_private.btp_version_content(uuid),
  dao_private.btp_dependency_cycle(uuid), dao_private.btp_validation_issues(uuid)
  from public, anon, authenticated;
revoke all on function dao_private.btp_admin_catalog(uuid,text), dao_private.btp_admin_create_draft(text,text,text),
  dao_private.btp_admin_save_item(uuid,text,jsonb,text), dao_private.btp_admin_remove_dependency(uuid,uuid,text),
  dao_private.btp_admin_validate_draft(uuid), dao_private.btp_admin_publish_draft(uuid,text), dao_private.btp_admin_abandon_draft(uuid,text),
  public.btp_admin_catalog(uuid,text), public.btp_admin_create_draft(text,text,text), public.btp_admin_save_item(uuid,text,jsonb,text),
  public.btp_admin_remove_dependency(uuid,uuid,text), public.btp_admin_validate_draft(uuid), public.btp_admin_publish_draft(uuid,text),
  public.btp_admin_abandon_draft(uuid,text)
  from public, anon;
grant execute on function dao_private.btp_admin_catalog(uuid,text), dao_private.btp_admin_create_draft(text,text,text),
  dao_private.btp_admin_save_item(uuid,text,jsonb,text), dao_private.btp_admin_remove_dependency(uuid,uuid,text),
  dao_private.btp_admin_validate_draft(uuid), dao_private.btp_admin_publish_draft(uuid,text), dao_private.btp_admin_abandon_draft(uuid,text),
  public.btp_admin_catalog(uuid,text), public.btp_admin_create_draft(text,text,text), public.btp_admin_save_item(uuid,text,jsonb,text),
  public.btp_admin_remove_dependency(uuid,uuid,text), public.btp_admin_validate_draft(uuid), public.btp_admin_publish_draft(uuid,text),
  public.btp_admin_abandon_draft(uuid,text)
  to authenticated, service_role;

commit;
