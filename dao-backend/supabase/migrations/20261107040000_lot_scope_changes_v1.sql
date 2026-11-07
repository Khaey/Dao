-- #587 — décision du propriétaire (07/11/2026, #577) : « Nouvel ouvrage après attribution : il doit passer par une
-- modification de périmètre validée, et non par un ouvrage privé qui contourne le contrat. »
--
-- Parcours :
--   1. Proposition par le Client propriétaire OU par l'Artisan titulaire du lot attribué (ouvrages du référentiel
--      publié ou libellés hors référentiel, sous-lot facultatif, motif obligatoire). Une seule proposition en attente
--      par lot attribué.
--   2. Validation par les deux parties : l'auteur valide en proposant, l'autre partie accepte ou refuse (motif).
--      L'auteur peut retirer sa proposition tant qu'elle est en attente.
--   3. Acceptation = nouvelle version APPEND-ONLY du périmètre du lot attribué (`lot_scope_versions`) :
--      version 1 = ouvrages publiés et attribués (instantané `publication_requests.works_scope` de la version du lot
--      offerte par l'Artisan), version N+1 = version N + ouvrages acceptés. La version publiée reste immuable.
--   4. Les ouvrages acceptés deviennent des occurrences du chantier (`project_work_items.origin = 'scope_change'`),
--      donc mesurables dans les métrés d'exécution du Suivi du chantier.
--
-- Aucun effet financier ou juridique (décision d'Ahmed demandée sur le prix) : pas de montant, aucun changement de
-- l'attribution, du montant attribué, du contrat, d'un paiement ou d'une facture. `price_effect` est figé à 'none'.
-- Tables lues et écrites uniquement par RPC JWT ; un concurrent ne voit rien ; historique append-only.
begin;

create table public.lot_scope_changes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  project_id uuid not null,
  request_id uuid not null,
  award_item_id uuid not null references public.award_items,
  base_version_no integer not null check (base_version_no >= 1),
  proposed_by uuid not null references auth.users,
  proposer_role text not null check (proposer_role in ('client','contractor')),
  reason text not null check (length(btrim(reason)) between 5 and 2000),
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 30),
  price_effect text not null default 'none' check (price_effect = 'none'),
  state text not null default 'pending' check (state in ('pending','accepted','rejected','withdrawn')),
  decided_by uuid references auth.users,
  decided_role text check (decided_role in ('client','contractor')),
  decided_at timestamptz,
  decision_reason text check (decision_reason is null or length(btrim(decision_reason)) between 5 and 2000),
  result_version_no integer check (result_version_no is null or result_version_no >= 2),
  foreign key (request_id, project_id) references public.project_requests(id, project_id),
  check ((state = 'pending') = (decided_at is null)),
  check ((state = 'pending') = (decided_by is null)),
  check ((state = 'accepted') = (result_version_no is not null)),
  check (state <> 'rejected' or decision_reason is not null),
  check (state not in ('accepted','rejected') or decided_role is distinct from proposer_role),
  unique (id, project_id)
);
create unique index lot_scope_changes_one_pending_uidx on public.lot_scope_changes(award_item_id) where state = 'pending';
create index lot_scope_changes_project_idx on public.lot_scope_changes(project_id, created_at desc);

create table public.lot_scope_versions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  project_id uuid not null,
  request_id uuid not null,
  award_item_id uuid not null references public.award_items,
  version_no integer not null check (version_no >= 1),
  works jsonb not null check (jsonb_typeof(works) = 'array'),
  scope_change_id uuid references public.lot_scope_changes,
  created_by uuid references auth.users,
  check ((version_no = 1) = (scope_change_id is null)),
  foreign key (request_id, project_id) references public.project_requests(id, project_id),
  unique (award_item_id, version_no)
);
create unique index lot_scope_versions_change_uidx on public.lot_scope_versions(scope_change_id) where scope_change_id is not null;

create table public.lot_scope_change_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  scope_change_id uuid not null references public.lot_scope_changes,
  project_id uuid not null,
  actor_id uuid not null references auth.users,
  actor_role text not null check (actor_role in ('client','contractor')),
  event_type text not null check (event_type in ('proposed','accepted','rejected','withdrawn')),
  reason text,
  detail jsonb
);
create index lot_scope_change_events_change_idx on public.lot_scope_change_events(scope_change_id, created_at, id);

create table dao_private.lot_scope_change_command_receipts (
  actor_id uuid not null,
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9._:-]{8,100}$'),
  action text not null,
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (actor_id, idempotency_key)
);

create trigger lot_scope_versions_append_only before update or delete on public.lot_scope_versions
  for each row execute function dao_private.append_only();
create trigger lot_scope_change_events_append_only before update or delete on public.lot_scope_change_events
  for each row execute function dao_private.append_only();

-- Une proposition est immuable ; seule sa décision (une fois, depuis « en attente ») est enregistrée.
create function dao_private.lot_scope_change_guard() returns trigger
language plpgsql set search_path='' as $$
begin
  if TG_OP = 'DELETE' then raise exception using errcode='23514', message='Modification de périmètre : historique immuable'; end if;
  if (to_jsonb(NEW) - 'state' - 'decided_by' - 'decided_role' - 'decided_at' - 'decision_reason' - 'result_version_no')
     is distinct from (to_jsonb(OLD) - 'state' - 'decided_by' - 'decided_role' - 'decided_at' - 'decision_reason' - 'result_version_no')
     or OLD.state <> 'pending' or NEW.state = 'pending' then
    raise exception using errcode='23514', message='Modification de périmètre : proposition immuable';
  end if;
  return NEW;
end; $$;
create trigger lot_scope_changes_guard before update or delete on public.lot_scope_changes
  for each row execute function dao_private.lot_scope_change_guard();

alter table public.lot_scope_changes enable row level security;
alter table public.lot_scope_versions enable row level security;
alter table public.lot_scope_change_events enable row level security;
revoke all on public.lot_scope_changes, public.lot_scope_versions, public.lot_scope_change_events from public, anon, authenticated;
grant select, insert, update on public.lot_scope_changes to service_role;
grant select, insert on public.lot_scope_versions, public.lot_scope_change_events to service_role;
revoke all on dao_private.lot_scope_change_command_receipts from public, anon, authenticated;

-- Occurrences issues d'une modification acceptée : origine explicite et lien immuable vers la modification.
alter table public.project_work_items drop constraint project_work_items_origin_check;
alter table public.project_work_items add constraint project_work_items_origin_check
  check (origin in ('assistant','manual','import','scope_change'));
alter table public.project_work_items add column scope_change_id uuid references public.lot_scope_changes;
alter table public.project_work_items add constraint project_work_items_scope_change_origin
  check ((origin = 'scope_change') = (scope_change_id is not null));
create index project_work_items_scope_change_idx on public.project_work_items(scope_change_id) where scope_change_id is not null;

create or replace function dao_private.project_work_item_identity_guard() returns trigger
language plpgsql set search_path='' as $$
begin
  if TG_OP = 'DELETE' then raise exception using errcode='23514', message='Occurrence d''ouvrage : retrait tracé uniquement'; end if;
  if NEW.id <> OLD.id or NEW.project_id <> OLD.project_id or NEW.request_id <> OLD.request_id
     or NEW.work_id is distinct from OLD.work_id or NEW.catalog_version_id is distinct from OLD.catalog_version_id
     or NEW.origin <> OLD.origin or NEW.origin_ref is distinct from OLD.origin_ref or NEW.created_at <> OLD.created_at
     or NEW.scope_change_id is distinct from OLD.scope_change_id
     or (OLD.status = 'removed') then
    raise exception using errcode='23514', message='Occurrence d''ouvrage : identité immuable';
  end if;
  return NEW;
end; $$;

-- Partie au lot attribué : 'client' (propriétaire), 'contractor' (titulaire actif) ou null.
create function dao_private.lot_scope_party(p_award_item_id uuid) returns text
language sql stable security definer set search_path='' as $$
  select case
    when not dao_private.account_active(auth.uid()) then null
    when dao_private.owner(ai.project_id) then 'client'
    when cp.user_id = auth.uid() then 'contractor'
    else null end
  from public.award_items ai
  join public.awards a on a.id = ai.award_id and a.project_id = ai.project_id and a.status <> 'cancelled'
  join public.contractor_profiles cp on cp.id = ai.contractor_id
  where ai.id = p_award_item_id and ai.active;
$$;

-- Version 1 : ouvrages publiés de la version du lot sur laquelle l'Artisan a remis l'offre attribuée.
create function dao_private.lot_scope_initial_works(p_award_item_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce((
    select pr.works_scope from public.award_items ai
    join public.bid_items bi on bi.id = ai.bid_item_id
    join public.publication_requests pr on pr.request_version_id = bi.request_version_id
    where ai.id = p_award_item_id and pr.works_scope is not null
    order by pr.created_at desc limit 1), '[]'::jsonb);
$$;

create function dao_private.lot_scope_current(p_award_item_id uuid, out version_no integer, out works jsonb)
language sql stable security definer set search_path='' as $$
  select coalesce(v.version_no, 1), coalesce(v.works, dao_private.lot_scope_initial_works(p_award_item_id))
  from (select 1) one
  left join lateral (select x.version_no, x.works from public.lot_scope_versions x
    where x.award_item_id = p_award_item_id order by x.version_no desc limit 1) v on true;
$$;

create function dao_private.lot_scope_change_json(p_change public.lot_scope_changes, p_party text) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'id', p_change.id, 'awardItemId', p_change.award_item_id, 'requestId', p_change.request_id, 'state', p_change.state,
    'proposerRole', p_change.proposer_role, 'proposedAt', p_change.created_at, 'reason', p_change.reason,
    'items', p_change.items, 'baseVersionNo', p_change.base_version_no, 'resultVersionNo', p_change.result_version_no,
    'decidedRole', p_change.decided_role, 'decidedAt', p_change.decided_at, 'decisionReason', p_change.decision_reason,
    'priceEffect', p_change.price_effect,
    'canDecide', p_change.state = 'pending' and p_party is not null and p_party <> p_change.proposer_role,
    'canWithdraw', p_change.state = 'pending' and p_party = p_change.proposer_role);
$$;

create function dao_private.lot_scope_changes_snapshot_v1(p_project_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_observer boolean; v_lots jsonb; v_catalog jsonb;
begin
  if auth.uid() is null or p_project_id is null or not dao_private.account_active(auth.uid()) then
    raise exception using errcode='42501', message='scope change access required';
  end if;
  v_observer := dao_private.owner(p_project_id) or dao_private.manages_project(p_project_id);
  select coalesce(jsonb_agg(lot order by lot->>'awardedAt', lot->>'awardItemId'), '[]'::jsonb) into v_lots from (
    select jsonb_build_object(
      'awardItemId', ai.id, 'requestId', ai.request_id, 'awardedAt', ai.created_at,
      'title', rv.title, 'contractorName', cp.business_name,
      'viewerRole', coalesce(party.role, 'observer'),
      'currentVersion', jsonb_build_object('versionNo', cur.version_no, 'works', cur.works),
      'versions', (select coalesce(jsonb_agg(jsonb_build_object('versionNo', v.version_no, 'createdAt', v.created_at,
          'scopeChangeId', v.scope_change_id, 'worksCount', jsonb_array_length(v.works)) order by v.version_no), '[]'::jsonb)
        from public.lot_scope_versions v where v.award_item_id = ai.id),
      'subLots', (select coalesce(jsonb_agg(jsonb_build_object('id', s.sub_lot_id, 'title', s.title) order by s.ordinal), '[]'::jsonb)
        from public.request_sub_lot_versions s where s.request_version_id = rv.id),
      'canPropose', party.role is not null and not exists (select 1 from public.lot_scope_changes c where c.award_item_id = ai.id and c.state = 'pending'),
      'changes', (select coalesce(jsonb_agg(dao_private.lot_scope_change_json(c, party.role) order by c.created_at desc, c.id), '[]'::jsonb)
        from public.lot_scope_changes c where c.award_item_id = ai.id)) as lot
    from public.award_items ai
    join public.awards a on a.id = ai.award_id and a.project_id = ai.project_id and a.status <> 'cancelled'
    join public.contractor_profiles cp on cp.id = ai.contractor_id
    join lateral (select x.id, x.title from public.project_request_versions x where x.request_id = ai.request_id order by x.version_no desc limit 1) rv on true
    cross join lateral (select dao_private.lot_scope_party(ai.id) as role) party
    cross join lateral dao_private.lot_scope_current(ai.id) cur
    where ai.project_id = p_project_id and ai.active and (v_observer or party.role is not null)) lots;
  if not v_observer and jsonb_array_length(v_lots) = 0 then
    raise exception using errcode='42501', message='scope change access required';
  end if;
  select jsonb_build_object('id', v.id, 'code', v.code) into v_catalog from public.btp_catalog_versions v
    where v.status = 'published' and v.country_code = 'TN' order by v.effective_from desc limit 1;
  return jsonb_build_object('projectId', p_project_id, 'catalogVersion', v_catalog, 'lots', v_lots);
end; $$;

create function dao_private.lot_scope_change_command_v1(p_action text, p_input jsonb, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid := auth.uid(); v_hash text; prior dao_private.lot_scope_change_command_receipts; result jsonb;
  v_award public.award_items; v_change public.lot_scope_changes; v_party text; v_reason text; v_entry jsonb;
  v_items jsonb := '[]'::jsonb; v_sub uuid; v_work uuid; v_label text; v_version public.btp_catalog_versions;
  w_id uuid; w_code text; w_label text; w_unit text; v_rv uuid; v_cur record; v_item public.project_work_items;
  v_ordinal integer; v_new jsonb := '[]'::jsonb; v_project uuid;
begin
  if actor is null or not dao_private.account_active(actor) then
    raise exception using errcode='42501', message='active authentication required';
  end if;
  if p_action not in ('propose','accept','reject','withdraw') or p_input is null or jsonb_typeof(p_input) <> 'object'
     or coalesce(p_idempotency_key, '') !~ '^[A-Za-z0-9._:-]{8,100}$' then
    raise exception using errcode='22023', message='invalid scope change command';
  end if;
  v_hash := encode(sha256(convert_to(p_action || ':' || p_input::text, 'UTF8')), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(actor::text || ':scope-change:' || p_idempotency_key, 0));
  select * into prior from dao_private.lot_scope_change_command_receipts where actor_id = actor and idempotency_key = p_idempotency_key;
  if found then
    if prior.action <> p_action or prior.payload_sha256 <> v_hash then raise exception using errcode='22023', message='idempotency key already used'; end if;
    return prior.result;
  end if;

  if p_action = 'propose' then
    if exists (select 1 from jsonb_object_keys(p_input) k where k not in ('awardItemId','reason','items'))
       or jsonb_typeof(p_input->'items') is distinct from 'array' or jsonb_array_length(p_input->'items') not between 1 and 30 then
      raise exception using errcode='22023', message='invalid scope change proposal'; end if;
    begin select * into v_award from public.award_items where id = (p_input->>'awardItemId')::uuid for update;
    exception when invalid_text_representation then raise exception using errcode='22023', message='invalid identifier'; end;
    if v_award.id is null then raise exception using errcode='P0002', message='awarded lot not found'; end if;
    v_party := dao_private.lot_scope_party(v_award.id);
    if v_party is null then raise exception using errcode='42501', message='awarded lot party required'; end if;
    v_reason := btrim(regexp_replace(coalesce(p_input->>'reason', ''), '\s+', ' ', 'g'));
    if length(v_reason) not between 5 and 2000 then raise exception using errcode='22023', message='reason required (5 to 2000 characters)'; end if;
    if exists (select 1 from public.lot_scope_changes c where c.award_item_id = v_award.id and c.state = 'pending') then
      raise exception using errcode='23514', message='a scope change is already pending', hint='scope_change_pending'; end if;
    select x.id into v_rv from public.project_request_versions x where x.request_id = v_award.request_id order by x.version_no desc limit 1;
    select * into v_version from public.btp_catalog_versions where status = 'published' and country_code = 'TN' order by effective_from desc limit 1;
    for v_entry in select value from jsonb_array_elements(p_input->'items') loop
      if jsonb_typeof(v_entry) <> 'object' or exists (select 1 from jsonb_object_keys(v_entry) k where k not in ('subLotId','workId','label')) then
        raise exception using errcode='22023', message='invalid work item'; end if;
      begin
        v_sub := nullif(v_entry->>'subLotId', '')::uuid;
        v_work := nullif(v_entry->>'workId', '')::uuid;
      exception when invalid_text_representation then raise exception using errcode='22023', message='invalid identifier'; end;
      if v_sub is not null and not exists (select 1 from public.request_sub_lot_versions s
          where s.sub_lot_id = v_sub and s.request_id = v_award.request_id and s.request_version_id = v_rv) then
        raise exception using errcode='22023', message='sub-lot is not part of this lot'; end if;
      w_id := null; w_code := null; w_unit := null;
      if v_work is not null then
        if v_version.id is null then raise exception using errcode='P0002', message='no published BTP catalogue'; end if;
        if v_entry ? 'label' then raise exception using errcode='22023', message='a catalogue work keeps its catalogue label'; end if;
        select w.id, w.code, w.label_fr, w.unit_code into w_id, w_code, w_label, w_unit from public.btp_works w
          where w.id = v_work and w.catalog_version_id = v_version.id and w.active;
        if w_id is null then raise exception using errcode='22023', message='work is not in the published catalogue'; end if;
        v_label := w_label;
      else
        v_label := btrim(regexp_replace(coalesce(v_entry->>'label', ''), '\s+', ' ', 'g'));
        if length(v_label) not between 2 and 200 or v_label ~ '[<>{}]' then
          raise exception using errcode='22023', message='custom work label required (2 to 200 characters)'; end if;
      end if;
      v_items := v_items || jsonb_build_object('workId', w_id, 'workCode', w_code,
        'catalogVersionId', case when w_id is null then null else v_version.id end,
        'catalogVersionCode', case when w_id is null then null else v_version.code end,
        'label', v_label, 'unitCode', w_unit, 'custom', w_id is null, 'subLotId', v_sub);
    end loop;
    select * into v_cur from dao_private.lot_scope_current(v_award.id);
    insert into public.lot_scope_changes(project_id, request_id, award_item_id, base_version_no, proposed_by, proposer_role, reason, items)
    values (v_award.project_id, v_award.request_id, v_award.id, v_cur.version_no, actor, v_party, v_reason, v_items)
    returning * into v_change;
    insert into public.lot_scope_change_events(scope_change_id, project_id, actor_id, actor_role, event_type, reason)
    values (v_change.id, v_change.project_id, actor, v_party, 'proposed', v_reason);
    v_project := v_award.project_id;
  else
    if exists (select 1 from jsonb_object_keys(p_input) k where k not in ('changeId','reason'))
       or (p_action = 'accept' and p_input ? 'reason') then
      raise exception using errcode='22023', message='unexpected field'; end if;
    begin select * into v_change from public.lot_scope_changes where id = (p_input->>'changeId')::uuid;
    exception when invalid_text_representation then raise exception using errcode='22023', message='invalid identifier'; end;
    if v_change.id is null then raise exception using errcode='P0002', message='scope change not found'; end if;
    -- Même ordre de verrou que la proposition : lot attribué, puis modification.
    select * into v_award from public.award_items where id = v_change.award_item_id for update;
    select * into v_change from public.lot_scope_changes where id = v_change.id for update;
    v_party := dao_private.lot_scope_party(v_award.id);
    if v_party is null then raise exception using errcode='42501', message='awarded lot party required'; end if;
    if v_change.state <> 'pending' then
      raise exception using errcode='23514', message='scope change already decided', hint='scope_change_closed'; end if;
    v_project := v_change.project_id;
    if p_action = 'withdraw' then
      if v_party <> v_change.proposer_role then raise exception using errcode='42501', message='only the proposing party can withdraw'; end if;
      v_reason := nullif(btrim(regexp_replace(coalesce(p_input->>'reason', ''), '\s+', ' ', 'g')), '');
      if v_reason is not null and length(v_reason) not between 5 and 2000 then raise exception using errcode='22023', message='invalid reason'; end if;
      update public.lot_scope_changes set state = 'withdrawn', decided_by = actor, decided_role = v_party, decided_at = now(), decision_reason = v_reason
        where id = v_change.id returning * into v_change;
      insert into public.lot_scope_change_events(scope_change_id, project_id, actor_id, actor_role, event_type, reason)
      values (v_change.id, v_project, actor, v_party, 'withdrawn', v_reason);
    else
      if v_party = v_change.proposer_role then
        raise exception using errcode='42501', message='the other party must decide', hint='scope_change_other_party'; end if;
      if p_action = 'reject' then
        v_reason := btrim(regexp_replace(coalesce(p_input->>'reason', ''), '\s+', ' ', 'g'));
        if length(v_reason) not between 5 and 2000 then raise exception using errcode='22023', message='reason required (5 to 2000 characters)'; end if;
        update public.lot_scope_changes set state = 'rejected', decided_by = actor, decided_role = v_party, decided_at = now(), decision_reason = v_reason
          where id = v_change.id returning * into v_change;
        insert into public.lot_scope_change_events(scope_change_id, project_id, actor_id, actor_role, event_type, reason)
        values (v_change.id, v_project, actor, v_party, 'rejected', v_reason);
      else
        select * into v_cur from dao_private.lot_scope_current(v_award.id);
        if v_cur.version_no <> v_change.base_version_no then
          raise exception using errcode='40001', message='awarded lot scope changed'; end if;
        if v_cur.version_no = 1 and not exists (select 1 from public.lot_scope_versions x where x.award_item_id = v_award.id) then
          insert into public.lot_scope_versions(project_id, request_id, award_item_id, version_no, works, created_by)
          values (v_award.project_id, v_award.request_id, v_award.id, 1, v_cur.works, actor);
        end if;
        perform 1 from public.project_requests where id = v_award.request_id for update;
        for v_entry in select value from jsonb_array_elements(v_change.items) loop
          select coalesce(max(ordinal), -1) + 1 into v_ordinal from public.project_work_items where request_id = v_award.request_id;
          insert into public.project_work_items(project_id, request_id, sub_lot_id, catalog_version_id, work_id, work_code, label, unit_code,
            confirmation, origin, ordinal, created_by, scope_change_id)
          values (v_award.project_id, v_award.request_id, nullif(v_entry->>'subLotId', '')::uuid, nullif(v_entry->>'catalogVersionId', '')::uuid,
            nullif(v_entry->>'workId', '')::uuid, nullif(v_entry->>'workCode', ''), v_entry->>'label', nullif(v_entry->>'unitCode', ''),
            'selected', 'scope_change', v_ordinal, actor, v_change.id)
          returning * into v_item;
          perform dao_private.project_work_item_event(v_item, 'created', actor,
            jsonb_build_object('scopeChangeId', v_change.id, 'scopeVersionNo', v_cur.version_no + 1));
          v_new := v_new || jsonb_build_object('id', v_item.id, 'label', v_item.label, 'unitCode', v_item.unit_code, 'workCode', v_item.work_code,
            'custom', v_item.work_id is null, 'toConfirm', false, 'subLotId', v_item.sub_lot_id, 'scopeChangeId', v_change.id);
        end loop;
        insert into public.lot_scope_versions(project_id, request_id, award_item_id, version_no, works, scope_change_id, created_by)
        values (v_award.project_id, v_award.request_id, v_award.id, v_cur.version_no + 1, v_cur.works || v_new, v_change.id, actor);
        update public.lot_scope_changes set state = 'accepted', decided_by = actor, decided_role = v_party, decided_at = now(),
          result_version_no = v_cur.version_no + 1 where id = v_change.id returning * into v_change;
        insert into public.lot_scope_change_events(scope_change_id, project_id, actor_id, actor_role, event_type, detail)
        values (v_change.id, v_project, actor, v_party, 'accepted', jsonb_build_object('versionNo', v_change.result_version_no,
          'workItemIds', (select jsonb_agg(x->'id') from jsonb_array_elements(v_new) x)));
      end if;
    end if;
  end if;

  result := dao_private.lot_scope_changes_snapshot_v1(v_project) || jsonb_build_object('changeId', v_change.id);
  insert into dao_private.lot_scope_change_command_receipts(actor_id, idempotency_key, action, payload_sha256, result)
  values (actor, p_idempotency_key, p_action, v_hash, result);
  return result;
end; $$;

-- Les occurrences exposent leur modification d'origine (lecture seule).
do $$
declare d text; n text;
begin
  d := pg_get_functiondef('dao_private.project_work_item_json(uuid)'::regprocedure);
  n := replace(d, $a$'origin', i.origin,$a$, $b$'origin', i.origin, 'scopeChangeId', i.scope_change_id,$b$);
  if n = d then raise exception 'project_work_item_json: anchor not found'; end if;
  execute n;
end $$;

revoke all on function dao_private.lot_scope_change_guard(), dao_private.lot_scope_party(uuid), dao_private.lot_scope_initial_works(uuid),
  dao_private.lot_scope_current(uuid), dao_private.lot_scope_change_json(public.lot_scope_changes, text),
  dao_private.lot_scope_changes_snapshot_v1(uuid), dao_private.lot_scope_change_command_v1(text, jsonb, text) from public, anon, authenticated;
grant execute on function dao_private.lot_scope_changes_snapshot_v1(uuid), dao_private.lot_scope_change_command_v1(text, jsonb, text)
  to authenticated, service_role;

create function public.lot_scope_changes_snapshot_v1(p_project_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$ select dao_private.lot_scope_changes_snapshot_v1($1); $$;
create function public.lot_scope_change_command_v1(p_action text, p_input jsonb, p_idempotency_key text) returns jsonb
language sql security invoker set search_path='' as $$ select dao_private.lot_scope_change_command_v1($1, $2, $3); $$;
revoke all on function public.lot_scope_changes_snapshot_v1(uuid), public.lot_scope_change_command_v1(text, jsonb, text) from public, anon;
grant execute on function public.lot_scope_changes_snapshot_v1(uuid), public.lot_scope_change_command_v1(text, jsonb, text)
  to authenticated, service_role;

commit;
