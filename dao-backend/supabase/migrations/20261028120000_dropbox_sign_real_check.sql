begin;

insert into dao_private.provider_manifests(provider_id,manifest_version,label,category,status,adapter_version,countries,capabilities,environments,auth_modes,live_locked,connection_check_supported,fields)
values('dropbox_sign_test','3','Dropbox Sign TEST','signature','installed','1.1.0-test',array['TN'],array['signature.sequential','signature.evidence'],array['sandbox'],array['api_key'],true,true,
  '[{"key":"api_key","label":"Clé API Dropbox Sign TEST","help":"Clé sandbox conservée uniquement dans le coffre serveur.","required":true,"type":"text","secret":true}]'::jsonb);

create or replace function public.provider_secret_read(p_name text)
returns text language plpgsql security definer set search_path='' as $$
declare v text;
begin
  if p_name is null or p_name !~ '^dao-provider/[0-9a-f-]{36}/[a-z][a-z0-9_]{1,63}$' then raise exception using errcode='22023',message='Nom de secret invalide'; end if;
  select decrypted_secret into v from vault.decrypted_secrets where name=p_name limit 1;
  return v;
end;
$$;
revoke all on function public.provider_secret_read(text) from public,anon,authenticated;
grant execute on function public.provider_secret_read(text) to service_role;

create or replace function public.provider_secret_record_check(p_connection_id uuid,p_status text,p_reason_code text,p_actor uuid,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare c dao_private.provider_connections; m dao_private.provider_manifests; v bigint;
begin
  if p_status not in ('verified','error','unconfigured') or p_reason_code !~ '^[a-z][a-z0-9_]{2,63}$' then raise exception using errcode='22023',message='Contrôle invalide'; end if;
  select * into c from dao_private.provider_connections where id=p_connection_id for update;
  if not found or c.environment<>'sandbox' or c.lifecycle_state='suspended' then raise exception using errcode='42501',message='Connexion non éligible'; end if;
  select * into m from dao_private.provider_manifests where provider_id=c.provider_id and manifest_version=c.manifest_version;
  if not found or m.provider_id<>'dropbox_sign_test'  then raise exception using errcode='42501',message='Contrôle non disponible'; end if;
  insert into dao_private.provider_checks(connection_id,status,reason_code,checked_by) values(c.id,p_status,p_reason_code,p_actor);
  update dao_private.provider_registry_state set version=version+1,updated_at=now() where singleton returning version into v;
  insert into dao_private.provider_events(actor_id,action,connection_id,reason,summary,registry_version)
  values(p_actor,'test_connection',c.id,p_reason,jsonb_build_object('check_status',p_status,'check_reason',p_reason_code),v);
end;
$$;
revoke all on function public.provider_secret_record_check(uuid,text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.provider_secret_record_check(uuid,text,text,uuid,text) to service_role;

commit;
