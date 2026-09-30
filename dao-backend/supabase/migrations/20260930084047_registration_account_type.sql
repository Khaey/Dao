begin;

-- Registration only asks Artisan / Entreprise as one account category. Do
-- not silently classify every new contractor as an artisan; professional
-- classification is left for explicit profile completion.
alter table public.contractor_profiles
  alter column contractor_type drop default,
  alter column contractor_type drop not null;

-- Public registration has a deliberately narrow role allowlist. Keep this as
-- a JWT-scoped SECURITY DEFINER command; authenticated clients never receive
-- table INSERT rights on user_roles or contractor_profiles.
create or replace function dao_private.initialize_registration_account(
  p_display_name text,
  p_phone_e164 text,
  p_account_type text,
  p_business_name text
) returns public.profiles
language plpgsql security definer set search_path=''
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_name text;
  v_profile public.profiles;
begin
  if v_uid is null then
    raise exception using errcode='42501', message='authentication required';
  end if;
  -- Serialize concurrent initializations for this Auth user so conflicting
  -- account choices cannot create a mixed client/contractor role set.
  perform 1 from auth.users where id=v_uid for update;
  if p_account_type is null or p_account_type not in ('client','contractor') then
    raise exception using errcode='22023', message='invalid account type';
  end if;
  if p_account_type='contractor' and nullif(btrim(p_business_name),'') is null then
    raise exception using errcode='22023', message='business name is required';
  end if;
  if p_account_type='client' and nullif(btrim(p_business_name),'') is not null then
    raise exception using errcode='22023', message='business name is not valid for client registration';
  end if;
  if p_phone_e164 is not null and p_phone_e164 !~ '^\+216[0-9]{8}$' then
    raise exception using errcode='23514', message='invalid Tunisian phone number';
  end if;

  v_role := p_account_type;
  if exists(select 1 from public.user_roles ur where ur.user_id=v_uid and ur.role<>v_role) then
    raise exception using errcode='42501', message='account already has a different role';
  end if;

  select coalesce(
    nullif(btrim(p_display_name),''),
    nullif(btrim(existing.display_name),''),
    nullif(split_part(coalesce((auth.jwt()->>'email'),''),'@',1),''),
    'Utilisateur'
  ) into v_name
  from (select 1) seed
  left join public.profiles existing on existing.user_id=v_uid;
  if v_name is null then v_name:='Utilisateur'; end if;

  insert into public.profiles(user_id,display_name) values(v_uid,v_name)
  on conflict(user_id) do update set display_name=excluded.display_name
  returning * into v_profile;

  if p_phone_e164 is not null then
    insert into public.profile_contacts(user_id,phone_e164,contact_email)
    values(v_uid,p_phone_e164,(auth.jwt()->>'email'))
    on conflict(user_id) do update set phone_e164=excluded.phone_e164,
      contact_email=coalesce(excluded.contact_email,public.profile_contacts.contact_email);
  else
    insert into public.profile_contacts(user_id,contact_email)
    values(v_uid,(auth.jwt()->>'email'))
    on conflict(user_id) do update set contact_email=coalesce(public.profile_contacts.contact_email,excluded.contact_email);
  end if;

  insert into public.user_roles(user_id,role) values(v_uid,v_role)
  on conflict(user_id,role) do nothing;

  if v_role='contractor' then
    insert into public.contractor_profiles(user_id,business_name,verification_status)
    values(v_uid,btrim(p_business_name),'pending')
    on conflict(user_id) do nothing;
  end if;
  return v_profile;
end;
$$;
revoke all on function dao_private.initialize_registration_account(text,text,text,text) from public,anon,authenticated;
grant execute on function dao_private.initialize_registration_account(text,text,text,text) to authenticated,service_role;

-- Profile editing can create a missing profile row, but it must never assign
-- a role. Account role creation belongs only to the explicit registration RPC.
create or replace function dao_private.initialize_my_account(
  p_display_name text default null,
  p_phone_e164 text default null
) returns public.profiles
language plpgsql security definer set search_path=''
as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
  v_profile public.profiles;
begin
  if v_uid is null then
    raise exception using errcode='42501', message='authentication required';
  end if;
  if p_phone_e164 is not null and p_phone_e164 !~ '^\+216[0-9]{8}$' then
    raise exception using errcode='23514', message='invalid Tunisian phone number';
  end if;
  select coalesce(
    nullif(btrim(p_display_name),''),
    nullif(btrim(existing.display_name),''),
    nullif(split_part(coalesce((auth.jwt()->>'email'),''),'@',1),''),
    'Utilisateur'
  ) into v_name
  from (select 1) seed
  left join public.profiles existing on existing.user_id=v_uid;
  if v_name is null then v_name:='Utilisateur'; end if;

  insert into public.profiles(user_id,display_name) values(v_uid,v_name)
  on conflict(user_id) do update set display_name=excluded.display_name
  returning * into v_profile;
  if p_phone_e164 is not null then
    insert into public.profile_contacts(user_id,phone_e164,contact_email)
    values(v_uid,p_phone_e164,(auth.jwt()->>'email'))
    on conflict(user_id) do update set phone_e164=excluded.phone_e164,
      contact_email=coalesce(excluded.contact_email,public.profile_contacts.contact_email);
  else
    insert into public.profile_contacts(user_id,contact_email)
    values(v_uid,(auth.jwt()->>'email'))
    on conflict(user_id) do update set contact_email=coalesce(public.profile_contacts.contact_email,excluded.contact_email);
  end if;
  return v_profile;
end;
$$;

-- Keep the old overload only for trusted server compatibility; authenticated
-- browser registration must use the four-argument, validated RPC above.
revoke all on function dao_private.initialize_my_account(text,text) from public,anon,authenticated;
grant execute on function dao_private.initialize_my_account(text,text) to service_role;

create or replace function public.initialize_my_account(
  p_display_name text,
  p_phone_e164 text,
  p_account_type text,
  p_business_name text
) returns public.profiles
language sql security definer set search_path=''
as $$ select dao_private.initialize_registration_account($1,$2,$3,$4); $$;
revoke all on function public.initialize_my_account(text,text,text,text) from public,anon;
grant execute on function public.initialize_my_account(text,text,text,text) to authenticated,service_role;
revoke all on function public.initialize_my_account(text,text) from public,anon,authenticated;
grant execute on function public.initialize_my_account(text,text) to service_role;

commit;
