-- P10-N4 (#409): attach journal events to native post-award activities.
begin;

alter table public.site_log_events add column native_activity_id uuid;
alter table public.site_log_events
  add constraint site_log_events_native_activity_award_fk
    foreign key(native_activity_id,award_item_id)
    references public.native_execution_activities(id,award_item_id),
  add constraint site_log_events_single_execution_node_check
    check(native_activity_id is null or bid_sub_lot_id is null);
create index site_log_events_native_activity_idx
  on public.site_log_events(native_activity_id,created_at desc,id desc)
  where native_activity_id is not null;

create function dao_private.native_activity_engagement_guard()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='INSERT' then
    if new.scope is not null and not exists(
      select 1 from public.native_execution_activity_proposals p
      where p.activity_id=new.id and p.award_item_id=new.award_item_id and p.action='create'
        and p.state='pending_acceptance' and p.scope is not distinct from new.scope
        and (select count(distinct a.party_role)=2 from public.native_execution_activity_proposal_acceptances a
          where a.proposal_id=p.id and a.decision='accepted')
    ) then
      raise exception using errcode='23514',message='Un nouveau périmètre exige une proposition acceptée par les deux parties';
    end if;
    return new;
  end if;
  if new.scope is distinct from old.scope and not exists(
    select 1 from public.native_execution_activity_proposals p
    where p.activity_id=old.id and p.award_item_id=old.award_item_id and p.action='update'
      and p.state='pending_acceptance' and p.expected_revision=old.revision
      and p.scope is not distinct from new.scope
      and (select count(distinct a.party_role)=2 from public.native_execution_activity_proposal_acceptances a
        where a.proposal_id=p.id and a.decision='accepted')
  ) then
    raise exception using errcode='23514',message='Un changement de périmètre exige une proposition acceptée par les deux parties';
  end if;
  if old.active and not new.active and old.scope is not null and not exists(
    select 1 from public.native_execution_activity_proposals p
    where p.activity_id=old.id and p.award_item_id=old.award_item_id and p.action='retire'
      and p.state='pending_acceptance' and p.expected_revision=old.revision
      and (select count(distinct a.party_role)=2 from public.native_execution_activity_proposal_acceptances a
        where a.proposal_id=p.id and a.decision='accepted')
  ) then
    raise exception using errcode='23514',message='Le retrait de ce périmètre exige une proposition acceptée par les deux parties';
  end if;
  return new;
end;
$$;
create trigger native_execution_activity_engagement_guard
  before insert or update on public.native_execution_activities
  for each row execute function dao_private.native_activity_engagement_guard();
revoke all on function dao_private.native_activity_engagement_guard() from public,anon,authenticated;

create function dao_private.record_native_activity_event_v1(
  p_award_item_id uuid,p_native_activity_id uuid,p_event_kind text,p_status text,p_percent integer,
  p_work_date date,p_title text,p_target_date date,p_note text,p_quote_line_id uuid,
  p_executed_quantity_milli bigint,p_quantity_unit text,p_document_ids uuid[],p_idempotency_key text
) returns public.site_log_events language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); item public.award_items; line public.bid_quote_lines;
  activity public.native_execution_activities; canonical_unit text; payload jsonb; v public.site_log_events;
begin
  if actor is null or not dao_private.account_active(actor) or not dao_private.site_contractor_award_item(p_award_item_id)
    or p_native_activity_id is null then raise exception using errcode='42501',message='Artisan actif et activité attribuée requis'; end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 100 then
    raise exception using errcode='22023',message='Clé idempotente invalide'; end if;
  select * into item from public.award_items where id=p_award_item_id and active;
  select * into activity from public.native_execution_activities where id=p_native_activity_id
    and award_item_id=p_award_item_id and active;
  if item.id is null or activity.id is null then raise exception using errcode='42501',message='Activité indisponible'; end if;
  if p_event_kind='intervention' and p_quote_line_id is not null then
    select * into line from public.bid_quote_lines where id=p_quote_line_id;
    canonical_unit:=line.unit;
  else canonical_unit:=nullif(btrim(coalesce(p_quantity_unit,'')),''); end if;
  payload:=jsonb_strip_nulls(jsonb_build_object('award_item_id',p_award_item_id,'native_activity_id',p_native_activity_id,
    'event_kind',p_event_kind,'status',p_status,'percent',p_percent,'work_date',p_work_date,
    'title',nullif(btrim(coalesce(p_title,'')),''),'target_date',p_target_date,
    'note',nullif(btrim(coalesce(p_note,'')),''),'quote_line_id',p_quote_line_id,
    'executed_quantity_milli',p_executed_quantity_milli,'quantity_unit',canonical_unit,
    'document_ids',to_jsonb(coalesce(p_document_ids,array[]::uuid[]))));
  v:=dao_private.site_existing_event(p_idempotency_key,p_event_kind,payload);
  if v.id is not null then return v; end if;
  if p_event_kind='progress' then
    if p_status not in ('not_started','in_progress','completed') or p_percent not between 0 and 100
      or length(btrim(coalesce(p_note,''))) not between 3 and 1000 or p_work_date is not null or p_title is not null
      or p_target_date is not null or p_quote_line_id is not null or p_executed_quantity_milli is not null or canonical_unit is not null then
      raise exception using errcode='22023',message='Avancement invalide'; end if;
  elsif p_event_kind='intervention' then
    if p_work_date is null or length(btrim(coalesce(p_note,''))) not between 3 and 2000
      or (p_percent is not null and p_percent not between 0 and 100)
      or ((p_executed_quantity_milli is null)<>(canonical_unit is null))
      or (p_quote_line_id is not null and p_executed_quantity_milli is null)
      or (p_executed_quantity_milli is not null and p_executed_quantity_milli not between 1 and 1000000000000)
      or length(coalesce(canonical_unit,''))>40 or p_status is not null or p_title is not null or p_target_date is not null then
      raise exception using errcode='22023',message='Intervention invalide'; end if;
    if p_quote_line_id is not null and (line.id is null or line.bid_item_id<>item.bid_item_id
      or (nullif(btrim(coalesce(p_quantity_unit,'')),'') is not null and btrim(p_quantity_unit)<>line.unit)) then
      raise exception using errcode='42501',message='Métré hors offre attribuée'; end if;
  elsif p_event_kind='milestone' then
    if p_status not in ('planned','in_progress','completed','cancelled') or length(btrim(coalesce(p_title,''))) not between 1 and 160
      or length(btrim(coalesce(p_note,'')))>1000 or p_percent is not null or p_work_date is not null
      or p_quote_line_id is not null or p_executed_quantity_milli is not null or canonical_unit is not null
      or coalesce(cardinality(p_document_ids),0)>0 then
      raise exception using errcode='22023',message='Jalon invalide'; end if;
  else raise exception using errcode='22023',message='Type d’événement invalide'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text||':site-native-event:'||p_idempotency_key,0));
  perform 1 from public.award_items where id=p_award_item_id for update;
  if not dao_private.site_contractor_award_item(p_award_item_id) or not exists(
    select 1 from public.native_execution_activities where id=p_native_activity_id and award_item_id=p_award_item_id and active
  ) then raise exception using errcode='42501',message='Activité ou attribution révoquée'; end if;
  insert into public.site_log_events(project_id,award_item_id,request_id,actor_id,event_kind,native_activity_id,
    declared_status,progress_percent,work_date,title,target_date,note,quote_line_id,executed_quantity_milli,
    quantity_unit,idempotency_key,command_payload,milestone_key)
  values(item.project_id,item.id,item.request_id,actor,p_event_kind,p_native_activity_id,p_status,p_percent,p_work_date,
    nullif(btrim(coalesce(p_title,'')),''),p_target_date,nullif(btrim(coalesce(p_note,'')),''),p_quote_line_id,
    p_executed_quantity_milli,canonical_unit,p_idempotency_key,payload,
    case when p_event_kind='milestone' then gen_random_uuid() end) returning * into v;
  if p_event_kind in ('progress','intervention') then perform dao_private.site_attach_evidence(v,p_document_ids); end if;
  insert into public.audit_events(actor_id,action,entity_type,entity_id,metadata)
  values(actor,case p_event_kind when 'progress' then 'site_progress_recorded' when 'intervention' then 'site_intervention_recorded' else 'site_milestone_recorded' end,
    'project',v.project_id,jsonb_strip_nulls(jsonb_build_object('event_id',v.id,'award_item_id',v.award_item_id,
      'native_activity_id',v.native_activity_id,'milestone_key',v.milestone_key)));
  return v;
end;
$$;

create function public.record_native_activity_event_v1(
  p_award_item_id uuid,p_native_activity_id uuid,p_event_kind text,p_status text,p_percent integer,
  p_work_date date,p_title text,p_target_date date,p_note text,p_quote_line_id uuid,
  p_executed_quantity_milli bigint,p_quantity_unit text,p_document_ids uuid[],p_idempotency_key text
) returns jsonb language sql security invoker set search_path='' as $$
  select to_jsonb(x)-'idempotency_key'-'command_payload'
  from dao_private.record_native_activity_event_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) x;
$$;

create or replace function dao_private.update_site_milestone(
  p_milestone_key uuid,p_target_date date,p_status text,p_note text,p_idempotency_key text
) returns public.site_log_events language plpgsql security definer set search_path='' as $$
declare previous public.site_log_events; payload jsonb; v public.site_log_events;
begin
  payload:=jsonb_build_object('milestone_key',p_milestone_key,'target_date',p_target_date,'status',p_status,
    'note',nullif(btrim(coalesce(p_note,'')),''));
  v:=dao_private.site_existing_event(p_idempotency_key,'milestone',payload);
  if v.id is not null then return v; end if;
  if p_milestone_key is null then raise exception using errcode='22023',message='Jalon requis'; end if;
  perform pg_advisory_xact_lock(hashtextextended('site-milestone:'||p_milestone_key::text,0));
  select * into previous from public.site_log_events where milestone_key=p_milestone_key order by created_at desc,id desc limit 1;
  if previous.id is null or not dao_private.site_contractor_award_item(previous.award_item_id) then
    raise exception using errcode='42501',message='Artisan actif requis'; end if;
  if previous.declared_status in ('completed','cancelled') then raise exception using errcode='23514',message='Jalon terminal immuable'; end if;
  if p_status not in ('planned','in_progress','completed','cancelled') or length(btrim(coalesce(p_note,'')))>1000 then
    raise exception using errcode='22023',message='Jalon invalide'; end if;
  perform 1 from public.award_items where id=previous.award_item_id for update;
  if not dao_private.site_contractor_award_item(previous.award_item_id) then raise exception using errcode='42501',message='Attribution révoquée'; end if;
  insert into public.site_log_events(project_id,award_item_id,request_id,actor_id,event_kind,milestone_key,native_activity_id,
    declared_status,title,target_date,note,idempotency_key,command_payload)
  values(previous.project_id,previous.award_item_id,previous.request_id,auth.uid(),'milestone',previous.milestone_key,
    previous.native_activity_id,p_status,previous.title,p_target_date,nullif(btrim(coalesce(p_note,'')),''),p_idempotency_key,payload) returning * into v;
  insert into public.audit_events(actor_id,action,entity_type,entity_id,metadata)
    values(auth.uid(),'site_milestone_recorded','project',v.project_id,jsonb_build_object('event_id',v.id,
      'award_item_id',v.award_item_id,'milestone_key',v.milestone_key,'native_activity_id',v.native_activity_id));
  return v;
end;
$$;

create function dao_private.native_execution_activity_event_overlay(p_base jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare activities jsonb; lots jsonb; actor uuid:=auth.uid();
begin
  if actor is null or not dao_private.account_active(actor) then raise exception using errcode='42501',message='Authentification active requise'; end if;
  select coalesce(jsonb_agg(x.value||jsonb_build_object('execution',jsonb_build_object(
      'progress',progress.item,'observed',case when observed.first_date is null then null else
        jsonb_build_object('start',observed.first_date,'end',observed.last_date) end,
      'quantities',coalesce(quantity.items,'[]'::jsonb),'milestones',coalesce(milestones.items,'[]'::jsonb))) order by x.ordinality),'[]'::jsonb)
    into activities
  from jsonb_array_elements(coalesce(p_base#>'{activities,items}','[]'::jsonb)) with ordinality x(value,ordinality)
  left join lateral (select jsonb_build_object('eventId',e.id,'percent',e.progress_percent,'status',e.declared_status,'at',e.created_at,
      'observation',(select jsonb_build_object('outcome',o.outcome,'reason',o.reason,'at',o.created_at)
        from public.site_client_observations o where o.event_id=e.id order by o.created_at desc,o.id desc limit 1)) as item
    from public.site_log_events e where e.native_activity_id=(x.value->>'id')::uuid and e.event_kind='progress'
    order by e.created_at desc,e.id desc limit 1) progress on true
  left join lateral (select jsonb_agg(jsonb_build_object('quoteLineId',q.quote_line_id,'unit',q.quantity_unit,
      'executedMilli',q.executed_milli::text,'referenceMilli',q.reference_milli::text) order by q.quantity_unit,q.quote_line_id nulls last) as items
    from (select e.quote_line_id,e.quantity_unit,sum(e.executed_quantity_milli)::bigint executed_milli,
      max(ql.quantity_milli)::bigint reference_milli from public.site_log_events e left join public.bid_quote_lines ql on ql.id=e.quote_line_id
      where e.native_activity_id=(x.value->>'id')::uuid and e.event_kind='intervention' and e.executed_quantity_milli is not null
      group by e.quote_line_id,e.quantity_unit) q) quantity on true
  left join lateral (select jsonb_agg(jsonb_build_object('key',m.milestone_key,'eventId',m.id,'title',m.title,
      'targetDate',m.target_date,'status',m.declared_status,'at',m.created_at) order by m.target_date nulls last,m.created_at,m.id) as items
    from (select distinct on (e.milestone_key) e.* from public.site_log_events e
      where e.native_activity_id=(x.value->>'id')::uuid and e.event_kind='milestone'
      order by e.milestone_key,e.created_at desc,e.id desc) m) milestones on true
  left join lateral (select min(e.work_date) as first_date,max(e.work_date) as last_date from public.site_log_events e
    where e.native_activity_id=(x.value->>'id')::uuid and e.event_kind='intervention') observed on true;

  select coalesce(jsonb_agg(l.value||jsonb_build_object(
      'progress',case when progress.event_id is null then null else jsonb_build_object('eventId',progress.event_id,
        'percent',progress.progress_percent,'status',progress.declared_status,'at',progress.created_at,
        'observation',progress.observation) end,
      'quantities',coalesce(quantity.items,'[]'::jsonb),'milestones',coalesce(milestones.items,'[]'::jsonb))
      order by l.ordinality),'[]'::jsonb)
    into lots
  from jsonb_array_elements(coalesce(p_base->'lots','[]'::jsonb)) with ordinality l(value,ordinality)
  left join lateral (select e.id as event_id,e.progress_percent,e.declared_status,e.created_at,
      (select jsonb_build_object('outcome',o.outcome,'reason',o.reason,'at',o.created_at) from public.site_client_observations o
       where o.event_id=e.id order by o.created_at desc,o.id desc limit 1) as observation
    from public.site_log_events e where e.award_item_id=(l.value#>>'{award,awardItemId}')::uuid
      and e.event_kind='progress' and e.bid_sub_lot_id is null
    order by e.created_at desc,e.id desc limit 1) progress on true
  left join lateral (select jsonb_agg(jsonb_build_object('quoteLineId',q.quote_line_id,'unit',q.quantity_unit,
      'executedMilli',q.executed_milli::text,'referenceMilli',q.reference_milli::text)
      order by q.quantity_unit,q.quote_line_id nulls last) as items
    from (select e.quote_line_id,e.quantity_unit,sum(e.executed_quantity_milli)::bigint executed_milli,
      max(ql.quantity_milli)::bigint reference_milli from public.site_log_events e
      left join public.bid_quote_lines ql on ql.id=e.quote_line_id
      where e.award_item_id=(l.value#>>'{award,awardItemId}')::uuid
        and e.bid_sub_lot_id is null and e.executed_quantity_milli is not null group by e.quote_line_id,e.quantity_unit) q) quantity on true
  left join lateral (select jsonb_agg(jsonb_build_object('key',m.milestone_key,'eventId',m.id,'title',m.title,
      'targetDate',m.target_date,'status',m.declared_status,'at',m.created_at) order by m.target_date nulls last,m.created_at,m.id) as items
    from (select distinct on (e.milestone_key) e.* from public.site_log_events e
      where e.award_item_id=(l.value#>>'{award,awardItemId}')::uuid and e.event_kind='milestone'
      order by e.milestone_key,e.created_at desc,e.id desc) m) milestones on true;
  return p_base||jsonb_build_object('activities',coalesce(p_base->'activities','{}'::jsonb)||jsonb_build_object('items',activities),'lots',lots);
end;
$$;

create or replace function public.native_execution_plan_v1(p_project_id uuid,p_after_request_id uuid default null,p_limit integer default 50)
returns jsonb language plpgsql security definer set search_path='' as $$
declare base jsonb;
begin
  base:=dao_private.native_execution_plan_v1(p_project_id,p_after_request_id,p_limit);
  base:=dao_private.native_execution_activity_overlay(p_project_id,base);
  return dao_private.native_execution_activity_event_overlay(base);
end;
$$;

revoke all on function dao_private.record_native_activity_event_v1(uuid,uuid,text,text,integer,date,text,date,text,uuid,bigint,text,uuid[],text),
  dao_private.native_execution_activity_event_overlay(jsonb),
  public.record_native_activity_event_v1(uuid,uuid,text,text,integer,date,text,date,text,uuid,bigint,text,uuid[],text)
  from public,anon,authenticated;
grant execute on function public.record_native_activity_event_v1(uuid,uuid,text,text,integer,date,text,date,text,uuid,bigint,text,uuid[],text),
  dao_private.record_native_activity_event_v1(uuid,uuid,text,text,integer,date,text,date,text,uuid,bigint,text,uuid[],text)
  to authenticated;

notify pgrst, 'reload schema';
commit;
