begin;

-- #515 tranche 3: the Vault schema remains private. These narrow wrappers are
-- callable only with the service_role key used by the Edge Function.
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

create or replace function public.provider_secret_revoke(p_name text)
returns boolean
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
begin
  if p_name is null or p_name !~ '^dao-provider/[0-9a-f-]{36}/[a-z][a-z0-9_]{1,63}$' then
    raise exception using errcode='22023', message='Secret invalide';
  end if;
  delete from vault.secrets where name=p_name;
  return found;
end;
$$;

create or replace function public.provider_secret_presence(p_name text)
returns table(present boolean, rotated_at timestamptz)
language sql
security definer
set search_path = public, vault, pg_temp
as $$
  select exists(select 1 from vault.secrets where name=p_name),
         (select updated_at from vault.secrets where name=p_name);
$$;

revoke all on function public.provider_secret_put(text, text) from public, anon, authenticated;
revoke all on function public.provider_secret_revoke(text) from public, anon, authenticated;
revoke all on function public.provider_secret_presence(text) from public, anon, authenticated;
grant execute on function public.provider_secret_put(text, text) to service_role;
grant execute on function public.provider_secret_revoke(text) to service_role;
grant execute on function public.provider_secret_presence(text) to service_role;

commit;
