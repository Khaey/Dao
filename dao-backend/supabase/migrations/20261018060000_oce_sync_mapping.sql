-- OCE Engine V1 (#58, lot backend 2) : mapping durable D.A.O <-> passerelle OCE et journal de synchronisation.
-- * D.A.O reste l'autorité : seuls des identifiants D.A.O (projet, lot = project_request) et des codes stables
--   (WBS code, activity_code) sont stockés ; les identifiants OCE restent dans la passerelle privée.
-- * Tables fermées (RLS activée, aucune politique, aucun droit anon/authenticated) ; accès uniquement par RPC
--   réservées à service_role (le serveur D.A.O). Aucun contrat, paiement, attribution ni reçu n'est touché.
-- * Journal append-only avec clé d'idempotence : rejouer une opération déjà réussie est un no-op, une clé
--   réutilisée avec un autre contenu est refusée. Additive : aucune donnée existante modifiée ou supprimée.
begin;

create table public.oce_sync_mappings (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  project_id uuid not null,
  request_id uuid not null,
  status text not null default 'requested' check (status in ('requested','admitted','revoked')),
  admitted_at timestamptz,
  revoked_at timestamptz,
  project_ensured_at timestamptz,
  schedule_ensured_at timestamptz,
  last_success_at timestamptz,
  last_error_kind text check (last_error_kind is null or last_error_kind ~ '^[a-z_]{1,32}$'),
  last_error_code text check (last_error_code is null or last_error_code ~ '^[a-z0-9_]{1,64}$'),
  last_error_at timestamptz,
  unique (project_id, request_id),
  foreign key (request_id, project_id) references public.project_requests(id, project_id),
  check (status<>'admitted' or admitted_at is not null),
  check (status<>'revoked' or revoked_at is not null)
);

-- Durable record of what has been ensured on the OCE side, by stable D.A.O-side codes only.
create table public.oce_sync_wbs (
  mapping_id uuid not null references public.oce_sync_mappings on delete cascade,
  code text not null check (code ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,49}$'),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  synced_at timestamptz not null default now(),
  primary key (mapping_id, code)
);
create table public.oce_sync_activities (
  mapping_id uuid not null references public.oce_sync_mappings on delete cascade,
  activity_code text not null check (activity_code ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,49}$'),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  synced_at timestamptz not null default now(),
  primary key (mapping_id, activity_code)
);
create table public.oce_sync_dependencies (
  mapping_id uuid not null references public.oce_sync_mappings on delete cascade,
  predecessor_code text not null check (predecessor_code ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,49}$'),
  successor_code text not null check (successor_code ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,49}$'),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  synced_at timestamptz not null default now(),
  primary key (mapping_id, predecessor_code, successor_code),
  check (predecessor_code<>successor_code)
);

-- Append-only synchronisation journal: no payload, no name, no OCE identifier, only a hash of the canonical body.
create table public.oce_sync_journal (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  mapping_id uuid not null references public.oce_sync_mappings,
  operation text not null check (operation in ('ensure-project','ensure-wbs','ensure-schedule','upsert-activity','ensure-dependency','calculate-planning','planning-summary')),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 200),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending' check (status in ('pending','succeeded','failed')),
  attempts integer not null default 1 check (attempts between 1 and 1000),
  error_kind text check (error_kind is null or error_kind ~ '^[a-z_]{1,32}$'),
  error_code text check (error_code is null or error_code ~ '^[a-z0-9_]{1,64}$'),
  provenance text not null default 'dao_backend' check (provenance in ('dao_backend')),
  unique (mapping_id, operation, idempotency_key),
  check ((status='pending') = (finished_at is null)),
  check (status<>'failed' or error_kind is not null)
);
create index oce_sync_journal_by_mapping on public.oce_sync_journal(mapping_id, created_at desc);

alter table public.oce_sync_mappings enable row level security;
alter table public.oce_sync_wbs enable row level security;
alter table public.oce_sync_activities enable row level security;
alter table public.oce_sync_dependencies enable row level security;
alter table public.oce_sync_journal enable row level security;
revoke all on public.oce_sync_mappings, public.oce_sync_wbs, public.oce_sync_activities,
  public.oce_sync_dependencies, public.oce_sync_journal from public, anon, authenticated;

-- The journal can only move forward: pending -> succeeded|failed, failed -> pending (explicit retry). Never deleted.
create function dao_private.oce_sync_journal_guard() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' then raise exception using errcode='42501',message='Journal OCE en ajout seul'; end if;
  if new.id is distinct from old.id or new.mapping_id is distinct from old.mapping_id or new.operation is distinct from old.operation
     or new.idempotency_key is distinct from old.idempotency_key or new.payload_hash is distinct from old.payload_hash
     or new.created_at is distinct from old.created_at or new.provenance is distinct from old.provenance then
    raise exception using errcode='42501',message='Journal OCE : identité de l’entrée immuable';
  end if;
  if not ((old.status='pending' and new.status in ('pending','succeeded','failed'))
       or (old.status='failed' and new.status='pending' and new.attempts=old.attempts+1)) then
    raise exception using errcode='42501',message='Journal OCE : transition interdite';
  end if;
  return new;
end;
$$;
create trigger oce_sync_journal_guard before update or delete on public.oce_sync_journal
  for each row execute function dao_private.oce_sync_journal_guard();

-- Register the (project, lot) pair the server wants to synchronise. Idempotent; refuses archived projects and withdrawn lots.
create function dao_private.oce_request_mapping(p_project_id uuid,p_request_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  if not exists(select 1 from public.project_requests r join public.projects p on p.id=r.project_id
      where r.id=p_request_id and r.project_id=p_project_id and p.status<>'archived' and r.status<>'withdrawn') then
    raise exception using errcode='22023',message='Lot ou projet non synchronisable';
  end if;
  insert into public.oce_sync_mappings(project_id,request_id) values(p_project_id,p_request_id)
  on conflict(project_id,request_id) do nothing returning id into v_id;
  if v_id is null then select id into v_id from public.oce_sync_mappings where project_id=p_project_id and request_id=p_request_id; end if;
  return v_id;
end;
$$;

-- Admission follows the gateway's root-only authorize/revoke; D.A.O only records the observed state.
create function dao_private.oce_set_admission(p_mapping_id uuid,p_admitted boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
  update public.oce_sync_mappings set
    status=case when p_admitted then 'admitted' else 'revoked' end,
    admitted_at=case when p_admitted then coalesce(admitted_at,now()) else admitted_at end,
    revoked_at=case when p_admitted then null else now() end,
    updated_at=now()
  where id=p_mapping_id;
  if not found then raise exception using errcode='22023',message='Mapping OCE introuvable'; end if;
end;
$$;

-- Start (or replay) one operation. Returns {id,state}: run | replay | in_progress.
create function dao_private.oce_begin_sync(p_mapping_id uuid,p_operation text,p_key text,p_payload_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.oce_sync_mappings; j public.oce_sync_journal;
begin
  select * into m from public.oce_sync_mappings where id=p_mapping_id for update;
  if m.id is null then raise exception using errcode='22023',message='Mapping OCE introuvable'; end if;
  if m.status='revoked' then raise exception using errcode='42501',message='Mapping OCE révoqué'; end if;
  select * into j from public.oce_sync_journal where mapping_id=m.id and operation=p_operation and idempotency_key=p_key for update;
  if j.id is null then
    insert into public.oce_sync_journal(mapping_id,operation,idempotency_key,payload_hash) values(m.id,p_operation,p_key,p_payload_hash) returning * into j;
    return jsonb_build_object('id',j.id,'state','run');
  end if;
  if j.payload_hash<>p_payload_hash then
    raise exception using errcode='22023',message='Clé d’idempotence réutilisée avec un autre contenu';
  end if;
  if j.status='succeeded' then return jsonb_build_object('id',j.id,'state','replay'); end if;
  if j.status='pending' and j.updated_at>now()-interval '5 minutes' then return jsonb_build_object('id',j.id,'state','in_progress'); end if;
  -- failed, or a pending attempt abandoned for 5 minutes: explicit retry
  update public.oce_sync_journal set status='pending',finished_at=null,error_kind=null,error_code=null,
    attempts=case when j.status='failed' then attempts+1 else attempts end,updated_at=now() where id=j.id;
  return jsonb_build_object('id',j.id,'state','run');
end;
$$;

create function dao_private.oce_finish_sync(p_journal_id uuid,p_ok boolean,p_error_kind text default null,p_error_code text default null) returns void
language plpgsql security definer set search_path='' as $$
declare j public.oce_sync_journal;
begin
  select * into j from public.oce_sync_journal where id=p_journal_id for update;
  if j.id is null or j.status<>'pending' then raise exception using errcode='22023',message='Entrée de journal OCE non en cours'; end if;
  if p_ok then
    update public.oce_sync_journal set status='succeeded',finished_at=now(),updated_at=now() where id=j.id;
    update public.oce_sync_mappings set last_success_at=now(),updated_at=now(),last_error_kind=null,last_error_code=null,last_error_at=null,
      status=case when status='requested' then 'admitted' else status end,
      admitted_at=case when status='requested' then now() else admitted_at end,
      project_ensured_at=case when j.operation='ensure-project' then now() else project_ensured_at end,
      schedule_ensured_at=case when j.operation='ensure-schedule' then now() else schedule_ensured_at end
    where id=j.mapping_id;
  else
    update public.oce_sync_journal set status='failed',finished_at=now(),updated_at=now(),error_kind=coalesce(p_error_kind,'unknown'),error_code=p_error_code where id=j.id;
    update public.oce_sync_mappings set last_error_kind=coalesce(p_error_kind,'unknown'),last_error_code=p_error_code,last_error_at=now(),updated_at=now() where id=j.mapping_id;
  end if;
end;
$$;

-- Record an ensured object by stable code. Returns true when it is new or its content hash changed (=> a write is due).
create function dao_private.oce_object_changed(p_mapping_id uuid,p_kind text,p_code text,p_code2 text,p_hash text) returns boolean
language plpgsql security definer set search_path='' as $$
declare v_old text;
begin
  if p_kind='wbs' then
    select content_hash into v_old from public.oce_sync_wbs where mapping_id=p_mapping_id and code=p_code;
  elsif p_kind='activity' then
    select content_hash into v_old from public.oce_sync_activities where mapping_id=p_mapping_id and activity_code=p_code;
  elsif p_kind='dependency' then
    select content_hash into v_old from public.oce_sync_dependencies where mapping_id=p_mapping_id and predecessor_code=p_code and successor_code=p_code2;
  else raise exception using errcode='22023',message='Type d’objet OCE inconnu'; end if;
  return v_old is distinct from p_hash;
end;
$$;
create function dao_private.oce_record_object(p_mapping_id uuid,p_kind text,p_code text,p_code2 text,p_hash text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if p_kind='wbs' then
    insert into public.oce_sync_wbs(mapping_id,code,content_hash) values(p_mapping_id,p_code,p_hash)
    on conflict(mapping_id,code) do update set content_hash=excluded.content_hash,synced_at=now();
  elsif p_kind='activity' then
    insert into public.oce_sync_activities(mapping_id,activity_code,content_hash) values(p_mapping_id,p_code,p_hash)
    on conflict(mapping_id,activity_code) do update set content_hash=excluded.content_hash,synced_at=now();
  elsif p_kind='dependency' then
    insert into public.oce_sync_dependencies(mapping_id,predecessor_code,successor_code,content_hash) values(p_mapping_id,p_code,p_code2,p_hash)
    on conflict(mapping_id,predecessor_code,successor_code) do update set content_hash=excluded.content_hash,synced_at=now();
  else raise exception using errcode='22023',message='Type d’objet OCE inconnu'; end if;
end;
$$;

grant usage on schema dao_private to service_role;

-- PostgREST wrappers (security invoker) for the server only; nothing is granted to anon/authenticated.
create function public.oce_request_mapping(p_project_id uuid,p_request_id uuid) returns uuid language sql security invoker set search_path='' as $$ select dao_private.oce_request_mapping($1,$2); $$;
create function public.oce_set_admission(p_mapping_id uuid,p_admitted boolean) returns void language sql security invoker set search_path='' as $$ select dao_private.oce_set_admission($1,$2); $$;
create function public.oce_begin_sync(p_mapping_id uuid,p_operation text,p_key text,p_payload_hash text) returns jsonb language sql security invoker set search_path='' as $$ select dao_private.oce_begin_sync($1,$2,$3,$4); $$;
create function public.oce_finish_sync(p_journal_id uuid,p_ok boolean,p_error_kind text default null,p_error_code text default null) returns void language sql security invoker set search_path='' as $$ select dao_private.oce_finish_sync($1,$2,$3,$4); $$;
create function public.oce_object_changed(p_mapping_id uuid,p_kind text,p_code text,p_code2 text,p_hash text) returns boolean language sql security invoker set search_path='' as $$ select dao_private.oce_object_changed($1,$2,$3,$4,$5); $$;
create function public.oce_record_object(p_mapping_id uuid,p_kind text,p_code text,p_code2 text,p_hash text) returns void language sql security invoker set search_path='' as $$ select dao_private.oce_record_object($1,$2,$3,$4,$5); $$;

revoke all on function
  dao_private.oce_sync_journal_guard(),
  dao_private.oce_request_mapping(uuid,uuid),dao_private.oce_set_admission(uuid,boolean),dao_private.oce_begin_sync(uuid,text,text,text),
  dao_private.oce_finish_sync(uuid,boolean,text,text),dao_private.oce_object_changed(uuid,text,text,text,text),dao_private.oce_record_object(uuid,text,text,text,text),
  public.oce_request_mapping(uuid,uuid),public.oce_set_admission(uuid,boolean),public.oce_begin_sync(uuid,text,text,text),
  public.oce_finish_sync(uuid,boolean,text,text),public.oce_object_changed(uuid,text,text,text,text),public.oce_record_object(uuid,text,text,text,text)
  from public,anon,authenticated;
grant execute on function
  dao_private.oce_request_mapping(uuid,uuid),dao_private.oce_set_admission(uuid,boolean),dao_private.oce_begin_sync(uuid,text,text,text),
  dao_private.oce_finish_sync(uuid,boolean,text,text),dao_private.oce_object_changed(uuid,text,text,text,text),dao_private.oce_record_object(uuid,text,text,text,text),
  public.oce_request_mapping(uuid,uuid),public.oce_set_admission(uuid,boolean),public.oce_begin_sync(uuid,text,text,text),
  public.oce_finish_sync(uuid,boolean,text,text),public.oce_object_changed(uuid,text,text,text,text),public.oce_record_object(uuid,text,text,text,text)
  to service_role;

commit;
