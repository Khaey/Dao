-- P10-N4 (#409): immutable installment-to-work scope references.
-- A scope is an accepted addendum to one agreement version; it never changes payment state.
begin;

create table public.native_installment_scope_proposals (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  agreement_version_id uuid not null references public.precontract_agreement_versions(id),
  award_id uuid not null references public.awards(id),
  installment_no integer not null check(installment_no between 1 and 100),
  scope_type text not null check(scope_type in ('lot','sub_lot','milestone','period','project_end')),
  award_item_id uuid references public.award_items(id),
  sub_lot_id uuid references public.bid_sub_lots(id),
  milestone_key uuid,
  period_start date,
  period_end date,
  proposed_by uuid not null references auth.users,
  idempotency_key text not null check(length(idempotency_key) between 8 and 128),
  command_payload jsonb not null,
  state text not null default 'pending_acceptance' check(state in ('pending_acceptance','accepted','rejected','stale')),
  check((scope_type='lot' and award_item_id is not null and sub_lot_id is null and milestone_key is null and period_start is null and period_end is null)
    or (scope_type='sub_lot' and award_item_id is not null and sub_lot_id is not null and milestone_key is null and period_start is null and period_end is null)
    or (scope_type='milestone' and award_item_id is not null and sub_lot_id is null and milestone_key is not null and period_start is null and period_end is null)
    or (scope_type='period' and award_item_id is null and sub_lot_id is null and milestone_key is null and period_start is not null and period_end is not null and period_end>=period_start)
    or (scope_type='project_end' and award_item_id is null and sub_lot_id is null and milestone_key is null and period_start is null and period_end is null))
);
create unique index native_installment_scope_one_pending_idx
  on public.native_installment_scope_proposals(agreement_version_id,installment_no) where state='pending_acceptance';
create unique index native_installment_scope_one_accepted_idx
  on public.native_installment_scope_proposals(agreement_version_id,installment_no) where state='accepted';
create unique index native_installment_scope_idempotency_idx
  on public.native_installment_scope_proposals(proposed_by,idempotency_key);

create table public.native_installment_scope_acceptances (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  proposal_id uuid not null references public.native_installment_scope_proposals(id),
  party_role text not null check(party_role in ('client','contractor')),
  actor_id uuid not null references auth.users,
  decision text not null check(decision in ('accepted','rejected')),
  idempotency_key text not null check(length(idempotency_key) between 8 and 128),
  unique(proposal_id,party_role),unique(actor_id,idempotency_key)
);
alter table public.native_installment_scope_proposals enable row level security;
alter table public.native_installment_scope_acceptances enable row level security;
revoke all on public.native_installment_scope_proposals,public.native_installment_scope_acceptances from public,anon,authenticated;
create trigger native_installment_scope_acceptances_append_only before update or delete
  on public.native_installment_scope_acceptances for each row execute function dao_private.plan_decisions_append_only();

create function dao_private.native_installment_scope_proposal_guard()
returns trigger language plpgsql set search_path='' as $$
begin
  if (to_jsonb(new)-'state') is distinct from (to_jsonb(old)-'state') then
    raise exception using errcode='55000',message='Proposition de portée immuable';
  end if;
  if old.state<>'pending_acceptance' and new.state<>old.state then
    raise exception using errcode='55000',message='Transition de proposition invalide';
  end if;
  return new;
end;
$$;
create trigger native_installment_scope_proposals_immutable before update
  on public.native_installment_scope_proposals for each row execute function dao_private.native_installment_scope_proposal_guard();

create function dao_private.native_execution_prepare_installment_scope(
  p_agreement_version_id uuid,p_installment_no integer,p_scope_type text,
  p_award_item_id uuid,p_sub_lot_id uuid,p_milestone_key uuid,p_period_start date,p_period_end date,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); agreement record; payload jsonb; prior public.native_installment_scope_proposals; proposal_id uuid;
begin
  if actor is null or not dao_private.account_active(actor) or p_idempotency_key is null
    or length(p_idempotency_key) not between 8 and 128 then raise exception using errcode='22023',message='Commande invalide'; end if;
  payload:=jsonb_build_object('agreement_version_id',p_agreement_version_id,'installment_no',p_installment_no,
    'scope_type',p_scope_type,'award_item_id',p_award_item_id,'sub_lot_id',p_sub_lot_id,'milestone_key',p_milestone_key,
    'period_start',p_period_start,'period_end',p_period_end);
  perform pg_advisory_xact_lock(hashtextextended(actor::text||':installment-scope:'||p_idempotency_key,0));
  select * into prior from public.native_installment_scope_proposals where proposed_by=actor and idempotency_key=p_idempotency_key;
  if prior.id is not null then
    if prior.command_payload is distinct from payload then raise exception using errcode='22023',message='Clé idempotente réutilisée'; end if;
    return jsonb_build_object('proposalId',prior.id,'state',prior.state);
  end if;
  select av.id as version_id,pa.award_id,a.project_id,av.content into agreement
  from public.precontract_agreement_versions av
  join public.precontract_agreements pa on pa.id=av.agreement_id and pa.current_version_id=av.id
  join public.awards a on a.id=pa.award_id and a.status in ('confirmed','contracting','contracted')
  where av.id=p_agreement_version_id;
  if agreement.version_id is null or not exists(select 1 from public.projects p where p.id=agreement.project_id and p.status<>'archived') then
    raise exception using errcode='42501',message='Version de conditions indisponible'; end if;
  if not dao_private.manages_project(agreement.project_id)
    and dao_private.precontract_party_for_award(agreement.award_id,actor) is null then
    raise exception using errcode='42501',message='Partie ou gestionnaire habilité requis'; end if;
  if p_installment_no is null or p_installment_no not between 1 and coalesce(jsonb_array_length(agreement.content#>'{terms,installments}'),0)
    or p_scope_type is null or p_scope_type not in ('lot','sub_lot','milestone','period','project_end') then
    raise exception using errcode='22023',message='Échéance ou portée invalide'; end if;
  if exists(select 1 from public.native_installment_scope_proposals p where p.agreement_version_id=p_agreement_version_id
    and p.installment_no=p_installment_no and p.state='accepted') then
    raise exception using errcode='23505',message='Portée déjà acceptée pour cette version'; end if;
  if p_scope_type in ('lot','sub_lot','milestone') and not exists(
    select 1 from public.award_items ai where ai.id=p_award_item_id and ai.award_id=agreement.award_id and ai.active
  ) then raise exception using errcode='42501',message='Lot hors attribution'; end if;
  if p_scope_type='sub_lot' and not exists(
    select 1 from public.award_items ai join public.bid_sub_lots sl on sl.bid_item_id=ai.bid_item_id
    where ai.id=p_award_item_id and sl.id=p_sub_lot_id and sl.request_id=ai.request_id
  ) then raise exception using errcode='42501',message='Sous-lot hors attribution'; end if;
  if p_scope_type='milestone' and not exists(
    select 1 from public.site_log_events e where e.award_item_id=p_award_item_id and e.milestone_key=p_milestone_key and e.event_kind='milestone'
  ) then raise exception using errcode='42501',message='Jalon hors attribution'; end if;
  insert into public.native_installment_scope_proposals(agreement_version_id,award_id,installment_no,scope_type,
    award_item_id,sub_lot_id,milestone_key,period_start,period_end,proposed_by,idempotency_key,command_payload)
  values(p_agreement_version_id,agreement.award_id,p_installment_no,p_scope_type,p_award_item_id,p_sub_lot_id,
    p_milestone_key,p_period_start,p_period_end,actor,p_idempotency_key,payload) returning id into proposal_id;
  return jsonb_build_object('proposalId',proposal_id,'state','pending_acceptance');
end;
$$;

create function dao_private.native_execution_accept_installment_scope(p_proposal_id uuid,p_decision text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); proposal public.native_installment_scope_proposals; v_award_id uuid; party text; accepted_count integer;
  v_project_id uuid; v_current_version_id uuid; target_valid boolean:=true;
begin
  if actor is null or not dao_private.account_active(actor) or p_decision is null or p_decision not in ('accepted','rejected')
    or p_idempotency_key is null or length(p_idempotency_key) not between 8 and 128 then
    raise exception using errcode='22023',message='Décision invalide'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text||':installment-scope-response:'||p_idempotency_key,0));
  select * into proposal from public.native_installment_scope_proposals where id=p_proposal_id for update;
  if proposal.id is null then raise exception using errcode='40001',message='Proposition indisponible'; end if;
  select pa.award_id,a.project_id,pa.current_version_id into v_award_id,v_project_id,v_current_version_id from public.precontract_agreement_versions av
    join public.precontract_agreements pa on pa.id=av.agreement_id
    join public.awards a on a.id=pa.award_id and a.status in ('confirmed','contracting','contracted')
    where av.id=proposal.agreement_version_id;
  party:=dao_private.precontract_party_for_award(v_award_id,actor);
  if party is null then raise exception using errcode='42501',message='Client ou Artisan de l’attribution requis'; end if;
  if exists(select 1 from public.native_installment_scope_acceptances where actor_id=actor and idempotency_key=p_idempotency_key) then
    if exists(select 1 from public.native_installment_scope_acceptances where actor_id=actor and idempotency_key=p_idempotency_key
      and proposal_id=p_proposal_id and party_role=party and decision=p_decision) then
      return jsonb_build_object('proposalId',p_proposal_id,'state',proposal.state); end if;
    raise exception using errcode='22023',message='Clé idempotente réutilisée'; end if;
  if proposal.state<>'pending_acceptance' then raise exception using errcode='40001',message='Proposition indisponible'; end if;
  target_valid:=coalesce(v_current_version_id=proposal.agreement_version_id,false)
    and exists(select 1 from public.projects p where p.id=v_project_id and p.status<>'archived')
    and (proposal.scope_type not in ('lot','sub_lot','milestone') or exists(
      select 1 from public.award_items ai where ai.id=proposal.award_item_id and ai.award_id=v_award_id and ai.active
    ))
    and (proposal.scope_type<>'sub_lot' or exists(
      select 1 from public.award_items ai join public.bid_sub_lots sl on sl.bid_item_id=ai.bid_item_id
      where ai.id=proposal.award_item_id and sl.id=proposal.sub_lot_id and sl.request_id=ai.request_id
    ))
    and (proposal.scope_type<>'milestone' or exists(
      select 1 from public.site_log_events e where e.id=(
        select latest.id from public.site_log_events latest where latest.award_item_id=proposal.award_item_id
          and latest.milestone_key=proposal.milestone_key and latest.event_kind='milestone'
        order by latest.created_at desc,latest.id desc limit 1
      ) and e.declared_status<>'cancelled'
    ));
  if not target_valid then
    update public.native_installment_scope_proposals set state='stale' where id=p_proposal_id;
    return jsonb_build_object('proposalId',p_proposal_id,'state','stale');
  end if;
  if exists(select 1 from public.native_installment_scope_acceptances where proposal_id=p_proposal_id and party_role=party) then
    raise exception using errcode='23505',message='Décision déjà enregistrée'; end if;
  insert into public.native_installment_scope_acceptances(proposal_id,party_role,actor_id,decision,idempotency_key)
    values(p_proposal_id,party,actor,p_decision,p_idempotency_key);
  if p_decision='rejected' then update public.native_installment_scope_proposals set state='rejected' where id=p_proposal_id;
  else
    select count(*) into accepted_count from public.native_installment_scope_acceptances where proposal_id=p_proposal_id and decision='accepted';
    if accepted_count=2 then update public.native_installment_scope_proposals set state='accepted' where id=p_proposal_id; end if;
  end if;
  return jsonb_build_object('proposalId',p_proposal_id,'state',(select p.state from public.native_installment_scope_proposals p where p.id=p_proposal_id));
end;
$$;

create function public.native_execution_prepare_installment_scope(
  p_agreement_version_id uuid,p_installment_no integer,p_scope_type text,
  p_award_item_id uuid,p_sub_lot_id uuid,p_milestone_key uuid,p_period_start date,p_period_end date,p_idempotency_key text
) returns jsonb language sql security invoker set search_path='' as $$
  select dao_private.native_execution_prepare_installment_scope($1,$2,$3,$4,$5,$6,$7,$8,$9);
$$;
create function public.native_execution_accept_installment_scope(p_proposal_id uuid,p_decision text,p_idempotency_key text)
returns jsonb language sql security invoker set search_path='' as $$
  select dao_private.native_execution_accept_installment_scope($1,$2,$3);
$$;

create function dao_private.native_execution_installment_scope_overlay(p_base jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare agreements jsonb; source_agreements jsonb;
begin
  if p_base#>>'{viewer,workspace}'='dao_manager' then
    select coalesce(jsonb_agg(x.value order by x.award_id),'[]'::jsonb) into source_agreements
    from (
      select distinct on (l.value#>>'{award,awardId}')
        l.value#>>'{award,awardId}' as award_id,
        jsonb_build_object('awardId',pa.award_id,'agreementVersionId',av.id,'status',pa.status,
          'acceptedByBoth',(select count(distinct a.party_role)=2 from public.precontract_agreement_acceptances a
            where a.agreement_id=pa.id and a.agreement_version_id=av.id and a.party_role in ('client','contractor')),
          'paymentMode',av.content#>>'{terms,payment_mode}','installments',coalesce(installments.items,'[]'::jsonb),
          'informationalOnly',true,'moneyMoved',false) as value
      from jsonb_array_elements(coalesce(p_base->'lots','[]'::jsonb)) l(value)
      join public.precontract_agreements pa on pa.award_id=(l.value#>>'{award,awardId}')::uuid
        and pa.current_version_id is not null
      join public.precontract_agreement_versions av on av.id=pa.current_version_id and av.agreement_id=pa.id
      left join lateral (
        select jsonb_agg(jsonb_build_object('number',i.ordinality,'label',i.value->>'label','dueDate',i.value->>'due_date',
          'amountMillimes',i.value->>'amount_millimes','latestState',coalesce(ev.event_type,'pending')) order by i.ordinality) as items
        from jsonb_array_elements(coalesce(av.content#>'{terms,installments}','[]'::jsonb)) with ordinality i(value,ordinality)
        left join lateral (select e.event_type from public.precontract_installment_events e
          where e.agreement_version_id=av.id and e.installment_no=i.ordinality::integer
          order by e.created_at desc,e.id desc limit 1) ev on true
      ) installments on true
      order by l.value#>>'{award,awardId}',l.value#>>'{requestId}'
    ) x;
  else source_agreements:=coalesce(p_base->'agreementsByAward','[]'::jsonb);
  end if;
  select coalesce(jsonb_agg(a.value||jsonb_build_object('installments',coalesce(items.value,'[]'::jsonb)) order by a.ordinality),'[]'::jsonb)
    into agreements
  from jsonb_array_elements(source_agreements) with ordinality a(value,ordinality)
  left join lateral (
    select jsonb_agg(i.value||jsonb_build_object(
      'scopeRef',case when s.id is null then null else jsonb_strip_nulls(jsonb_build_object(
        'id',s.id,'type',s.scope_type,'awardItemId',s.award_item_id,'subLotId',s.sub_lot_id,'milestoneKey',s.milestone_key,
        'periodStart',s.period_start,'periodEnd',s.period_end)) end,
      'scopeProposal',case when pending.id is null then null else jsonb_strip_nulls(jsonb_build_object(
        'id',pending.id,'type',pending.scope_type,'state',pending.state,'awardItemId',pending.award_item_id,
        'subLotId',pending.sub_lot_id,'milestoneKey',pending.milestone_key,'periodStart',pending.period_start,
        'periodEnd',pending.period_end,'acceptedBy',pending.accepted_by)) end
    ) order by i.ordinality) as value
    from jsonb_array_elements(coalesce(a.value->'installments','[]'::jsonb)) with ordinality i(value,ordinality)
    left join lateral (select p.* from public.native_installment_scope_proposals p
      where p.agreement_version_id=(a.value->>'agreementVersionId')::uuid and p.installment_no=i.ordinality and p.state='accepted'
        and (p.scope_type not in ('lot','sub_lot','milestone') or exists(
          select 1 from public.award_items ai where ai.id=p.award_item_id and ai.award_id=p.award_id and ai.active
        ))
        and (p.scope_type<>'milestone' or exists(
          select 1 from public.site_log_events e where e.id=(
            select latest.id from public.site_log_events latest where latest.award_item_id=p.award_item_id
              and latest.milestone_key=p.milestone_key and latest.event_kind='milestone'
            order by latest.created_at desc,latest.id desc limit 1
          ) and e.declared_status<>'cancelled'
        ))
      order by p.created_at desc,p.id desc limit 1) s on true
    left join lateral (select p.id,p.scope_type,p.state,p.award_item_id,p.sub_lot_id,p.milestone_key,
        p.period_start,p.period_end,coalesce(acceptances.roles,'[]'::jsonb) as accepted_by
      from public.native_installment_scope_proposals p
      left join lateral (select jsonb_agg(a.party_role order by a.party_role) as roles
        from public.native_installment_scope_acceptances a where a.proposal_id=p.id and a.decision='accepted') acceptances on true
      where p.agreement_version_id=(a.value->>'agreementVersionId')::uuid and p.installment_no=i.ordinality
        and p.state='pending_acceptance'
      order by p.created_at desc,p.id desc limit 1) pending on true
  ) items on true;
  return p_base||jsonb_build_object('agreementsByAward',agreements);
end;
$$;

create or replace function public.native_execution_plan_v1(p_project_id uuid,p_after_request_id uuid default null,p_limit integer default 50)
returns jsonb language plpgsql security definer set search_path='' as $$
declare base jsonb;
begin
  base:=dao_private.native_execution_plan_v1(p_project_id,p_after_request_id,p_limit);
  base:=dao_private.native_execution_activity_overlay(p_project_id,base);
  base:=dao_private.native_execution_installment_scope_overlay(base);
  return dao_private.native_execution_activity_event_overlay(base);
end;
$$;

revoke all on function dao_private.native_execution_prepare_installment_scope(uuid,integer,text,uuid,uuid,uuid,date,date,text),
  dao_private.native_execution_accept_installment_scope(uuid,text,text),dao_private.native_execution_installment_scope_overlay(jsonb),
  public.native_execution_prepare_installment_scope(uuid,integer,text,uuid,uuid,uuid,date,date,text),
  public.native_execution_accept_installment_scope(uuid,text,text) from public,anon,authenticated;
grant execute on function public.native_execution_prepare_installment_scope(uuid,integer,text,uuid,uuid,uuid,date,date,text),
  public.native_execution_accept_installment_scope(uuid,text,text),
  dao_private.native_execution_prepare_installment_scope(uuid,integer,text,uuid,uuid,uuid,date,date,text),
  dao_private.native_execution_accept_installment_scope(uuid,text,text) to authenticated;

commit;
