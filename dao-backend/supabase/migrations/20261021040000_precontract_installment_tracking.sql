-- P9-A3 (#345): append-only, informational follow-up of the installments
-- already agreed by the Client and awarded contractor. This never records a
-- payment, creates a debt, changes the award/contract or moves money.
begin;

create table public.precontract_installment_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  agreement_id uuid not null references public.precontract_agreements,
  agreement_version_id uuid not null,
  installment_no integer not null check(installment_no between 1 and 100),
  event_type text not null check(event_type in ('declared','verified','contested','authorized')),
  actor_id uuid not null references auth.users,
  actor_role text not null check(actor_role in ('client','contractor')),
  reason text check(reason is null or length(btrim(reason)) between 1 and 2000),
  metadata jsonb not null default '{}'::jsonb,
  foreign key(agreement_version_id,agreement_id)
    references public.precontract_agreement_versions(id,agreement_id)
);

create index precontract_installment_events_version_idx
  on public.precontract_installment_events(
    agreement_version_id,installment_no,created_at desc,id desc
  );

create trigger immutable_precontract_installment_events
before update or delete on public.precontract_installment_events
for each row execute function dao_private.precontract_append_only();

create or replace function dao_private.precontract_latest_agreed_version(
  p_agreement_id uuid
) returns public.precontract_agreement_versions
language sql stable security definer set search_path='' as $$
  select v
  from public.precontract_agreement_versions v
  where v.agreement_id=p_agreement_id
    and 2=(
      select count(distinct a.party_role)
      from public.precontract_agreement_acceptances a
      where a.agreement_id=v.agreement_id
        and a.agreement_version_id=v.id
        and a.party_role in ('client','contractor')
    )
  order by v.version_no desc
  limit 1;
$$;

create or replace function dao_private.precontract_installment_snapshot(
  p_award_id uuid
) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  actor uuid:=auth.uid(); agreement public.precontract_agreements;
  agreed_version public.precontract_agreement_versions;
  v_party_role text; v_active boolean; result jsonb;
begin
  if actor is null or p_award_id is null or not dao_private.account_active(actor) then
    raise exception using errcode='42501',message='Authentification active requise';
  end if;
  v_party_role:=dao_private.precontract_party_for_award(p_award_id,actor);
  if v_party_role is null then
    raise exception using errcode='42501',message='Attribution inaccessible';
  end if;
  select * into agreement from public.precontract_agreements where award_id=p_award_id;
  if not found or actor not in (agreement.client_id,agreement.contractor_user_id) then
    raise exception using errcode='42501',message='Accord inaccessible';
  end if;
  select * into agreed_version
    from dao_private.precontract_latest_agreed_version(agreement.id);
  v_active:=exists(
    select 1 from public.awards a
    join public.projects p on p.id=a.project_id and p.status<>'archived'
    where a.id=p_award_id and a.status in ('confirmed','contracting','contracted')
      and exists(select 1 from public.award_items ai where ai.award_id=a.id and ai.active)
  );
  if agreed_version.id is null then
    return jsonb_build_object(
      'agreement_id',agreement.id,'agreement_version_id',null,
      'payment_mode','none','installments','[]'::jsonb,
      'permissions',jsonb_build_object('party_role',v_party_role),
      'informational_only',true,'money_moved',false,
      'payment_recorded',false,'debt_created',false
    );
  end if;

  select jsonb_build_object(
    'agreement_id',agreement.id,
    'agreement_version_id',agreed_version.id,
    'version_no',agreed_version.version_no,
    'content_hash',agreed_version.content_hash,
    'payment_mode',agreed_version.content#>>'{terms,payment_mode}',
    'total_millimes',agreed_version.content#>'{reference,total_millimes}',
    'currency',agreed_version.content#>>'{reference,currency}',
    'installments',coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'installment_no',i.installment_no,
        'label',i.entry->>'label',
        'due_date',i.entry->>'due_date',
        'amount_millimes',(i.entry->>'amount_millimes')::bigint,
        'status',coalesce(e.event_type,'pending'),
        'last_event',case when e.id is null then null else jsonb_strip_nulls(jsonb_build_object(
          'id',e.id,'event_type',e.event_type,'actor_role',e.actor_role,
          'reason',e.reason,'created_at',e.created_at
        )) end,
        'can_declare',v_active and v_party_role='contractor'
          and coalesce(e.event_type,'pending') in ('pending','contested'),
        'can_verify',v_active and v_party_role='client' and e.event_type='declared',
        'can_contest',v_active and v_party_role='client'
          and e.event_type in ('declared','verified'),
        'can_authorize',v_active and v_party_role='client' and e.event_type='verified'
      )) order by i.installment_no)
      from jsonb_array_elements(
        coalesce(agreed_version.content#>'{terms,installments}','[]'::jsonb)
      ) with ordinality as raw(entry,installment_no)
      cross join lateral (
        select raw.entry,raw.installment_no::integer
      ) i
      left join lateral (
        select ev.* from public.precontract_installment_events ev
        where ev.agreement_version_id=agreed_version.id
          and ev.installment_no=i.installment_no
        order by ev.created_at desc,ev.id desc limit 1
      ) e on true
    ),'[]'::jsonb),
    'events',coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id',e.id,'installment_no',e.installment_no,'event_type',e.event_type,
        'actor_role',e.actor_role,'reason',e.reason,'created_at',e.created_at
      )) order by e.created_at,e.id)
      from public.precontract_installment_events e
      where e.agreement_version_id=agreed_version.id
    ),'[]'::jsonb),
    'permissions',jsonb_build_object('party_role',v_party_role),
    'informational_only',true,'money_moved',false,
    'payment_recorded',false,'debt_created',false
  ) into result;
  return result;
end;
$$;

create or replace function dao_private.record_precontract_installment_event(
  p_agreement_id uuid,p_version_id uuid,p_installment_no integer,
  p_event_type text,p_reason text,p_idempotency_key uuid
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=auth.uid(); agreement public.precontract_agreements;
  agreed_version public.precontract_agreement_versions;
  v_party_role text; current_event text; installment jsonb;
  event_id uuid; result jsonb;
begin
  if actor is null or p_agreement_id is null or p_version_id is null
    or p_installment_no is null or p_event_type is null or p_idempotency_key is null then
    raise exception using errcode='22023',message='Accord, version, échéance, action et clé idempotente requis';
  end if;
  if p_event_type not in ('declared','verified','contested','authorized') then
    raise exception using errcode='22023',message='Action d’échéancier invalide';
  end if;
  if p_event_type='contested'
    and length(btrim(coalesce(p_reason,''))) not between 1 and 2000 then
    raise exception using errcode='22023',message='Un motif de contestation est requis';
  end if;
  if p_event_type<>'contested' and p_reason is not null
    and length(btrim(p_reason)) not between 1 and 2000 then
    raise exception using errcode='22023',message='Note invalide';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_idempotency_key::text,0));
  select cr.result into result from public.command_receipts cr
    where cr.actor_id=actor and cr.idempotency_key=p_idempotency_key::text
      and cr.command='record_precontract_installment_event';
  if result is not null then return result; end if;
  if exists(select 1 from public.command_receipts cr
    where cr.actor_id=actor and cr.idempotency_key=p_idempotency_key::text) then
    raise exception using errcode='23505',message='Clé idempotente déjà utilisée';
  end if;

  select * into agreement from public.precontract_agreements where id=p_agreement_id;
  if not found then raise exception using errcode='42501',message='Accord inaccessible'; end if;
  perform 1 from public.projects where id=agreement.project_id for update;
  select * into agreement from public.precontract_agreements where id=p_agreement_id for update;
  v_party_role:=dao_private.precontract_party_for_award(agreement.award_id,actor);
  if not dao_private.account_active(actor) or v_party_role is null
    or actor not in (agreement.client_id,agreement.contractor_user_id) then
    raise exception using errcode='42501',message='Partie active requise';
  end if;
  if not exists(
    select 1 from public.awards a
    join public.projects p on p.id=a.project_id and p.status<>'archived'
    where a.id=agreement.award_id and a.status in ('confirmed','contracting','contracted')
      and exists(select 1 from public.award_items ai where ai.award_id=a.id and ai.active)
  ) then
    raise exception using errcode='23514',message='Échéancier indisponible sur cette attribution';
  end if;
  select * into agreed_version
    from dao_private.precontract_latest_agreed_version(agreement.id);
  if agreed_version.id is null or agreed_version.id<>p_version_id then
    raise exception using errcode='23514',message='Version d’échéancier non convenue ou obsolète';
  end if;
  installment:=agreed_version.content#>array[
    'terms','installments',(p_installment_no-1)::text
  ];
  if p_installment_no not between 1 and 100 or installment is null
    or jsonb_typeof(installment)<>'object' then
    raise exception using errcode='22023',message='Échéance introuvable';
  end if;

  select e.event_type into current_event
  from public.precontract_installment_events e
  where e.agreement_version_id=agreed_version.id
    and e.installment_no=p_installment_no
  order by e.created_at desc,e.id desc limit 1;
  current_event:=coalesce(current_event,'pending');
  if (p_event_type='declared' and not (
      v_party_role='contractor' and current_event in ('pending','contested')
    )) or (p_event_type='verified' and not (
      v_party_role='client' and current_event='declared'
    )) or (p_event_type='contested' and not (
      v_party_role='client' and current_event in ('declared','verified')
    )) or (p_event_type='authorized' and not (
      v_party_role='client' and current_event='verified'
    )) then
    raise exception using errcode='23514',message='Transition d’échéancier non autorisée';
  end if;

  insert into public.precontract_installment_events(
    agreement_id,agreement_version_id,installment_no,event_type,
    actor_id,actor_role,reason,metadata
  ) values(
    agreement.id,agreed_version.id,p_installment_no,p_event_type,
    actor,v_party_role,nullif(btrim(coalesce(p_reason,'')),''),
    jsonb_build_object(
      'label',installment->>'label',
      'due_date',installment->>'due_date',
      'amount_millimes',(installment->>'amount_millimes')::bigint,
      'currency',agreed_version.content#>>'{reference,currency}',
      'informational_only',true,'money_moved',false,
      'payment_recorded',false,'debt_created',false
    )
  ) returning id into event_id;
  result:=jsonb_build_object(
    'event_id',event_id,'agreement_id',agreement.id,
    'agreement_version_id',agreed_version.id,'installment_no',p_installment_no,
    'status',p_event_type,'party_role',v_party_role,
    'informational_only',true,'money_moved',false,
    'payment_recorded',false,'debt_created',false
  );
  insert into public.command_receipts(actor_id,idempotency_key,command,result)
    values(actor,p_idempotency_key::text,'record_precontract_installment_event',result);
  return result;
end;
$$;

create function public.precontract_installment_snapshot(p_award_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select dao_private.precontract_installment_snapshot(p_award_id);
$$;

create function public.record_precontract_installment_event(
  p_agreement_id uuid,p_version_id uuid,p_installment_no integer,
  p_event_type text,p_reason text,p_idempotency_key uuid
) returns jsonb language sql security definer set search_path='' as $$
  select dao_private.record_precontract_installment_event(
    p_agreement_id,p_version_id,p_installment_no,p_event_type,p_reason,p_idempotency_key
  );
$$;

alter table public.precontract_installment_events enable row level security;
revoke all on public.precontract_installment_events from public,anon,authenticated;
grant all on public.precontract_installment_events to service_role;

revoke all on function
  dao_private.precontract_latest_agreed_version(uuid),
  dao_private.precontract_installment_snapshot(uuid),
  dao_private.record_precontract_installment_event(uuid,uuid,integer,text,text,uuid)
  from public,anon,authenticated;

revoke all on function
  public.precontract_installment_snapshot(uuid),
  public.record_precontract_installment_event(uuid,uuid,integer,text,text,uuid)
  from public,anon;
grant execute on function
  public.precontract_installment_snapshot(uuid),
  public.record_precontract_installment_event(uuid,uuid,integer,text,text,uuid)
  to authenticated;

notify pgrst, 'reload schema';
commit;
