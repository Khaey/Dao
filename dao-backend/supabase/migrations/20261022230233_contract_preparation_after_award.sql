begin;

-- #390: the Client explicitly chooses whether future awards for a chantier
-- prepare a non-engaging contract draft. Absence of a row is the safe OFF
-- default. Mutations only go through the commands below.
create table public.project_contract_settings (
  project_id uuid primary key references public.projects,
  enabled boolean not null default false,
  revision integer not null default 1 check (revision > 0),
  updated_by uuid not null references auth.users,
  updated_at timestamptz not null default now()
);

alter table public.project_contract_settings enable row level security;
revoke all on public.project_contract_settings from public, anon, authenticated;
grant select on public.project_contract_settings to authenticated;
grant all on public.project_contract_settings to service_role;
create policy read_allowed on public.project_contract_settings
  for select to authenticated
  using (
    dao_private.account_active(auth.uid())
    and (
      dao_private.owner(project_id)
      or exists (
        select 1 from public.user_roles ur
        where ur.user_id = auth.uid() and ur.role = 'dao_admin'
      )
    )
  );

-- The legal carrier and its actual D.A.O representative are deliberately kept
-- outside exposed schemas. They are never inferred from "the first admin".
create table dao_private.contract_runtime_configuration (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  dao_user_id uuid references auth.users,
  dao_legal_name text,
  revision integer not null default 1 check (revision > 0),
  updated_by uuid not null references auth.users,
  updated_at timestamptz not null default now(),
  check (
    (enabled and dao_user_id is not null and dao_legal_name = 'LogicLab Tunisie')
    or (not enabled)
  )
);

create table dao_private.contract_runtime_configuration_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  actor_id uuid not null references auth.users,
  enabled boolean not null,
  dao_user_id uuid references auth.users,
  dao_legal_name text,
  revision integer not null check (revision > 0)
);

create table dao_private.contract_preparation_audit (
  award_id uuid primary key references public.awards,
  project_id uuid not null references public.projects,
  setting_revision integer,
  runtime_revision integer,
  enabled boolean not null,
  status text not null check (status in ('disabled','prepared')),
  dao_user_id uuid references auth.users,
  dao_legal_name text,
  contract_id uuid unique references public.contracts,
  created_at timestamptz not null default now(),
  check (
    (status = 'disabled' and not enabled and contract_id is null)
    or (status = 'prepared' and enabled and contract_id is not null
        and dao_user_id is not null and dao_legal_name = 'LogicLab Tunisie')
  )
);

revoke all on dao_private.contract_runtime_configuration,
  dao_private.contract_runtime_configuration_events,
  dao_private.contract_preparation_audit
  from public, anon, authenticated;
grant all on dao_private.contract_runtime_configuration,
  dao_private.contract_runtime_configuration_events,
  dao_private.contract_preparation_audit
  to service_role;

create function dao_private.contract_configuration_receipt(
  p_actor uuid,
  p_key text,
  p_command text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare existing public.command_receipts;
begin
  if p_key is null or length(btrim(p_key)) < 8 then
    raise exception using errcode = '22023', message = 'Clé idempotente requise';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor::text || ':' || p_key, 0));
  select * into existing
  from public.command_receipts
  where actor_id = p_actor and idempotency_key = p_key;
  if existing.id is null then return null; end if;
  if existing.command <> p_command then
    raise exception using errcode = '22023', message = 'Clé idempotente déjà utilisée';
  end if;
  return existing.result;
end;
$$;

create function dao_private.configure_contract_runtime(
  p_dao_user_id uuid,
  p_dao_legal_name text,
  p_enabled boolean,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  replay jsonb;
  current_revision integer;
  result jsonb;
begin
  if actor is null or not dao_private.account_active(actor)
     or not exists (
       select 1 from public.user_roles
       where user_id = actor and role = 'dao_admin'
     ) then
    raise exception using errcode = '42501', message = 'Administrateur D.A.O actif requis';
  end if;

  replay := dao_private.contract_configuration_receipt(
    actor, p_idempotency_key, 'configure_contract_runtime'
  );
  if replay is not null then
    if replay->>'enabled' is distinct from p_enabled::text
       or replay->>'dao_user_id' is distinct from p_dao_user_id::text
       or replay->>'dao_legal_name' is distinct from nullif(btrim(p_dao_legal_name), '') then
      raise exception using errcode = '22023', message = 'Clé idempotente réutilisée avec une configuration différente';
    end if;
    return replay;
  end if;

  if p_enabled then
    if p_dao_user_id is null
       or btrim(coalesce(p_dao_legal_name, '')) <> 'LogicLab Tunisie'
       or not dao_private.account_active(p_dao_user_id)
       or not exists (
         select 1 from public.user_roles
         where user_id = p_dao_user_id and role = 'dao_admin'
       ) then
      raise exception using errcode = '22023', message = 'Représentant LogicLab Tunisie habilité requis';
    end if;
  elsif exists (
    select 1 from public.project_contract_settings where enabled
  ) then
    raise exception using errcode = '23514', message = 'Désactivation impossible tant que des chantiers utilisent le contrat';
  end if;

  select revision into current_revision
  from dao_private.contract_runtime_configuration
  where singleton
  for update;
  current_revision := coalesce(current_revision, 0) + 1;

  insert into dao_private.contract_runtime_configuration(
    singleton, enabled, dao_user_id, dao_legal_name, revision, updated_by
  ) values (
    true, p_enabled,
    case when p_enabled then p_dao_user_id else null end,
    case when p_enabled then 'LogicLab Tunisie' else null end,
    current_revision, actor
  )
  on conflict(singleton) do update set
    enabled = excluded.enabled,
    dao_user_id = excluded.dao_user_id,
    dao_legal_name = excluded.dao_legal_name,
    revision = excluded.revision,
    updated_by = excluded.updated_by,
    updated_at = now();

  insert into dao_private.contract_runtime_configuration_events(
    actor_id, enabled, dao_user_id, dao_legal_name, revision
  ) values (
    actor, p_enabled,
    case when p_enabled then p_dao_user_id else null end,
    case when p_enabled then 'LogicLab Tunisie' else null end,
    current_revision
  );

  result := jsonb_build_object(
    'enabled', p_enabled,
    'dao_user_id', case when p_enabled then p_dao_user_id else null end,
    'dao_legal_name', case when p_enabled then 'LogicLab Tunisie' else null end,
    'revision', current_revision
  );
  insert into public.audit_events(actor_id, action, entity_type, entity_id, metadata)
  values(actor, 'contract_runtime_configured', 'contract_runtime', p_dao_user_id,
    result - 'dao_user_id');
  insert into public.command_receipts(actor_id, idempotency_key, command, result)
  values(actor, p_idempotency_key, 'configure_contract_runtime', result);
  return result;
end;
$$;

create function public.configure_contract_runtime(
  p_dao_user_id uuid,
  p_dao_legal_name text,
  p_enabled boolean,
  p_idempotency_key text
) returns jsonb
language sql
security definer
set search_path = ''
as $$
  select dao_private.configure_contract_runtime($1, $2, $3, $4);
$$;

create function dao_private.set_project_contract_enabled(
  p_project_id uuid,
  p_enabled boolean,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  replay jsonb;
  previous_enabled boolean := false;
  current_revision integer := 0;
  result jsonb;
begin
  if actor is null or not dao_private.account_active(actor)
     or not exists (
       select 1 from public.projects p
       join public.user_roles ur on ur.user_id = actor and ur.role = 'client'
       where p.id = p_project_id and p.client_id = actor and p.status <> 'archived'
     ) then
    raise exception using errcode = '42501', message = 'Client propriétaire actif requis';
  end if;

  replay := dao_private.contract_configuration_receipt(
    actor, p_idempotency_key, 'set_project_contract_enabled'
  );
  if replay is not null then
    if replay->>'project_id' is distinct from p_project_id::text
       or replay->>'enabled' is distinct from p_enabled::text then
      raise exception using errcode = '22023', message = 'Clé idempotente réutilisée avec une configuration différente';
    end if;
    return replay;
  end if;

  perform 1 from public.projects where id = p_project_id for update;
  if exists (
    select 1 from public.awards
    where project_id = p_project_id and status <> 'cancelled'
  ) then
    raise exception using errcode = '23514', message = 'Le choix contrat doit être fixé avant la première attribution active';
  end if;
  if p_enabled and not exists (
    select 1
    from dao_private.contract_runtime_configuration c
    where c.singleton and c.enabled
      and c.dao_legal_name = 'LogicLab Tunisie'
      and dao_private.account_active(c.dao_user_id)
      and exists (
        select 1 from public.user_roles ur
        where ur.user_id = c.dao_user_id and ur.role = 'dao_admin'
      )
  ) then
    raise exception using errcode = '23514', message = 'Configuration contractuelle D.A.O indisponible';
  end if;

  select enabled, revision into previous_enabled, current_revision
  from public.project_contract_settings
  where project_id = p_project_id
  for update;
  previous_enabled := coalesce(previous_enabled, false);
  current_revision := coalesce(current_revision, 0) + 1;

  insert into public.project_contract_settings(
    project_id, enabled, revision, updated_by
  ) values (p_project_id, p_enabled, current_revision, actor)
  on conflict(project_id) do update set
    enabled = excluded.enabled,
    revision = excluded.revision,
    updated_by = excluded.updated_by,
    updated_at = now();

  result := jsonb_build_object(
    'project_id', p_project_id,
    'enabled', p_enabled,
    'revision', current_revision
  );
  insert into public.audit_events(actor_id, action, entity_type, entity_id, metadata)
  values(actor, 'project_contract_setting_changed', 'project', p_project_id,
    jsonb_build_object(
      'previous_enabled', previous_enabled,
      'enabled', p_enabled,
      'revision', current_revision
    ));
  insert into public.command_receipts(actor_id, idempotency_key, command, result)
  values(actor, p_idempotency_key, 'set_project_contract_enabled', result);
  return result;
end;
$$;

create function public.set_project_contract_enabled(
  p_project_id uuid,
  p_enabled boolean,
  p_idempotency_key text
) returns jsonb
language sql
security definer
set search_path = ''
as $$
  select dao_private.set_project_contract_enabled($1, $2, $3);
$$;

create function dao_private.project_contract_configuration(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare result jsonb;
begin
  if auth.uid() is null or not dao_private.account_active(auth.uid())
     or not (
       dao_private.owner(p_project_id)
       or exists (
         select 1 from public.user_roles
         where user_id = auth.uid() and role = 'dao_admin'
       )
     ) then
    raise exception using errcode = '42501', message = 'Configuration contrat non autorisée';
  end if;
  select jsonb_build_object(
    'project_id', p_project_id,
    'enabled', coalesce(s.enabled, false),
    'revision', coalesce(s.revision, 0),
    'runtime_available', exists (
      select 1 from dao_private.contract_runtime_configuration c
      where c.singleton and c.enabled
        and c.dao_legal_name = 'LogicLab Tunisie'
        and dao_private.account_active(c.dao_user_id)
        and exists (
          select 1 from public.user_roles ur
          where ur.user_id = c.dao_user_id and ur.role = 'dao_admin'
        )
    )
  ) into result
  from (select p_project_id as id) p
  left join public.project_contract_settings s on s.project_id = p.id;
  return result;
end;
$$;

create function public.project_contract_configuration(p_project_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select dao_private.project_contract_configuration($1);
$$;

-- Deferred execution means all award_items have been inserted before the
-- immutable contract snapshot is built. A preparation failure rolls back the
-- award itself, so no "awarded but missing contract" intermediate state exists.
create function dao_private.prepare_contract_after_award()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  setting public.project_contract_settings;
  runtime dao_private.contract_runtime_configuration;
  prepared jsonb;
  preparation_key uuid;
begin
  select * into setting
  from public.project_contract_settings
  where project_id = new.project_id;

  if setting.project_id is null or not setting.enabled then
    insert into dao_private.contract_preparation_audit(
      award_id, project_id, setting_revision, enabled, status
    ) values (
      new.id, new.project_id, setting.revision, false, 'disabled'
    );
    return null;
  end if;

  select * into runtime
  from dao_private.contract_runtime_configuration
  where singleton and enabled
  for share;
  if runtime.dao_user_id is null
     or runtime.dao_legal_name <> 'LogicLab Tunisie'
     or not dao_private.account_active(runtime.dao_user_id)
     or not exists (
       select 1 from public.user_roles
       where user_id = runtime.dao_user_id and role = 'dao_admin'
     ) then
    raise exception using errcode = '23514', message = 'Configuration contractuelle D.A.O indisponible';
  end if;

  preparation_key := (
    substr(md5(new.id::text || ':contract-preparation'), 1, 8) || '-' ||
    substr(md5(new.id::text || ':contract-preparation'), 9, 4) || '-' ||
    substr(md5(new.id::text || ':contract-preparation'), 13, 4) || '-' ||
    substr(md5(new.id::text || ':contract-preparation'), 17, 4) || '-' ||
    substr(md5(new.id::text || ':contract-preparation'), 21, 12)
  )::uuid;

  prepared := dao_private.prepare_contract_foundation(
    runtime.dao_user_id,
    new.id,
    runtime.dao_user_id,
    runtime.dao_legal_name,
    preparation_key
  );

  insert into dao_private.contract_preparation_audit(
    award_id, project_id, setting_revision, runtime_revision, enabled, status,
    dao_user_id, dao_legal_name, contract_id
  ) values (
    new.id, new.project_id, setting.revision, runtime.revision, true, 'prepared',
    runtime.dao_user_id, runtime.dao_legal_name,
    (prepared->>'contract_id')::uuid
  );
  return null;
end;
$$;

create constraint trigger prepare_contract_after_award
after insert on public.awards
deferrable initially deferred
for each row execute function dao_private.prepare_contract_after_award();

revoke all on function dao_private.contract_configuration_receipt(uuid,text,text),
  dao_private.configure_contract_runtime(uuid,text,boolean,text),
  dao_private.set_project_contract_enabled(uuid,boolean,text),
  dao_private.project_contract_configuration(uuid),
  dao_private.prepare_contract_after_award()
  from public, anon, authenticated;

revoke all on function public.configure_contract_runtime(uuid,text,boolean,text),
  public.set_project_contract_enabled(uuid,boolean,text),
  public.project_contract_configuration(uuid)
  from public, anon;
grant execute on function public.configure_contract_runtime(uuid,text,boolean,text),
  public.set_project_contract_enabled(uuid,boolean,text),
  public.project_contract_configuration(uuid)
  to authenticated, service_role;

commit;
