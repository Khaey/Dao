begin;

-- #515 tranche 2: non-secret connection registry and audited Admin commands.
-- No credential value or opaque vault reference is accepted by this RPC.

create table dao_private.provider_legal_entities (
  id text primary key check(id ~ '^[a-z][a-z0-9_]{2,63}$'),
  label text not null check(length(btrim(label)) between 3 and 120),
  country text not null check(country='TN'),
  sandbox_only boolean not null default true,
  created_at timestamptz not null default now()
);
insert into dao_private.provider_legal_entities(id,label,country,sandbox_only)
values('dao_tn_sandbox','D.A.O. Tunisie — périmètre sandbox', 'TN',true);

create table dao_private.provider_connections (
  id uuid primary key default gen_random_uuid(),
  provider_id text not null,
  manifest_version text not null,
  alias text not null check(length(btrim(alias)) between 3 and 100),
  country text not null check(country='TN'),
  legal_entity_id text not null references dao_private.provider_legal_entities(id),
  environment text not null check(environment in ('sandbox','live')),
  params jsonb not null default '{}'::jsonb check(jsonb_typeof(params)='object'),
  lifecycle_state text not null default 'configured' check(lifecycle_state in ('configured','error','suspended')),
  version integer not null default 1 check(version>0),
  created_by uuid not null references auth.users,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(provider_id,manifest_version) references dao_private.provider_manifests(provider_id,manifest_version)
);
create index provider_connections_scope on dao_private.provider_connections(country,legal_entity_id,environment,provider_id);

create table dao_private.provider_checks (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references dao_private.provider_connections(id),
  status text not null check(status in ('unknown','unconfigured','verified','error','simulated')),
  reason_code text not null check(reason_code ~ '^[a-z][a-z0-9_]{2,63}$'),
  checked_by uuid not null references auth.users,
  checked_at timestamptz not null default now()
);
create index provider_checks_latest on dao_private.provider_checks(connection_id,checked_at desc,id desc);

create table dao_private.provider_policies (
  id uuid primary key default gen_random_uuid(),
  category text not null check(category in ('signature','escrow','payment','maps','individual_identity','business_identity','messaging','documents')),
  capability text not null check(capability ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  country text not null check(country='TN'),
  legal_entity_id text not null references dao_private.provider_legal_entities(id),
  environment text not null check(environment in ('sandbox','live')),
  connection_id uuid references dao_private.provider_connections(id),
  version integer not null default 1 check(version>0),
  updated_by uuid not null references auth.users,
  updated_at timestamptz not null default now(),
  unique(category,capability,country,legal_entity_id,environment),
  check(split_part(capability,'.',1)=category)
);

create table dao_private.provider_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users,
  action text not null check(action in ('create_connection','update_connection','test_connection','suspend','resume','set_default')),
  connection_id uuid,
  reason text not null check(length(btrim(reason)) between 5 and 500),
  summary jsonb not null check(jsonb_typeof(summary)='object'),
  registry_version bigint not null,
  created_at timestamptz not null default now()
);
create index provider_events_order on dao_private.provider_events(created_at desc,id desc);

create table dao_private.provider_command_receipts (
  actor_id uuid not null references auth.users,
  idempotency_key uuid not null,
  action text not null,
  payload_sha256 text not null check(payload_sha256 ~ '^[a-f0-9]{64}$'),
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key(actor_id,idempotency_key)
);

alter table dao_private.provider_legal_entities enable row level security;
alter table dao_private.provider_connections enable row level security;
alter table dao_private.provider_checks enable row level security;
alter table dao_private.provider_policies enable row level security;
alter table dao_private.provider_events enable row level security;
alter table dao_private.provider_command_receipts enable row level security;
revoke all on dao_private.provider_legal_entities,dao_private.provider_connections,dao_private.provider_checks,
  dao_private.provider_policies,dao_private.provider_events,dao_private.provider_command_receipts
  from public,anon,authenticated;
grant all on dao_private.provider_legal_entities,dao_private.provider_connections,dao_private.provider_checks,
  dao_private.provider_policies,dao_private.provider_events,dao_private.provider_command_receipts to service_role;

create function dao_private.provider_append_only() returns trigger
language plpgsql set search_path='' as $$
begin
  raise exception using errcode='42501',message='Historique fournisseurs en ajout seul';
end;
$$;
create trigger provider_checks_append_only before update or delete on dao_private.provider_checks
  for each row execute function dao_private.provider_append_only();
create trigger provider_events_append_only before update or delete on dao_private.provider_events
  for each row execute function dao_private.provider_append_only();
create trigger provider_receipts_append_only before update or delete on dao_private.provider_command_receipts
  for each row execute function dao_private.provider_append_only();

create function dao_private.provider_params_valid(p_manifest dao_private.provider_manifests,p_params jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare k text; f jsonb; v jsonb;
begin
  if jsonb_typeof(p_params)<>'object' then return false; end if;
  for k in select jsonb_object_keys(p_params) loop
    select field into f from jsonb_array_elements(p_manifest.fields) as items(field)
      where field->>'key'=k and coalesce((field->>'secret')::boolean,false)=false;
    if f is null then return false; end if;
    v:=p_params->k;
    if (f->>'type'='text' and (jsonb_typeof(v)<>'string' or length(v#>>'{}')>500))
      or (f->>'type'='boolean' and jsonb_typeof(v)<>'boolean')
      or (f->>'type'='number' and jsonb_typeof(v)<>'number')
      or (f->>'type'='enum' and (jsonb_typeof(v)<>'string' or not (f->'options' @> jsonb_build_array(v)))) then
      return false;
    end if;
  end loop;
  for f in select field from jsonb_array_elements(p_manifest.fields) as items(field)
      where coalesce((field->>'required')::boolean,false) and not coalesce((field->>'secret')::boolean,false) loop
    if not p_params ? (f->>'key') then return false; end if;
  end loop;
  return true;
end;
$$;

create function dao_private.provider_connection_state(p_connection dao_private.provider_connections)
returns text language plpgsql stable security definer set search_path='' as $$
declare m dao_private.provider_manifests; c dao_private.provider_checks; active boolean;
begin
  if p_connection.lifecycle_state='suspended' then return 'suspended'; end if;
  if p_connection.lifecycle_state='error' then return 'error'; end if;
  select * into m from dao_private.provider_manifests
    where provider_id=p_connection.provider_id and manifest_version=p_connection.manifest_version;
  select * into c from dao_private.provider_checks where connection_id=p_connection.id
    order by checked_at desc,id desc limit 1;
  if found and c.status='error' then return 'error'; end if;
  if found and c.status='verified' then
    select exists(select 1 from dao_private.provider_policies p where p.connection_id=p_connection.id) into active;
    if active then return case p_connection.environment when 'sandbox' then 'active_sandbox' else 'active_live' end; end if;
    return 'verified';
  end if;
  if m.auth_modes && array['api_key','oauth2','service_account']::text[] then return 'unconfigured'; end if;
  return 'configured';
end;
$$;

create function dao_private.provider_bump_version() returns bigint
language sql security definer set search_path='' as $$
  update dao_private.provider_registry_state set version=version+1,updated_at=now() where singleton returning version;
$$;

create function dao_private.admin_integration_command(p_action text,p_input jsonb,p_idempotency_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; reason text:=btrim(coalesce(p_input->>'reason','')); payload_hash text; prior dao_private.provider_command_receipts;
  result jsonb; registry_version bigint; connection dao_private.provider_connections; manifest dao_private.provider_manifests;
  entity dao_private.provider_legal_entities; expected integer; v_connection_id uuid; check_status text; check_reason text;
  v_category text; v_capability text; v_country text; v_legal_entity text; v_environment text;
  policy dao_private.provider_policies; policy_exists boolean;
begin
  actor:=dao_private.settings_require_admin();
  if p_action not in ('create_connection','update_connection','test_connection','suspend','resume','set_default')
    or p_idempotency_key is null or jsonb_typeof(p_input)<>'object' then
    raise exception using errcode='22023',message='Commande invalide';
  end if;
  if length(reason) not between 5 and 500 then raise exception using errcode='22023',message='Motif obligatoire (5 à 500 caractères)'; end if;
  payload_hash:=encode(sha256(convert_to(p_action||':'||p_input::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended(actor::text||':provider:'||p_idempotency_key::text,0));
  select * into prior from dao_private.provider_command_receipts where actor_id=actor and idempotency_key=p_idempotency_key;
  if found then
    if prior.action<>p_action or prior.payload_sha256<>payload_hash then
      raise exception using errcode='22023',message='Clé idempotente déjà utilisée';
    end if;
    return prior.result;
  end if;

  if p_action='create_connection' then
    select * into manifest from dao_private.provider_manifests where provider_id=p_input->>'provider_id'
      and manifest_version=coalesce(nullif(p_input->>'manifest_version',''),
        (select m.manifest_version from dao_private.provider_manifests m where m.provider_id=p_input->>'provider_id' order by m.created_at desc limit 1));
    if not found or manifest.status<>'installed' then raise exception using errcode='22023',message='Connecteur non installé'; end if;
    select * into entity from dao_private.provider_legal_entities where id=p_input->>'legal_entity_id';
    if not found then raise exception using errcode='22023',message='Périmètre juridique inconnu'; end if;
    v_country:=p_input->>'country';v_environment:=p_input->>'environment';
    if v_country<>entity.country or not (v_country=any(manifest.countries)) or not (v_environment=any(manifest.environments)) then
      raise exception using errcode='22023',message='Marché ou environnement non supporté';
    end if;
    if v_environment='live' then raise exception using errcode='42501',message='Activation LIVE indisponible'; end if;
    if not dao_private.provider_params_valid(manifest,coalesce(p_input->'params','{}'::jsonb)) then
      raise exception using errcode='22023',message='Paramètres non valides';
    end if;
    insert into dao_private.provider_connections(provider_id,manifest_version,alias,country,legal_entity_id,environment,params,created_by)
    values(manifest.provider_id,manifest.manifest_version,btrim(coalesce(p_input->>'alias','')),v_country,entity.id,v_environment,
      coalesce(p_input->'params','{}'::jsonb),actor) returning * into connection;
    registry_version:=dao_private.provider_bump_version();
    insert into dao_private.provider_events(actor_id,action,connection_id,reason,summary,registry_version)
    values(actor,p_action,connection.id,reason,jsonb_build_object('provider_id',connection.provider_id,'alias',connection.alias,
      'country',connection.country,'legal_entity_id',connection.legal_entity_id,'environment',connection.environment),registry_version);
    result:=jsonb_build_object('version',registry_version,'connection_id',connection.id,'connection_version',connection.version);

  elsif p_action in ('update_connection','suspend','resume','test_connection') then
    begin v_connection_id:=(p_input->>'connection_id')::uuid; expected:=(p_input->>'expected_version')::integer;
    exception when others then raise exception using errcode='22023',message='Connexion ou version invalide'; end;
    select * into connection from dao_private.provider_connections where id=v_connection_id for update;
    if not found then raise exception using errcode='22023',message='Connexion inconnue'; end if;
    if p_action<>'test_connection' and (expected is null or expected<>connection.version) then
      raise exception using errcode='40001',message='La connexion a été modifiée';
    end if;
    if p_action='update_connection' then
      select * into manifest from dao_private.provider_manifests where provider_id=connection.provider_id and manifest_version=connection.manifest_version;
      if not dao_private.provider_params_valid(manifest,coalesce(p_input->'params',connection.params)) then
        raise exception using errcode='22023',message='Paramètres non valides';
      end if;
      update dao_private.provider_connections set alias=btrim(coalesce(p_input->>'alias',alias)),
        params=coalesce(p_input->'params',params),version=version+1,updated_at=now() where id=connection.id returning * into connection;
    elsif p_action='suspend' then
      update dao_private.provider_connections set lifecycle_state='suspended',version=version+1,updated_at=now()
        where id=connection.id returning * into connection;
    elsif p_action='resume' then
      update dao_private.provider_connections set lifecycle_state='configured',version=version+1,updated_at=now()
        where id=connection.id returning * into connection;
    else
      select * into manifest from dao_private.provider_manifests where provider_id=connection.provider_id and manifest_version=connection.manifest_version;
      if manifest.auth_modes && array['api_key','oauth2','service_account']::text[] then
        check_status:='unconfigured';check_reason:='credentials_missing';
      elsif not manifest.connection_check_supported then check_status:='unknown';check_reason:='check_not_supported';
      else check_status:='unknown';check_reason:='provider_check_unavailable'; end if;
      insert into dao_private.provider_checks(connection_id,status,reason_code,checked_by)
        values(connection.id,check_status,check_reason,actor);
    end if;
    registry_version:=dao_private.provider_bump_version();
    insert into dao_private.provider_events(actor_id,action,connection_id,reason,summary,registry_version)
    values(actor,p_action,connection.id,reason,jsonb_build_object('connection_version',connection.version,
      'state',dao_private.provider_connection_state(connection),'check_status',check_status,'check_reason',check_reason),registry_version);
    result:=jsonb_strip_nulls(jsonb_build_object('version',registry_version,'connection_id',connection.id,
      'connection_version',connection.version,'check_status',check_status,'check_reason',check_reason));

  else
    v_category:=p_input->>'category';v_capability:=p_input->>'capability';v_country:=p_input->>'country';
    v_legal_entity:=p_input->>'legal_entity_id';v_environment:=p_input->>'environment';
    if split_part(v_capability,'.',1)<>v_category or v_country<>'TN' or v_environment not in ('sandbox','live') then
      raise exception using errcode='22023',message='Politique invalide';
    end if;
    if v_environment='live' then raise exception using errcode='42501',message='Activation LIVE indisponible'; end if;
    begin v_connection_id:=nullif(p_input->>'connection_id','')::uuid;expected:=nullif(p_input->>'expected_version','')::integer;
    exception when others then raise exception using errcode='22023',message='Politique invalide'; end;
    select * into policy from dao_private.provider_policies p where p.category=v_category
      and p.capability=v_capability and p.country=v_country
      and p.legal_entity_id=v_legal_entity and p.environment=v_environment for update;
    policy_exists:=found;
    if policy_exists and expected is distinct from policy.version then raise exception using errcode='40001',message='La politique a été modifiée'; end if;
    if not policy_exists and expected is not null then raise exception using errcode='40001',message='La politique a été modifiée'; end if;
    if v_connection_id is not null then
      select * into connection from dao_private.provider_connections where id=v_connection_id for update;
      if not found or connection.country<>v_country or connection.legal_entity_id<>v_legal_entity or connection.environment<>v_environment
        or connection.lifecycle_state='suspended' then
        raise exception using errcode='42501',message='Connexion non vérifiée ou non éligible';
      end if;
      select * into manifest from dao_private.provider_manifests m
        where m.provider_id=connection.provider_id and m.manifest_version=connection.manifest_version;
      if not (v_capability=any(manifest.capabilities))
        or not exists(select 1 from dao_private.provider_checks c where c.connection_id=connection.id and c.status='verified'
          and not exists(select 1 from dao_private.provider_checks newer where newer.connection_id=c.connection_id
            and (newer.checked_at,newer.id)>(c.checked_at,c.id))) then
        raise exception using errcode='42501',message='Connexion non vérifiée ou non éligible';
      end if;
    end if;
    if policy_exists then
      update dao_private.provider_policies set connection_id=v_connection_id,version=version+1,
        updated_by=actor,updated_at=now() where id=policy.id returning * into policy;
    else
      insert into dao_private.provider_policies(category,capability,country,legal_entity_id,environment,connection_id,updated_by)
      values(v_category,v_capability,v_country,v_legal_entity,v_environment,v_connection_id,actor) returning * into policy;
    end if;
    registry_version:=dao_private.provider_bump_version();
    insert into dao_private.provider_events(actor_id,action,connection_id,reason,summary,registry_version)
    values(actor,p_action,v_connection_id,reason,jsonb_build_object('policy_id',policy.id,'category',v_category,'capability',v_capability,
      'country',v_country,'legal_entity_id',v_legal_entity,'environment',v_environment,'policy_version',policy.version),registry_version);
    result:=jsonb_build_object('version',registry_version,'policy_id',policy.id,'policy_version',policy.version);
  end if;
  insert into dao_private.provider_command_receipts(actor_id,idempotency_key,action,payload_sha256,result)
  values(actor,p_idempotency_key,p_action,payload_hash,result);
  return result;
end;
$$;

alter function dao_private.admin_integrations_overview() rename to admin_integrations_manifest_overview;

create function dao_private.admin_integrations_overview() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare base jsonb;
begin
  perform dao_private.settings_require_admin();
  base:=dao_private.admin_integrations_manifest_overview();
  return base || jsonb_build_object(
    'registry_version',(select version from dao_private.provider_registry_state where singleton),
    'legal_entities',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'label',e.label,'country',e.country,
      'sandbox_only',e.sandbox_only) order by e.label),'[]'::jsonb) from dao_private.provider_legal_entities e),
    'connections',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'provider_id',c.provider_id,'alias',c.alias,
      'category',m.category,'country',c.country,'legal_entity_id',c.legal_entity_id,'environment',c.environment,
      'state',dao_private.provider_connection_state(c),'params',c.params,
      'secrets',case when m.auth_modes && array['api_key','oauth2','service_account']::text[] then
        jsonb_build_array(jsonb_build_object('key','credentials','present',false,'rotated_at',null)) else '[]'::jsonb end,
      'last_check',(select jsonb_build_object('status',x.status,'at',x.checked_at,'reason',x.reason_code)
        from dao_private.provider_checks x where x.connection_id=c.id order by x.checked_at desc,x.id desc limit 1),
      'version',c.version) order by c.created_at,c.id),'[]'::jsonb)
      from dao_private.provider_connections c join dao_private.provider_manifests m
        on m.provider_id=c.provider_id and m.manifest_version=c.manifest_version),
    'policies',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'category',p.category,'capability',p.capability,
      'country',p.country,'legal_entity_id',p.legal_entity_id,'environment',p.environment,
      'connection_id',p.connection_id,'version',p.version) order by p.category,p.capability,p.country,p.legal_entity_id,p.environment),'[]'::jsonb)
      from dao_private.provider_policies p)
  );
end;
$$;

create function dao_private.admin_integration_events(p_connection_id uuid default null,p_limit integer default 50) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform dao_private.settings_require_admin();
  if p_limit is null or p_limit not between 1 and 100 then raise exception using errcode='22023',message='Pagination invalide'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'at',x.created_at,'actor',x.actor,
    'action',x.action,'connection_id',x.connection_id,'reason',x.reason,'summary',x.summary,'version',x.registry_version)
    order by x.created_at desc,x.id desc),'[]'::jsonb) from (
      select e.*,(select p.display_name from public.profiles p where p.user_id=e.actor_id) actor
      from dao_private.provider_events e where p_connection_id is null or e.connection_id=p_connection_id
      order by e.created_at desc,e.id desc limit p_limit
    ) x);
end;
$$;

create function public.admin_integration_command(p_action text,p_input jsonb,p_idempotency_key uuid) returns jsonb
language sql security invoker set search_path='' as $$ select dao_private.admin_integration_command($1,$2,$3); $$;
create function public.admin_integration_events(p_connection_id uuid default null,p_limit integer default 50) returns jsonb
language sql stable security invoker set search_path='' as $$ select dao_private.admin_integration_events($1,$2); $$;

revoke all on function dao_private.provider_append_only(),dao_private.provider_params_valid(dao_private.provider_manifests,jsonb),
  dao_private.provider_connection_state(dao_private.provider_connections),dao_private.provider_bump_version()
  from public,anon,authenticated;
revoke all on function dao_private.admin_integrations_manifest_overview(),dao_private.admin_integrations_overview(),
  dao_private.admin_integration_command(text,jsonb,uuid),dao_private.admin_integration_events(uuid,integer),
  public.admin_integrations_overview(),public.admin_integration_command(text,jsonb,uuid),public.admin_integration_events(uuid,integer)
  from public,anon;
grant execute on function dao_private.admin_integrations_manifest_overview(),dao_private.admin_integrations_overview(),
  dao_private.admin_integration_command(text,jsonb,uuid),dao_private.admin_integration_events(uuid,integer),
  public.admin_integrations_overview(),public.admin_integration_command(text,jsonb,uuid),public.admin_integration_events(uuid,integer)
  to authenticated,service_role;

commit;
