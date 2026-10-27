begin;

-- #515 tranche 1: versioned provider manifests and the first real Admin-only
-- overview RPC. Persistent connections, policies, checks and events follow in
-- a separate additive migration; no integration_* duplicate schema is created.

create function dao_private.provider_manifest_capabilities_valid(p_category text, p_capabilities text[])
returns boolean language sql immutable set search_path='' as $$
  select coalesce(array_length(p_capabilities,1),0)>0
    and not exists (
      select 1 from unnest(p_capabilities) capability
      where capability !~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'
        or split_part(capability,'.',1) <> p_category
    );
$$;

create function dao_private.provider_manifest_fields_valid(p_fields jsonb)
returns boolean language sql immutable set search_path='' as $$
  select jsonb_typeof(p_fields)='array' and not exists (
    select 1 from jsonb_array_elements(p_fields) field
    where jsonb_typeof(field)<>'object'
      or coalesce(field->>'key','') !~ '^[a-z][a-z0-9_]{0,63}$'
      or field->>'key' in ('url','endpoint','script','javascript','callback_url')
      or length(btrim(coalesce(field->>'label',''))) not between 1 and 100
      or length(coalesce(field->>'help','')) > 500
      or coalesce(field->>'type','') not in ('text','enum','boolean','number')
      or jsonb_typeof(field->'required') <> 'boolean'
      or jsonb_typeof(field->'secret') <> 'boolean'
      or field ?| array['url','endpoint','script','javascript','callback_url']
      or exists (
        select 1 from jsonb_object_keys(field) key
        where key not in ('key','label','help','required','type','options','secret')
      )
      or (field->>'type'='enum' and (
        jsonb_typeof(field->'options') <> 'array'
        or jsonb_array_length(field->'options')=0
        or exists (select 1 from jsonb_array_elements(field->'options') option where jsonb_typeof(option)<>'string')
      ))
      or (field->>'type'<>'enum' and field ? 'options')
  );
$$;

create table dao_private.provider_registry_state (
  singleton boolean primary key default true check(singleton),
  version bigint not null default 1 check(version>0),
  updated_at timestamptz not null default now()
);
insert into dao_private.provider_registry_state(singleton,version) values(true,1);

create table dao_private.provider_manifests (
  provider_id text not null check(provider_id ~ '^[a-z][a-z0-9_]{1,63}$'),
  manifest_version text not null check(manifest_version ~ '^[0-9]+(\.[0-9]+){0,2}$'),
  label text not null check(length(btrim(label)) between 1 and 100),
  category text not null check(category in ('signature','escrow','payment','maps','individual_identity','business_identity','messaging','documents')),
  status text not null check(status in ('candidate','installed')),
  adapter_version text,
  countries text[] not null check(cardinality(countries)>0 and countries <@ array['TN']::text[]),
  capabilities text[] not null,
  environments text[] not null check(cardinality(environments)>0 and environments <@ array['sandbox','live']::text[]),
  auth_modes text[] not null check(auth_modes <@ array['api_key','oauth2','service_account','platform_managed']::text[]),
  live_locked boolean not null default true,
  connection_check_supported boolean not null default false,
  fields jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  primary key(provider_id,manifest_version),
  check((status='installed' and length(btrim(coalesce(adapter_version,'')))>0) or (status='candidate' and adapter_version is null)),
  check(not connection_check_supported or status='installed'),
  check(dao_private.provider_manifest_capabilities_valid(category,capabilities)),
  check(dao_private.provider_manifest_fields_valid(fields))
);

alter table dao_private.provider_registry_state enable row level security;
alter table dao_private.provider_manifests enable row level security;
revoke all on dao_private.provider_registry_state, dao_private.provider_manifests from public, anon, authenticated;
grant all on dao_private.provider_registry_state, dao_private.provider_manifests to service_role;

create function dao_private.provider_manifests_append_only() returns trigger
language plpgsql set search_path='' as $$
begin
  raise exception using errcode='42501',message='Les manifests fournisseurs sont versionnés et immuables';
end;
$$;
create trigger provider_manifests_append_only before update or delete on dao_private.provider_manifests
  for each row execute function dao_private.provider_manifests_append_only();

insert into dao_private.provider_manifests(
  provider_id,manifest_version,label,category,status,adapter_version,countries,capabilities,environments,
  auth_modes,live_locked,connection_check_supported,fields
) values
  ('dropbox_sign_test','1','Dropbox Sign TEST','signature','installed','1.0.0-test',array['TN'],
    array['signature.sequential','signature.evidence'],array['sandbox'],array['api_key'],true,false,'[]'),
  ('ngsign','1','NGSign','signature','candidate',null,array['TN'],
    array['signature.sequential','signature.simple','signature.qualified','signature.evidence'],
    array['sandbox','live'],array['api_key'],true,false,'[]'),
  ('tuntrust_digigo','1','TunTrust DigiGO','signature','candidate',null,array['TN'],
    array['signature.qualified','signature.evidence'],array['sandbox','live'],array['api_key'],true,false,'[]'),
  ('mapbox','1','Mapbox','maps','candidate',null,array['TN'],
    array['maps.map','maps.geocode','maps.autocomplete','maps.route'],
    array['sandbox','live'],array['api_key'],true,false,'[]'),
  ('resend','1','Resend','messaging','candidate',null,array['TN'],
    array['messaging.email'],array['sandbox','live'],array['api_key'],true,false,'[]'),
  ('supabase_storage','1','Supabase Storage','documents','candidate',null,array['TN'],
    array['documents.store','documents.archive'],array['sandbox','live'],array['platform_managed'],true,false,'[]');

create function dao_private.admin_integrations_overview() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_version bigint;
begin
  perform dao_private.settings_require_admin();
  select version into v_version from dao_private.provider_registry_state where singleton;
  return jsonb_build_object(
    'contract_version','provider-integrations.v1',
    'registry_version',v_version,
    'markets',jsonb_build_array('TN'),
    -- No approved legal-entity registry exists yet. Never invent one in the DTO.
    'legal_entities','[]'::jsonb,
    'categories',jsonb_build_array(
      jsonb_build_object('key','signature','label','Signature électronique','sensitive',true,'capabilities',jsonb_build_array(
        jsonb_build_object('key','signature.sequential','label','Signatures séquentielles'),
        jsonb_build_object('key','signature.simple','label','Signature simple'),
        jsonb_build_object('key','signature.qualified','label','Signature qualifiée'),
        jsonb_build_object('key','signature.evidence','label','Preuves'))),
      jsonb_build_object('key','escrow','label','Escrow / séquestre','sensitive',true,'capabilities',jsonb_build_array(
        jsonb_build_object('key','escrow.hold','label','Blocage'),jsonb_build_object('key','escrow.release','label','Libération'),
        jsonb_build_object('key','escrow.refund','label','Remboursement'),jsonb_build_object('key','escrow.dispute','label','Litige'))),
      jsonb_build_object('key','payment','label','Paiements et versements','sensitive',true,'capabilities',jsonb_build_array(
        jsonb_build_object('key','payment.collect','label','Encaissement'),jsonb_build_object('key','payment.refund','label','Remboursement'),
        jsonb_build_object('key','payment.payout','label','Versement'),jsonb_build_object('key','payment.reconcile','label','Rapprochement'))),
      jsonb_build_object('key','maps','label','Cartes et géolocalisation','sensitive',false,'capabilities',jsonb_build_array(
        jsonb_build_object('key','maps.map','label','Carte'),jsonb_build_object('key','maps.geocode','label','Géocodage'),
        jsonb_build_object('key','maps.autocomplete','label','Autocomplétion'),jsonb_build_object('key','maps.route','label','Itinéraires'))),
      jsonb_build_object('key','individual_identity','label','Identité individuelle (KYC)','sensitive',true,'capabilities',jsonb_build_array(
        jsonb_build_object('key','individual_identity.verify','label','Vérifier une identité'))),
      jsonb_build_object('key','business_identity','label','Identité entreprise (KYB)','sensitive',true,'capabilities',jsonb_build_array(
        jsonb_build_object('key','business_identity.verify','label','Vérifier une entreprise'))),
      jsonb_build_object('key','messaging','label','E-mail, SMS et WhatsApp','sensitive',false,'capabilities',jsonb_build_array(
        jsonb_build_object('key','messaging.email','label','E-mail'),jsonb_build_object('key','messaging.sms','label','SMS'),
        jsonb_build_object('key','messaging.whatsapp','label','WhatsApp'))),
      jsonb_build_object('key','documents','label','Documents et archivage','sensitive',true,'capabilities',jsonb_build_array(
        jsonb_build_object('key','documents.store','label','Stockage'),jsonb_build_object('key','documents.archive','label','Archivage'),
        jsonb_build_object('key','documents.timestamp','label','Horodatage')))
    ),
    'connectors',(select coalesce(jsonb_agg(jsonb_build_object(
      'provider_id',m.provider_id,'manifest_version',m.manifest_version,'label',m.label,'category',m.category,
      'status',m.status,'adapter_version',m.adapter_version,'countries',to_jsonb(m.countries),
      'capabilities',to_jsonb(m.capabilities),'environments',to_jsonb(m.environments),
      'auth_modes',to_jsonb(m.auth_modes),'live_locked',m.live_locked,
      'connection_check_supported',m.connection_check_supported,'fields',m.fields
    ) order by m.category,m.label),'[]'::jsonb) from (
      select distinct on(provider_id) * from dao_private.provider_manifests
      order by provider_id,created_at desc,manifest_version desc
    ) m),
    'connections','[]'::jsonb,
    'policies','[]'::jsonb
  );
end;
$$;

create function public.admin_integrations_overview() returns jsonb
language sql stable security invoker set search_path='' as $$
  select dao_private.admin_integrations_overview();
$$;

revoke all on function dao_private.provider_manifest_capabilities_valid(text,text[]),
  dao_private.provider_manifest_fields_valid(jsonb),dao_private.provider_manifests_append_only()
  from public,anon,authenticated;
revoke all on function dao_private.admin_integrations_overview(),public.admin_integrations_overview()
  from public,anon;
grant execute on function dao_private.admin_integrations_overview(),public.admin_integrations_overview()
  to authenticated,service_role;

commit;
