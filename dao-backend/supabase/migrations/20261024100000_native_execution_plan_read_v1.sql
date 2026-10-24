-- P10-N1 (#411): one JWT-scoped, read-only projection for the native tracking table.
-- No OCE call, no direct table grants, no service-role query and no mutation.
begin;

create function dao_private.native_execution_plan_v1(
  p_project_id uuid,
  p_after_request_id uuid default null,
  p_limit integer default 50
) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  actor uuid:=auth.uid();
  workspace text;
  result jsonb;
  next_cursor uuid;
  has_more boolean;
begin
  if actor is null or not dao_private.account_active(actor) then
    raise exception using errcode='42501',message='Authentification active requise';
  end if;
  if p_project_id is null or p_limit is null or p_limit not between 1 and 100 then
    raise exception using errcode='22023',message='Paramètres invalides';
  end if;

  if dao_private.manages_project(p_project_id) then
    workspace:='dao_manager';
  elsif dao_private.site_client_project(p_project_id) then
    workspace:='client';
  elsif dao_private.site_actor_workspace('contractor') and exists(
    select 1
    from public.award_items ai
    join public.awards a on a.id=ai.award_id and a.project_id=ai.project_id
    join public.projects p on p.id=ai.project_id
    join public.project_requests r on r.id=ai.request_id and r.project_id=ai.project_id
    join public.contractor_profiles cp on cp.id=ai.contractor_id and cp.user_id=actor
    where ai.project_id=p_project_id and ai.active and a.status in ('confirmed','contracting','contracted')
      and p.confirmed_at is not null
      and p.status<>'archived' and cp.verification_status<>'suspended'
  ) then
    workspace:='contractor';
  else
    raise exception using errcode='42501',message='Accès au suivi du projet refusé';
  end if;

  if not exists(select 1 from public.projects p where p.id=p_project_id and p.status<>'archived') then
    raise exception using errcode='P0002',message='Projet introuvable';
  end if;

  select count(*)>p_limit into has_more from (
    select r.id from public.project_requests r
    where r.project_id=p_project_id and r.status<>'withdrawn'
      and (p_after_request_id is null or r.id>p_after_request_id)
      and (workspace<>'contractor' or exists(
        select 1 from public.award_items ai
        join public.awards a on a.id=ai.award_id and a.status in ('confirmed','contracting','contracted')
        join public.contractor_profiles cp on cp.id=ai.contractor_id
        where ai.project_id=r.project_id and ai.request_id=r.id and ai.active
          and cp.user_id=actor and cp.verification_status<>'suspended'
      ))
    order by r.id limit p_limit+1
  ) page_check;

  with scoped_lots as (
    select r.id as request_id,r.status as request_status,
      coalesce(awarded_rv.id,latest_rv.id) as request_version_id,
      coalesce(awarded_rv.title,latest_rv.title) as title,
      coalesce(awarded_rv.scope,latest_rv.scope) as scope,
      ai.id as award_item_id,ai.award_id,ai.contractor_id,cp.business_name,
      bi.id as bid_item_id,bi.bid_version_id,
      pl.planned_start,pl.planned_end,pl.status as plan_status,pl.revision as plan_revision
    from public.project_requests r
    left join lateral (
      select v.id,v.title,v.scope from public.project_request_versions v
      where v.request_id=r.id and v.project_id=r.project_id order by v.version_no desc limit 1
    ) latest_rv on true
    left join lateral (
      select ai.*,a.status as award_status,cp.business_name,bi.id as selected_bid_item_id,bi.bid_version_id,
        bi.request_version_id as selected_request_version_id
      from public.award_items ai join public.awards a on a.id=ai.award_id
      join public.contractor_profiles cp on cp.id=ai.contractor_id
      join public.bid_items bi on bi.id=ai.bid_item_id
      where ai.project_id=r.project_id and ai.request_id=r.id and ai.active
        and a.status in ('confirmed','contracting','contracted')
      order by ai.created_at desc,ai.id limit 1
    ) picked on true
    left join public.award_items ai on ai.id=picked.id
    left join public.contractor_profiles cp on cp.id=ai.contractor_id
    left join public.bid_items bi on bi.id=picked.selected_bid_item_id
    left join lateral (
      select v.id,v.title,v.scope from public.project_request_versions v
      where v.id=picked.selected_request_version_id
    ) awarded_rv on true
    left join public.oce_lot_plans pl on pl.project_id=r.project_id and pl.request_id=r.id
    where r.project_id=p_project_id and r.status<>'withdrawn'
      and (p_after_request_id is null or r.id>p_after_request_id)
      and (workspace<>'contractor' or (ai.id is not null and cp.user_id=actor
        and cp.verification_status<>'suspended'))
    order by r.id limit p_limit
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'requestId',l.request_id,
      'requestVersionId',l.request_version_id,
      'title',l.title,
      'scope',l.scope,
      'status',l.request_status,
      'award',case when l.award_item_id is null then null else jsonb_build_object(
        'awardId',l.award_id,'awardItemId',l.award_item_id,
        'contractorId',case when workspace='contractor' then null else l.contractor_id end,
        'contractorName',case when workspace='contractor' then null else l.business_name end
      ) end,
      'permissions',jsonb_build_object(
        'canRead',true,
        'canPrepareChange',workspace='dao_manager' and l.award_item_id is not null,
        'canDeclareProgress',workspace='contractor' and dao_private.site_contractor_award_item(l.award_item_id),
        'canReviewProgress',workspace='client' and dao_private.site_client_project(p_project_id) and l.award_item_id is not null,
        'canAcceptEngagingChange',workspace in ('client','contractor')
          and dao_private.precontract_party_for_award(l.award_id,actor) is not null
      ),
      'dates',jsonb_build_object(
        'proposed',case when l.bid_item_id is null then null else jsonb_build_object(
          'start',null,'end',null,'durationDays',bi.duration_days,'source','winning_bid') end,
        'agreed',case when agreed.version_id is null then null else jsonb_build_object(
          'versionId',agreed.version_id,'start',agreed.terms->>'planned_start_date',
          'durationDays',nullif(agreed.terms->>'duration_days','')::integer,
          'source','accepted_agreement') end,
        'plan',case when l.planned_start is null and l.planned_end is null then null else jsonb_build_object(
          'start',l.planned_start,'end',l.planned_end,'state',l.plan_status,'revision',l.plan_revision,'source','dao_lot_plan') end,
        'observed',case when observed.first_work_date is null and observed.last_work_date is null then null else jsonb_build_object(
          'start',observed.first_work_date,'end',observed.last_work_date,'source','site_log') end
      ),
      'progress',case when progress.event_id is null then null else jsonb_build_object(
        'eventId',progress.event_id,'percent',progress.progress_percent,'status',progress.declared_status,
        'at',progress.created_at,'observation',progress.observation) end,
      'quantities',coalesce(lot_quantity.items,'[]'::jsonb),
      'officialSubLots',coalesce(official.items,'[]'::jsonb),
      'executionSubLots',coalesce(execution.items,'[]'::jsonb),
      'milestones',coalesce(milestones.items,'[]'::jsonb),
      'dependencies',coalesce(dependencies.items,'[]'::jsonb),
      'modalities',case when agreement.id is null or workspace='dao_manager' then null else jsonb_build_object(
        'awardId',l.award_id,'agreementVersionId',agreement.version_id,
        'status',agreement.status,'acceptedByBoth',agreement.accepted_by_both,
        'paymentMode',agreement.terms->>'payment_mode',
        'installments',coalesce(installments.items,'[]'::jsonb),
        'informationalOnly',true,'moneyMoved',false) end
    ) order by l.request_id),'[]'::jsonb),
    (array_agg(l.request_id order by l.request_id))[p_limit]
  into result,next_cursor
  from scoped_lots l
  left join public.bid_items bi on bi.id=l.bid_item_id
  left join lateral (
    select v.id as version_id,v.content->'terms' as terms,
      (select count(distinct a.party_role)=2 from public.precontract_agreement_acceptances a
       where a.agreement_id=pa.id and a.agreement_version_id=v.id and a.party_role in ('client','contractor')) as accepted_by_both,
      pa.status
    from public.precontract_agreements pa
    join public.precontract_agreement_versions v on v.id=pa.current_version_id and v.agreement_id=pa.id
    where pa.award_id=l.award_id and workspace<>'dao_manager'
      and dao_private.precontract_party_for_award(l.award_id,actor) is not null
    limit 1
  ) agreement on true
  left join lateral (
    select accepted.id as version_id,accepted.content->'terms' as terms
    from public.precontract_agreements pa
    cross join lateral dao_private.precontract_latest_agreed_version(pa.id) accepted
    where pa.award_id=l.award_id and workspace<>'dao_manager'
      and dao_private.precontract_party_for_award(l.award_id,actor) is not null
    limit 1
  ) agreed on true
  left join lateral (
    select min(e.work_date) as first_work_date,max(e.work_date) as last_work_date
    from public.site_log_events e where e.award_item_id=l.award_item_id and e.event_kind='intervention'
      and dao_private.site_can_read_award_item(l.award_item_id)
  ) observed on true
  left join lateral (
    select e.id as event_id,e.progress_percent,e.declared_status,e.created_at,
      (select jsonb_build_object('outcome',o.outcome,'reason',o.reason,'at',o.created_at)
       from public.site_client_observations o where o.event_id=e.id order by o.created_at desc,o.id desc limit 1) as observation
    from public.site_log_events e where e.award_item_id=l.award_item_id and e.event_kind='progress'
      and dao_private.site_can_read_award_item(l.award_item_id)
      and e.bid_sub_lot_id is null order by e.created_at desc,e.id desc limit 1
  ) progress on true
  left join lateral (
    select jsonb_agg(jsonb_build_object('quoteLineId',q.quote_line_id,'unit',q.quantity_unit,
      'executedMilli',q.executed_milli::text,'referenceMilli',q.reference_milli::text)
      order by q.quantity_unit,q.quote_line_id nulls last) as items
    from (select e.quote_line_id,e.quantity_unit,sum(e.executed_quantity_milli)::bigint executed_milli,
      max(ql.quantity_milli)::bigint reference_milli from public.site_log_events e
      left join public.bid_quote_lines ql on ql.id=e.quote_line_id
      where e.award_item_id=l.award_item_id and e.bid_sub_lot_id is null and e.executed_quantity_milli is not null
        and dao_private.site_can_read_award_item(l.award_item_id)
      group by e.quote_line_id,e.quantity_unit) q
  ) lot_quantity on true
  left join lateral (
    select jsonb_agg(jsonb_build_object('id',v.sub_lot_id,'versionId',v.id,'title',v.title,'scope',v.scope)
      order by v.ordinal,v.id) as items
    from public.request_sub_lot_versions v
    where v.request_version_id=l.request_version_id
  ) official on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'id',sl.id,'nodeKey',sl.node_key,'officialSubLotId',sl.official_sub_lot_id,
      'title',sl.title,'scope',sl.scope,'position',sl.position,
      'proposedDates',jsonb_build_object('start',sl.start_date,'end',sl.end_date,'durationDays',sl.duration_days),
      'agreedDates',case when schedule.entry is null then null else jsonb_build_object(
        'agreementVersionId',agreed.version_id,'start',schedule.entry->>'start_date',
        'end',schedule.entry->>'end_date','durationDays',nullif(schedule.entry->>'duration_days','')::integer) end,
      'progress',case when subprogress.event_id is null then null else jsonb_build_object(
        'eventId',subprogress.event_id,'percent',subprogress.progress_percent,'status',subprogress.declared_status,
        'at',subprogress.created_at,'observation',subprogress.observation) end,
      'quantities',coalesce(quantity.items,'[]'::jsonb)
    ) order by sl.position,sl.id) as items
    from public.bid_sub_lots sl
    left join lateral (select x.value as entry from jsonb_array_elements(coalesce(agreed.terms->'sub_lot_schedule','[]'::jsonb)) x(value)
      where x.value->>'node_key'=sl.node_key::text limit 1) schedule on true
    left join lateral (
      select e.id as event_id,e.progress_percent,e.declared_status,e.created_at,
        (select jsonb_build_object('outcome',o.outcome,'reason',o.reason,'at',o.created_at)
         from public.site_client_observations o where o.event_id=e.id order by o.created_at desc,o.id desc limit 1) as observation
      from public.site_log_events e where e.award_item_id=l.award_item_id and e.bid_sub_lot_id=sl.id and e.event_kind='progress'
        and dao_private.site_can_read_award_item(l.award_item_id)
      order by e.created_at desc,e.id desc limit 1
    ) subprogress on true
    left join lateral (
      select jsonb_agg(jsonb_build_object('quoteLineId',q.quote_line_id,'unit',q.quantity_unit,
        'executedMilli',q.executed_milli::text,'referenceMilli',q.reference_milli::text) order by q.quantity_unit,q.quote_line_id nulls last) as items
      from (select e.quote_line_id,e.quantity_unit,sum(e.executed_quantity_milli)::bigint executed_milli,
        max(ql.quantity_milli)::bigint reference_milli from public.site_log_events e
        left join public.bid_quote_lines ql on ql.id=e.quote_line_id
        where e.award_item_id=l.award_item_id and e.bid_sub_lot_id=sl.id and e.executed_quantity_milli is not null
          and dao_private.site_can_read_award_item(l.award_item_id)
        group by e.quote_line_id,e.quantity_unit) q
    ) quantity on true
    where sl.bid_item_id=l.bid_item_id
  ) execution on true
  left join lateral (
    select jsonb_agg(jsonb_build_object('key',m.milestone_key,'eventId',m.id,'title',m.title,
      'targetDate',m.target_date,'status',m.declared_status,'at',m.created_at) order by m.target_date nulls last,m.created_at,m.id) as items
    from (select distinct on (e.milestone_key) e.* from public.site_log_events e
      where e.award_item_id=l.award_item_id and e.event_kind='milestone'
        and dao_private.site_can_read_award_item(l.award_item_id)
      order by e.milestone_key,e.created_at desc,e.id desc) m
  ) milestones on true
  left join lateral (
    select jsonb_agg(jsonb_build_object('id',x.value->>'id','from',x.value->>'pred_target','to',x.value->>'succ_target',
      'state',x.value->>'state','relation','FS','lagDays',0,
      'source',case when coalesce((x.value->>'manual')::boolean,false) then 'manual' else 'bid_proposal' end)
      order by x.value->>'id') as items
    from jsonb_array_elements(dao_private.project_plan_data(p_project_id)->'links') x(value)
    where (workspace in ('client','dao_manager') or exists(
        select 1 from public.bid_sub_lot_links own_link
        where own_link.id=(x.value->>'id')::uuid and own_link.bid_version_id=l.bid_version_id
      ))
      and (x.value->>'pred_target' like 'lot:'||l.request_id::text or x.value->>'succ_target' like 'lot:'||l.request_id::text
        or x.value->>'pred_target' in (select 'node:'||s.id::text from public.bid_sub_lots s where s.bid_item_id=l.bid_item_id)
        or x.value->>'succ_target' in (select 'node:'||s.id::text from public.bid_sub_lots s where s.bid_item_id=l.bid_item_id))
  ) dependencies on true
  left join lateral (
    select jsonb_agg(jsonb_build_object('number',i.ordinality,'label',i.value->>'label','dueDate',i.value->>'due_date',
      'amountMillimes',(i.value->>'amount_millimes'),'latestState',coalesce(ev.event_type,'pending')) order by i.ordinality) as items
    from jsonb_array_elements(coalesce(agreement.terms->'installments','[]'::jsonb)) with ordinality i(value,ordinality)
    left join lateral (select e.event_type from public.precontract_installment_events e
      where e.agreement_version_id=agreement.version_id and e.installment_no=i.ordinality::integer
      order by e.created_at desc,e.id desc limit 1) ev on true
  ) installments on true;

  return jsonb_build_object(
    'schemaVersion',1,'projectId',p_project_id,'generatedAt',now(),
    'viewer',jsonb_build_object('workspace',workspace),
    'lots',coalesce(result,'[]'::jsonb),
    'page',jsonb_build_object('limit',p_limit,'nextCursor',case when has_more then next_cursor end),
    'sourceRevisions',jsonb_build_object(
      'plan',case when workspace='contractor' then null else
        (select coalesce(c.revision,1) from (select 1) seed left join public.project_plan_contexts c on c.project_id=p_project_id) end,
      'executionCursor',(select jsonb_build_object('createdAt',e.created_at,'eventId',e.id)
        from public.site_log_events e
        join public.award_items ai on ai.id=e.award_item_id and ai.active
        join public.awards a on a.id=ai.award_id and a.status in ('confirmed','contracting','contracted')
        join public.project_requests r on r.id=ai.request_id and r.status<>'withdrawn'
        where e.project_id=p_project_id and dao_private.site_can_read_award_item(ai.id)
          and (workspace<>'contractor' or exists(select 1 from public.contractor_profiles cp
            where cp.id=ai.contractor_id and cp.user_id=actor and cp.verification_status<>'suspended'))
        order by e.created_at desc,e.id desc limit 1)
    ),
    'activities',jsonb_build_object('supported',false,'items','[]'::jsonb),
    'forecast',null
  );
end;
$$;

create function public.native_execution_plan_v1(
  p_project_id uuid,p_after_request_id uuid default null,p_limit integer default 50
) returns jsonb language sql stable security invoker set search_path='' as $$
  select dao_private.native_execution_plan_v1($1,$2,$3);
$$;

revoke all on function dao_private.native_execution_plan_v1(uuid,uuid,integer),
  public.native_execution_plan_v1(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.native_execution_plan_v1(uuid,uuid,integer) to authenticated;
-- The public wrapper is SECURITY INVOKER, so the private SECURITY DEFINER
-- projection must be executable by authenticated callers; its body enforces auth.uid().
grant execute on function dao_private.native_execution_plan_v1(uuid,uuid,integer) to authenticated;

commit;
