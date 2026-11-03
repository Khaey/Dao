-- Assistant BTP (Coordinateur Mission 1) : brouillons Client, historique append-only
-- et création atomique d'un chantier éditable (lots + sous-lots officiels).
-- Aucun prix, quantité, durée ni conformité n'est stocké ou déduit ici.
-- Le référentiel BTP reste la propriété de DEV 5 (#541) : on ne conserve que des
-- références (id, code, version, provenance) vers ses éléments.
begin;

create table public.project_assistant_drafts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  owner_id uuid not null references auth.users,
  status text not null default 'draft' check (status in ('draft','created','abandoned')),
  revision integer not null default 1 check (revision > 0),
  project_type text not null check (project_type in ('construction','renovation','extension','other')),
  description text not null check (length(btrim(description)) between 3 and 4000),
  title text not null check (length(btrim(title)) between 2 and 200),
  governorate_id uuid references public.governorates,
  proposal jsonb not null check (jsonb_typeof(proposal) = 'object' and jsonb_typeof(proposal->'items') = 'array'
    and jsonb_array_length(proposal->'items') <= 300 and pg_column_size(proposal) <= 262144),
  referential jsonb not null check (jsonb_typeof(referential) = 'object' and length(coalesce(referential->>'provider','')) between 1 and 80
    and length(coalesce(referential->>'catalogVersion','')) between 1 and 80),
  engine_mode text not null default 'rules' check (engine_mode in ('rules','llm_validated')),
  created_project_id uuid references public.projects,
  creation_key text check (creation_key is null or length(creation_key) between 8 and 120),
  check ((status = 'created') = (created_project_id is not null)),
  unique (owner_id, creation_key)
);
create index project_assistant_drafts_owner_idx on public.project_assistant_drafts(owner_id, updated_at desc);
create unique index project_assistant_drafts_project_idx on public.project_assistant_drafts(created_project_id) where created_project_id is not null;

create table public.project_assistant_draft_revisions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  draft_id uuid not null references public.project_assistant_drafts,
  owner_id uuid not null references auth.users,
  revision integer not null check (revision > 0),
  kind text not null check (kind in ('analyze','edit','abandon','create')),
  command text check (command is null or length(command) <= 500),
  project_type text not null,
  governorate_id uuid,
  proposal jsonb not null,
  unique (draft_id, revision)
);
create index project_assistant_draft_revisions_owner_idx on public.project_assistant_draft_revisions(owner_id, created_at desc);
create trigger project_assistant_draft_revisions_append_only before update or delete on public.project_assistant_draft_revisions
  for each row execute function dao_private.append_only();

-- Lien chantier ↔ référentiel, pour les futurs métrés et estimations (aucune valeur chiffrée ici).
create table public.project_assistant_scope_links (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  project_id uuid not null references public.projects,
  request_id uuid not null,
  sub_lot_id uuid references public.request_sub_lots,
  draft_id uuid not null references public.project_assistant_drafts,
  referential_provider text not null check (length(referential_provider) between 1 and 80),
  referential_version text not null check (length(referential_version) between 1 and 80),
  item_id text not null check (item_id ~ '^[A-Za-z0-9:_-]{1,80}$'),
  item_code text not null check (length(item_code) between 2 and 80),
  item_kind text not null check (item_kind in ('lot','sub_lot','work')),
  item_label text not null check (length(item_label) between 1 and 200),
  unit text check (unit is null or length(unit) <= 16),
  relevance text not null check (relevance in ('usual','verify','conditional','optional','unusual')),
  foreign key (request_id, project_id) references public.project_requests(id, project_id),
  unique (project_id, item_id)
);
create index project_assistant_scope_links_request_idx on public.project_assistant_scope_links(request_id);
create trigger project_assistant_scope_links_append_only before update or delete on public.project_assistant_scope_links
  for each row execute function dao_private.append_only();

alter table public.project_assistant_drafts enable row level security;
alter table public.project_assistant_draft_revisions enable row level security;
alter table public.project_assistant_scope_links enable row level security;
revoke all on public.project_assistant_drafts, public.project_assistant_draft_revisions, public.project_assistant_scope_links from public, anon, authenticated;
grant select on public.project_assistant_drafts, public.project_assistant_draft_revisions, public.project_assistant_scope_links to authenticated;
grant all on public.project_assistant_drafts, public.project_assistant_draft_revisions, public.project_assistant_scope_links to service_role;
create policy project_assistant_drafts_owner_read on public.project_assistant_drafts for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy project_assistant_draft_revisions_owner_read on public.project_assistant_draft_revisions for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy project_assistant_scope_links_project_read on public.project_assistant_scope_links for select to authenticated
  using (dao_private.can_view_project(project_id));

-- Enregistre une révision du brouillon (création si p_draft_id est null).
create function dao_private.save_project_assistant_draft_v1(
  p_draft_id uuid, p_expected_revision integer, p_kind text, p_command text, p_draft jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.project_assistant_drafts; v_type text; v_description text; v_title text; v_governorate uuid; v_engine text;
begin
  if auth.uid() is null or not dao_private.account_active(auth.uid()) then
    raise exception using errcode='42501', message='active authentication required';
  end if;
  if p_kind not in ('analyze','edit') or p_draft is null or jsonb_typeof(p_draft) <> 'object'
     or (p_draft - array['projectType','description','title','governorateId','proposal','referential','engineMode']) <> '{}'::jsonb then
    raise exception using errcode='22023', message='invalid assistant draft';
  end if;
  v_type := p_draft->>'projectType'; v_description := btrim(coalesce(p_draft->>'description',''));
  v_title := btrim(coalesce(p_draft->>'title','')); v_engine := coalesce(p_draft->>'engineMode','rules');
  if nullif(p_draft->>'governorateId','') is not null then
    if p_draft->>'governorateId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception using errcode='22023', message='invalid governorate';
    end if;
    v_governorate := (p_draft->>'governorateId')::uuid;
  end if;
  if p_draft_id is null then
    if p_kind <> 'analyze' then raise exception using errcode='22023', message='draft required'; end if;
    insert into public.project_assistant_drafts(owner_id, project_type, description, title, governorate_id, proposal, referential, engine_mode)
    values (auth.uid(), v_type, v_description, v_title, v_governorate, p_draft->'proposal', p_draft->'referential', v_engine)
    returning * into v;
  else
    select * into v from public.project_assistant_drafts where id = p_draft_id and owner_id = auth.uid() for update;
    if v.id is null then raise exception using errcode='P0002', message='assistant draft not found'; end if;
    if v.status <> 'draft' then raise exception using errcode='23514', message='assistant draft is closed'; end if;
    if p_expected_revision is distinct from v.revision then raise exception using errcode='40001', message='assistant draft changed'; end if;
    update public.project_assistant_drafts set revision = v.revision + 1, updated_at = now(), project_type = v_type,
      description = v_description, title = v_title, governorate_id = v_governorate, proposal = p_draft->'proposal',
      referential = p_draft->'referential', engine_mode = v_engine
    where id = v.id returning * into v;
  end if;
  insert into public.project_assistant_draft_revisions(draft_id, owner_id, revision, kind, command, project_type, governorate_id, proposal)
  values (v.id, v.owner_id, v.revision, p_kind, left(nullif(btrim(p_command),''), 500), v.project_type, v.governorate_id, v.proposal);
  return to_jsonb(v) - 'creation_key';
end; $$;

create function dao_private.abandon_project_assistant_draft_v1(p_draft_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v public.project_assistant_drafts;
begin
  if auth.uid() is null then raise exception using errcode='42501', message='authentication required'; end if;
  select * into v from public.project_assistant_drafts where id = p_draft_id and owner_id = auth.uid() for update;
  if v.id is null then raise exception using errcode='P0002', message='assistant draft not found'; end if;
  if v.status = 'draft' then
    update public.project_assistant_drafts set status = 'abandoned', revision = v.revision + 1, updated_at = now() where id = v.id returning * into v;
    insert into public.project_assistant_draft_revisions(draft_id, owner_id, revision, kind, project_type, governorate_id, proposal)
    values (v.id, v.owner_id, v.revision, 'abandon', v.project_type, v.governorate_id, v.proposal);
  end if;
  return to_jsonb(v) - 'creation_key';
end; $$;

-- Crée le chantier (brouillon D.A.O.) depuis la proposition retenue, en une transaction.
-- Idempotent : un brouillon déjà transformé renvoie toujours le même chantier.
create function dao_private.create_project_from_assistant_draft_v1(p_draft_id uuid, p_creation_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  v public.project_assistant_drafts; v_project public.projects; v_request public.project_requests;
  v_request_version uuid; v_sub_lot uuid; v_trade uuid; v_lot jsonb; v_sub jsonb; v_items jsonb;
  v_lot_scope text; v_sub_scope text; v_ordinal integer; v_lots integer := 0;
begin
  if auth.uid() is null or not dao_private.account_active(auth.uid()) then
    raise exception using errcode='42501', message='active authentication required';
  end if;
  if not exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'client') then
    raise exception using errcode='42501', message='client role required';
  end if;
  if p_creation_key is null or length(p_creation_key) not between 8 and 120 then
    raise exception using errcode='22023', message='creation key required';
  end if;
  select * into v from public.project_assistant_drafts where id = p_draft_id and owner_id = auth.uid() for update;
  if v.id is null then raise exception using errcode='P0002', message='assistant draft not found'; end if;
  if v.status = 'created' then
    return jsonb_build_object('projectId', v.created_project_id, 'created', false, 'lots', 0);
  end if;
  if v.status <> 'draft' then raise exception using errcode='23514', message='assistant draft is closed'; end if;
  if v.governorate_id is null then raise exception using errcode='23514', message='governorate required'; end if;

  select coalesce(jsonb_agg(item), '[]'::jsonb) into v_items
    from jsonb_array_elements(v.proposal->'items') item where (item->>'selected')::boolean is true;
  if not exists (select 1 from jsonb_array_elements(v_items) item where item->>'kind' = 'lot') then
    raise exception using errcode='23514', message='at least one lot required';
  end if;
  if exists (select 1 from jsonb_array_elements(v_items) item where
      coalesce(item->>'id','') !~ '^[A-Za-z0-9:_-]{1,80}$' or item->>'kind' not in ('lot','sub_lot','work')
      or length(btrim(coalesce(item->>'label',''))) not between 1 and 200
      or (item->>'kind' <> 'lot' and not exists (select 1 from jsonb_array_elements(v_items) parent
        where parent->>'id' = item->>'parentId' and parent->>'kind' = case item->>'kind' when 'sub_lot' then 'lot' else 'sub_lot' end))) then
    raise exception using errcode='23514', message='invalid assistant selection';
  end if;

  v_project := dao_private.create_project_draft(v.project_type, null::numeric, null::date, null::date, null::bigint, v.governorate_id, null::uuid, null::uuid);
  update public.project_versions set title = v.title,
    description = left(v.description || E'\n\nPérimètre préparé avec l’assistant D.A.O. à partir du référentiel '
      || coalesce(v.referential->>'provider','') || ' ' || coalesce(v.referential->>'catalogVersion','')
      || '. Aucun prix, quantité ni délai n’a été estimé.', 10000)
    where project_id = v_project.id and version_no = 1;

  for v_lot in select item from jsonb_array_elements(v_items) item where item->>'kind' = 'lot' loop
    select id into v_trade from public.trades where code = v_lot->>'tradeCode' and active;
    if v_trade is null then select id into v_trade from public.trades where code = 'general_contractor' and active; end if;
    if v_trade is null then raise exception using errcode='23514', message='trade unavailable'; end if;
    select string_agg('• ' || (sub->>'label'), E'\n' order by ord) into v_lot_scope
      from jsonb_array_elements(v_items) with ordinality s(sub, ord) where sub->>'parentId' = v_lot->>'id';
    v_lot_scope := coalesce(v_lot_scope, 'Périmètre à préciser avec les professionnels.')
      || E'\n\nÀ confirmer avec les professionnels : quantités, prix et délais non estimés.';
    v_request := dao_private.add_project_request(v_project.id, v_trade, left(v_lot->>'label', 200), v_lot_scope, null::bigint);
    select id into v_request_version from public.project_request_versions where request_id = v_request.id and version_no = 1;
    insert into public.project_assistant_scope_links(project_id, request_id, draft_id, referential_provider, referential_version, item_id, item_code, item_kind, item_label, unit, relevance)
    values (v_project.id, v_request.id, v.id, v.referential->>'provider', v.referential->>'catalogVersion', v_lot->>'id', v_lot->>'code', 'lot', v_lot->>'label', v_lot->>'unit', coalesce(v_lot->>'relevance','usual'));
    v_ordinal := 0;
    for v_sub in select sub from jsonb_array_elements(v_items) with ordinality s(sub, ord) where sub->>'parentId' = v_lot->>'id' and sub->>'kind' = 'sub_lot' order by ord loop
      select string_agg('• ' || (work->>'label') || case when work->>'relevance' in ('verify','unusual') or (work->>'tentative')::boolean is true then ' (à vérifier)' else '' end, E'\n' order by ord)
        into v_sub_scope from jsonb_array_elements(v_items) with ordinality w(work, ord) where work->>'parentId' = v_sub->>'id';
      insert into public.request_sub_lots(request_id, project_id) values (v_request.id, v_project.id) returning id into v_sub_lot;
      insert into public.request_sub_lot_versions(sub_lot_id, request_id, project_id, request_version_id, ordinal, title, scope, budget_millimes)
      values (v_sub_lot, v_request.id, v_project.id, v_request_version, v_ordinal, left(v_sub->>'label', 200),
        coalesce(v_sub_scope, 'Contenu à préciser avec les professionnels.'), null);
      v_ordinal := v_ordinal + 1;
      insert into public.project_assistant_scope_links(project_id, request_id, sub_lot_id, draft_id, referential_provider, referential_version, item_id, item_code, item_kind, item_label, unit, relevance)
      select v_project.id, v_request.id, v_sub_lot, v.id, v.referential->>'provider', v.referential->>'catalogVersion', x->>'id', x->>'code', x->>'kind', x->>'label', x->>'unit', coalesce(x->>'relevance','usual')
        from jsonb_array_elements(v_items) x where x->>'id' = v_sub->>'id' or x->>'parentId' = v_sub->>'id';
    end loop;
    v_lots := v_lots + 1;
  end loop;

  update public.project_assistant_drafts set status = 'created', created_project_id = v_project.id, creation_key = p_creation_key,
    revision = v.revision + 1, updated_at = now() where id = v.id returning * into v;
  insert into public.project_assistant_draft_revisions(draft_id, owner_id, revision, kind, project_type, governorate_id, proposal)
  values (v.id, v.owner_id, v.revision, 'create', v.project_type, v.governorate_id, v.proposal);
  return jsonb_build_object('projectId', v_project.id, 'created', true, 'lots', v_lots);
end; $$;

create function public.save_project_assistant_draft_v1(p_draft_id uuid, p_expected_revision integer, p_kind text, p_command text, p_draft jsonb)
returns jsonb language sql security definer set search_path='' as $$ select dao_private.save_project_assistant_draft_v1($1,$2,$3,$4,$5); $$;
create function public.abandon_project_assistant_draft_v1(p_draft_id uuid)
returns jsonb language sql security definer set search_path='' as $$ select dao_private.abandon_project_assistant_draft_v1($1); $$;
create function public.create_project_from_assistant_draft_v1(p_draft_id uuid, p_creation_key text)
returns jsonb language sql security definer set search_path='' as $$ select dao_private.create_project_from_assistant_draft_v1($1,$2); $$;

revoke all on function dao_private.save_project_assistant_draft_v1(uuid,integer,text,text,jsonb),
  dao_private.abandon_project_assistant_draft_v1(uuid), dao_private.create_project_from_assistant_draft_v1(uuid,text),
  public.save_project_assistant_draft_v1(uuid,integer,text,text,jsonb), public.abandon_project_assistant_draft_v1(uuid),
  public.create_project_from_assistant_draft_v1(uuid,text) from public, anon, authenticated;
grant execute on function public.save_project_assistant_draft_v1(uuid,integer,text,text,jsonb),
  public.abandon_project_assistant_draft_v1(uuid), public.create_project_from_assistant_draft_v1(uuid,text) to authenticated;

commit;
