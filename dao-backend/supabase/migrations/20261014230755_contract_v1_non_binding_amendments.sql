begin;

-- P2.2-C records simple amendment proposals without changing the contract,
-- award, lots, executable dates or legal status. Every proposal remains
-- explicitly non-engaging until a later, separately authorized legal phase.
create table public.contract_amendments (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  contract_id uuid not null references public.contracts,
  base_contract_version_id uuid not null references public.contract_versions,
  initiated_by uuid not null references auth.users,
  status text not null default 'awaiting_acceptances'
    check(status in ('awaiting_acceptances','accepted','rejected','cancelled')),
  legal_effect_enabled boolean not null default false check(not legal_effect_enabled),
  validated_at timestamptz,
  validated_by uuid references auth.users,
  validation_reason text,
  rejected_at timestamptz,
  rejected_by uuid references auth.users,
  rejection_reason text,
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users,
  cancellation_reason text,
  constraint contract_amendments_validation_shape check(
    (status<>'accepted' and validated_at is null and validated_by is null and validation_reason is null) or
    (status='accepted' and validated_at is not null and validated_by is not null
      and btrim(coalesce(validation_reason,''))<>'')
  ),
  constraint contract_amendments_rejection_shape check(
    (status<>'rejected' and rejected_at is null and rejected_by is null and rejection_reason is null) or
    (status='rejected' and rejected_at is not null and rejected_by is not null
      and btrim(coalesce(rejection_reason,''))<>'')
  ),
  constraint contract_amendments_cancellation_shape check(
    (status<>'cancelled' and cancelled_at is null and cancelled_by is null and cancellation_reason is null) or
    (status='cancelled' and cancelled_at is not null and cancelled_by is not null
      and btrim(coalesce(cancellation_reason,''))<>'')
  )
);

create table public.contract_amendment_versions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  amendment_id uuid not null references public.contract_amendments,
  version_no integer not null check(version_no=1),
  content jsonb not null,
  content_hash text not null check(content_hash~'^[0-9a-f]{64}$'),
  created_by uuid not null references auth.users,
  unique(amendment_id,version_no),
  unique(amendment_id,content_hash)
);

create table public.contract_amendment_acceptances (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  amendment_id uuid not null references public.contract_amendments,
  amendment_version_id uuid not null references public.contract_amendment_versions,
  party_role text not null check(party_role in ('client','contractor')),
  accepted_by uuid not null references auth.users,
  method text not null check(method in ('trusted_simple','qualified')),
  evidence_hash text not null check(evidence_hash~'^[0-9a-f]{64}$'),
  provider_reference text,
  evidence_metadata jsonb not null default '{}'::jsonb,
  accepted_at timestamptz not null,
  unique(amendment_id,amendment_version_id,party_role)
);

create table public.contract_amendment_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  amendment_id uuid not null references public.contract_amendments,
  actor_id uuid not null references auth.users,
  event_type text not null check(event_type in ('proposed','acceptance_recorded','accepted','rejected','cancelled')),
  from_status text,
  to_status text,
  reason text,
  metadata jsonb not null default '{}'::jsonb
);

create function dao_private.contract_amendment(p_amendment_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.contract_amendments ca
    where ca.id=p_amendment_id and dao_private.contract(ca.contract_id)
  );
$$;

create function dao_private.contract_amendment_version_guard() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.content_hash<>dao_private.contract_version_hash(new.content) then
    raise exception using errcode='23514',message='Empreinte de proposition invalide';
  end if;
  if coalesce((new.content->>'non_engaging')::boolean,false) is distinct from true then
    raise exception using errcode='23514',message='Une proposition d''avenant doit rester non engageante';
  end if;
  return new;
end;
$$;

create function dao_private.contract_amendment_state_guard() returns trigger
language plpgsql set search_path='' as $$
begin
  if current_user<>'postgres' then
    raise exception using errcode='23514',message='Transition d''avenant réservée aux commandes contrôlées';
  end if;
  if new.contract_id<>old.contract_id
     or new.base_contract_version_id<>old.base_contract_version_id
     or new.initiated_by<>old.initiated_by
     or new.legal_effect_enabled is distinct from false then
    raise exception using errcode='23514',message='Identité de proposition immuable';
  end if;
  if old.status<>'awaiting_acceptances' or new.status not in ('accepted','rejected','cancelled') then
    raise exception using errcode='23514',message='Transition d''avenant invalide';
  end if;
  new.updated_at:=now();
  return new;
end;
$$;

create trigger contract_amendment_versions_hash before insert on public.contract_amendment_versions
for each row execute function dao_private.contract_amendment_version_guard();
create trigger controlled_contract_amendment_update before update on public.contract_amendments
for each row execute function dao_private.contract_amendment_state_guard();
create trigger immutable_contract_amendments before delete on public.contract_amendments
for each row execute function dao_private.contract_append_only();
create trigger immutable_contract_amendment_versions before update or delete on public.contract_amendment_versions
for each row execute function dao_private.contract_append_only();
create trigger immutable_contract_amendment_acceptances before update or delete on public.contract_amendment_acceptances
for each row execute function dao_private.contract_append_only();
create trigger immutable_contract_amendment_events before update or delete on public.contract_amendment_events
for each row execute function dao_private.contract_append_only();

create function dao_private.propose_contract_amendment(
  p_actor_id uuid,p_contract_id uuid,p_scope_clarification text,p_amount_delta_millimes bigint,
  p_planned_start_date date,p_duration_days integer,p_reason text,p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.contracts; base_hash text; aid uuid; avid uuid; body jsonb; result jsonb;
  proposed_total bigint;
begin
  if p_actor_id is null or p_contract_id is null or p_idempotency_key is null
     or btrim(coalesce(p_reason,''))='' then
    raise exception using errcode='22023',message='Acteur, contrat, motif et clé requis';
  end if;
  if nullif(btrim(coalesce(p_scope_clarification,'')),'') is null
     and p_amount_delta_millimes is null and p_planned_start_date is null and p_duration_days is null then
    raise exception using errcode='22023',message='Au moins un changement proposé est requis';
  end if;
  if p_duration_days is not null and p_duration_days<=0 then
    raise exception using errcode='22023',message='Durée proposée invalide';
  end if;
  if not dao_private.account_active(p_actor_id) then
    raise exception using errcode='42501',message='Compte actif requis';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text||':'||p_idempotency_key::text,0));
  select cr.result into result from public.command_receipts cr where cr.actor_id=p_actor_id
    and cr.idempotency_key=p_idempotency_key::text and cr.command='propose_contract_amendment';
  if result is not null then return result; end if;
  if exists(select 1 from public.command_receipts where actor_id=p_actor_id and idempotency_key=p_idempotency_key::text) then
    raise exception using errcode='23505',message='Clé idempotente déjà utilisée'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_contract_id::text,0));
  select * into c from public.contracts where id=p_contract_id for update;
  if not found or c.status<>'ready' or c.validated_at is null or c.current_version_id is null
     or c.legal_effect_enabled then
    raise exception using errcode='23514',message='Contrat non engageant contrôlé requis';
  end if;
  if not exists(select 1 from public.contract_parties cp where cp.contract_id=c.id
    and cp.role='client' and cp.user_id=p_actor_id) then
    raise exception using errcode='42501',message='Seul le client contractuel peut proposer un avenant';
  end if;
  if exists(select 1 from public.contract_parties cp where cp.contract_id=c.id
    and cp.role in ('client','contractor') and not dao_private.account_active(cp.user_id)) then
    raise exception using errcode='23514',message='Parties contractuelles actives requises';
  end if;
  select cv.content_hash into base_hash from public.contract_versions cv
    where cv.id=c.current_version_id and cv.contract_id=c.id;
  if base_hash is null then
    raise exception using errcode='23514',message='Version contractuelle de base invalide'; end if;
  proposed_total:=c.total_millimes+coalesce(p_amount_delta_millimes,0);
  if proposed_total<0 then
    raise exception using errcode='22023',message='Montant total proposé négatif'; end if;
  insert into public.contract_amendments(contract_id,base_contract_version_id,initiated_by)
    values(c.id,c.current_version_id,p_actor_id) returning id into aid;
  body:=jsonb_build_object(
    'schema','dao-contract-amendment-v1','amendment_id',aid,'contract_id',c.id,
    'base_contract_version_id',c.current_version_id,'base_contract_version_hash',base_hash,
    'non_engaging',true,'reason',btrim(p_reason),
    'scope_clarification',nullif(btrim(coalesce(p_scope_clarification,'')),''),
    'amount_delta_millimes',p_amount_delta_millimes,
    'base_total_millimes',c.total_millimes,'proposed_total_millimes',proposed_total,
    'planned_start_date',p_planned_start_date,'duration_days',p_duration_days);
  insert into public.contract_amendment_versions(amendment_id,version_no,content,content_hash,created_by)
    values(aid,1,body,dao_private.contract_version_hash(body),p_actor_id) returning id into avid;
  insert into public.contract_amendment_events(amendment_id,actor_id,event_type,to_status,reason,metadata)
    values(aid,p_actor_id,'proposed','awaiting_acceptances',btrim(p_reason),
      jsonb_build_object('version_id',avid,'base_contract_version_id',c.current_version_id,'non_engaging',true));
  result:=jsonb_build_object('amendment_id',aid,'amendment_version_id',avid,
    'contract_id',c.id,'status','awaiting_acceptances','legal_effect_enabled',false,
    'proposed_total_millimes',proposed_total);
  insert into public.command_receipts(actor_id,idempotency_key,command,result)
    values(p_actor_id,p_idempotency_key::text,'propose_contract_amendment',result);
  return result;
end;
$$;

create function dao_private.record_contract_amendment_acceptance(
  p_actor_id uuid,p_amendment_id uuid,p_amendment_version_id uuid,p_method text,
  p_evidence_hash text,p_provider_reference text,p_evidence_metadata jsonb,
  p_accepted_at timestamptz,p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.contract_amendments; c public.contracts; party_role text; result jsonb;
begin
  if p_actor_id is null or p_idempotency_key is null or p_method not in ('trusted_simple','qualified')
     or p_evidence_hash!~'^[0-9a-f]{64}$' or p_accepted_at is null
     or p_accepted_at>now()+interval '5 minutes' then
    raise exception using errcode='22023',message='Preuve d''accord invalide'; end if;
  if not dao_private.account_active(p_actor_id) then
    raise exception using errcode='42501',message='Compte actif requis'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text||':'||p_idempotency_key::text,0));
  select cr.result into result from public.command_receipts cr where cr.actor_id=p_actor_id
    and cr.idempotency_key=p_idempotency_key::text and cr.command='record_contract_amendment_acceptance';
  if result is not null then return result; end if;
  if exists(select 1 from public.command_receipts where actor_id=p_actor_id and idempotency_key=p_idempotency_key::text) then
    raise exception using errcode='23505',message='Clé idempotente déjà utilisée'; end if;
  select * into a from public.contract_amendments where id=p_amendment_id for update;
  if not found or a.status<>'awaiting_acceptances' or not exists(
    select 1 from public.contract_amendment_versions av
    where av.id=p_amendment_version_id and av.amendment_id=a.id and av.version_no=1
  ) then raise exception using errcode='23514',message='Proposition figée en attente requise'; end if;
  select * into c from public.contracts where id=a.contract_id;
  if c.status<>'ready' or c.current_version_id<>a.base_contract_version_id or c.legal_effect_enabled then
    raise exception using errcode='23514',message='Version contractuelle de base périmée'; end if;
  if exists(select 1 from public.contract_parties cp where cp.contract_id=c.id
    and cp.role in ('client','contractor') and not dao_private.account_active(cp.user_id)) then
    raise exception using errcode='23514',message='Parties contractuelles actives requises'; end if;
  select cp.role into party_role from public.contract_parties cp where cp.contract_id=a.contract_id
    and cp.user_id=p_actor_id and cp.role in ('client','contractor');
  if party_role is null then raise exception using errcode='42501',message='Partie contractuelle requise'; end if;
  if c.signature_mode='trusted_simple' and p_method<>'trusted_simple'
     or c.signature_mode='qualified' and p_method<>'qualified' then
    raise exception using errcode='23514',message='Méthode d''accord incompatible'; end if;
  insert into public.contract_amendment_acceptances(amendment_id,amendment_version_id,party_role,
    accepted_by,method,evidence_hash,provider_reference,evidence_metadata,accepted_at)
    values(a.id,p_amendment_version_id,party_role,p_actor_id,p_method,p_evidence_hash,
      nullif(btrim(p_provider_reference),''),coalesce(p_evidence_metadata,'{}'::jsonb),p_accepted_at);
  insert into public.contract_amendment_events(amendment_id,actor_id,event_type,to_status,metadata)
    values(a.id,p_actor_id,'acceptance_recorded','awaiting_acceptances',jsonb_build_object(
      'version_id',p_amendment_version_id,'party_role',party_role,'method',p_method,
      'evidence_hash',p_evidence_hash));
  result:=jsonb_build_object('amendment_id',a.id,'amendment_version_id',p_amendment_version_id,
    'party_role',party_role,'status','awaiting_acceptances','legal_effect_enabled',false);
  insert into public.command_receipts(actor_id,idempotency_key,command,result)
    values(p_actor_id,p_idempotency_key::text,'record_contract_amendment_acceptance',result);
  return result;
exception when unique_violation then
  raise exception using errcode='23505',message='Cette partie a déjà accepté cette proposition';
end;
$$;

create function dao_private.validate_contract_amendment(
  p_actor_id uuid,p_amendment_id uuid,p_reason text,p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.contract_amendments; c public.contracts; version_id uuid; result jsonb;
begin
  if p_actor_id is null or p_idempotency_key is null or btrim(coalesce(p_reason,''))='' then
    raise exception using errcode='22023',message='Acteur, motif et clé requis'; end if;
  if not dao_private.account_active(p_actor_id) or not exists(
    select 1 from public.user_roles where user_id=p_actor_id and role='dao_admin'
  ) then raise exception using errcode='42501',message='Administrateur actif requis'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text||':'||p_idempotency_key::text,0));
  select cr.result into result from public.command_receipts cr where cr.actor_id=p_actor_id
    and cr.idempotency_key=p_idempotency_key::text and cr.command='validate_contract_amendment';
  if result is not null then return result; end if;
  if exists(select 1 from public.command_receipts where actor_id=p_actor_id and idempotency_key=p_idempotency_key::text) then
    raise exception using errcode='23505',message='Clé idempotente déjà utilisée'; end if;
  select * into a from public.contract_amendments where id=p_amendment_id for update;
  if not found or a.status<>'awaiting_acceptances' then
    raise exception using errcode='23514',message='Proposition en attente requise'; end if;
  select * into c from public.contracts where id=a.contract_id;
  if c.status<>'ready' or c.current_version_id<>a.base_contract_version_id or c.legal_effect_enabled then
    raise exception using errcode='23514',message='Version contractuelle de base périmée'; end if;
  if exists(select 1 from public.contract_parties cp where cp.contract_id=c.id
    and cp.role in ('client','contractor') and not dao_private.account_active(cp.user_id)) then
    raise exception using errcode='23514',message='Parties contractuelles actives requises'; end if;
  select id into version_id from public.contract_amendment_versions
    where amendment_id=a.id and version_no=1;
  if (select count(*) from public.contract_amendment_acceptances aa
      where aa.amendment_id=a.id and aa.amendment_version_id=version_id
        and aa.party_role in ('client','contractor'))<>2 then
    raise exception using errcode='23514',message='Accords client et prestataire requis'; end if;
  update public.contract_amendments set status='accepted',validated_at=now(),validated_by=p_actor_id,
    validation_reason=btrim(p_reason) where id=a.id;
  insert into public.contract_amendment_events(amendment_id,actor_id,event_type,from_status,to_status,reason)
    values(a.id,p_actor_id,'accepted','awaiting_acceptances','accepted',btrim(p_reason));
  result:=jsonb_build_object('amendment_id',a.id,'status','accepted','legal_effect_enabled',false,
    'validated_by',p_actor_id);
  insert into public.command_receipts(actor_id,idempotency_key,command,result)
    values(p_actor_id,p_idempotency_key::text,'validate_contract_amendment',result);
  return result;
end;
$$;

create function dao_private.reject_contract_amendment(
  p_actor_id uuid,p_amendment_id uuid,p_reason text,p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.contract_amendments; party_role text; result jsonb;
begin
  if p_actor_id is null or p_idempotency_key is null or btrim(coalesce(p_reason,''))='' then
    raise exception using errcode='22023',message='Acteur, motif et clé requis'; end if;
  if not dao_private.account_active(p_actor_id) then
    raise exception using errcode='42501',message='Compte actif requis'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text||':'||p_idempotency_key::text,0));
  select cr.result into result from public.command_receipts cr where cr.actor_id=p_actor_id
    and cr.idempotency_key=p_idempotency_key::text and cr.command='reject_contract_amendment';
  if result is not null then return result; end if;
  if exists(select 1 from public.command_receipts where actor_id=p_actor_id and idempotency_key=p_idempotency_key::text) then
    raise exception using errcode='23505',message='Clé idempotente déjà utilisée'; end if;
  select * into a from public.contract_amendments where id=p_amendment_id for update;
  if not found or a.status<>'awaiting_acceptances' then
    raise exception using errcode='23514',message='Proposition en attente requise'; end if;
  select cp.role into party_role from public.contract_parties cp where cp.contract_id=a.contract_id
    and cp.user_id=p_actor_id and cp.role in ('client','contractor');
  if party_role is null then raise exception using errcode='42501',message='Partie contractuelle requise'; end if;
  update public.contract_amendments set status='rejected',rejected_at=now(),rejected_by=p_actor_id,
    rejection_reason=btrim(p_reason) where id=a.id;
  insert into public.contract_amendment_events(amendment_id,actor_id,event_type,from_status,to_status,reason,metadata)
    values(a.id,p_actor_id,'rejected','awaiting_acceptances','rejected',btrim(p_reason),
      jsonb_build_object('party_role',party_role));
  result:=jsonb_build_object('amendment_id',a.id,'status','rejected','party_role',party_role,
    'legal_effect_enabled',false);
  insert into public.command_receipts(actor_id,idempotency_key,command,result)
    values(p_actor_id,p_idempotency_key::text,'reject_contract_amendment',result);
  return result;
end;
$$;

create function dao_private.cancel_contract_amendment(
  p_actor_id uuid,p_amendment_id uuid,p_reason text,p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.contract_amendments; result jsonb;
begin
  if p_actor_id is null or p_idempotency_key is null or btrim(coalesce(p_reason,''))='' then
    raise exception using errcode='22023',message='Acteur, motif et clé requis'; end if;
  if not dao_private.account_active(p_actor_id) or not exists(
    select 1 from public.user_roles where user_id=p_actor_id and role='dao_admin'
  ) then raise exception using errcode='42501',message='Administrateur actif requis'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text||':'||p_idempotency_key::text,0));
  select cr.result into result from public.command_receipts cr where cr.actor_id=p_actor_id
    and cr.idempotency_key=p_idempotency_key::text and cr.command='cancel_contract_amendment';
  if result is not null then return result; end if;
  if exists(select 1 from public.command_receipts where actor_id=p_actor_id and idempotency_key=p_idempotency_key::text) then
    raise exception using errcode='23505',message='Clé idempotente déjà utilisée'; end if;
  select * into a from public.contract_amendments where id=p_amendment_id for update;
  if not found or a.status<>'awaiting_acceptances' then
    raise exception using errcode='23514',message='Seule une proposition en attente peut être annulée'; end if;
  update public.contract_amendments set status='cancelled',cancelled_at=now(),cancelled_by=p_actor_id,
    cancellation_reason=btrim(p_reason) where id=a.id;
  insert into public.contract_amendment_events(amendment_id,actor_id,event_type,from_status,to_status,reason)
    values(a.id,p_actor_id,'cancelled','awaiting_acceptances','cancelled',btrim(p_reason));
  result:=jsonb_build_object('amendment_id',a.id,'status','cancelled','legal_effect_enabled',false);
  insert into public.command_receipts(actor_id,idempotency_key,command,result)
    values(p_actor_id,p_idempotency_key::text,'cancel_contract_amendment',result);
  return result;
end;
$$;

create function public.propose_contract_amendment(
  p_actor_id uuid,p_contract_id uuid,p_scope_clarification text,p_amount_delta_millimes bigint,
  p_planned_start_date date,p_duration_days integer,p_reason text,p_idempotency_key uuid
) returns jsonb language sql security definer set search_path='' as $$
  select dao_private.propose_contract_amendment($1,$2,$3,$4,$5,$6,$7,$8);
$$;
create function public.record_contract_amendment_acceptance(
  p_actor_id uuid,p_amendment_id uuid,p_amendment_version_id uuid,p_method text,
  p_evidence_hash text,p_provider_reference text,p_evidence_metadata jsonb,
  p_accepted_at timestamptz,p_idempotency_key uuid
) returns jsonb language sql security definer set search_path='' as $$
  select dao_private.record_contract_amendment_acceptance($1,$2,$3,$4,$5,$6,$7,$8,$9);
$$;
create function public.validate_contract_amendment(
  p_actor_id uuid,p_amendment_id uuid,p_reason text,p_idempotency_key uuid
) returns jsonb language sql security definer set search_path='' as $$
  select dao_private.validate_contract_amendment($1,$2,$3,$4);
$$;
create function public.reject_contract_amendment(
  p_actor_id uuid,p_amendment_id uuid,p_reason text,p_idempotency_key uuid
) returns jsonb language sql security definer set search_path='' as $$
  select dao_private.reject_contract_amendment($1,$2,$3,$4);
$$;
create function public.cancel_contract_amendment(
  p_actor_id uuid,p_amendment_id uuid,p_reason text,p_idempotency_key uuid
) returns jsonb language sql security definer set search_path='' as $$
  select dao_private.cancel_contract_amendment($1,$2,$3,$4);
$$;

revoke all on function public.propose_contract_amendment(uuid,uuid,text,bigint,date,integer,text,uuid),
  public.record_contract_amendment_acceptance(uuid,uuid,uuid,text,text,text,jsonb,timestamptz,uuid),
  public.validate_contract_amendment(uuid,uuid,text,uuid),
  public.reject_contract_amendment(uuid,uuid,text,uuid),
  public.cancel_contract_amendment(uuid,uuid,text,uuid)
  from public,anon,authenticated;
grant execute on function public.propose_contract_amendment(uuid,uuid,text,bigint,date,integer,text,uuid),
  public.record_contract_amendment_acceptance(uuid,uuid,uuid,text,text,text,jsonb,timestamptz,uuid),
  public.validate_contract_amendment(uuid,uuid,text,uuid),
  public.reject_contract_amendment(uuid,uuid,text,uuid),
  public.cancel_contract_amendment(uuid,uuid,text,uuid)
  to service_role;
revoke all on function dao_private.contract_amendment(uuid),
  dao_private.contract_amendment_version_guard(),dao_private.contract_amendment_state_guard(),
  dao_private.propose_contract_amendment(uuid,uuid,text,bigint,date,integer,text,uuid),
  dao_private.record_contract_amendment_acceptance(uuid,uuid,uuid,text,text,text,jsonb,timestamptz,uuid),
  dao_private.validate_contract_amendment(uuid,uuid,text,uuid),
  dao_private.reject_contract_amendment(uuid,uuid,text,uuid),
  dao_private.cancel_contract_amendment(uuid,uuid,text,uuid)
  from public,anon,authenticated;
grant execute on function dao_private.contract_amendment(uuid) to authenticated,service_role;

alter table public.contract_amendments enable row level security;
alter table public.contract_amendment_versions enable row level security;
alter table public.contract_amendment_acceptances enable row level security;
alter table public.contract_amendment_events enable row level security;
revoke all on public.contract_amendments,public.contract_amendment_versions,
  public.contract_amendment_acceptances,public.contract_amendment_events from anon,authenticated;
grant select on public.contract_amendments,public.contract_amendment_versions,
  public.contract_amendment_acceptances,public.contract_amendment_events to authenticated;
create policy read_allowed on public.contract_amendments for select to authenticated
  using(dao_private.contract(contract_id));
create policy read_allowed on public.contract_amendment_versions for select to authenticated
  using(dao_private.contract_amendment(amendment_id));
create policy read_allowed on public.contract_amendment_acceptances for select to authenticated
  using(dao_private.contract_amendment(amendment_id));
create policy read_allowed on public.contract_amendment_events for select to authenticated
  using(dao_private.contract_amendment(amendment_id));

create index contract_amendments_contract_idx on public.contract_amendments(contract_id,created_at,id);
create index contract_amendments_base_version_idx on public.contract_amendments(base_contract_version_id);
create index contract_amendment_versions_amendment_idx on public.contract_amendment_versions(amendment_id);
create index contract_amendment_acceptances_amendment_idx on public.contract_amendment_acceptances(amendment_id,amendment_version_id,party_role);
create index contract_amendment_events_amendment_idx on public.contract_amendment_events(amendment_id,created_at,id);

commit;
