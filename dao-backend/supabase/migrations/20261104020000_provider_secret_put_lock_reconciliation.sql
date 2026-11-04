begin;

-- #555: DEV lost the row lock present in the tracked Vault bridge. Restore it
-- before rotating an existing credential; never read or return secret values.
create or replace function public.provider_secret_put(p_name text, p_value text)
returns uuid
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
declare v_id uuid;
begin
  if p_name is null or p_name !~ '^dao-provider/[0-9a-f-]{36}/[a-z][a-z0-9_]{1,63}$'
     or p_value is null or length(p_value) < 1 or length(p_value) > 16384
     or p_value ~ E'[\\x00\\r\\n]' then
    raise exception using errcode='22023', message='Secret invalide';
  end if;
  select id into v_id from vault.secrets where name=p_name for update;
  if v_id is null then
    v_id := vault.create_secret(p_value, p_name, 'D.A.O. provider credential', null);
  else
    perform vault.update_secret(v_id, p_value, p_name, 'D.A.O. provider credential', null);
  end if;
  return v_id;
end;
$$;

-- CREATE OR REPLACE preserves existing ACLs; this only ensures the already
-- authorized backend role retains EXECUTE. No broad Vault/table grants or revokes.
grant execute on function public.provider_secret_put(text, text) to service_role;

commit;
