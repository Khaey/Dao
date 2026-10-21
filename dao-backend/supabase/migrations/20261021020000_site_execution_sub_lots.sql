begin;

-- P9-A2: additive sub-lot and executed-quantity detail on the existing #289
-- append-only journal. Commercial awards remain strictly per lot.
alter table public.site_log_events
  add column bid_sub_lot_id uuid references public.bid_sub_lots,
  add column quote_line_id uuid references public.bid_quote_lines,
  add column executed_quantity_milli bigint,
  add column quantity_unit text,
  add constraint site_log_events_execution_detail_check check (
    (event_kind in ('progress','intervention') or bid_sub_lot_id is null)
    and (event_kind='intervention' or (quote_line_id is null
      and executed_quantity_milli is null and quantity_unit is null))
    and ((executed_quantity_milli is null and quote_line_id is null and quantity_unit is null)
      or (executed_quantity_milli between 1 and 1000000000000
        and length(btrim(quantity_unit)) between 1 and 40))
  );
create index site_log_events_sub_lot_idx
  on public.site_log_events(bid_sub_lot_id,created_at desc,id desc)
  where bid_sub_lot_id is not null;
create index site_log_events_quote_line_idx
  on public.site_log_events(quote_line_id,created_at desc,id desc)
  where quote_line_id is not null;

grant select(bid_sub_lot_id,quote_line_id,executed_quantity_milli,quantity_unit)
  on public.site_log_events to authenticated;

alter table public.site_client_observations
  drop constraint site_client_observations_outcome_check,
  drop constraint site_client_observations_check,
  add constraint site_client_observations_outcome_check
    check(outcome in ('acknowledged','disputed','technical_validated')),
  add constraint site_client_observations_check check (
    (outcome='acknowledged' and (reason is null or length(btrim(reason)) between 1 and 1000))
    or (outcome='disputed' and length(btrim(coalesce(reason,''))) between 3 and 1000)
    or (outcome='technical_validated' and (reason is null or length(btrim(reason)) between 1 and 1000))
  );

create or replace function dao_private.record_site_progress_v2(
  p_award_item_id uuid,p_bid_sub_lot_id uuid,p_status text,p_percent integer,
  p_reason text,p_document_ids uuid[],p_idempotency_key text
) returns public.site_log_events language plpgsql security definer set search_path='' as $$
declare item public.award_items; payload jsonb; v public.site_log_events;
begin
  payload:=jsonb_build_object('award_item_id',p_award_item_id,'bid_sub_lot_id',p_bid_sub_lot_id,
    'status',p_status,'percent',p_percent,'reason',btrim(coalesce(p_reason,'')),
    'document_ids',to_jsonb(coalesce(p_document_ids,array[]::uuid[])));
  v:=dao_private.site_existing_event(p_idempotency_key,'progress',payload);
  if v.id is not null then return v; end if;
  if not dao_private.site_contractor_award_item(p_award_item_id) then
    raise exception using errcode='42501',message='active awarded contractor required';
  end if;
  if p_status not in ('not_started','in_progress','completed') or p_percent not between 0 and 100
    or length(btrim(coalesce(p_reason,''))) not between 3 and 1000 then
    raise exception using errcode='22023',message='invalid progress declaration';
  end if;
  perform 1 from public.award_items where id=p_award_item_id for update;
  if not dao_private.site_contractor_award_item(p_award_item_id) then
    raise exception using errcode='42501',message='active awarded contractor required';
  end if;
  select * into item from public.award_items where id=p_award_item_id;
  if p_bid_sub_lot_id is not null and not exists(
    select 1 from public.bid_sub_lots sl
    where sl.id=p_bid_sub_lot_id and sl.bid_item_id=item.bid_item_id
      and sl.project_id=item.project_id and sl.request_id=item.request_id
  ) then raise exception using errcode='42501',message='sub-lot is outside awarded lot'; end if;
  insert into public.site_log_events(project_id,award_item_id,request_id,actor_id,event_kind,
    bid_sub_lot_id,declared_status,progress_percent,note,idempotency_key,command_payload)
  values(item.project_id,item.id,item.request_id,auth.uid(),'progress',p_bid_sub_lot_id,
    p_status,p_percent,btrim(p_reason),p_idempotency_key,payload) returning * into v;
  perform dao_private.site_attach_evidence(v,p_document_ids);
  insert into public.audit_events(actor_id,action,entity_type,entity_id,metadata)
    values(auth.uid(),'site_progress_recorded','project',v.project_id,
      jsonb_strip_nulls(jsonb_build_object('event_id',v.id,'award_item_id',v.award_item_id,
        'bid_sub_lot_id',v.bid_sub_lot_id)));
  return v;
end;
$$;

create or replace function dao_private.record_site_intervention_v2(
  p_award_item_id uuid,p_bid_sub_lot_id uuid,p_work_date date,p_note text,p_percent integer,
  p_quote_line_id uuid,p_executed_quantity_milli bigint,p_quantity_unit text,
  p_document_ids uuid[],p_idempotency_key text
) returns public.site_log_events language plpgsql security definer set search_path='' as $$
declare item public.award_items; line public.bid_quote_lines; canonical_unit text;
  payload jsonb; v public.site_log_events;
begin
  if p_quote_line_id is not null then
    select * into line from public.bid_quote_lines where id=p_quote_line_id;
    canonical_unit:=line.unit;
  else canonical_unit:=nullif(btrim(coalesce(p_quantity_unit,'')),''); end if;
  payload:=jsonb_build_object('award_item_id',p_award_item_id,'bid_sub_lot_id',p_bid_sub_lot_id,
    'work_date',p_work_date,'note',btrim(coalesce(p_note,'')),'percent',p_percent,
    'quote_line_id',p_quote_line_id,'executed_quantity_milli',p_executed_quantity_milli,
    'quantity_unit',canonical_unit,'document_ids',to_jsonb(coalesce(p_document_ids,array[]::uuid[])));
  v:=dao_private.site_existing_event(p_idempotency_key,'intervention',payload);
  if v.id is not null then return v; end if;
  if not dao_private.site_contractor_award_item(p_award_item_id) then
    raise exception using errcode='42501',message='active awarded contractor required';
  end if;
  if p_work_date is null or length(btrim(coalesce(p_note,''))) not between 3 and 2000
    or (p_percent is not null and p_percent not between 0 and 100)
    or ((p_executed_quantity_milli is null)<>(canonical_unit is null))
    or (p_quote_line_id is not null and p_executed_quantity_milli is null)
    or (p_executed_quantity_milli is not null and p_executed_quantity_milli not between 1 and 1000000000000)
    or length(coalesce(canonical_unit,''))>40 then
    raise exception using errcode='22023',message='invalid intervention declaration';
  end if;
  perform 1 from public.award_items where id=p_award_item_id for update;
  if not dao_private.site_contractor_award_item(p_award_item_id) then
    raise exception using errcode='42501',message='active awarded contractor required';
  end if;
  select * into item from public.award_items where id=p_award_item_id;
  if p_bid_sub_lot_id is not null and not exists(
    select 1 from public.bid_sub_lots sl where sl.id=p_bid_sub_lot_id
      and sl.bid_item_id=item.bid_item_id and sl.project_id=item.project_id and sl.request_id=item.request_id
  ) then raise exception using errcode='42501',message='sub-lot is outside awarded lot'; end if;
  if p_quote_line_id is not null and (line.id is null or line.bid_item_id<>item.bid_item_id
      or (nullif(btrim(coalesce(p_quantity_unit,'')),'') is not null
        and btrim(p_quantity_unit)<>line.unit)) then
    raise exception using errcode='42501',message='quote line is outside awarded lot or unit differs';
  end if;
  insert into public.site_log_events(project_id,award_item_id,request_id,actor_id,event_kind,
    bid_sub_lot_id,quote_line_id,executed_quantity_milli,quantity_unit,
    progress_percent,work_date,note,idempotency_key,command_payload)
  values(item.project_id,item.id,item.request_id,auth.uid(),'intervention',p_bid_sub_lot_id,
    p_quote_line_id,p_executed_quantity_milli,canonical_unit,p_percent,p_work_date,
    btrim(p_note),p_idempotency_key,payload) returning * into v;
  perform dao_private.site_attach_evidence(v,p_document_ids);
  insert into public.audit_events(actor_id,action,entity_type,entity_id,metadata)
    values(auth.uid(),'site_intervention_recorded','project',v.project_id,
      jsonb_strip_nulls(jsonb_build_object('event_id',v.id,'award_item_id',v.award_item_id,
        'bid_sub_lot_id',v.bid_sub_lot_id,'quote_line_id',v.quote_line_id)));
  return v;
end;
$$;

create or replace function dao_private.site_execution_snapshot_v2(
  p_project_id uuid,p_before_created_at timestamptz,p_before_id uuid,p_limit integer
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare base jsonb;
begin
  base:=dao_private.site_execution_snapshot(p_project_id,p_before_created_at,p_before_id,p_limit);
  base:=jsonb_set(base,'{lots}',coalesce((
    select jsonb_agg(lot.value||jsonb_build_object('sub_lots',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',sl.id,'node_key',sl.node_key,'position',sl.position,'title',sl.title,'scope',sl.scope,
        'latest_progress',(select jsonb_build_object('id',e.id,'created_at',e.created_at,
          'status',e.declared_status,'percent',e.progress_percent,'reason',e.note,'actor_id',e.actor_id)
          from public.site_log_events e where e.bid_sub_lot_id=sl.id and e.event_kind='progress'
          order by e.created_at desc,e.id desc limit 1),
        'quantities',coalesce((select jsonb_agg(jsonb_build_object(
          'quote_line_id',q.quote_line_id,'unit',q.quantity_unit,
          'executed_quantity_milli',q.executed_quantity_milli,
          'reference_quantity_milli',q.reference_quantity_milli,
          'ratio_percent',case when q.reference_quantity_milli is null then null
            else round(q.executed_quantity_milli::numeric*100/q.reference_quantity_milli,2) end
        ) order by q.quantity_unit,q.quote_line_id nulls last) from (
          select e.quote_line_id,e.quantity_unit,sum(e.executed_quantity_milli)::bigint executed_quantity_milli,
            max(ql.quantity_milli)::bigint reference_quantity_milli
          from public.site_log_events e left join public.bid_quote_lines ql on ql.id=e.quote_line_id
          where e.bid_sub_lot_id=sl.id and e.executed_quantity_milli is not null
          group by e.quote_line_id,e.quantity_unit
        ) q),'[]'::jsonb)
      ) order by sl.position)
      from public.award_items ai join public.bid_sub_lots sl on sl.bid_item_id=ai.bid_item_id
      where ai.id=(lot.value->>'award_item_id')::uuid
    ),'[]'::jsonb)) order by lot.ordinality)
    from jsonb_array_elements(base->'lots') with ordinality lot(value,ordinality)
  ),'[]'::jsonb));
  base:=jsonb_set(base,'{events}',coalesce((
    select jsonb_agg(event.value||jsonb_strip_nulls(jsonb_build_object(
      'bid_sub_lot_id',e.bid_sub_lot_id,
      'sub_lot',case when sl.id is null then null else jsonb_build_object(
        'id',sl.id,'node_key',sl.node_key,'title',sl.title,'position',sl.position) end,
      'quantity',case when e.executed_quantity_milli is null then null else jsonb_build_object(
        'executed_quantity_milli',e.executed_quantity_milli,'unit',e.quantity_unit,
        'quote_line_id',e.quote_line_id,'reference_quantity_milli',ql.quantity_milli,
        'designation',ql.designation) end
    )) order by event.ordinality)
    from jsonb_array_elements(base->'events') with ordinality event(value,ordinality)
    join public.site_log_events e on e.id=(event.value->>'id')::uuid
    left join public.bid_sub_lots sl on sl.id=e.bid_sub_lot_id
    left join public.bid_quote_lines ql on ql.id=e.quote_line_id
  ),'[]'::jsonb));
  return base;
end;
$$;

create or replace function dao_private.record_site_observation(
  p_event_id uuid,p_outcome text,p_reason text,p_idempotency_key text
) returns public.site_client_observations language plpgsql security definer set search_path='' as $$
declare event public.site_log_events; payload jsonb; v public.site_client_observations;
begin
  if auth.uid() is null or p_idempotency_key is null or length(p_idempotency_key) not between 8 and 100 then
    raise exception using errcode='22023',message='valid idempotency key required';
  end if;
  payload:=jsonb_build_object('event_id',p_event_id,'outcome',p_outcome,
    'reason',nullif(btrim(coalesce(p_reason,'')),''));
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':site-observation:'||p_idempotency_key,0));
  select * into v from public.site_client_observations where actor_id=auth.uid() and idempotency_key=p_idempotency_key;
  if v.id is not null then
    if v.command_payload<>payload then raise exception using errcode='22023',message='idempotency key reused with different command'; end if;
    return v;
  end if;
  select * into event from public.site_log_events where id=p_event_id;
  if event.id is null or not dao_private.site_client_project(event.project_id)
    or not dao_private.site_can_read_award_item(event.award_item_id) then
    raise exception using errcode='42501',message='confirmed project client required';
  end if;
  if p_outcome not in ('acknowledged','disputed','technical_validated')
    or (p_outcome='disputed' and length(btrim(coalesce(p_reason,''))) not between 3 and 1000)
    or (p_outcome in ('acknowledged','technical_validated') and length(btrim(coalesce(p_reason,'')))>1000) then
    raise exception using errcode='22023',message='invalid client observation';
  end if;
  insert into public.site_client_observations(event_id,project_id,award_item_id,actor_id,
    outcome,reason,idempotency_key,command_payload)
  values(event.id,event.project_id,event.award_item_id,auth.uid(),p_outcome,
    nullif(btrim(coalesce(p_reason,'')),''),p_idempotency_key,payload) returning * into v;
  insert into public.audit_events(actor_id,action,entity_type,entity_id,metadata)
    values(auth.uid(),'site_observation_recorded','project',v.project_id,
      jsonb_build_object('observation_id',v.id,'event_id',v.event_id,'outcome',v.outcome));
  return v;
end;
$$;

create function public.record_site_progress_v2(
  p_award_item_id uuid,p_bid_sub_lot_id uuid,p_status text,p_percent integer,
  p_reason text,p_document_ids uuid[],p_idempotency_key text
) returns jsonb language sql security invoker set search_path='' as $$
  select to_jsonb(x)-'idempotency_key'-'command_payload'
  from dao_private.record_site_progress_v2($1,$2,$3,$4,$5,$6,$7) x;
$$;
create function public.record_site_intervention_v2(
  p_award_item_id uuid,p_bid_sub_lot_id uuid,p_work_date date,p_note text,p_percent integer,
  p_quote_line_id uuid,p_executed_quantity_milli bigint,p_quantity_unit text,
  p_document_ids uuid[],p_idempotency_key text
) returns jsonb language sql security invoker set search_path='' as $$
  select to_jsonb(x)-'idempotency_key'-'command_payload'
  from dao_private.record_site_intervention_v2($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) x;
$$;
create function public.site_execution_snapshot_v2(
  p_project_id uuid,p_before_created_at timestamptz,p_before_id uuid,p_limit integer
) returns jsonb language sql stable security invoker set search_path='' as $$
  select dao_private.site_execution_snapshot_v2($1,$2,$3,$4);
$$;

revoke all on function
  dao_private.record_site_progress_v2(uuid,uuid,text,integer,text,uuid[],text),
  dao_private.record_site_intervention_v2(uuid,uuid,date,text,integer,uuid,bigint,text,uuid[],text),
  dao_private.site_execution_snapshot_v2(uuid,timestamptz,uuid,integer)
  from public,anon,authenticated;
grant execute on function
  dao_private.record_site_progress_v2(uuid,uuid,text,integer,text,uuid[],text),
  dao_private.record_site_intervention_v2(uuid,uuid,date,text,integer,uuid,bigint,text,uuid[],text),
  dao_private.site_execution_snapshot_v2(uuid,timestamptz,uuid,integer)
  to authenticated,service_role;
revoke all on function
  public.record_site_progress_v2(uuid,uuid,text,integer,text,uuid[],text),
  public.record_site_intervention_v2(uuid,uuid,date,text,integer,uuid,bigint,text,uuid[],text),
  public.site_execution_snapshot_v2(uuid,timestamptz,uuid,integer)
  from public,anon,authenticated;
grant execute on function
  public.record_site_progress_v2(uuid,uuid,text,integer,text,uuid[],text),
  public.record_site_intervention_v2(uuid,uuid,date,text,integer,uuid,bigint,text,uuid[],text),
  public.site_execution_snapshot_v2(uuid,timestamptz,uuid,integer)
  to authenticated,service_role;

notify pgrst, 'reload schema';
commit;
