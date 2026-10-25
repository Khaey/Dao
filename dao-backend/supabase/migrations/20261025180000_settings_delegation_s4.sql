begin;

-- #423 Settings S4: Gestionnaire delegations (#426 A1/A2/A3/A7/A8).
-- A dao_reviewer has NO settings right by role (A8). An Admin grants an explicit,
-- dated, revocable mandate: delegable capability keys only (A1), restrict and/or
-- lift its own restrictions, on accounts of an explicit Admin portfolio or on
-- chantiers it is assigned to (A2), never on itself, never a positive exception
-- (A3), each restriction ending within 90 days (A7). Every write goes through the
-- S2 audited path (apply_setting_change) with the mandate id.

create table dao_private.staff_account_assignments (
  id uuid primary key default gen_random_uuid(),
  staff_user uuid not null references auth.users,
  account_user uuid not null references auth.users,
  reason text not null check (length(btrim(reason)) between 5 and 500),
  granted_by uuid not null references auth.users,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references auth.users,
  revoke_reason text,
  check (staff_user <> account_user),
  check ((revoked_at is null) = (revoked_by is null))
);
create unique index staff_account_assignments_active on dao_private.staff_account_assignments(staff_user, account_user)
  where revoked_at is null;

create table dao_private.setting_mandates (
  id uuid primary key default gen_random_uuid(),
  staff_user uuid not null references auth.users,
  keys text[] not null check (cardinality(keys) between 1 and 50),
  actions text[] not null check (cardinality(actions) between 1 and 2 and actions <@ array['restrict','lift_own_restriction']),
  scopes text[] not null check (cardinality(scopes) between 1 and 2 and scopes <@ array['account','project']),
  valid_from timestamptz not null default now(),
  valid_until timestamptz not null,
  reason text not null check (length(btrim(reason)) between 5 and 500),
  granted_by uuid not null references auth.users,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references auth.users,
  revoke_reason text,
  check (valid_until > valid_from),
  check ((revoked_at is null) = (revoked_by is null))
);
create index setting_mandates_staff on dao_private.setting_mandates(staff_user) where revoked_at is null;

alter table dao_private.setting_overrides add constraint setting_overrides_mandate_fk
  foreign key (mandate_id) references dao_private.setting_mandates(id);

alter table dao_private.staff_account_assignments enable row level security;
alter table dao_private.setting_mandates enable row level security;
revoke all on dao_private.staff_account_assignments, dao_private.setting_mandates from public, anon, authenticated;
grant all on dao_private.staff_account_assignments, dao_private.setting_mandates to service_role;

-- Grants are history: rows are never deleted and only the revocation columns change.
create function dao_private.settings_delegation_immutable() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' or old.revoked_at is not null
     or (to_jsonb(new) - array['revoked_at','revoked_by','revoke_reason']) <> (to_jsonb(old) - array['revoked_at','revoked_by','revoke_reason']) then
    raise exception using errcode='42501', message='Délégation conservée : seule la révocation est possible';
  end if;
  return new;
end;
$$;
create trigger staff_account_assignments_immutable before update or delete on dao_private.staff_account_assignments
  for each row execute function dao_private.settings_delegation_immutable();
create trigger setting_mandates_immutable before update or delete on dao_private.setting_mandates
  for each row execute function dao_private.settings_delegation_immutable();

create function dao_private.setting_mandate_live(m dao_private.setting_mandates) returns boolean
language sql stable set search_path='' as $$
  select m.revoked_at is null and m.valid_from <= now() and m.valid_until > now();
$$;

create function dao_private.settings_is_reviewer(p_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select dao_private.account_active(p_user) and exists(select 1 from public.user_roles r where r.user_id=p_user and r.role='dao_reviewer')
    and not exists(select 1 from public.user_roles r where r.user_id=p_user and r.role='dao_admin');
$$;

-- A2: explicit Admin portfolio, or existing chantier assignment.
create function dao_private.settings_manager_covers(p_staff uuid, p_user uuid, p_project uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select case
    when p_user is not null then p_user <> p_staff and exists(select 1 from dao_private.staff_account_assignments a
      where a.staff_user=p_staff and a.account_user=p_user and a.revoked_at is null)
    when p_project is not null then exists(select 1 from public.review_assignments r
      where r.project_id=p_project and r.reviewer_id=p_staff)
    else false end;
$$;

-- ===== Admin: grant/revoke mandates and portfolio =====

create function dao_private.admin_delegation_command(p_action text, p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=dao_private.settings_require_admin(); v_staff uuid; v_account uuid; v_id uuid; v_until timestamptz;
  v_keys text[]; v_actions text[]; v_scopes text[]; v_reason text:=btrim(coalesce(p_input->>'reason',''));
begin
  if length(v_reason) not between 5 and 500 then raise exception using errcode='22023', message='Motif obligatoire (5 à 500 caractères)'; end if;
  begin
    v_staff:=nullif(p_input->>'staff_user_id','')::uuid; v_account:=nullif(p_input->>'account_user_id','')::uuid;
    v_id:=nullif(p_input->>'id','')::uuid; v_until:=nullif(p_input->>'valid_until','')::timestamptz;
    v_keys:=array(select jsonb_array_elements_text(coalesce(p_input->'keys','[]')));
    v_actions:=array(select jsonb_array_elements_text(coalesce(p_input->'actions','[]')));
    v_scopes:=array(select jsonb_array_elements_text(coalesce(p_input->'scopes','[]')));
  exception when others then raise exception using errcode='22023', message='Données de délégation invalides';
  end;
  if p_action in ('grant_mandate','assign_account') and (v_staff is null or not dao_private.settings_is_reviewer(v_staff)) then
    raise exception using errcode='22023', message='Gestionnaire actif requis';
  end if;
  if p_action='grant_mandate' then
    if v_until is null or v_until <= now() or v_until > now() + interval '366 days' then
      raise exception using errcode='22023', message='Échéance du mandat obligatoire (au plus un an)';
    end if;
    if cardinality(v_keys)=0 or exists(select 1 from unnest(v_keys) k where not exists(select 1 from dao_private.setting_definitions d
        where d.key=k and d.delegable and d.family='capability' and d.implemented and not d.retired)) then
      raise exception using errcode='22023', message='Seules les fonctions délégables peuvent être confiées';
    end if;
    if cardinality(v_actions)=0 or not (v_actions <@ array['restrict','lift_own_restriction'])
       or cardinality(v_scopes)=0 or not (v_scopes <@ array['account','project']) then
      raise exception using errcode='22023', message='Actions ou portées de mandat invalides';
    end if;
    insert into dao_private.setting_mandates(staff_user,keys,actions,scopes,valid_until,reason,granted_by)
      values(v_staff,array(select distinct unnest(v_keys) order by 1),array(select distinct unnest(v_actions) order by 1),
        array(select distinct unnest(v_scopes) order by 1),v_until,v_reason,v_actor) returning id into v_id;
  elsif p_action='revoke_mandate' then
    update dao_private.setting_mandates set revoked_at=now(), revoked_by=v_actor, revoke_reason=v_reason
      where id=v_id and revoked_at is null;
    if not found then raise exception using errcode='22023', message='Mandat introuvable ou déjà révoqué'; end if;
  elsif p_action='assign_account' then
    if v_account is null or v_account=v_staff or not exists(select 1 from public.user_roles r
        where r.user_id=v_account and r.role in ('client','contractor')) then
      raise exception using errcode='22023', message='Compte Client ou Artisan requis';
    end if;
    insert into dao_private.staff_account_assignments(staff_user,account_user,reason,granted_by)
      values(v_staff,v_account,v_reason,v_actor) on conflict do nothing returning id into v_id;
    if v_id is null then raise exception using errcode='22023', message='Compte déjà dans ce portefeuille'; end if;
  elsif p_action='unassign_account' then
    update dao_private.staff_account_assignments set revoked_at=now(), revoked_by=v_actor, revoke_reason=v_reason
      where id=v_id and revoked_at is null;
    if not found then raise exception using errcode='22023', message='Affectation introuvable ou déjà retirée'; end if;
  else
    raise exception using errcode='22023', message='Action invalide';
  end if;
  return jsonb_build_object('id',v_id);
end;
$$;

create function dao_private.admin_settings_delegations() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform dao_private.settings_require_admin();
  return jsonb_build_object(
    'managers',(select coalesce(jsonb_agg(jsonb_build_object('id',r.user_id,'name',coalesce(p.display_name,'Gestionnaire')) order by p.display_name),'[]')
      from public.user_roles r left join public.profiles p on p.user_id=r.user_id
      where r.role='dao_reviewer' and dao_private.settings_is_reviewer(r.user_id)),
    'mandates',(select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'staff_user_id',m.staff_user,
        'staff_label',dao_private.settings_target_label(m.staff_user,null),'keys',m.keys,'actions',m.actions,'scopes',m.scopes,
        'valid_until',m.valid_until,'live',dao_private.setting_mandate_live(m),'reason',m.reason,'created_at',m.created_at,
        'revoked_at',m.revoked_at) order by m.created_at desc),'[]')
      from (select * from dao_private.setting_mandates order by created_at desc limit 200) m),
    'portfolio',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'staff_user_id',a.staff_user,
        'staff_label',dao_private.settings_target_label(a.staff_user,null),'account_user_id',a.account_user,
        'account_label',dao_private.settings_target_label(a.account_user,null),'reason',a.reason,'created_at',a.created_at)
        order by a.created_at desc),'[]')
      from dao_private.staff_account_assignments a where a.revoked_at is null));
end;
$$;

-- ===== Gestionnaire: read scope, simulate, restrict/lift own =====

create function dao_private.settings_require_manager() returns uuid
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not dao_private.settings_is_reviewer(auth.uid())
     or not exists(select 1 from dao_private.setting_mandates m where m.staff_user=auth.uid() and dao_private.setting_mandate_live(m)) then
    raise exception using errcode='42501', message='Délégation active requise';
  end if;
  return auth.uid();
end;
$$;

-- Never raises for staff: an empty answer lets the UI hide the entry point.
create function dao_private.my_settings_delegation() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_me uuid:=auth.uid();
begin
  if v_me is null or not dao_private.staff() then raise exception using errcode='42501', message='Accès réservé à l’équipe D.A.O'; end if;
  if not dao_private.settings_is_reviewer(v_me) or not exists(select 1 from dao_private.setting_mandates m
      where m.staff_user=v_me and dao_private.setting_mandate_live(m)) then
    return jsonb_build_object('mandates','[]'::jsonb);
  end if;
  return jsonb_build_object(
    'mandates',(select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'keys',m.keys,'actions',m.actions,'scopes',m.scopes,
        'valid_until',m.valid_until) order by m.valid_until),'[]')
      from dao_private.setting_mandates m where m.staff_user=v_me and dao_private.setting_mandate_live(m)),
    'accounts',(select coalesce(jsonb_agg(jsonb_build_object('id',a.account_user,'name',dao_private.settings_target_label(a.account_user,null),
        'roles',(select coalesce(jsonb_agg(r.role order by r.role),'[]') from public.user_roles r
          where r.user_id=a.account_user and r.role in ('client','contractor'))) order by a.created_at),'[]')
      from dao_private.staff_account_assignments a where a.staff_user=v_me and a.revoked_at is null),
    'projects',(select coalesce(jsonb_agg(jsonb_build_object('id',r.project_id,'name',dao_private.settings_target_label(null,r.project_id))),'[]')
      from (select distinct project_id from public.review_assignments where reviewer_id=v_me) r),
    'overrides',(select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'key',o.key,'scope',o.scope_type,'workspace',o.workspace,
        'user_id',o.target_user,'project_id',o.target_project,'target_label',dao_private.settings_target_label(o.target_user,o.target_project),
        'value',o.value,'valid_until',o.valid_until,'live',dao_private.setting_override_live(o),'reason',o.reason,
        'mandate_id',o.mandate_id,'created_at',o.created_at) order by o.created_at desc),'[]')
      from dao_private.setting_overrides o where o.superseded_at is null and o.created_by=v_me and o.mandate_id is not null));
end;
$$;

-- p_action: 'set' (restriction only) or 'clear' (own restriction only).
create function dao_private.manager_setting_command(p_action text, p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_me uuid:=dao_private.settings_require_manager(); m dao_private.setting_mandates; d dao_private.setting_definitions;
  v_scope text:=p_input->>'scope'; v_user uuid; v_project uuid; v_until timestamptz; v_value jsonb:=p_input->'value';
  v_current dao_private.setting_overrides; v_base jsonb;
begin
  begin
    v_user:=nullif(p_input->>'user_id','')::uuid; v_project:=nullif(p_input->>'project_id','')::uuid;
    v_until:=nullif(p_input->>'valid_until','')::timestamptz;
  exception when others then raise exception using errcode='22023', message='Cible ou échéance invalide';
  end;
  select * into d from dao_private.setting_definitions where key=p_input->>'key' and not retired;
  select * into m from dao_private.setting_mandates x where x.staff_user=v_me and dao_private.setting_mandate_live(x)
    and d.key = any(x.keys) and v_scope = any(x.scopes)
    and (case p_action when 'set' then 'restrict' when 'clear' then 'lift_own_restriction' end) = any(x.actions)
    order by x.valid_until desc limit 1;
  if d.key is null or not d.delegable or m.id is null then
    raise exception using errcode='42501', message='Hors de votre délégation';
  end if;
  if not dao_private.settings_manager_covers(v_me, v_user, v_project)
     or (v_scope='account' and (v_user is null or v_project is not null))
     or (v_scope='project' and (v_project is null or v_user is not null)) then
    raise exception using errcode='42501', message='Compte ou chantier hors de votre portefeuille';
  end if;
  perform 1 from dao_private.settings_state where singleton for update;
  select * into v_current from dao_private.setting_overrides o where o.key=d.key and o.scope_type=v_scope
    and o.workspace is not distinct from nullif(p_input->>'workspace','') and o.target_user is not distinct from v_user
    and o.target_project is not distinct from v_project and o.superseded_at is null;
  -- Never overwrite or lift an Admin decision or another manager's restriction.
  if v_current.id is not null and (v_current.mandate_id is null or v_current.created_by <> v_me) then
    raise exception using errcode='42501', message='Exception posée par l’administration : contactez un Administrateur';
  end if;
  if p_action='set' then
    -- A7: always temporary, at most 90 days.
    if v_until is null or v_until > now() + interval '90 days' then
      raise exception using errcode='22023', message='Restriction temporaire obligatoire (90 jours au plus)';
    end if;
    if d.value_type='boolean' and v_value is distinct from 'false'::jsonb then
      raise exception using errcode='42501', message='Une délégation ne peut que restreindre';
    end if;
    if d.value_type='enum_set' then
      v_base:=coalesce((select o.value from dao_private.setting_overrides o where o.key=d.key and o.scope_type='global'
        and dao_private.setting_override_live(o)), d.default_value);
      if jsonb_typeof(v_value) <> 'array' or not (v_value <@ v_base) or v_value @> v_base then
        raise exception using errcode='42501', message='Une délégation ne peut que restreindre';
      end if;
    end if;
  elsif p_action <> 'clear' then
    raise exception using errcode='22023', message='Action invalide';
  end if;
  return dao_private.apply_setting_change(v_me, m.id, p_action, p_input);
end;
$$;

create function dao_private.manager_preview_settings(p_user uuid, p_workspace text, p_project_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_me uuid:=dao_private.settings_require_manager();
begin
  if not dao_private.settings_manager_covers(v_me, p_user, null)
     or (p_project_id is not null and not dao_private.settings_manager_covers(v_me, null, p_project_id)) then
    raise exception using errcode='42501', message='Compte ou chantier hors de votre portefeuille';
  end if;
  if p_workspace not in ('client','contractor') or not exists(select 1 from public.user_roles r
      where r.user_id=p_user and r.role=p_workspace) then
    raise exception using errcode='22023', message='Compte ou espace invalide';
  end if;
  return dao_private.effective_settings_for(p_user,p_workspace,p_project_id,true);
end;
$$;

-- Public wrappers (JWT path).
create function public.admin_delegation_command(p_action text, p_input jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select dao_private.admin_delegation_command($1,$2); $$;
create function public.admin_settings_delegations() returns jsonb
language sql stable security invoker set search_path='' as $$ select dao_private.admin_settings_delegations(); $$;
create function public.my_settings_delegation() returns jsonb
language sql stable security invoker set search_path='' as $$ select dao_private.my_settings_delegation(); $$;
create function public.manager_setting_command(p_action text, p_input jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select dao_private.manager_setting_command($1,$2); $$;
create function public.manager_preview_settings(p_user uuid, p_workspace text, p_project_id uuid default null) returns jsonb
language sql stable security invoker set search_path='' as $$ select dao_private.manager_preview_settings($1,$2,$3); $$;

revoke all on function dao_private.settings_delegation_immutable(), dao_private.setting_mandate_live(dao_private.setting_mandates),
  dao_private.settings_is_reviewer(uuid), dao_private.settings_manager_covers(uuid,uuid,uuid), dao_private.settings_require_manager()
  from public, anon, authenticated;
revoke all on function dao_private.admin_delegation_command(text,jsonb), dao_private.admin_settings_delegations(),
  dao_private.my_settings_delegation(), dao_private.manager_setting_command(text,jsonb),
  dao_private.manager_preview_settings(uuid,text,uuid),
  public.admin_delegation_command(text,jsonb), public.admin_settings_delegations(), public.my_settings_delegation(),
  public.manager_setting_command(text,jsonb), public.manager_preview_settings(uuid,text,uuid)
  from public, anon;
grant execute on function dao_private.admin_delegation_command(text,jsonb), dao_private.admin_settings_delegations(),
  dao_private.my_settings_delegation(), dao_private.manager_setting_command(text,jsonb),
  dao_private.manager_preview_settings(uuid,text,uuid),
  public.admin_delegation_command(text,jsonb), public.admin_settings_delegations(), public.my_settings_delegation(),
  public.manager_setting_command(text,jsonb), public.manager_preview_settings(uuid,text,uuid)
  to authenticated, service_role;

commit;
