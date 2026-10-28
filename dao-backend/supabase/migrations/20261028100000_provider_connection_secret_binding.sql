begin;
insert into dao_private.provider_manifests(provider_id,manifest_version,label,category,status,adapter_version,countries,capabilities,environments,auth_modes,live_locked,connection_check_supported,fields) values ('dropbox_sign_test','2','Dropbox Sign TEST','signature','installed','1.0.1-test',array['TN'],array['signature.sequential','signature.evidence'],array['sandbox'],array['api_key'],true,false,'[{"key":"api_key","label":"Clé API Dropbox Sign TEST","help":"Clé sandbox Dropbox Sign, conservée uniquement dans le coffre serveur.","required":true,"type":"text","secret":true}]'::jsonb);
alter table dao_private.provider_events drop constraint if exists provider_events_action_check;
alter table dao_private.provider_events add constraint provider_events_action_check check(action in ('create_connection','update_connection','test_connection','suspend','resume','set_default','put_secret','revoke_secret'));

create or replace function public.provider_secret_connection_allowed(p_connection_id uuid,p_key text)
returns boolean language sql security definer set search_path='' as $$
  select exists(
    select 1 from dao_private.provider_connections c
    join dao_private.provider_manifests m on m.provider_id=c.provider_id and m.manifest_version=c.manifest_version
    cross join lateral jsonb_array_elements(m.fields) f
    where c.id=p_connection_id and coalesce((f->>'secret')::boolean,false) and f->>'key'=p_key
  );
$$;

create or replace function public.provider_secret_audit(p_actor uuid,p_connection_id uuid,p_action text,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare v numeric;
begin
  if p_action not in ('put_secret','revoke_secret') or p_actor is null or p_connection_id is null or length(btrim(coalesce(p_reason,''))) not between 5 and 500 then
    raise exception using errcode='22023',message='Audit invalide';
  end if;
  select version into v from dao_private.provider_registry_state where singleton for update;
  update dao_private.provider_registry_state set version=version+1,updated_at=now() where singleton returning version into v;
  insert into dao_private.provider_events(actor_id,action,connection_id,reason,summary,registry_version)
  values(p_actor,p_action,p_connection_id,p_reason,jsonb_build_object('secret_key','redacted'),v);
end;
$$;

revoke all on function public.provider_secret_connection_allowed(uuid,text), public.provider_secret_audit(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.provider_secret_connection_allowed(uuid,text), public.provider_secret_audit(uuid,uuid,text,text) to service_role;

create or replace function dao_private.admin_integrations_overview() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare base jsonb;
begin
  perform dao_private.settings_require_admin();
  base:=dao_private.admin_integrations_manifest_overview();
  return base || jsonb_build_object(
    'registry_version',(select version from dao_private.provider_registry_state where singleton),
    'legal_entities',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'label',e.label,'country',e.country,'sandbox_only',e.sandbox_only) order by e.label),'[]'::jsonb) from dao_private.provider_legal_entities e),
    'connections',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'provider_id',c.provider_id,'alias',c.alias,'category',m.category,'country',c.country,'legal_entity_id',c.legal_entity_id,'environment',c.environment,'state',dao_private.provider_connection_state(c),'params',c.params,
      'secrets',coalesce((select jsonb_agg(jsonb_build_object('key',f->>'key','present',exists(select 1 from vault.secrets s where s.name='dao-provider/'||c.id::text||'/'||(f->>'key')),'rotated_at',(select s.updated_at from vault.secrets s where s.name='dao-provider/'||c.id::text||'/'||(f->>'key')))) from jsonb_array_elements(m.fields) f where coalesce((f->>'secret')::boolean,false)),'[]'::jsonb),
      'last_check',(select jsonb_build_object('status',x.status,'at',x.checked_at,'reason',x.reason_code) from dao_private.provider_checks x where x.connection_id=c.id order by x.checked_at desc,x.id desc limit 1),'version',c.version) order by c.created_at,c.id),'[]'::jsonb)
      from dao_private.provider_connections c join dao_private.provider_manifests m on m.provider_id=c.provider_id and m.manifest_version=c.manifest_version),
    'policies',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'category',p.category,'capability',p.capability,'country',p.country,'legal_entity_id',p.legal_entity_id,'environment',p.environment,'connection_id',p.connection_id,'version',p.version) order by p.category,p.capability,p.country,p.legal_entity_id,p.environment),'[]'::jsonb) from dao_private.provider_policies p)
  );
end;
$$;
revoke all on function dao_private.admin_integrations_overview() from public,anon;
grant execute on function dao_private.admin_integrations_overview() to authenticated,service_role;
commit;