begin;

-- #426 Settings S1: typed catalogue mirror and read-only central resolver.
-- Definitions are generated from dao-backend/src/settings/catalog.ts; the
-- database never accepts a free key from a user. No override, mandate or
-- command enforcement exists yet: every value equals today's behaviour.

create table dao_private.setting_definitions (
  key text primary key check (key ~ '^[a-z]+(\.[a-z_]+)+$'),
  family text not null check (family in ('capability','value','catalog','federated')),
  value_type text not null check (value_type in ('boolean','int','enum_set','enum','flags')),
  default_value jsonb not null,
  min_value integer,
  max_value integer,
  allowed_values text[],
  min_items integer,
  scopes text[] not null,
  workspaces text[] not null,
  delegable boolean not null,
  effect text not null check (effect in ('prospective','live')),
  sensitivity text not null check (sensitivity in ('normal','sensitive')),
  requires text[] not null,
  conditions text[] not null,
  less_than jsonb,
  owner_choice text,
  source text,
  implemented boolean not null,
  retired boolean not null default false,
  catalog_version integer not null check (catalog_version > 0),
  check (scopes <@ array['global','role','account','project']::text[]),
  check (workspaces <@ array['client','contractor','staff']::text[]),
  check (value_type <> 'int' or (min_value is not null and max_value is not null and min_value <= max_value)),
  check (not delegable or family = 'capability'),
  check ((family = 'federated') = (source is not null and family <> 'catalog') or family = 'catalog')
);

create table dao_private.settings_state (
  singleton boolean primary key default true check (singleton),
  catalog_version integer not null check (catalog_version > 0),
  catalog_hash text not null check (catalog_hash ~ '^[0-9a-f]{64}$'),
  -- Cache key: incremented on every catalogue sync and (from S2) every override change.
  version bigint not null default 1 check (version > 0),
  updated_at timestamptz not null default now()
);

alter table dao_private.setting_definitions enable row level security;
alter table dao_private.settings_state enable row level security;
revoke all on dao_private.setting_definitions, dao_private.settings_state from public, anon, authenticated;
grant all on dao_private.setting_definitions, dao_private.settings_state to service_role;

-- Only migrations call this: it mirrors the code catalogue. Removed keys are
-- retired (kept for history and future overrides), never deleted.
create function dao_private.sync_setting_definitions(p_version integer, p_hash text, p_catalog jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare item jsonb;
begin
  if p_version is null or p_version < 1 or p_hash !~ '^[0-9a-f]{64}$' or jsonb_typeof(p_catalog) <> 'array' then
    raise exception using errcode='22023', message='Catalogue de paramètres invalide';
  end if;
  if exists(select 1 from dao_private.settings_state where catalog_version > p_version) then
    raise exception using errcode='23514', message='Version de catalogue antérieure à la version installée';
  end if;
  for item in select value from jsonb_array_elements(p_catalog) loop
    insert into dao_private.setting_definitions(key,family,value_type,default_value,min_value,max_value,allowed_values,
      min_items,scopes,workspaces,delegable,effect,sensitivity,requires,conditions,less_than,owner_choice,source,
      implemented,retired,catalog_version)
    values(item->>'key',item->>'family',item->>'type',item->'default',(item->>'min')::integer,(item->>'max')::integer,
      case when jsonb_typeof(item->'values')='array' then array(select jsonb_array_elements_text(item->'values')) end,
      (item->>'min_items')::integer,array(select jsonb_array_elements_text(item->'scopes')),
      array(select jsonb_array_elements_text(item->'workspaces')),(item->>'delegable')::boolean,item->>'effect',
      item->>'sensitivity',array(select jsonb_array_elements_text(item->'requires')),
      array(select jsonb_array_elements_text(item->'conditions')),nullif(item->'less_than','null'::jsonb),
      item->>'owner_choice',item->>'source',(item->>'implemented')::boolean,false,p_version)
    on conflict(key) do update set family=excluded.family,value_type=excluded.value_type,
      default_value=excluded.default_value,min_value=excluded.min_value,max_value=excluded.max_value,
      allowed_values=excluded.allowed_values,min_items=excluded.min_items,scopes=excluded.scopes,
      workspaces=excluded.workspaces,delegable=excluded.delegable,effect=excluded.effect,
      sensitivity=excluded.sensitivity,requires=excluded.requires,conditions=excluded.conditions,
      less_than=excluded.less_than,owner_choice=excluded.owner_choice,source=excluded.source,
      implemented=excluded.implemented,retired=false,catalog_version=excluded.catalog_version;
  end loop;
  update dao_private.setting_definitions set retired=true, implemented=false
    where key not in (select value->>'key' from jsonb_array_elements(p_catalog));
  insert into dao_private.settings_state(singleton,catalog_version,catalog_hash)
    values(true,p_version,p_hash)
    on conflict(singleton) do update set catalog_version=excluded.catalog_version,
      catalog_hash=excluded.catalog_hash,version=dao_private.settings_state.version+1,updated_at=now();
end;
$$;
revoke all on function dao_private.sync_setting_definitions(integer,text,jsonb) from public, anon, authenticated, service_role;

-- Explicit coded conditions (no generic rule engine).
create function dao_private.setting_condition_met(p_condition text) returns boolean
language sql stable security definer set search_path='' as $$
  select case p_condition
    when 'contract_runtime_enabled' then coalesce((select c.enabled from dao_private.contract_runtime_configuration c where c.singleton),false)
    else false end;
$$;

-- Owner choices are read from their real tables, never copied.
create function dao_private.setting_federated_value(p_key text, p_user uuid, p_workspace text, p_project uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  case p_key
    when 'pref.workspace' then
      select to_jsonb(p.last_workspace) into result from public.profiles p where p.user_id=p_user;
    when 'pref.notify.invitation_expiring' then
      if p_workspace in ('client','contractor') then
        select to_jsonb(n.invitation_expiring) into result from public.notification_preferences n
          where n.user_id=p_user and n.workspace=p_workspace;
      end if;
    when 'pref.contractor.counter_offers_optin' then
      select to_jsonb(c.allow_counter_offers) into result from public.contractor_profiles c where c.user_id=p_user;
    when 'pref.contractor.contact_visibility' then
      select jsonb_build_object('website',d.show_website,'phone',d.show_phone,'whatsapp',d.show_whatsapp,
          'email',d.show_email,'social_links',d.show_social_links,'exact_address',d.show_exact_address)
        into result from public.contractor_profiles c join public.contractor_profile_details d on d.contractor_id=c.id
        where c.user_id=p_user;
    when 'project.contract_enabled' then
      if p_project is not null then
        select to_jsonb(s.enabled) into result from public.project_contract_settings s where s.project_id=p_project;
      end if;
    else null;
  end case;
  return result;
end;
$$;

-- Central resolver for one key. Internal: callers are trusted security
-- definer commands or my_effective_settings, which authorise the context.
-- It can only narrow access: it never grants a right that RLS/JWT refuses.
create function dao_private.resolve_setting(p_key text, p_user uuid, p_workspace text, p_project uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare d dao_private.setting_definitions; v jsonb; required text; req jsonb; condition text; owner jsonb;
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
  foreach condition in array d.conditions loop
    if not dao_private.setting_condition_met(condition) then
      return jsonb_build_object('value',v,'state','unavailable','source','default','reason','not_configured');
    end if;
  end loop;
  foreach required in array d.requires loop
    req:=dao_private.resolve_setting(required,p_user,p_workspace,p_project);
    if req->>'state' <> 'available' then
      return jsonb_build_object('value',v,'state','unavailable','source','default','reason','depends_on','requires',required);
    end if;
  end loop;
  if d.family='capability' and (v='false'::jsonb or v='[]'::jsonb) then
    return jsonb_build_object('value',v,'state','unavailable','source','default','reason','restricted');
  end if;
  if d.owner_choice is not null and p_workspace='contractor' then
    owner:=dao_private.setting_federated_value(d.owner_choice,p_user,p_workspace,p_project);
    return jsonb_build_object('value',v,'state','available','source','default','owner_choice',
      coalesce(owner,(select x.default_value from dao_private.setting_definitions x where x.key=d.owner_choice)));
  end if;
  return jsonb_build_object('value',v,'state','available','source','default');
end;
$$;

-- Workspace of the read: an explicit, held role; never the union of roles.
create function dao_private.settings_workspace(p_workspace text) returns text
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not dao_private.account_active(auth.uid()) then
    raise exception using errcode='42501', message='Compte actif requis';
  end if;
  if p_workspace is null then
    return dao_private.notification_workspace();
  end if;
  if p_workspace='staff' and dao_private.staff() then return 'staff'; end if;
  if p_workspace in ('client','contractor') and exists(select 1 from public.user_roles r
      where r.user_id=auth.uid() and r.role=p_workspace) then
    return p_workspace;
  end if;
  raise exception using errcode='42501', message='Espace non autorisé';
end;
$$;

create function dao_private.settings_project_allowed(p_workspace text, p_project uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select case p_workspace
    when 'client' then dao_private.owner(p_project) or dao_private.project_member(p_project)
    when 'contractor' then dao_private.project_member(p_project) or exists(
      select 1 from public.bids b join public.contractor_profiles c on c.id=b.contractor_id
      where b.project_id=p_project and c.user_id=auth.uid())
    when 'staff' then dao_private.manages_project(p_project)
    else false end;
$$;

-- One read per screen: every applicable key with value, state and neutral source.
create function dao_private.my_effective_settings(p_workspace text default null, p_project_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare ws text; key text; entries jsonb:='{}'::jsonb; state dao_private.settings_state;
begin
  ws:=dao_private.settings_workspace(p_workspace);
  if p_project_id is not null and not dao_private.settings_project_allowed(ws,p_project_id) then
    raise exception using errcode='42501', message='Chantier non accessible';
  end if;
  select * into state from dao_private.settings_state where singleton;
  for key in select d.key from dao_private.setting_definitions d
      where not d.retired and d.family <> 'catalog' and ws = any(d.workspaces)
        and (d.key <> 'project.contract_enabled' or (p_project_id is not null and ws='client'))
      order by d.key loop
    entries:=entries||jsonb_build_object(key,dao_private.resolve_setting(key,auth.uid(),ws,p_project_id));
  end loop;
  return jsonb_build_object('catalog_version',state.catalog_version,'version',state.version,
    'workspace',ws,'project_id',p_project_id,'settings',entries);
end;
$$;

create function public.my_effective_settings(p_workspace text default null, p_project_id uuid default null) returns jsonb
language sql stable security invoker set search_path='' as $$ select dao_private.my_effective_settings($1,$2); $$;

revoke all on function dao_private.setting_condition_met(text),
  dao_private.setting_federated_value(text,uuid,text,uuid),
  dao_private.resolve_setting(text,uuid,text,uuid),
  dao_private.settings_workspace(text),
  dao_private.settings_project_allowed(text,uuid)
  from public, anon, authenticated;
grant execute on function dao_private.resolve_setting(text,uuid,text,uuid) to service_role;
revoke all on function dao_private.my_effective_settings(text,uuid) from public, anon;
grant execute on function dao_private.my_effective_settings(text,uuid) to authenticated, service_role;
revoke all on function public.my_effective_settings(text,uuid) from public, anon;
grant execute on function public.my_effective_settings(text,uuid) to authenticated, service_role;

-- settings-catalog:begin (generated by `npm run settings:sync`, do not edit)
select dao_private.sync_setting_definitions(1, '870e041cd72091d2b8c25f6be2e06cc0b052ce9f3db73905b5784691c4cb0757', '[{"conditions":[],"default":true,"delegable":true,"effect":"prospective","family":"capability","implemented":true,"key":"client.invite_professionals","less_than":null,"max":null,"min":null,"min_items":null,"owner_choice":null,"requires":[],"scopes":["global","role","account","project"],"sensitivity":"normal","source":null,"type":"boolean","values":null,"workspaces":["client"]},{"conditions":[],"default":["public","targeted","invite_only"],"delegable":true,"effect":"prospective","family":"capability","implemented":true,"key":"publication.visibility_modes","less_than":null,"max":null,"min":null,"min_items":1,"owner_choice":null,"requires":[],"scopes":["global","role","account"],"sensitivity":"normal","source":null,"type":"enum_set","values":["public","targeted","invite_only"],"workspaces":["client"]},{"conditions":[],"default":true,"delegable":true,"effect":"prospective","family":"capability","implemented":true,"key":"bids.rfi","less_than":null,"max":null,"min":null,"min_items":null,"owner_choice":null,"requires":[],"scopes":["global","role","project"],"sensitivity":"normal","source":null,"type":"boolean","values":null,"workspaces":["client","contractor"]},{"conditions":[],"default":true,"delegable":true,"effect":"prospective","family":"capability","implemented":true,"key":"bids.counter_proposals","less_than":null,"max":null,"min":null,"min_items":null,"owner_choice":"pref.contractor.counter_offers_optin","requires":[],"scopes":["global","role","account","project"],"sensitivity":"normal","source":null,"type":"boolean","values":null,"workspaces":["client","contractor"]},{"conditions":[],"default":true,"delegable":false,"effect":"prospective","family":"capability","implemented":true,"key":"bids.multi_lot","less_than":null,"max":null,"min":null,"min_items":null,"owner_choice":null,"requires":[],"scopes":["global","role","project"],"sensitivity":"normal","source":null,"type":"boolean","values":null,"workspaces":["contractor"]},{"conditions":[],"default":true,"delegable":true,"effect":"prospective","family":"capability","implemented":true,"key":"bids.quote_pdf","less_than":null,"max":null,"min":null,"min_items":null,"owner_choice":null,"requires":[],"scopes":["global","role","account"],"sensitivity":"normal","source":null,"type":"boolean","values":null,"workspaces":["contractor"]},{"conditions":[],"default":true,"delegable":true,"effect":"prospective","family":"capability","implemented":true,"key":"bids.quote_lines","less_than":null,"max":null,"min":null,"min_items":null,"owner_choice":null,"requires":[],"scopes":["global","role","account"],"sensitivity":"normal","source":null,"type":"boolean","values":null,"workspaces":["contractor"]},{"conditions":[],"default":true,"delegable":true,"effect":"prospective","family":"capability","implemented":true,"key":"bids.proposed_sub_lots","less_than":null,"max":null,"min":null,"min_items":null,"owner_choice":null,"requires":[],"scopes":["global","role","account"],"sensitivity":"normal","source":null,"type":"boolean","values":null,"workspaces":["contractor"]},{"conditions":[],"default":true,"delegable":true,"effect":"prospective","family":"capability","implemented":true,"key":"client.offer_comparison","less_than":null,"max":null,"min":null,"min_items":null,"owner_choice":null,"requires":[],"scopes":["global","role","account","project"],"sensitivity":"normal","source":null,"type":"boolean","values":null,"workspaces":["client"]},{"conditions":["contract_runtime_enabled"],"default":true,"delegable":false,"effect":"prospective","family":"capability","implemented":true,"key":"contract.preparation_after_award","less_than":null,"max":null,"min":null,"min_items":null,"owner_choice":null,"requires":[],"scopes":["global","role","account"],"sensitivity":"sensitive","source":null,"type":"boolean","values":null,"workspaces":["client"]},{"conditions":[],"default":true,"delegable":false,"effect":"prospective","family":"capability","implemented":true,"key":"contract.precontract_agreement","less_than":null,"max":null,"min":null,"min_items":null,"owner_choice":null,"requires":[],"scopes":["global","role","project"],"sensitivity":"sensitive","source":null,"type":"boolean","values":null,"workspaces":["client","contractor"]},{"conditions":[],"default":30,"delegable":false,"effect":"prospective","family":"value","implemented":true,"key":"publication.default_submission_days","less_than":null,"max":90,"min":7,"min_items":null,"owner_choice":null,"requires":[],"scopes":["global"],"sensitivity":"normal","source":null,"type":"int","values":null,"workspaces":["client"]},{"conditions":[],"default":7,"delegable":false,"effect":"prospective","family":"value","implemented":true,"key":"invitations.ttl_days","less_than":null,"max":30,"min":1,"min_items":null,"owner_choice":null,"requires":[],"scopes":["global"],"sensitivity":"normal","source":null,"type":"int","values":null,"workspaces":["client","contractor"]},{"conditions":[],"default":24,"delegable":false,"effect":"prospective","family":"value","implemented":true,"key":"invitations.reminder_hours_before","less_than":{"factor":24,"key":"invitations.ttl_days"},"max":72,"min":1,"min_items":null,"owner_choice":null,"requires":[],"scopes":["global"],"sensitivity":"normal","source":null,"type":"int","values":null,"workspaces":["client","contractor"]},{"conditions":[],"default":20,"delegable":false,"effect":"live","family":"value","implemented":true,"key":"messaging.max_per_minute","less_than":null,"max":60,"min":5,"min_items":null,"owner_choice":null,"requires":[],"scopes":["global"],"sensitivity":"sensitive","source":null,"type":"int","values":null,"workspaces":["client","contractor","staff"]},{"conditions":[],"default":20,"delegable":false,"effect":"prospective","family":"value","implemented":true,"key":"uploads.max_file_mb","less_than":null,"max":20,"min":1,"min_items":null,"owner_choice":null,"requires":[],"scopes":["global"],"sensitivity":"sensitive","source":null,"type":"int","values":null,"workspaces":["client","contractor","staff"]},{"conditions":[],"default":30,"delegable":false,"effect":"prospective","family":"value","implemented":true,"key":"reviews.response_edit_days","less_than":null,"max":90,"min":0,"min_items":null,"owner_choice":null,"requires":[],"scopes":["global"],"sensitivity":"normal","source":null,"type":"int","values":null,"workspaces":["contractor"]},{"conditions":[],"default":true,"delegable":false,"effect":"prospective","family":"catalog","implemented":true,"key":"catalog.trades.active","less_than":null,"max":null,"min":null,"min_items":null,"owner_choice":null,"requires":[],"scopes":["global"],"sensitivity":"sensitive","source":"public.trades.active","type":"boolean","values":null,"workspaces":["staff"]},{"conditions":[],"default":"client","delegable":false,"effect":"live","family":"federated","implemented":true,"key":"pref.workspace","less_than":null,"max":null,"min":null,"min_items":null,"owner_choice":null,"requires":[],"scopes":[],"sensitivity":"normal","source":"public.profiles.last_workspace","type":"enum","values":["client","contractor"],"workspaces":["client","contractor"]},{"conditions":[],"default":true,"delegable":false,"effect":"live","family":"federated","implemented":true,"key":"pref.notify.invitation_expiring","less_than":null,"max":null,"min":null,"min_items":null,"owner_choice":null,"requires":[],"scopes":[],"sensitivity":"normal","source":"public.notification_preferences.invitation_expiring","type":"boolean","values":null,"workspaces":["client","contractor"]},{"conditions":[],"default":false,"delegable":false,"effect":"live","family":"federated","implemented":true,"key":"pref.contractor.counter_offers_optin","less_than":null,"max":null,"min":null,"min_items":null,"owner_choice":null,"requires":[],"scopes":[],"sensitivity":"normal","source":"public.contractor_profiles.allow_counter_offers","type":"boolean","values":null,"workspaces":["contractor"]},{"conditions":[],"default":{"email":false,"exact_address":false,"phone":false,"social_links":false,"website":false,"whatsapp":false},"delegable":false,"effect":"live","family":"federated","implemented":true,"key":"pref.contractor.contact_visibility","less_than":null,"max":null,"min":null,"min_items":null,"owner_choice":null,"requires":[],"scopes":[],"sensitivity":"normal","source":"public.contractor_profile_details.show_*","type":"flags","values":["website","phone","whatsapp","email","social_links","exact_address"],"workspaces":["contractor"]},{"conditions":[],"default":false,"delegable":false,"effect":"live","family":"federated","implemented":true,"key":"project.contract_enabled","less_than":null,"max":null,"min":null,"min_items":null,"owner_choice":null,"requires":[],"scopes":[],"sensitivity":"normal","source":"public.project_contract_settings.enabled","type":"boolean","values":null,"workspaces":["client"]}]'::jsonb);
-- settings-catalog:end

commit;
