begin;

-- P2.2-B records verified acceptance evidence without pretending that a
-- simple proof is a qualified signature. Legal effect is technically blocked.
alter table public.contracts drop constraint contracts_status_check;
alter table public.contracts add constraint contracts_status_check
  check(status in ('draft','review','ready','awaiting_signatures','signed','cancelled'));
alter table public.contracts
  add column signature_mode text not null default 'disabled'
    check(signature_mode in ('disabled','trusted_simple','qualified','hybrid')),
  add column legal_effect_enabled boolean not null default false,
  add column validated_at timestamptz,
  add column validated_by uuid references auth.users,
  add column cancelled_at timestamptz,
  add column cancelled_by uuid references auth.users,
  add column cancellation_reason text,
  add constraint contracts_validation_shape check(
    (validated_at is null and validated_by is null) or
    (validated_at is not null and validated_by is not null)
  ),
  add constraint contracts_cancellation_shape check(
    (status<>'cancelled' and cancelled_at is null and cancelled_by is null and cancellation_reason is null) or
    (status='cancelled' and cancelled_at is not null and cancelled_by is not null and btrim(cancellation_reason)<>'')
  ),
  add constraint contracts_legal_mode check(not legal_effect_enabled or signature_mode<>'disabled');

alter table public.contract_events drop constraint contract_events_event_type_check;
alter table public.contract_events add constraint contract_events_event_type_check
  check(event_type in ('foundation_prepared','version_created','status_changed','acceptance_recorded','cancelled'));

create table public.contract_acceptances (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  contract_id uuid not null references public.contracts,
  contract_version_id uuid not null references public.contract_versions,
  party_role text not null check(party_role in ('client','contractor')),
  accepted_by uuid not null references auth.users,
  method text not null check(method in ('trusted_simple','qualified')),
  evidence_hash text not null check(evidence_hash~'^[0-9a-f]{64}$'),
  provider_reference text,
  evidence_metadata jsonb not null default '{}'::jsonb,
  accepted_at timestamptz not null,
  unique(contract_id,contract_version_id,party_role)
);

create trigger immutable_contract_acceptances before update or delete on public.contract_acceptances
for each row execute function dao_private.contract_append_only();

create or replace function dao_private.contract_state_guard() returns trigger
language plpgsql set search_path='' as $$
begin
  if old.status='draft' and old.current_version_id is null
     and new.current_version_id is not null and old.locked_at is null and new.locked_at is not null
     and new.award_id=old.award_id and new.project_id=old.project_id
     and new.prepared_by is not distinct from old.prepared_by
     and new.total_millimes is not distinct from old.total_millimes then
    new.updated_at:=now(); return new;
  end if;
  if current_user='postgres' and new.award_id=old.award_id and new.project_id=old.project_id
     and new.prepared_by is not distinct from old.prepared_by
     and new.total_millimes is not distinct from old.total_millimes
     and new.current_version_id is not distinct from old.current_version_id then
    new.updated_at:=now(); return new;
  end if;
  if new is distinct from old then
    raise exception using errcode='23514',message='Transition contractuelle réservée aux commandes contrôlées';
  end if;
  new.updated_at:=now(); return new;
end;
$$;

create function dao_private.start_contract_acceptance(
  p_actor_id uuid,p_contract_id uuid,p_signature_mode text,p_legal_effect_enabled boolean,p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.contracts; result jsonb;
begin
  if p_actor_id is null or p_idempotency_key is null or p_signature_mode not in ('trusted_simple','qualified','hybrid') then
    raise exception using errcode='22023',message='Paramètres contractuels invalides';
  end if;
  if coalesce(p_legal_effect_enabled,false) then
    raise exception using errcode='0A000',message='Activation juridique non autorisée dans P2.2-B';
  end if;
  if not dao_private.account_active(p_actor_id) or not exists(
    select 1 from public.user_roles where user_id=p_actor_id and role='dao_admin'
  ) then raise exception using errcode='42501',message='Administrateur actif requis'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text||':'||p_idempotency_key::text,0));
  select cr.result into result from public.command_receipts cr where cr.actor_id=p_actor_id
    and cr.idempotency_key=p_idempotency_key::text and cr.command='start_contract_acceptance';
  if result is not null then return result; end if;
  if exists(select 1 from public.command_receipts where actor_id=p_actor_id and idempotency_key=p_idempotency_key::text) then
    raise exception using errcode='23505',message='Clé idempotente déjà utilisée'; end if;
  select * into c from public.contracts where id=p_contract_id for update;
  if not found or c.status<>'draft' or c.current_version_id is null then
    raise exception using errcode='23514',message='Brouillon contractuel verrouillé requis'; end if;
  update public.contracts set status='awaiting_signatures',signature_mode=p_signature_mode,
    legal_effect_enabled=coalesce(p_legal_effect_enabled,false) where id=c.id;
  insert into public.contract_events(contract_id,actor_id,event_type,from_status,to_status,metadata)
    values(c.id,p_actor_id,'status_changed','draft','awaiting_signatures',jsonb_build_object(
      'signature_mode',p_signature_mode,'legal_effect_enabled',coalesce(p_legal_effect_enabled,false)));
  result:=jsonb_build_object('contract_id',c.id,'version_id',c.current_version_id,
    'status','awaiting_signatures','signature_mode',p_signature_mode,
    'legal_effect_enabled',coalesce(p_legal_effect_enabled,false));
  insert into public.command_receipts(actor_id,idempotency_key,command,result)
    values(p_actor_id,p_idempotency_key::text,'start_contract_acceptance',result);
  return result;
end;
$$;

create function dao_private.record_contract_acceptance(
  p_actor_id uuid,p_contract_id uuid,p_contract_version_id uuid,p_method text,
  p_evidence_hash text,p_provider_reference text,p_evidence_metadata jsonb,p_accepted_at timestamptz,p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.contracts; party_role text; result jsonb;
begin
  if p_actor_id is null or p_idempotency_key is null or p_method not in ('trusted_simple','qualified')
     or p_evidence_hash!~'^[0-9a-f]{64}$' or p_accepted_at is null or p_accepted_at>now()+interval '5 minutes' then
    raise exception using errcode='22023',message='Preuve de consentement invalide'; end if;
  if not dao_private.account_active(p_actor_id) then raise exception using errcode='42501',message='Compte actif requis'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text||':'||p_idempotency_key::text,0));
  select cr.result into result from public.command_receipts cr where cr.actor_id=p_actor_id
    and cr.idempotency_key=p_idempotency_key::text and cr.command='record_contract_acceptance';
  if result is not null then return result; end if;
  if exists(select 1 from public.command_receipts where actor_id=p_actor_id and idempotency_key=p_idempotency_key::text) then
    raise exception using errcode='23505',message='Clé idempotente déjà utilisée'; end if;
  select * into c from public.contracts where id=p_contract_id for update;
  if not found or c.status<>'awaiting_signatures' or c.current_version_id<>p_contract_version_id then
    raise exception using errcode='23514',message='Version contractuelle en attente requise'; end if;
  select cp.role into party_role from public.contract_parties cp where cp.contract_id=c.id
    and cp.user_id=p_actor_id and cp.role in ('client','contractor');
  if party_role is null then raise exception using errcode='42501',message='Partie contractuelle requise'; end if;
  if c.signature_mode='trusted_simple' and p_method<>'trusted_simple'
     or c.signature_mode='qualified' and p_method<>'qualified' then
    raise exception using errcode='23514',message='Méthode de signature incompatible'; end if;
  insert into public.contract_acceptances(contract_id,contract_version_id,party_role,accepted_by,method,
    evidence_hash,provider_reference,evidence_metadata,accepted_at)
    values(c.id,p_contract_version_id,party_role,p_actor_id,p_method,p_evidence_hash,
      nullif(btrim(p_provider_reference),''),coalesce(p_evidence_metadata,'{}'::jsonb),p_accepted_at);
  insert into public.contract_events(contract_id,actor_id,event_type,to_status,metadata)
    values(c.id,p_actor_id,'acceptance_recorded','awaiting_signatures',jsonb_build_object(
      'version_id',p_contract_version_id,'party_role',party_role,'method',p_method,'evidence_hash',p_evidence_hash));
  result:=jsonb_build_object('contract_id',c.id,'version_id',p_contract_version_id,'party_role',party_role,
    'method',p_method,'accepted_at',p_accepted_at);
  insert into public.command_receipts(actor_id,idempotency_key,command,result)
    values(p_actor_id,p_idempotency_key::text,'record_contract_acceptance',result);
  return result;
exception when unique_violation then
  raise exception using errcode='23505',message='Cette partie a déjà accepté cette version';
end;
$$;

create function dao_private.validate_contract_acceptance(
  p_actor_id uuid,p_contract_id uuid,p_reason text,p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.contracts; result jsonb; next_status text;
begin
  if p_actor_id is null or p_idempotency_key is null or btrim(coalesce(p_reason,''))='' then
    raise exception using errcode='22023',message='Acteur, clé et justification requis'; end if;
  if not dao_private.account_active(p_actor_id) or not exists(
    select 1 from public.user_roles where user_id=p_actor_id and role='dao_admin'
  ) then raise exception using errcode='42501',message='Administrateur actif requis'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text||':'||p_idempotency_key::text,0));
  select cr.result into result from public.command_receipts cr where cr.actor_id=p_actor_id
    and cr.idempotency_key=p_idempotency_key::text and cr.command='validate_contract_acceptance';
  if result is not null then return result; end if;
  if exists(select 1 from public.command_receipts where actor_id=p_actor_id and idempotency_key=p_idempotency_key::text) then
    raise exception using errcode='23505',message='Clé idempotente déjà utilisée'; end if;
  select * into c from public.contracts where id=p_contract_id for update;
  if not found or c.status<>'awaiting_signatures' then
    raise exception using errcode='23514',message='Contrat en attente de signatures requis'; end if;
  if (select count(*) from public.contract_acceptances ca where ca.contract_id=c.id
      and ca.contract_version_id=c.current_version_id and ca.party_role in ('client','contractor'))<>2 then
    raise exception using errcode='23514',message='Accords client et prestataire requis'; end if;
  next_status:=case when c.legal_effect_enabled then 'signed' else 'ready' end;
  update public.contracts set status=next_status,validated_at=now(),validated_by=p_actor_id where id=c.id;
  update public.awards set status=case when c.legal_effect_enabled then 'contracted' else 'contracting' end where id=c.award_id;
  insert into public.contract_events(contract_id,actor_id,event_type,from_status,to_status,reason,metadata)
    values(c.id,p_actor_id,'status_changed','awaiting_signatures',next_status,btrim(p_reason),
      jsonb_build_object('legal_effect_enabled',c.legal_effect_enabled));
  result:=jsonb_build_object('contract_id',c.id,'status',next_status,
    'legal_effect_enabled',c.legal_effect_enabled,'validated_by',p_actor_id);
  insert into public.command_receipts(actor_id,idempotency_key,command,result)
    values(p_actor_id,p_idempotency_key::text,'validate_contract_acceptance',result);
  return result;
end;
$$;

create function dao_private.cancel_contract_draft(
  p_actor_id uuid,p_contract_id uuid,p_reason text,p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.contracts; result jsonb;
begin
  if p_actor_id is null or p_idempotency_key is null or btrim(coalesce(p_reason,''))='' then
    raise exception using errcode='22023',message='Motif obligatoire'; end if;
  if not dao_private.account_active(p_actor_id) or not exists(
    select 1 from public.user_roles where user_id=p_actor_id and role='dao_admin'
  ) then raise exception using errcode='42501',message='Administrateur actif requis'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text||':'||p_idempotency_key::text,0));
  select cr.result into result from public.command_receipts cr where cr.actor_id=p_actor_id
    and cr.idempotency_key=p_idempotency_key::text and cr.command='cancel_contract_draft';
  if result is not null then return result; end if;
  select * into c from public.contracts where id=p_contract_id for update;
  if not found or c.status not in ('draft','review','ready','awaiting_signatures') or c.validated_at is not null then
    raise exception using errcode='23514',message='Seul un contrat non validé peut être annulé'; end if;
  update public.contracts set status='cancelled',cancelled_at=now(),cancelled_by=p_actor_id,
    cancellation_reason=btrim(p_reason) where id=c.id;
  update public.awards set status='confirmed' where id=c.award_id and status='contracting';
  insert into public.contract_events(contract_id,actor_id,event_type,from_status,to_status,reason)
    values(c.id,p_actor_id,'cancelled',c.status,'cancelled',btrim(p_reason));
  result:=jsonb_build_object('contract_id',c.id,'status','cancelled','reason',btrim(p_reason));
  insert into public.command_receipts(actor_id,idempotency_key,command,result)
    values(p_actor_id,p_idempotency_key::text,'cancel_contract_draft',result);
  return result;
end;
$$;

create function public.start_contract_acceptance(
  p_actor_id uuid,p_contract_id uuid,p_signature_mode text,p_legal_effect_enabled boolean,p_idempotency_key uuid
) returns jsonb language sql security definer set search_path='' as
$$ select dao_private.start_contract_acceptance(p_actor_id,p_contract_id,p_signature_mode,p_legal_effect_enabled,p_idempotency_key); $$;
create function public.record_contract_acceptance(
  p_actor_id uuid,p_contract_id uuid,p_contract_version_id uuid,p_method text,p_evidence_hash text,
  p_provider_reference text,p_evidence_metadata jsonb,p_accepted_at timestamptz,p_idempotency_key uuid
) returns jsonb language sql security definer set search_path='' as
$$ select dao_private.record_contract_acceptance(p_actor_id,p_contract_id,p_contract_version_id,p_method,p_evidence_hash,p_provider_reference,p_evidence_metadata,p_accepted_at,p_idempotency_key); $$;
create function public.validate_contract_acceptance(
  p_actor_id uuid,p_contract_id uuid,p_reason text,p_idempotency_key uuid
) returns jsonb language sql security definer set search_path='' as
$$ select dao_private.validate_contract_acceptance(p_actor_id,p_contract_id,p_reason,p_idempotency_key); $$;
create function public.cancel_contract_draft(
  p_actor_id uuid,p_contract_id uuid,p_reason text,p_idempotency_key uuid
) returns jsonb language sql security definer set search_path='' as
$$ select dao_private.cancel_contract_draft(p_actor_id,p_contract_id,p_reason,p_idempotency_key); $$;

revoke all on function public.start_contract_acceptance(uuid,uuid,text,boolean,uuid),
  public.record_contract_acceptance(uuid,uuid,uuid,text,text,text,jsonb,timestamptz,uuid),
  public.validate_contract_acceptance(uuid,uuid,text,uuid),public.cancel_contract_draft(uuid,uuid,text,uuid)
  from public,anon,authenticated;
grant execute on function public.start_contract_acceptance(uuid,uuid,text,boolean,uuid),
  public.record_contract_acceptance(uuid,uuid,uuid,text,text,text,jsonb,timestamptz,uuid),
  public.validate_contract_acceptance(uuid,uuid,text,uuid),public.cancel_contract_draft(uuid,uuid,text,uuid)
  to service_role;

alter table public.contract_acceptances enable row level security;
revoke all on public.contract_acceptances from anon,authenticated;
grant select on public.contract_acceptances to authenticated;
create policy read_allowed on public.contract_acceptances for select to authenticated
  using(dao_private.contract(contract_id));
create index contract_acceptances_contract_idx on public.contract_acceptances(contract_id,contract_version_id,party_role);

commit;
