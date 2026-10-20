-- P9-A1 (#345): optional bilateral conditions agreed before contract preparation.
-- The agreement is versioned, append-only and explicitly non-engaging. It never
-- changes the awarded offer, creates a contract, signs, receives or pays anything.
begin;

create table public.precontract_agreements (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  award_id uuid not null unique,
  project_id uuid not null,
  contractor_id uuid not null,
  client_id uuid not null references auth.users,
  contractor_user_id uuid not null references auth.users,
  status text not null default 'negotiating' check(status in ('negotiating','agreed','rejected')),
  current_version_id uuid,
  agreed_at timestamptz,
  foreign key(award_id,project_id,contractor_id) references public.awards(id,project_id,contractor_id),
  check(client_id<>contractor_user_id),
  check((status='agreed')=(agreed_at is not null))
);

create table public.precontract_agreement_versions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  agreement_id uuid not null references public.precontract_agreements,
  version_no integer not null check(version_no between 1 and 1000),
  content jsonb not null,
  content_hash text not null check(content_hash~'^[0-9a-f]{64}$'),
  proposed_by uuid not null references auth.users,
  proposed_role text not null check(proposed_role in ('client','contractor')),
  unique(agreement_id,version_no),
  unique(agreement_id,content_hash),
  unique(id,agreement_id)
);

alter table public.precontract_agreements
  add constraint precontract_agreements_current_version_fkey
  foreign key(current_version_id,id)
  references public.precontract_agreement_versions(id,agreement_id);

create table public.precontract_agreement_acceptances (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  agreement_id uuid not null references public.precontract_agreements,
  agreement_version_id uuid not null,
  party_role text not null check(party_role in ('client','contractor')),
  accepted_by uuid not null references auth.users,
  accepted_at timestamptz not null default now(),
  foreign key(agreement_version_id,agreement_id)
    references public.precontract_agreement_versions(id,agreement_id),
  unique(agreement_version_id,party_role)
);

create table public.precontract_agreement_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  agreement_id uuid not null references public.precontract_agreements,
  agreement_version_id uuid references public.precontract_agreement_versions,
  actor_id uuid not null references auth.users,
  actor_role text not null check(actor_role in ('client','contractor')),
  event_type text not null check(event_type in ('proposed','counter_proposed','accepted','agreed','rejected')),
  reason text check(reason is null or length(btrim(reason)) between 1 and 2000),
  metadata jsonb not null default '{}'::jsonb
);

create index precontract_agreements_project_idx
  on public.precontract_agreements(project_id,created_at desc);
create index precontract_versions_agreement_idx
  on public.precontract_agreement_versions(agreement_id,version_no desc);
create index precontract_acceptances_agreement_idx
  on public.precontract_agreement_acceptances(agreement_id,agreement_version_id);
create index precontract_events_agreement_idx
  on public.precontract_agreement_events(agreement_id,created_at,id);

create or replace function dao_private.precontract_party_for_award(
  p_award_id uuid,p_actor_id uuid
) returns text
language sql stable security definer set search_path='' as $$
  select case
    when p.client_id=p_actor_id and cp.user_id<>p_actor_id
      and exists(select 1 from public.user_roles ur where ur.user_id=p_actor_id and ur.role='client')
      and exists(select 1 from public.project_members pm where pm.project_id=p.id
        and pm.user_id=p_actor_id and pm.participation_role='client' and pm.status='accepted')
      then 'client'
    when cp.user_id=p_actor_id and p.client_id<>p_actor_id
      and exists(select 1 from public.user_roles ur where ur.user_id=p_actor_id and ur.role='contractor')
      and exists(select 1 from public.project_members pm where pm.project_id=p.id
        and pm.user_id=p_actor_id and pm.participation_role='contractor' and pm.status='accepted')
      then 'contractor'
    else null
  end
  from public.awards a
  join public.projects p on p.id=a.project_id
  join public.contractor_profiles cp on cp.id=a.contractor_id
  where a.id=p_award_id;
$$;

create or replace function dao_private.precontract_award_reference(
  p_award_id uuid
) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'award_id',a.id,
    'project_id',a.project_id,
    'currency','TND',
    'total_millimes',coalesce(sum(ai.agreed_millimes),0),
    'items',coalesce(jsonb_agg(
      jsonb_build_object(
        'award_item_id',ai.id,
        'request_id',ai.request_id,
        'bid_item_id',ai.bid_item_id,
        'bid_version_id',bi.bid_version_id,
        'agreed_millimes',ai.agreed_millimes,
        'title',prv.title,
        'scope',prv.scope,
        'duration_days',bi.duration_days,
        'inclusions',bi.inclusions,
        'exclusions',bi.exclusions,
        'sub_lots',coalesce((
          select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
            'node_key',sl.node_key,
            'position',sl.position,
            'title',sl.title,
            'scope',sl.scope,
            'start_date',sl.start_date,
            'end_date',sl.end_date,
            'duration_days',sl.duration_days,
            'budget_millimes',sl.budget_millimes,
            'official_sub_lot_id',sl.official_sub_lot_id
          )) order by sl.position)
          from public.bid_sub_lots sl
          where sl.bid_item_id=bi.id
        ),'[]'::jsonb)
      ) order by ai.id
    ),'[]'::jsonb)
  )
  from public.awards a
  join public.award_items ai on ai.award_id=a.id and ai.active
  join public.bid_items bi on bi.id=ai.bid_item_id
  join public.project_request_versions prv on prv.id=bi.request_version_id
  where a.id=p_award_id
  group by a.id,a.project_id;
$$;

create or replace function dao_private.precontract_normalize_terms(
  p_award_id uuid,p_terms jsonb
) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  terms jsonb:=coalesce(p_terms,'{}'::jsonb);
  v_start date; v_duration integer; v_execution text; v_mode text;
  installments jsonb; schedule jsonb; entry jsonb;
  normalized_installments jsonb:='[]'::jsonb;
  normalized_schedule jsonb:='[]'::jsonb;
  v_label text; v_due date; v_amount bigint; v_sum bigint:=0;
  v_node uuid; v_sub_start date; v_sub_end date; v_sub_duration integer;
  seen_nodes uuid[]:='{}'::uuid[];
  reference_total bigint;
begin
  if jsonb_typeof(terms)<>'object' then
    raise exception using errcode='22023',message='Les conditions doivent être un objet';
  end if;
  if exists(select 1 from jsonb_object_keys(terms) k
    where k not in ('planned_start_date','duration_days','execution_terms',
      'payment_mode','installments','sub_lot_schedule')) then
    raise exception using errcode='22023',message='Champ de conditions non autorisé';
  end if;
  begin
    v_start:=nullif(terms->>'planned_start_date','')::date;
    v_duration:=nullif(terms->>'duration_days','')::integer;
  exception when invalid_text_representation or datetime_field_overflow then
    raise exception using errcode='22023',message='Date ou durée invalide';
  end;
  if v_duration is not null and v_duration not between 1 and 3650 then
    raise exception using errcode='22023',message='La durée doit être comprise entre 1 et 3650 jours';
  end if;
  v_execution:=nullif(btrim(terms->>'execution_terms'),'');
  if length(coalesce(v_execution,''))>4000 then
    raise exception using errcode='22023',message='Modalités d’exécution trop longues';
  end if;
  v_mode:=coalesce(nullif(terms->>'payment_mode',''),'none');
  if v_mode not in ('none','daily','weekly','monthly','milestone','sub_lot','lot_end','project_end') then
    raise exception using errcode='22023',message='Modalité d’échéancier invalide';
  end if;

  installments:=coalesce(terms->'installments','[]'::jsonb);
  if jsonb_typeof(installments)<>'array' or jsonb_array_length(installments)>100 then
    raise exception using errcode='22023',message='Échéancier invalide';
  end if;
  if v_mode='none' and jsonb_array_length(installments)>0 then
    raise exception using errcode='22023',message='Un échéancier exige une modalité';
  end if;
  for entry in select value from jsonb_array_elements(installments) loop
    if jsonb_typeof(entry)<>'object' or exists(
      select 1 from jsonb_object_keys(entry) k where k not in ('label','due_date','amount_millimes')
    ) then raise exception using errcode='22023',message='Échéance invalide'; end if;
    v_label:=btrim(coalesce(entry->>'label',''));
    begin
      v_due:=nullif(entry->>'due_date','')::date;
      v_amount:=(entry->>'amount_millimes')::bigint;
    exception when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then
      raise exception using errcode='22023',message='Date ou montant d’échéance invalide';
    end;
    if length(v_label) not between 1 and 120 or v_amount is null or v_amount not between 1 and 1000000000000 then
      raise exception using errcode='22023',message='Libellé ou montant d’échéance invalide';
    end if;
    v_sum:=v_sum+v_amount;
    normalized_installments:=normalized_installments||jsonb_build_array(
      jsonb_strip_nulls(jsonb_build_object(
        'label',v_label,'due_date',v_due,'amount_millimes',v_amount
      ))
    );
  end loop;
  select sum(ai.agreed_millimes) into reference_total
  from public.award_items ai where ai.award_id=p_award_id and ai.active;
  if jsonb_array_length(installments)>0 and v_sum<>reference_total then
    raise exception using errcode='23514',message='Le total de l’échéancier doit égaler le montant attribué';
  end if;

  schedule:=coalesce(terms->'sub_lot_schedule','[]'::jsonb);
  if jsonb_typeof(schedule)<>'array' or jsonb_array_length(schedule)>200 then
    raise exception using errcode='22023',message='Calendrier de sous-lots invalide';
  end if;
  for entry in select value from jsonb_array_elements(schedule) loop
    if jsonb_typeof(entry)<>'object' or exists(
      select 1 from jsonb_object_keys(entry) k
      where k not in ('node_key','start_date','end_date','duration_days')
    ) then raise exception using errcode='22023',message='Calendrier de sous-lot invalide'; end if;
    begin
      v_node:=(entry->>'node_key')::uuid;
      v_sub_start:=nullif(entry->>'start_date','')::date;
      v_sub_end:=nullif(entry->>'end_date','')::date;
      v_sub_duration:=nullif(entry->>'duration_days','')::integer;
    exception when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then
      raise exception using errcode='22023',message='Référence, date ou durée de sous-lot invalide';
    end;
    if v_node is null then
      raise exception using errcode='22023',message='Référence de sous-lot requise';
    end if;
    if v_node=any(seen_nodes) then
      raise exception using errcode='22023',message='Sous-lot dupliqué dans le calendrier';
    end if;
    seen_nodes:=array_append(seen_nodes,v_node);
    if not exists(
      select 1
      from public.bid_sub_lots sl
      join public.bid_items bi on bi.id=sl.bid_item_id
      join public.award_items ai on ai.bid_item_id=bi.id and ai.active
      where ai.award_id=p_award_id and sl.node_key=v_node
    ) then raise exception using errcode='42501',message='Sous-lot hors attribution'; end if;
    if (v_sub_start is null)<>(v_sub_end is null)
      or (v_sub_end is not null and v_sub_end<v_sub_start)
      or (v_sub_duration is not null and v_sub_duration not between 1 and 3650)
      or (v_sub_start is not null and v_sub_duration is not null
        and v_sub_duration<>(v_sub_end-v_sub_start)+1) then
      raise exception using errcode='22023',message='Dates ou durée de sous-lot incohérentes';
    end if;
    normalized_schedule:=normalized_schedule||jsonb_build_array(
      jsonb_strip_nulls(jsonb_build_object(
        'node_key',v_node,'start_date',v_sub_start,'end_date',v_sub_end,
        'duration_days',v_sub_duration
      ))
    );
  end loop;

  return jsonb_strip_nulls(jsonb_build_object(
    'planned_start_date',v_start,
    'duration_days',v_duration,
    'execution_terms',v_execution,
    'payment_mode',v_mode,
    'installments',normalized_installments,
    'sub_lot_schedule',normalized_schedule
  ));
end;
$$;

create or replace function dao_private.precontract_append_only() returns trigger
language plpgsql set search_path='' as $$
begin
  raise exception using errcode='23514',message='Historique d’accord immuable';
end;
$$;

create or replace function dao_private.precontract_version_guard() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.content_hash<>dao_private.contract_version_hash(new.content)
    or coalesce((new.content->>'non_engaging')::boolean,false) is distinct from true
    or coalesce((new.content->>'legal_effect_enabled')::boolean,true) is distinct from false then
    raise exception using errcode='23514',message='Version d’accord invalide';
  end if;
  return new;
end;
$$;

create or replace function dao_private.precontract_state_guard() returns trigger
language plpgsql set search_path='' as $$
begin
  if current_user<>'postgres'
    or new.award_id<>old.award_id or new.project_id<>old.project_id
    or new.contractor_id<>old.contractor_id or new.client_id<>old.client_id
    or new.contractor_user_id<>old.contractor_user_id
    or new.created_at<>old.created_at then
    raise exception using errcode='23514',message='Transition d’accord réservée aux commandes contrôlées';
  end if;
  if new.current_version_id is distinct from old.current_version_id then
    if new.current_version_id is null or new.status<>'negotiating' or new.agreed_at is not null then
      raise exception using errcode='23514',message='Nouvelle version d’accord incohérente';
    end if;
  elsif new.status is distinct from old.status or new.agreed_at is distinct from old.agreed_at then
    if old.status<>'negotiating'
      or new.status not in ('agreed','rejected')
      or (new.status='agreed')<>(new.agreed_at is not null) then
      raise exception using errcode='23514',message='Transition d’accord invalide';
    end if;
  end if;
  new.updated_at:=now();
  return new;
end;
$$;

create trigger precontract_versions_hash before insert on public.precontract_agreement_versions
for each row execute function dao_private.precontract_version_guard();
create trigger controlled_precontract_agreement_update before update on public.precontract_agreements
for each row execute function dao_private.precontract_state_guard();
create trigger immutable_precontract_agreements before delete on public.precontract_agreements
for each row execute function dao_private.precontract_append_only();
create trigger immutable_precontract_versions before update or delete on public.precontract_agreement_versions
for each row execute function dao_private.precontract_append_only();
create trigger immutable_precontract_acceptances before update or delete on public.precontract_agreement_acceptances
for each row execute function dao_private.precontract_append_only();
create trigger immutable_precontract_events before update or delete on public.precontract_agreement_events
for each row execute function dao_private.precontract_append_only();

create or replace function dao_private.propose_precontract_agreement(
  p_award_id uuid,p_base_version_id uuid,p_terms jsonb,p_idempotency_key uuid
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=auth.uid(); a public.awards; agreement public.precontract_agreements;
  party_role text; reference jsonb; normalized_terms jsonb; body jsonb;
  version_id uuid; version_no integer; result jsonb;
begin
  if actor is null or p_award_id is null or p_idempotency_key is null then
    raise exception using errcode='22023',message='Acteur, attribution et clé idempotente requis';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_idempotency_key::text,0));
  select cr.result into result from public.command_receipts cr
    where cr.actor_id=actor and cr.idempotency_key=p_idempotency_key::text
      and cr.command='propose_precontract_agreement';
  if result is not null then return result; end if;
  if exists(select 1 from public.command_receipts cr
    where cr.actor_id=actor and cr.idempotency_key=p_idempotency_key::text) then
    raise exception using errcode='23505',message='Clé idempotente déjà utilisée';
  end if;

  select * into a from public.awards where id=p_award_id;
  if not found then raise exception using errcode='42501',message='Attribution inaccessible'; end if;
  perform 1 from public.projects where id=a.project_id for update;
  select * into a from public.awards where id=p_award_id for update;
  party_role:=dao_private.precontract_party_for_award(a.id,actor);
  if not dao_private.account_active(actor) or party_role is null then
    raise exception using errcode='42501',message='Partie active requise';
  end if;
  if a.status<>'confirmed' or not exists(
      select 1 from public.award_items ai where ai.award_id=a.id and ai.active
    ) or exists(select 1 from public.contracts c where c.award_id=a.id) then
    raise exception using errcode='23514',message='Accord disponible uniquement avant le contrat sur une attribution active';
  end if;

  select * into agreement from public.precontract_agreements
    where award_id=a.id for update;
  if not found then
    if p_base_version_id is not null then
      raise exception using errcode='23514',message='Version de base inattendue';
    end if;
    insert into public.precontract_agreements(
      award_id,project_id,contractor_id,client_id,contractor_user_id
    )
    select a.id,a.project_id,a.contractor_id,p.client_id,cp.user_id
    from public.projects p join public.contractor_profiles cp on cp.id=a.contractor_id
    where p.id=a.project_id
    returning * into agreement;
  elsif p_base_version_id is null or p_base_version_id<>agreement.current_version_id then
    raise exception using errcode='23514',message='La proposition repose sur une version obsolète';
  end if;

  normalized_terms:=dao_private.precontract_normalize_terms(a.id,p_terms);
  reference:=dao_private.precontract_award_reference(a.id);
  if reference is null then
    raise exception using errcode='23514',message='Périmètre attribué introuvable';
  end if;
  select coalesce(max(v.version_no),0)+1 into version_no
    from public.precontract_agreement_versions v where v.agreement_id=agreement.id;
  body:=jsonb_build_object(
    'schema','dao-precontract-agreement-v1',
    'agreement_id',agreement.id,
    'version_no',version_no,
    'non_engaging',true,
    'legal_effect_enabled',false,
    'contract_signed',false,
    'reference',reference,
    'terms',normalized_terms
  );
  insert into public.precontract_agreement_versions(
    agreement_id,version_no,content,content_hash,proposed_by,proposed_role
  ) values(
    agreement.id,version_no,body,dao_private.contract_version_hash(body),actor,party_role
  ) returning id into version_id;
  update public.precontract_agreements
    set current_version_id=version_id,status='negotiating',agreed_at=null
    where id=agreement.id;
  insert into public.precontract_agreement_events(
    agreement_id,agreement_version_id,actor_id,actor_role,event_type,metadata
  ) values(
    agreement.id,version_id,actor,party_role,
    case when version_no=1 then 'proposed' else 'counter_proposed' end,
    jsonb_build_object('version_no',version_no,'non_engaging',true)
  );
  result:=jsonb_build_object(
    'agreement_id',agreement.id,'version_id',version_id,'version_no',version_no,
    'status','negotiating','content_hash',dao_private.contract_version_hash(body),
    'party_role',party_role,'non_engaging',true,'legal_effect_enabled',false
  );
  insert into public.command_receipts(actor_id,idempotency_key,command,result)
    values(actor,p_idempotency_key::text,'propose_precontract_agreement',result);
  return result;
end;
$$;

create or replace function dao_private.accept_precontract_agreement(
  p_agreement_id uuid,p_version_id uuid,p_idempotency_key uuid
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=auth.uid(); agreement public.precontract_agreements;
  party_role text; accepted_count integer; result jsonb;
begin
  if actor is null or p_agreement_id is null or p_version_id is null or p_idempotency_key is null then
    raise exception using errcode='22023',message='Accord, version et clé idempotente requis';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_idempotency_key::text,0));
  select cr.result into result from public.command_receipts cr
    where cr.actor_id=actor and cr.idempotency_key=p_idempotency_key::text
      and cr.command='accept_precontract_agreement';
  if result is not null then return result; end if;
  if exists(select 1 from public.command_receipts cr
    where cr.actor_id=actor and cr.idempotency_key=p_idempotency_key::text) then
    raise exception using errcode='23505',message='Clé idempotente déjà utilisée';
  end if;

  select * into agreement from public.precontract_agreements where id=p_agreement_id;
  if not found then raise exception using errcode='42501',message='Accord inaccessible'; end if;
  perform 1 from public.projects where id=agreement.project_id for update;
  select * into agreement from public.precontract_agreements where id=p_agreement_id for update;
  party_role:=dao_private.precontract_party_for_award(agreement.award_id,actor);
  if not dao_private.account_active(actor) or party_role is null
    or actor not in (agreement.client_id,agreement.contractor_user_id) then
    raise exception using errcode='42501',message='Partie active requise';
  end if;
  if agreement.status<>'negotiating' or agreement.current_version_id<>p_version_id
    or not exists(select 1 from public.awards a where a.id=agreement.award_id and a.status='confirmed')
    or exists(select 1 from public.contracts c where c.award_id=agreement.award_id) then
    raise exception using errcode='23514',message='Cette version ne peut plus être acceptée';
  end if;
  insert into public.precontract_agreement_acceptances(
    agreement_id,agreement_version_id,party_role,accepted_by
  ) values(agreement.id,p_version_id,party_role,actor);
  insert into public.precontract_agreement_events(
    agreement_id,agreement_version_id,actor_id,actor_role,event_type
  ) values(agreement.id,p_version_id,actor,party_role,'accepted');

  select count(*) into accepted_count
  from public.precontract_agreement_acceptances x
  where x.agreement_id=agreement.id and x.agreement_version_id=p_version_id
    and x.party_role in ('client','contractor');
  if accepted_count=2 then
    update public.precontract_agreements set status='agreed',agreed_at=now()
      where id=agreement.id;
    insert into public.precontract_agreement_events(
      agreement_id,agreement_version_id,actor_id,actor_role,event_type,metadata
    ) values(
      agreement.id,p_version_id,actor,party_role,'agreed',
      jsonb_build_object('non_engaging',true,'contract_signed',false)
    );
  end if;
  result:=jsonb_build_object(
    'agreement_id',agreement.id,'version_id',p_version_id,
    'party_role',party_role,
    'status',case when accepted_count=2 then 'agreed' else 'negotiating' end,
    'accepted_parties',accepted_count,
    'non_engaging',true,'legal_effect_enabled',false,'contract_signed',false
  );
  insert into public.command_receipts(actor_id,idempotency_key,command,result)
    values(actor,p_idempotency_key::text,'accept_precontract_agreement',result);
  return result;
exception when unique_violation then
  raise exception using errcode='23505',message='Cette partie a déjà accepté cette version';
end;
$$;

create or replace function dao_private.reject_precontract_agreement(
  p_agreement_id uuid,p_version_id uuid,p_reason text,p_idempotency_key uuid
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=auth.uid(); agreement public.precontract_agreements;
  party_role text; result jsonb;
begin
  if actor is null or p_agreement_id is null or p_version_id is null
    or p_idempotency_key is null or length(btrim(coalesce(p_reason,''))) not between 1 and 2000 then
    raise exception using errcode='22023',message='Accord, version, motif et clé idempotente requis';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_idempotency_key::text,0));
  select cr.result into result from public.command_receipts cr
    where cr.actor_id=actor and cr.idempotency_key=p_idempotency_key::text
      and cr.command='reject_precontract_agreement';
  if result is not null then return result; end if;
  if exists(select 1 from public.command_receipts cr
    where cr.actor_id=actor and cr.idempotency_key=p_idempotency_key::text) then
    raise exception using errcode='23505',message='Clé idempotente déjà utilisée';
  end if;

  select * into agreement from public.precontract_agreements where id=p_agreement_id;
  if not found then raise exception using errcode='42501',message='Accord inaccessible'; end if;
  perform 1 from public.projects where id=agreement.project_id for update;
  select * into agreement from public.precontract_agreements where id=p_agreement_id for update;
  party_role:=dao_private.precontract_party_for_award(agreement.award_id,actor);
  if not dao_private.account_active(actor) or party_role is null
    or actor not in (agreement.client_id,agreement.contractor_user_id) then
    raise exception using errcode='42501',message='Partie active requise';
  end if;
  if agreement.status<>'negotiating' or agreement.current_version_id<>p_version_id
    or exists(select 1 from public.contracts c where c.award_id=agreement.award_id) then
    raise exception using errcode='23514',message='Cette version ne peut plus être refusée';
  end if;
  update public.precontract_agreements set status='rejected',agreed_at=null
    where id=agreement.id;
  insert into public.precontract_agreement_events(
    agreement_id,agreement_version_id,actor_id,actor_role,event_type,reason
  ) values(agreement.id,p_version_id,actor,party_role,'rejected',btrim(p_reason));
  result:=jsonb_build_object(
    'agreement_id',agreement.id,'version_id',p_version_id,'party_role',party_role,
    'status','rejected','reason',btrim(p_reason),
    'non_engaging',true,'legal_effect_enabled',false,'contract_signed',false
  );
  insert into public.command_receipts(actor_id,idempotency_key,command,result)
    values(actor,p_idempotency_key::text,'reject_precontract_agreement',result);
  return result;
end;
$$;

create or replace function dao_private.precontract_agreement_snapshot(
  p_award_id uuid
) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  actor uuid:=auth.uid(); agreement public.precontract_agreements;
  party_role text; current_version public.precontract_agreement_versions;
  reference jsonb; can_propose boolean; result jsonb;
begin
  if actor is null or p_award_id is null or not dao_private.account_active(actor) then
    raise exception using errcode='42501',message='Authentification active requise';
  end if;
  party_role:=dao_private.precontract_party_for_award(p_award_id,actor);
  if party_role is null then raise exception using errcode='42501',message='Attribution inaccessible'; end if;
  select * into agreement from public.precontract_agreements where award_id=p_award_id;
  can_propose:=exists(select 1 from public.awards a where a.id=p_award_id and a.status='confirmed')
    and not exists(select 1 from public.contracts c where c.award_id=p_award_id);
  if not found then
    reference:=dao_private.precontract_award_reference(p_award_id);
    return jsonb_build_object(
      'agreement',null,
      'reference',reference,
      'current_version',null,
      'versions','[]'::jsonb,
      'acceptances','[]'::jsonb,
      'events','[]'::jsonb,
      'permissions',jsonb_build_object(
        'party_role',party_role,'can_propose',can_propose,
        'can_accept',false,'can_reject',false
      ),
      'non_engaging',true,'legal_effect_enabled',false,'contract_signed',false
    );
  end if;
  if actor not in (agreement.client_id,agreement.contractor_user_id) then
    raise exception using errcode='42501',message='Accord inaccessible';
  end if;
  select * into current_version from public.precontract_agreement_versions
    where id=agreement.current_version_id and agreement_id=agreement.id;
  reference:=current_version.content->'reference';
  result:=jsonb_build_object(
    'agreement',jsonb_build_object(
      'id',agreement.id,'award_id',agreement.award_id,'project_id',agreement.project_id,
      'status',agreement.status,'current_version_id',agreement.current_version_id,
      'agreed_at',agreement.agreed_at,'created_at',agreement.created_at,'updated_at',agreement.updated_at
    ),
    'reference',reference,
    'current_version',jsonb_build_object(
      'id',current_version.id,'version_no',current_version.version_no,
      'content_hash',current_version.content_hash,'proposed_by',current_version.proposed_by,
      'proposed_role',current_version.proposed_role,'created_at',current_version.created_at,
      'terms',current_version.content->'terms'
    ),
    'versions',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',v.id,'version_no',v.version_no,'content_hash',v.content_hash,
        'proposed_by',v.proposed_by,'proposed_role',v.proposed_role,
        'created_at',v.created_at,'terms',v.content->'terms'
      ) order by v.version_no desc)
      from public.precontract_agreement_versions v where v.agreement_id=agreement.id
    ),'[]'::jsonb),
    'acceptances',coalesce((
      select jsonb_agg(jsonb_build_object(
        'version_id',x.agreement_version_id,'party_role',x.party_role,
        'accepted_by',x.accepted_by,'accepted_at',x.accepted_at
      ) order by x.accepted_at)
      from public.precontract_agreement_acceptances x where x.agreement_id=agreement.id
    ),'[]'::jsonb),
    'events',coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id',e.id,'version_id',e.agreement_version_id,'actor_role',e.actor_role,
        'event_type',e.event_type,'reason',e.reason,'created_at',e.created_at
      )) order by e.created_at,e.id)
      from public.precontract_agreement_events e where e.agreement_id=agreement.id
    ),'[]'::jsonb),
    'permissions',jsonb_build_object(
      'party_role',party_role,
      'can_propose',can_propose,
      'can_accept',can_propose and agreement.status='negotiating'
        and not exists(select 1 from public.precontract_agreement_acceptances x
          where x.agreement_version_id=agreement.current_version_id and x.party_role=party_role),
      'can_reject',can_propose and agreement.status='negotiating'
    ),
    'non_engaging',true,'legal_effect_enabled',false,'contract_signed',false
  );
  return result;
end;
$$;

create function public.propose_precontract_agreement(
  p_award_id uuid,p_base_version_id uuid,p_terms jsonb,p_idempotency_key uuid
) returns jsonb language sql security definer set search_path='' as $$
  select dao_private.propose_precontract_agreement(
    p_award_id,p_base_version_id,p_terms,p_idempotency_key
  );
$$;
create function public.accept_precontract_agreement(
  p_agreement_id uuid,p_version_id uuid,p_idempotency_key uuid
) returns jsonb language sql security definer set search_path='' as $$
  select dao_private.accept_precontract_agreement(
    p_agreement_id,p_version_id,p_idempotency_key
  );
$$;
create function public.reject_precontract_agreement(
  p_agreement_id uuid,p_version_id uuid,p_reason text,p_idempotency_key uuid
) returns jsonb language sql security definer set search_path='' as $$
  select dao_private.reject_precontract_agreement(
    p_agreement_id,p_version_id,p_reason,p_idempotency_key
  );
$$;
create function public.precontract_agreement_snapshot(
  p_award_id uuid
) returns jsonb language sql stable security definer set search_path='' as $$
  select dao_private.precontract_agreement_snapshot(p_award_id);
$$;

alter table public.precontract_agreements enable row level security;
alter table public.precontract_agreement_versions enable row level security;
alter table public.precontract_agreement_acceptances enable row level security;
alter table public.precontract_agreement_events enable row level security;
revoke all on public.precontract_agreements,public.precontract_agreement_versions,
  public.precontract_agreement_acceptances,public.precontract_agreement_events
  from public,anon,authenticated;
grant all on public.precontract_agreements,public.precontract_agreement_versions,
  public.precontract_agreement_acceptances,public.precontract_agreement_events
  to service_role;

revoke all on function
  dao_private.precontract_party_for_award(uuid,uuid),
  dao_private.precontract_award_reference(uuid),
  dao_private.precontract_normalize_terms(uuid,jsonb),
  dao_private.precontract_append_only(),
  dao_private.precontract_version_guard(),
  dao_private.precontract_state_guard(),
  dao_private.propose_precontract_agreement(uuid,uuid,jsonb,uuid),
  dao_private.accept_precontract_agreement(uuid,uuid,uuid),
  dao_private.reject_precontract_agreement(uuid,uuid,text,uuid),
  dao_private.precontract_agreement_snapshot(uuid)
  from public,anon,authenticated;

revoke all on function
  public.propose_precontract_agreement(uuid,uuid,jsonb,uuid),
  public.accept_precontract_agreement(uuid,uuid,uuid),
  public.reject_precontract_agreement(uuid,uuid,text,uuid),
  public.precontract_agreement_snapshot(uuid)
  from public,anon;
grant execute on function
  public.propose_precontract_agreement(uuid,uuid,jsonb,uuid),
  public.accept_precontract_agreement(uuid,uuid,uuid),
  public.reject_precontract_agreement(uuid,uuid,text,uuid),
  public.precontract_agreement_snapshot(uuid)
  to authenticated;

commit;
