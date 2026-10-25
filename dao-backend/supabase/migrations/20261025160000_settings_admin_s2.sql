begin;

-- #423 Settings S2: Admin overrides, append-only history, server enforcement.
-- A2/A3/A4/A5/A6 (#426): restrictions block NEW actions only; values are
-- prospective (copied into each new object) except anti-spam (live). With no
-- override row the behaviour is exactly the S1/main behaviour.

create table dao_private.setting_overrides (
  id uuid primary key default gen_random_uuid(),
  key text not null references dao_private.setting_definitions(key),
  scope_type text not null check (scope_type in ('global','role','account','project')),
  workspace text check (workspace in ('client','contractor','staff')),
  target_user uuid references auth.users,
  target_project uuid references public.projects,
  value jsonb not null,
  locked boolean not null default false,
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  reason text not null check (length(btrim(reason)) between 5 and 500),
  mandate_id uuid,
  created_by uuid not null references auth.users,
  created_at timestamptz not null default now(),
  superseded_at timestamptz,
  superseded_by uuid references auth.users,
  check (valid_until is null or valid_until > valid_from),
  check (not locked or scope_type = 'global'),
  check ((scope_type = 'global' and workspace is null and target_user is null and target_project is null)
    or (scope_type = 'role' and workspace is not null and target_user is null and target_project is null)
    or (scope_type = 'account' and target_user is not null and target_project is null)
    or (scope_type = 'project' and target_project is not null and target_user is null))
);
create unique index setting_overrides_one_active on dao_private.setting_overrides(key, scope_type,
  coalesce(workspace,''), coalesce(target_user,'00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(target_project,'00000000-0000-0000-0000-000000000000'::uuid)) where superseded_at is null;
create index setting_overrides_account on dao_private.setting_overrides(target_user) where superseded_at is null and target_user is not null;
create index setting_overrides_project on dao_private.setting_overrides(target_project) where superseded_at is null and target_project is not null;

create table dao_private.setting_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  actor_id uuid not null references auth.users,
  action text not null check (action in ('set','clear','trade_active')),
  key text not null,
  scope_type text not null check (scope_type in ('global','role','account','project')),
  workspace text,
  target_user uuid,
  target_project uuid,
  target_ref text,
  old_value jsonb,
  new_value jsonb,
  old_locked boolean,
  new_locked boolean,
  valid_until timestamptz,
  reason text not null,
  mandate_id uuid,
  override_id uuid,
  settings_version bigint not null
);
create index setting_events_order on dao_private.setting_events(created_at desc, id desc);
create index setting_events_key on dao_private.setting_events(key, created_at desc);

alter table dao_private.setting_overrides enable row level security;
alter table dao_private.setting_events enable row level security;
revoke all on dao_private.setting_overrides, dao_private.setting_events from public, anon, authenticated;
grant all on dao_private.setting_overrides, dao_private.setting_events to service_role;

create function dao_private.setting_events_append_only() returns trigger
language plpgsql set search_path='' as $$
begin
  raise exception using errcode='42501', message='Historique des paramètres en ajout seul';
end;
$$;
create trigger setting_events_append_only before update or delete on dao_private.setting_events
  for each row execute function dao_private.setting_events_append_only();

create function dao_private.setting_override_live(o dao_private.setting_overrides) returns boolean
language sql stable set search_path='' as $$
  select o.superseded_at is null and o.valid_from <= now() and (o.valid_until is null or o.valid_until > now());
$$;

-- Values are global in tranche 1: active global override, else code default,
-- always clamped to the coded bounds (A6).
create function dao_private.setting_global_int(p_key text) returns integer
language sql stable security definer set search_path='' as $$
  select greatest(d.min_value, least(d.max_value, coalesce(
    (select (o.value#>>'{}')::integer from dao_private.setting_overrides o
      where o.key=d.key and o.scope_type='global' and dao_private.setting_override_live(o)),
    (d.default_value#>>'{}')::integer)))
  from dao_private.setting_definitions d where d.key=p_key and d.value_type='int';
$$;

-- Deterministic resolution (#423 S0 §3.4). Precedence for a default:
-- global (or global locked: final) < role < account/project. For capabilities
-- restrictions accumulate (any specific OFF wins); a positive exception can only
-- lift a default, never a lock or another restriction. Never grants RLS access.
create or replace function dao_private.resolve_setting(p_key text, p_user uuid, p_workspace text, p_project uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare d dao_private.setting_definitions; v jsonb; src text:='default'; o dao_private.setting_overrides;
  required text; req jsonb; condition text; owner jsonb; restricted text; opened text; narrowed jsonb;
begin
  select * into d from dao_private.setting_definitions where key=p_key and not retired;
  if not found then
    raise exception using errcode='22023', message='Paramètre inconnu';
  end if;
  if not dao_private.account_active(p_user) then
    return jsonb_build_object('value',d.default_value,'state','unavailable','source','default','reason','account_inactive');
  end if;
  if not d.implemented then
    return jsonb_build_object('value',d.default_value,'state','unavailable','source','default','reason','not_implemented');
  end if;
  if d.family='federated' then
    v:=dao_private.setting_federated_value(d.key,p_user,p_workspace,p_project);
    return jsonb_build_object('value',coalesce(v,d.default_value),'state','owner_choice',
      'source',case when v is null then 'default' else 'owner' end);
  end if;
  v:=d.default_value;
  select * into o from dao_private.setting_overrides x
    where x.key=d.key and x.scope_type='global' and dao_private.setting_override_live(x);
  if found then
    v:=o.value; src:=case when o.locked then 'global_locked' else 'global' end;
  end if;
  if src <> 'global_locked' then
    select * into o from dao_private.setting_overrides x
      where x.key=d.key and x.scope_type='role' and x.workspace=p_workspace and dao_private.setting_override_live(x);
    if found then v:=o.value; src:='role'; end if;
    if d.family='value' then
      select * into o from dao_private.setting_overrides x
        where x.key=d.key and dao_private.setting_override_live(x) and (x.workspace is null or x.workspace=p_workspace)
          and ((x.scope_type='project' and x.target_project=p_project) or (x.scope_type='account' and x.target_user=p_user))
        order by case x.scope_type when 'project' then 0 else 1 end limit 1;
      if found then v:=o.value; src:=o.scope_type; end if;
      v:=to_jsonb(greatest(d.min_value,least(d.max_value,(v#>>'{}')::integer)));
    else
      for o in select * from dao_private.setting_overrides x
          where x.key=d.key and dao_private.setting_override_live(x) and (x.workspace is null or x.workspace=p_workspace)
            and ((x.scope_type='project' and p_project is not null and x.target_project=p_project)
              or (x.scope_type='account' and x.target_user=p_user))
          order by case x.scope_type when 'account' then 0 else 1 end loop
        if d.value_type='enum_set' then
          select coalesce(jsonb_agg(e order by ord),'[]'::jsonb) into narrowed
            from jsonb_array_elements(v) with ordinality as t(e,ord) where o.value @> jsonb_build_array(e);
          if narrowed <> v then v:=narrowed; src:=o.scope_type; end if;
        elsif o.value='false'::jsonb then restricted:=coalesce(restricted,o.scope_type);
        elsif v='false'::jsonb then opened:=coalesce(opened,o.scope_type);
        end if;
      end loop;
      if restricted is not null then v:='false'::jsonb; src:=restricted;
      elsif opened is not null then v:='true'::jsonb; src:=opened;
      end if;
    end if;
  end if;
  foreach condition in array d.conditions loop
    if not dao_private.setting_condition_met(condition) then
      return jsonb_build_object('value',v,'state','unavailable','source',src,'reason','not_configured');
    end if;
  end loop;
  foreach required in array d.requires loop
    req:=dao_private.resolve_setting(required,p_user,p_workspace,p_project);
    if req->>'state' <> 'available' then
      return jsonb_build_object('value',v,'state','unavailable','source',src,'reason','depends_on','requires',required);
    end if;
  end loop;
  if d.family='capability' and (v='false'::jsonb or v='[]'::jsonb) then
    return jsonb_build_object('value',v,'state','unavailable','source',src,'reason','restricted');
  end if;
  if d.owner_choice is not null and p_workspace='contractor' then
    owner:=dao_private.setting_federated_value(d.owner_choice,p_user,p_workspace,p_project);
    return jsonb_build_object('value',v,'state','available','source',src,'owner_choice',
      coalesce(owner,(select x.default_value from dao_private.setting_definitions x where x.key=d.owner_choice)));
  end if;
  return jsonb_build_object('value',v,'state','available','source',src);
end;
$$;

-- DTO builder shared by self-read and Admin preview (no authorisation here).
create function dao_private.effective_settings_for(p_user uuid, p_workspace text, p_project uuid, p_detailed boolean) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare key text; entry jsonb; entries jsonb:='{}'::jsonb; state dao_private.settings_state;
begin
  select * into state from dao_private.settings_state where singleton;
  for key in select d.key from dao_private.setting_definitions d
      where not d.retired and d.family <> 'catalog' and p_workspace = any(d.workspaces)
        and (d.key <> 'project.contract_enabled' or (p_project is not null and p_workspace='client'))
      order by d.key loop
    entry:=dao_private.resolve_setting(key,p_user,p_workspace,p_project);
    -- A10: Clients/Artisans never learn whether a restriction targets them.
    if not p_detailed and entry->>'source' not in ('default','owner') then
      entry:=jsonb_set(entry,'{source}','"platform"');
    end if;
    entries:=entries||jsonb_build_object(key,entry);
  end loop;
  return jsonb_build_object('catalog_version',state.catalog_version,'version',state.version,
    'workspace',p_workspace,'project_id',p_project,'settings',entries);
end;
$$;

create or replace function dao_private.my_effective_settings(p_workspace text default null, p_project_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare ws text;
begin
  ws:=dao_private.settings_workspace(p_workspace);
  if p_project_id is not null and not dao_private.settings_project_allowed(ws,p_project_id) then
    raise exception using errcode='42501', message='Chantier non accessible';
  end if;
  return dao_private.effective_settings_for(auth.uid(),ws,p_project_id,ws='staff');
end;
$$;

-- Writers. S2/S3: dao_admin only. S4 adds explicit manager mandates.
create function dao_private.settings_require_admin() returns uuid
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not dao_private.admin() then
    raise exception using errcode='42501', message='Administrateur D.A.O actif requis';
  end if;
  return auth.uid();
end;
$$;

create function dao_private.settings_bump_version() returns bigint
language sql security definer set search_path='' as $$
  update dao_private.settings_state set version=version+1, updated_at=now() where singleton returning version;
$$;

create function dao_private.setting_value_valid(d dao_private.setting_definitions, p_value jsonb) returns boolean
language sql immutable set search_path='' as $$
  select coalesce(case d.value_type
    when 'boolean' then jsonb_typeof(p_value)='boolean'
    when 'int' then case when jsonb_typeof(p_value)='number' and (p_value#>>'{}') ~ '^-?[0-9]{1,9}$'
      then (p_value#>>'{}')::integer between d.min_value and d.max_value else false end
    when 'enum_set' then case when jsonb_typeof(p_value)='array' and jsonb_array_length(p_value) >= coalesce(d.min_items,0)
      then (select coalesce(bool_and(jsonb_typeof(e)='string' and (e#>>'{}') = any(d.allowed_values)),true) and count(distinct e)=count(*)
        from jsonb_array_elements(p_value) e) else false end
    else false end,false);
$$;

-- Single audited write path. p_action: 'set' or 'clear'. Input keys: key, scope
-- (global|role|account|project), workspace, user_id, project_id, value, locked,
-- valid_until, reason, expected_override_id (optimistic concurrency).
create function dao_private.apply_setting_change(p_actor uuid, p_mandate uuid, p_action text, p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d dao_private.setting_definitions; v_scope text:=p_input->>'scope'; v_ws text:=nullif(p_input->>'workspace','');
  v_user uuid; v_project uuid; v_value jsonb:=p_input->'value'; v_locked boolean:=coalesce((p_input->>'locked')::boolean,false);
  v_until timestamptz; v_reason text:=btrim(coalesce(p_input->>'reason','')); v_current dao_private.setting_overrides;
  v_inserted dao_private.setting_overrides; v_global dao_private.setting_overrides; v_ver bigint; v_other dao_private.setting_definitions;
  v_other_value integer;
begin
  if p_action not in ('set','clear') then raise exception using errcode='22023', message='Action invalide'; end if;
  select * into d from dao_private.setting_definitions where key=p_input->>'key' and not retired;
  if not found or d.family not in ('capability','value') or not d.implemented then
    raise exception using errcode='22023', message='Paramètre non modifiable';
  end if;
  if v_scope is null or not (v_scope = any(d.scopes)) then raise exception using errcode='22023', message='Portée non autorisée pour ce paramètre'; end if;
  begin
    v_user:=nullif(p_input->>'user_id','')::uuid; v_project:=nullif(p_input->>'project_id','')::uuid;
    v_until:=nullif(p_input->>'valid_until','')::timestamptz;
  exception when others then raise exception using errcode='22023', message='Cible ou échéance invalide';
  end;
  if length(v_reason) not between 5 and 500 then raise exception using errcode='22023', message='Motif obligatoire (5 à 500 caractères)'; end if;
  if v_scope='global' and (v_ws is not null or v_user is not null or v_project is not null)
     or v_scope='role' and (v_ws is null or v_user is not null or v_project is not null)
     or v_scope='account' and (v_user is null or v_project is not null)
     or v_scope='project' and (v_project is null or v_user is not null) then
    raise exception using errcode='22023', message='Cible incohérente avec la portée';
  end if;
  if v_ws is not null and not (v_ws = any(d.workspaces)) then raise exception using errcode='22023', message='Espace non concerné par ce paramètre'; end if;
  if v_user is not null and not exists(select 1 from public.user_roles r where r.user_id=v_user
      and r.role = any(case when v_ws is null then d.workspaces else array[v_ws] end)) then
    raise exception using errcode='22023', message='Compte non concerné par ce paramètre';
  end if;
  if v_project is not null and not exists(select 1 from public.projects p where p.id=v_project) then
    raise exception using errcode='22023', message='Chantier introuvable';
  end if;
  perform 1 from dao_private.settings_state where singleton for update;
  select * into v_current from dao_private.setting_overrides o where o.key=d.key and o.scope_type=v_scope
    and o.workspace is not distinct from v_ws and o.target_user is not distinct from v_user
    and o.target_project is not distinct from v_project and o.superseded_at is null;
  if v_current.id is distinct from nullif(p_input->>'expected_override_id','')::uuid then
    raise exception using errcode='40001', message='Paramètre modifié entre-temps : rechargez avant de réessayer';
  end if;
  if p_action='clear' then
    if v_current.id is null then raise exception using errcode='22023', message='Aucune surcharge active à retirer'; end if;
  else
    if not dao_private.setting_value_valid(d,v_value) then raise exception using errcode='22023', message='Valeur hors du type ou des bornes'; end if;
    if v_locked and v_scope <> 'global' then raise exception using errcode='22023', message='Seule une valeur globale peut être verrouillée'; end if;
    if v_until is not null and v_until <= now() then raise exception using errcode='22023', message='Échéance déjà passée'; end if;
    if v_until is not null and v_scope in ('global','role') then raise exception using errcode='22023', message='Échéance réservée aux exceptions compte ou chantier'; end if;
    if v_scope in ('account','project') then
      select * into v_global from dao_private.setting_overrides o where o.key=d.key and o.scope_type='global' and dao_private.setting_override_live(o);
      if v_global.locked then raise exception using errcode='23514', message='Valeur globale verrouillée : aucune exception possible'; end if;
      -- A3: a positive exception is Admin-only and always temporary.
      if v_value='true'::jsonb and (p_mandate is not null or v_until is null) then
        raise exception using errcode='23514', message='Exception positive : Administrateur, motif et échéance obligatoires';
      end if;
    end if;
    -- Cross-key bounds (e.g. reminder strictly before invitation expiry).
    if d.less_than is not null then
      v_other_value:=dao_private.setting_global_int(d.less_than->>'key');
      if (v_value#>>'{}')::integer >= v_other_value*(d.less_than->>'factor')::integer then
        raise exception using errcode='23514', message='Valeur incompatible avec '||(d.less_than->>'key');
      end if;
    end if;
    for v_other in select * from dao_private.setting_definitions x where x.less_than->>'key'=d.key and not x.retired loop
      if dao_private.setting_global_int(v_other.key) >= (v_value#>>'{}')::integer*(v_other.less_than->>'factor')::integer then
        raise exception using errcode='23514', message='Valeur incompatible avec '||v_other.key;
      end if;
    end loop;
  end if;
  if v_current.id is not null then
    update dao_private.setting_overrides set superseded_at=now(), superseded_by=p_actor where id=v_current.id;
  end if;
  if p_action='set' then
    insert into dao_private.setting_overrides(key,scope_type,workspace,target_user,target_project,value,locked,
      valid_until,reason,mandate_id,created_by)
    values(d.key,v_scope,v_ws,v_user,v_project,v_value,v_locked,v_until,v_reason,p_mandate,p_actor)
    returning * into v_inserted;
  end if;
  v_ver:=dao_private.settings_bump_version();
  insert into dao_private.setting_events(actor_id,action,key,scope_type,workspace,target_user,target_project,
    old_value,new_value,old_locked,new_locked,valid_until,reason,mandate_id,override_id,settings_version)
  values(p_actor,p_action,d.key,v_scope,v_ws,v_user,v_project,v_current.value,v_inserted.value,v_current.locked,
    v_inserted.locked,v_inserted.valid_until,v_reason,p_mandate,coalesce(v_inserted.id,v_current.id),v_ver);
  return jsonb_build_object('override_id',v_inserted.id,'version',v_ver);
end;
$$;

create function dao_private.admin_setting_command(p_action text, p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  return dao_private.apply_setting_change(dao_private.settings_require_admin(),null,p_action,p_input);
end;
$$;

-- Admin referential: activate/deactivate an existing trade (historic lots untouched).
create function dao_private.admin_set_trade_active(p_trade_id uuid, p_active boolean, p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=dao_private.settings_require_admin(); t public.trades; ver bigint;
begin
  if p_active is null or length(btrim(coalesce(p_reason,''))) not between 5 and 500 then
    raise exception using errcode='22023', message='Motif obligatoire (5 à 500 caractères)';
  end if;
  select * into t from public.trades where id=p_trade_id for update;
  if not found then raise exception using errcode='22023', message='Métier introuvable'; end if;
  if t.active = p_active then return jsonb_build_object('trade_id',t.id,'active',t.active,'changed',false); end if;
  update public.trades set active=p_active where id=t.id;
  ver:=dao_private.settings_bump_version();
  insert into dao_private.setting_events(actor_id,action,key,scope_type,target_ref,old_value,new_value,reason,settings_version)
  values(actor,'trade_active','catalog.trades.active','global',t.code,to_jsonb(t.active),to_jsonb(p_active),btrim(p_reason),ver);
  return jsonb_build_object('trade_id',t.id,'active',p_active,'changed',true,'version',ver);
end;
$$;

create function dao_private.settings_target_label(p_user uuid, p_project uuid) returns text
language sql stable security definer set search_path='' as $$
  select coalesce(
    (select p.display_name from public.profiles p where p.user_id=p_user),
    (select v.title from public.project_versions v where v.project_id=p_project order by v.version_no desc limit 1));
$$;

create function dao_private.admin_settings_overview() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare state dao_private.settings_state;
begin
  perform dao_private.settings_require_admin();
  select * into state from dao_private.settings_state where singleton;
  return jsonb_build_object('catalog_version',state.catalog_version,'version',state.version,
    'definitions',(select coalesce(jsonb_agg(jsonb_build_object('key',d.key,'family',d.family,'type',d.value_type,
        'default',d.default_value,'min',d.min_value,'max',d.max_value,'values',d.allowed_values,'scopes',d.scopes,
        'workspaces',d.workspaces,'delegable',d.delegable,'effect',d.effect,'sensitivity',d.sensitivity,
        'implemented',d.implemented,'source',d.source,
        'global_value',case when d.value_type='int' then to_jsonb(dao_private.setting_global_int(d.key)) end) order by d.key),'[]')
      from dao_private.setting_definitions d where not d.retired),
    'overrides',(select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'key',o.key,'scope',o.scope_type,
        'workspace',o.workspace,'user_id',o.target_user,'project_id',o.target_project,
        'target_label',dao_private.settings_target_label(o.target_user,o.target_project),'value',o.value,'locked',o.locked,
        'valid_until',o.valid_until,'live',dao_private.setting_override_live(o),'reason',o.reason,
        'mandate_id',o.mandate_id,'created_at',o.created_at) order by o.key,o.scope_type,o.created_at),'[]')
      from dao_private.setting_overrides o where o.superseded_at is null),
    'trades',(select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'code',t.code,'name',t.name_fr,'active',t.active) order by t.name_fr),'[]')
      from public.trades t));
end;
$$;

create function dao_private.admin_settings_history(p_key text default null, p_limit integer default 50,
  p_before timestamptz default null, p_before_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform dao_private.settings_require_admin();
  if p_limit is null or p_limit not between 1 and 100 or (p_before is null) <> (p_before_id is null) then
    raise exception using errcode='22023', message='Pagination invalide';
  end if;
  return (select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.created_at desc,x.id desc),'[]')
    from (select e.id,e.created_at,e.action,e.key,e.scope_type as scope,e.workspace,e.target_user as user_id,
        e.target_project as project_id,e.target_ref,dao_private.settings_target_label(e.target_user,e.target_project) as target_label,
        e.old_value,e.new_value,e.old_locked,e.new_locked,e.valid_until,e.reason,e.mandate_id,e.settings_version as version,
        (select p.display_name from public.profiles p where p.user_id=e.actor_id) as actor
      from dao_private.setting_events e
      where (p_key is null or e.key=p_key) and (p_before is null or (e.created_at,e.id) < (p_before,p_before_id))
      order by e.created_at desc,e.id desc limit p_limit) x);
end;
$$;

-- "Voir comme" without mutation: settings only, never the account's data.
create function dao_private.admin_preview_settings(p_user uuid, p_workspace text, p_project_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform dao_private.settings_require_admin();
  if p_workspace not in ('client','contractor') or not exists(select 1 from public.user_roles r
      where r.user_id=p_user and r.role=p_workspace) then
    raise exception using errcode='22023', message='Compte ou espace invalide';
  end if;
  return dao_private.effective_settings_for(p_user,p_workspace,p_project_id,true);
end;
$$;

-- ===== Server enforcement (A4/A5): the same resolver guards new actions. =====

create function dao_private.require_setting(p_key text, p_user uuid, p_workspace text, p_project uuid) returns void
language plpgsql stable security definer set search_path='' as $$
begin
  -- Inactive accounts are refused by the existing commands/RLS with their own errors.
  if p_user is null or not dao_private.account_active(p_user) then return; end if;
  if dao_private.resolve_setting(p_key,p_user,p_workspace,p_project)->>'state' <> 'available' then
    raise exception using errcode='42501', message='Option non disponible pour ce dossier. Contactez l''assistance.',
      hint='setting_restricted:'||p_key;
  end if;
end;
$$;

create function dao_private.settings_actor_workspace(p_user uuid, p_project uuid) returns text
language sql stable security definer set search_path='' as $$
  select case when exists(select 1 from public.projects p where p.id=p_project and p.client_id=p_user)
    or exists(select 1 from public.project_members m where m.project_id=p_project and m.user_id=p_user
      and m.participation_role='client' and m.status='accepted') then 'client' else 'contractor' end;
$$;

create function dao_private.contractor_user(p_contractor uuid) returns uuid
language sql stable security definer set search_path='' as $$
  select c.user_id from public.contractor_profiles c where c.id=p_contractor;
$$;

create function dao_private.settings_guard_invitation() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.projects p where p.id=new.project_id and p.client_id=new.created_by) then
    perform dao_private.require_setting('client.invite_professionals',new.created_by,'client',new.project_id);
  end if;
  -- Prospective TTL: the commands compute now()+7 days; now() is the transaction
  -- timestamp, so only that exact default is replaced by the configured value.
  if new.expires_at = now() + interval '7 days' then
    new.expires_at:=now()+make_interval(days=>dao_private.setting_global_int('invitations.ttl_days'));
  end if;
  return new;
end;
$$;
create trigger settings_guard before insert on public.project_invitations
  for each row execute function dao_private.settings_guard_invitation();

create function dao_private.settings_guard_publication() returns trigger
language plpgsql security definer set search_path='' as $$
declare client uuid; modes jsonb;
begin
  select p.client_id into client from public.projects p where p.id=new.project_id;
  if client is not null and dao_private.account_active(client) then
    modes:=dao_private.resolve_setting('publication.visibility_modes',client,'client',new.project_id);
    if modes->>'state' <> 'available' or not (modes->'value' @> to_jsonb(new.visibility)) then
      raise exception using errcode='42501', message='Mode de publication non disponible pour ce dossier. Contactez l''assistance.',
        hint='setting_restricted:publication.visibility_modes';
    end if;
  end if;
  return new;
end;
$$;
create trigger settings_guard before insert on public.publications
  for each row execute function dao_private.settings_guard_publication();

create function dao_private.settings_guard_rfi_question() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform dao_private.require_setting('bids.rfi',new.author_id,
    dao_private.settings_actor_workspace(new.author_id,new.project_id),new.project_id);
  return new;
end;
$$;
create trigger settings_guard before insert on public.technical_questions
  for each row execute function dao_private.settings_guard_rfi_question();

create function dao_private.settings_guard_counter() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform dao_private.require_setting('bids.counter_proposals',new.client_id,'client',new.project_id);
  perform dao_private.require_setting('bids.counter_proposals',new.contractor_user_id,'contractor',new.project_id);
  return new;
end;
$$;
create trigger settings_guard before insert on dao_private.bid_counter_proposals
  for each row execute function dao_private.settings_guard_counter();

create function dao_private.settings_guard_bid_item() returns trigger
language plpgsql security definer set search_path='' as $$
declare version public.bid_versions;
begin
  select * into version from public.bid_versions v where v.id=new.bid_version_id;
  -- A second lot in a version is a multi-lot offer, unless an earlier version
  -- of the same bid already covered several lots (continuation, A4/A5).
  if exists(select 1 from public.bid_items i where i.bid_version_id=new.bid_version_id and i.request_version_id<>new.request_version_id)
     and not exists(select 1 from public.bid_versions pv join public.bid_items pi on pi.bid_version_id=pv.id
       where pv.bid_id=version.bid_id and pv.id<>version.id
       group by pv.id having count(distinct pi.request_version_id)>1) then
    perform dao_private.require_setting('bids.multi_lot',dao_private.contractor_user(version.contractor_id),'contractor',version.project_id);
  end if;
  return new;
end;
$$;
create trigger settings_guard before insert on public.bid_items
  for each row execute function dao_private.settings_guard_bid_item();

create function dao_private.settings_guard_bid_group() returns trigger
language plpgsql security definer set search_path='' as $$
declare version public.bid_versions;
begin
  if new.indivisible then
    select * into version from public.bid_versions v where v.id=new.bid_version_id;
    perform dao_private.require_setting('bids.multi_lot',dao_private.contractor_user(version.contractor_id),'contractor',version.project_id);
  end if;
  return new;
end;
$$;
create trigger settings_guard before insert on public.bid_groups
  for each row execute function dao_private.settings_guard_bid_group();

create function dao_private.settings_guard_bid_document() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform dao_private.require_setting('bids.quote_pdf',dao_private.contractor_user(new.contractor_id),'contractor',new.project_id);
  return new;
end;
$$;
create trigger settings_guard before insert on public.bid_documents
  for each row execute function dao_private.settings_guard_bid_document();

create function dao_private.settings_guard_quote_line() returns trigger
language plpgsql security definer set search_path='' as $$
declare version public.bid_versions;
begin
  select * into version from public.bid_versions v where v.id=new.bid_version_id;
  perform dao_private.require_setting('bids.quote_lines',dao_private.contractor_user(version.contractor_id),'contractor',version.project_id);
  return new;
end;
$$;
create trigger settings_guard before insert on public.bid_quote_lines
  for each row execute function dao_private.settings_guard_quote_line();

create function dao_private.settings_guard_bid_sub_lot() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform dao_private.require_setting('bids.proposed_sub_lots',dao_private.contractor_user(new.contractor_id),'contractor',new.project_id);
  return new;
end;
$$;
create trigger settings_guard before insert on public.bid_sub_lots
  for each row execute function dao_private.settings_guard_bid_sub_lot();

create function dao_private.settings_guard_contract_setting() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  -- Turning the option OFF is always allowed; an existing ON choice is never rewritten.
  if new.enabled and (tg_op='INSERT' or not old.enabled) then
    perform dao_private.require_setting('contract.preparation_after_award',
      (select p.client_id from public.projects p where p.id=new.project_id),'client',new.project_id);
  end if;
  return new;
end;
$$;
create trigger settings_guard before insert or update on public.project_contract_settings
  for each row execute function dao_private.settings_guard_contract_setting();

create function dao_private.settings_guard_precontract() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform dao_private.require_setting('contract.precontract_agreement',new.client_id,'client',new.project_id);
  perform dao_private.require_setting('contract.precontract_agreement',new.contractor_user_id,'contractor',new.project_id);
  return new;
end;
$$;
create trigger settings_guard before insert on public.precontract_agreements
  for each row execute function dao_private.settings_guard_precontract();

create function dao_private.settings_guard_bid_version() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  -- Prospective default window: replaces only the coded now()+30 days fallback.
  if new.expires_at = now() + interval '30 days' and (new.publication_id is null
      or (select p.submission_deadline from public.publications p where p.id=new.publication_id) is null) then
    new.expires_at:=now()+make_interval(days=>dao_private.setting_global_int('publication.default_submission_days'));
  end if;
  return new;
end;
$$;
create trigger settings_guard before insert on public.bid_versions
  for each row execute function dao_private.settings_guard_bid_version();

-- A6: configured upload ceiling, never above the coded 20 MB physical limit.
create function dao_private.settings_guard_upload_size() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.size_bytes > dao_private.setting_global_int('uploads.max_file_mb')::bigint*1048576 then
    raise exception using errcode='22023', message='Fichier trop volumineux pour la limite actuelle de la plateforme',
      hint='setting_limit:uploads.max_file_mb';
  end if;
  return new;
end;
$$;
do $$ declare t record; begin
  for t in select c.table_schema, c.table_name from information_schema.columns c
      join information_schema.tables x on x.table_schema=c.table_schema and x.table_name=c.table_name and x.table_type='BASE TABLE'
      where c.table_schema='public' and c.column_name='size_bytes' and c.table_name <> 'contract_archives'
      order by c.table_name loop
    execute format('create trigger settings_upload_size before insert on %I.%I for each row execute function dao_private.settings_guard_upload_size()',
      t.table_schema,t.table_name);
  end loop;
end $$;

-- Coded constants replaced in place by the configured value (exact, counted).
create function dao_private.settings_patch_function(p_signature regprocedure, p_from text, p_to text, p_expected integer) returns void
language plpgsql set search_path='' as $$
declare def text:=pg_get_functiondef(p_signature); found integer;
begin
  found:=(length(def)-length(replace(def,p_from,'')))/length(p_from);
  if found <> p_expected then
    raise exception 'settings patch: % occurrences of % in %, expected %', found, p_from, p_signature, p_expected;
  end if;
  execute replace(def,p_from,p_to);
end;
$$;
select dao_private.settings_patch_function('dao_private.send_conversation_message(uuid,text,uuid)'::regprocedure,
  ')>=20 then', ')>=dao_private.setting_global_int(''messaging.max_per_minute'') then', 1);
select dao_private.settings_patch_function('dao_private.respond_to_contractor_review(uuid,text)'::regprocedure,
  'interval ''30 days''', 'make_interval(days=>dao_private.setting_global_int(''reviews.response_edit_days''))', 1);
select dao_private.settings_patch_function('dao_private.my_received_reviews()'::regprocedure,
  'interval ''30 days''', 'make_interval(days=>dao_private.setting_global_int(''reviews.response_edit_days''))', 1);
select dao_private.settings_patch_function(p.oid::regprocedure, 'interval ''24 hours''',
    'make_interval(hours=>dao_private.setting_global_int(''invitations.reminder_hours_before''))', expected)
  from (values ('invitation_expiry_reminder_allowed',1),('dry_run_invitation_expiry_reminders',1),
    ('generate_invitation_expiry_reminders',2)) as f(name,expected)
  join pg_proc p on p.proname=f.name join pg_namespace n on n.oid=p.pronamespace and n.nspname='dao_private';
drop function dao_private.settings_patch_function(regprocedure,text,text,integer);

-- Public wrappers (JWT path).
create function public.admin_setting_command(p_action text, p_input jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select dao_private.admin_setting_command($1,$2); $$;
create function public.admin_set_trade_active(p_trade_id uuid, p_active boolean, p_reason text) returns jsonb
language sql security invoker set search_path='' as $$ select dao_private.admin_set_trade_active($1,$2,$3); $$;
create function public.admin_settings_overview() returns jsonb
language sql stable security invoker set search_path='' as $$ select dao_private.admin_settings_overview(); $$;
create function public.admin_settings_history(p_key text default null, p_limit integer default 50,
  p_before timestamptz default null, p_before_id uuid default null) returns jsonb
language sql stable security invoker set search_path='' as $$ select dao_private.admin_settings_history($1,$2,$3,$4); $$;
create function public.admin_preview_settings(p_user uuid, p_workspace text, p_project_id uuid default null) returns jsonb
language sql stable security invoker set search_path='' as $$ select dao_private.admin_preview_settings($1,$2,$3); $$;

revoke all on function dao_private.setting_events_append_only(), dao_private.setting_override_live(dao_private.setting_overrides),
  dao_private.setting_global_int(text), dao_private.effective_settings_for(uuid,text,uuid,boolean),
  dao_private.settings_require_admin(), dao_private.settings_bump_version(),
  dao_private.setting_value_valid(dao_private.setting_definitions,jsonb),
  dao_private.apply_setting_change(uuid,uuid,text,jsonb), dao_private.settings_target_label(uuid,uuid),
  dao_private.require_setting(text,uuid,text,uuid), dao_private.settings_actor_workspace(uuid,uuid),
  dao_private.contractor_user(uuid), dao_private.settings_guard_invitation(), dao_private.settings_guard_publication(),
  dao_private.settings_guard_rfi_question(), dao_private.settings_guard_counter(), dao_private.settings_guard_bid_item(),
  dao_private.settings_guard_bid_group(), dao_private.settings_guard_bid_document(), dao_private.settings_guard_quote_line(),
  dao_private.settings_guard_bid_sub_lot(), dao_private.settings_guard_contract_setting(), dao_private.settings_guard_precontract(),
  dao_private.settings_guard_bid_version(), dao_private.settings_guard_upload_size()
  from public, anon, authenticated;
grant execute on function dao_private.setting_global_int(text) to service_role;
revoke all on function dao_private.admin_setting_command(text,jsonb), dao_private.admin_set_trade_active(uuid,boolean,text),
  dao_private.admin_settings_overview(), dao_private.admin_settings_history(text,integer,timestamptz,uuid),
  dao_private.admin_preview_settings(uuid,text,uuid),
  public.admin_setting_command(text,jsonb), public.admin_set_trade_active(uuid,boolean,text),
  public.admin_settings_overview(), public.admin_settings_history(text,integer,timestamptz,uuid),
  public.admin_preview_settings(uuid,text,uuid)
  from public, anon;
grant execute on function dao_private.admin_setting_command(text,jsonb), dao_private.admin_set_trade_active(uuid,boolean,text),
  dao_private.admin_settings_overview(), dao_private.admin_settings_history(text,integer,timestamptz,uuid),
  dao_private.admin_preview_settings(uuid,text,uuid),
  public.admin_setting_command(text,jsonb), public.admin_set_trade_active(uuid,boolean,text),
  public.admin_settings_overview(), public.admin_settings_history(text,integer,timestamptz,uuid),
  public.admin_preview_settings(uuid,text,uuid)
  to authenticated, service_role;

commit;
