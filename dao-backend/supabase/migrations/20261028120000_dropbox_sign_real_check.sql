begin;

insert into dao_private.provider_manifests(provider_id,manifest_version,label,category,status,adapter_version,countries,capabilities,environments,auth_modes,live_locked,connection_check_supported,fields)
values('dropbox_sign_test','2','Dropbox Sign TEST','signature','installed','1.1.0-test',array['TN'],array['signature.sequential','signature.evidence'],array['sandbox'],array['api_key'],true,true,
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

commit;
