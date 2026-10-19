begin;

-- P2.3: append-only site execution journal. This domain is deliberately
-- independent from global project_stage/payment_status, contracts and OCE.
alter table public.award_items
  add constraint award_items_execution_identity unique(id,project_id,request_id);

create table public.site_log_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  project_id uuid not null references public.projects,
  award_item_id uuid not null references public.award_items,
  request_id uuid not null references public.project_requests,
  actor_id uuid not null references auth.users,
  event_kind text not null check(event_kind in ('progress','intervention','milestone')),
  milestone_key uuid,
  declared_status text,
  progress_percent integer check(progress_percent between 0 and 100),
  work_date date,
  title text,
  target_date date,
  note text,
  idempotency_key text not null check(length(idempotency_key) between 8 and 100),
  command_payload jsonb not null,
  unique(actor_id,idempotency_key),
  unique(id,project_id),
  unique(id,project_id,award_item_id),
  foreign key(award_item_id,project_id,request_id)
    references public.award_items(id,project_id,request_id),
  check (
    (event_kind='progress'
      and milestone_key is null and declared_status in ('not_started','in_progress','completed')
      and progress_percent is not null and work_date is null and title is null and target_date is null
      and length(btrim(coalesce(note,''))) between 3 and 1000)
    or
    (event_kind='intervention'
      and milestone_key is null and declared_status is null and work_date is not null
      and title is null and target_date is null and length(btrim(coalesce(note,''))) between 3 and 2000)
    or
    (event_kind='milestone'
      and milestone_key is not null and declared_status in ('planned','in_progress','completed','cancelled')
      and progress_percent is null and work_date is null and length(btrim(coalesce(title,''))) between 1 and 160
      and (note is null or length(btrim(note)) between 1 and 1000))
  )
);
create index site_log_events_project_page_idx on public.site_log_events(project_id,created_at desc,id desc);
create index site_log_events_award_page_idx on public.site_log_events(award_item_id,created_at desc,id desc);
create index site_log_events_milestone_idx on public.site_log_events(milestone_key,created_at desc,id desc)
  where milestone_key is not null;

create table public.site_log_evidence (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  event_id uuid not null,
  project_id uuid not null references public.projects,
  document_id uuid not null references public.documents,
  actor_id uuid not null references auth.users,
  unique(event_id,document_id),
  foreign key(event_id,project_id) references public.site_log_events(id,project_id)
);
create index site_log_evidence_project_idx on public.site_log_evidence(project_id,event_id);
create index site_log_evidence_document_idx on public.site_log_evidence(document_id);

create table public.site_client_observations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  event_id uuid not null,
  project_id uuid not null references public.projects,
  award_item_id uuid not null references public.award_items,
  actor_id uuid not null references auth.users,
  outcome text not null check(outcome in ('acknowledged','disputed')),
  reason text,
  idempotency_key text not null check(length(idempotency_key) between 8 and 100),
  command_payload jsonb not null,
  unique(actor_id,idempotency_key),
  foreign key(event_id,project_id,award_item_id)
    references public.site_log_events(id,project_id,award_item_id),
  check (
    (outcome='acknowledged' and (reason is null or length(btrim(reason)) between 1 and 1000))
    or (outcome='disputed' and length(btrim(coalesce(reason,''))) between 3 and 1000)
  )
);
create index site_client_observations_event_idx on public.site_client_observations(event_id,created_at,id);
create index site_client_observations_project_idx on public.site_client_observations(project_id,created_at desc,id desc);

create function dao_private.site_actor_workspace(p_workspace text) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null
    and p_workspace in ('client','contractor')
    and exists(select 1 from public.user_roles r where r.user_id=auth.uid() and r.role=p_workspace)
    and (
      not exists(select 1 from public.user_roles r where r.user_id=auth.uid()
        and r.role=case p_workspace when 'client' then 'contractor' else 'client' end)
      or exists(select 1 from public.profiles p where p.user_id=auth.uid() and p.last_workspace=p_workspace)
    );
$$;

create function dao_private.site_client_project(p_project_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select dao_private.site_actor_workspace('client')
    and dao_private.account_active(auth.uid())
    and exists(
      select 1 from public.projects p
      join public.project_members m on m.project_id=p.id and m.user_id=p.client_id
        and m.participation_role='client' and m.status='accepted'
      where p.id=p_project_id and p.client_id=auth.uid() and p.confirmed_at is not null
        and p.status<>'archived'
    );
$$;

create function dao_private.site_contractor_award_item(p_award_item_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select dao_private.site_actor_workspace('contractor')
    and dao_private.account_active(auth.uid())
    and exists(
      select 1 from public.award_items ai
      join public.awards a on a.id=ai.award_id and a.project_id=ai.project_id
        and a.contractor_id=ai.contractor_id
      join public.contractor_profiles cp on cp.id=ai.contractor_id and cp.user_id=auth.uid()
      join public.projects p on p.id=ai.project_id
      join public.project_requests r on r.id=ai.request_id and r.project_id=ai.project_id
      join public.project_members m on m.project_id=ai.project_id and m.user_id=auth.uid()
        and m.participation_role='contractor' and m.status='accepted'
      join public.project_members cm on cm.project_id=p.id and cm.user_id=p.client_id
        and cm.participation_role='client' and cm.status='accepted'
      where ai.id=p_award_item_id and ai.active and a.status<>'cancelled'
        and r.status in ('awarded','contracted') and p.client_id is not null
        and p.confirmed_at is not null and p.status<>'archived'
        and cp.verification_status<>'suspended'
    );
$$;

create function dao_private.site_can_read_award_item(p_award_item_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.award_items ai
    join public.awards a on a.id=ai.award_id and a.project_id=ai.project_id
    join public.project_requests r on r.id=ai.request_id and r.project_id=ai.project_id
    where ai.id=p_award_item_id and ai.active and a.status<>'cancelled'
      and r.status in ('awarded','contracted')
      and (dao_private.site_client_project(ai.project_id)
        or dao_private.site_contractor_award_item(ai.id))
  );
$$;

create function dao_private.site_can_read_document(p_document_id uuid,p_project_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.documents d
    where d.id=p_document_id and d.project_id=p_project_id and d.status='approved'
      and d.share_scope='project_members'
      and dao_private.project_member(d.project_id)
  );
$$;

revoke all on function dao_private.site_actor_workspace(text),
  dao_private.site_client_project(uuid),dao_private.site_contractor_award_item(uuid),
  dao_private.site_can_read_award_item(uuid),dao_private.site_can_read_document(uuid,uuid)
  from public,anon,authenticated;
grant execute on function dao_private.site_actor_workspace(text),
  dao_private.site_client_project(uuid),dao_private.site_contractor_award_item(uuid),
  dao_private.site_can_read_award_item(uuid),dao_private.site_can_read_document(uuid,uuid)
  to authenticated,service_role;

alter table public.site_log_events enable row level security;
alter table public.site_log_evidence enable row level security;
alter table public.site_client_observations enable row level security;
revoke all on public.site_log_events,public.site_log_evidence,public.site_client_observations
  from public,anon,authenticated;
grant select(id,created_at,project_id,award_item_id,request_id,actor_id,event_kind,
  milestone_key,declared_status,progress_percent,work_date,title,target_date,note)
  on public.site_log_events to authenticated;
grant select(id,created_at,event_id,project_id,document_id,actor_id)
  on public.site_log_evidence to authenticated;
grant select(id,created_at,event_id,project_id,award_item_id,actor_id,outcome,reason)
  on public.site_client_observations to authenticated;
grant all on public.site_log_events,public.site_log_evidence,public.site_client_observations to service_role;

create policy read_authorized_lot on public.site_log_events for select to authenticated
using (dao_private.site_can_read_award_item(award_item_id));
create policy read_authorized_evidence on public.site_log_evidence for select to authenticated
using (
  dao_private.site_can_read_document(document_id,project_id)
  and exists(select 1 from public.site_log_events e where e.id=event_id
    and e.project_id=site_log_evidence.project_id
    and dao_private.site_can_read_award_item(e.award_item_id))
);
create policy read_authorized_observation on public.site_client_observations for select to authenticated
using (dao_private.site_can_read_award_item(award_item_id));

create function dao_private.site_history_immutable() returns trigger
language plpgsql set search_path='' as $$
begin
  raise exception using errcode='23514',message='site execution history is immutable';
end;
$$;
create trigger immutable_site_log_events before update or delete on public.site_log_events
  for each row execute function dao_private.site_history_immutable();
create trigger immutable_site_log_evidence before update or delete on public.site_log_evidence
  for each row execute function dao_private.site_history_immutable();
create trigger immutable_site_client_observations before update or delete on public.site_client_observations
  for each row execute function dao_private.site_history_immutable();
revoke all on function dao_private.site_history_immutable() from public,anon,authenticated;

create function dao_private.site_existing_event(p_key text,p_kind text,p_payload jsonb)
returns public.site_log_events language plpgsql security definer set search_path='' as $$
declare v public.site_log_events;
begin
  if auth.uid() is null or p_key is null or length(p_key) not between 8 and 100 then
    raise exception using errcode='22023',message='valid idempotency key required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':site:'||p_key,0));
  select * into v from public.site_log_events where actor_id=auth.uid() and idempotency_key=p_key;
  if v.id is not null and (v.event_kind<>p_kind or v.command_payload<>p_payload) then
    raise exception using errcode='22023',message='idempotency key reused with different command';
  end if;
  return v;
end;
$$;

create function dao_private.site_attach_evidence(p_event public.site_log_events,p_document_ids uuid[])
returns void language plpgsql security definer set search_path='' as $$
declare expected integer; inserted integer;
begin
  if coalesce(cardinality(p_document_ids),0)>10 then
    raise exception using errcode='22023',message='too many evidence documents';
  end if;
  select count(distinct x) into expected from unnest(coalesce(p_document_ids,array[]::uuid[])) x;
  if expected<>coalesce(cardinality(p_document_ids),0) then
    raise exception using errcode='22023',message='duplicate evidence document';
  end if;
  insert into public.site_log_evidence(event_id,project_id,document_id,actor_id)
  select p_event.id,p_event.project_id,d.id,auth.uid()
  from unnest(coalesce(p_document_ids,array[]::uuid[])) x
  join public.documents d on d.id=x and d.project_id=p_event.project_id
    and d.owner_id=auth.uid() and d.status='approved' and d.share_scope='project_members';
  get diagnostics inserted=row_count;
  if inserted<>expected then
    raise exception using errcode='42501',message='evidence document is not authorized';
  end if;
end;
$$;

create function dao_private.record_site_progress(
  p_award_item_id uuid,p_status text,p_percent integer,p_reason text,
  p_document_ids uuid[],p_idempotency_key text
) returns public.site_log_events language plpgsql security definer set search_path='' as $$
declare item public.award_items; payload jsonb; v public.site_log_events;
begin
  payload:=jsonb_build_object('award_item_id',p_award_item_id,'status',p_status,'percent',p_percent,
    'reason',btrim(coalesce(p_reason,'')),'document_ids',to_jsonb(coalesce(p_document_ids,array[]::uuid[])));
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
  insert into public.site_log_events(project_id,award_item_id,request_id,actor_id,event_kind,
    declared_status,progress_percent,note,idempotency_key,command_payload)
  values(item.project_id,item.id,item.request_id,auth.uid(),'progress',p_status,p_percent,
    btrim(p_reason),p_idempotency_key,payload) returning * into v;
  perform dao_private.site_attach_evidence(v,p_document_ids);
  insert into public.audit_events(actor_id,action,entity_type,entity_id,metadata)
    values(auth.uid(),'site_progress_recorded','project',v.project_id,
      jsonb_build_object('event_id',v.id,'award_item_id',v.award_item_id));
  return v;
end;
$$;

create function dao_private.record_site_intervention(
  p_award_item_id uuid,p_work_date date,p_note text,p_percent integer,
  p_document_ids uuid[],p_idempotency_key text
) returns public.site_log_events language plpgsql security definer set search_path='' as $$
declare item public.award_items; payload jsonb; v public.site_log_events;
begin
  payload:=jsonb_build_object('award_item_id',p_award_item_id,'work_date',p_work_date,
    'note',btrim(coalesce(p_note,'')),'percent',p_percent,
    'document_ids',to_jsonb(coalesce(p_document_ids,array[]::uuid[])));
  v:=dao_private.site_existing_event(p_idempotency_key,'intervention',payload);
  if v.id is not null then return v; end if;
  if not dao_private.site_contractor_award_item(p_award_item_id) then
    raise exception using errcode='42501',message='active awarded contractor required';
  end if;
  if p_work_date is null or length(btrim(coalesce(p_note,''))) not between 3 and 2000
    or (p_percent is not null and p_percent not between 0 and 100) then
    raise exception using errcode='22023',message='invalid intervention declaration';
  end if;
  perform 1 from public.award_items where id=p_award_item_id for update;
  if not dao_private.site_contractor_award_item(p_award_item_id) then
    raise exception using errcode='42501',message='active awarded contractor required';
  end if;
  select * into item from public.award_items where id=p_award_item_id;
  insert into public.site_log_events(project_id,award_item_id,request_id,actor_id,event_kind,
    progress_percent,work_date,note,idempotency_key,command_payload)
  values(item.project_id,item.id,item.request_id,auth.uid(),'intervention',p_percent,p_work_date,
    btrim(p_note),p_idempotency_key,payload) returning * into v;
  perform dao_private.site_attach_evidence(v,p_document_ids);
  insert into public.audit_events(actor_id,action,entity_type,entity_id,metadata)
    values(auth.uid(),'site_intervention_recorded','project',v.project_id,
      jsonb_build_object('event_id',v.id,'award_item_id',v.award_item_id));
  return v;
end;
$$;

create function dao_private.create_site_milestone(
  p_award_item_id uuid,p_title text,p_target_date date,p_status text,p_note text,
  p_idempotency_key text
) returns public.site_log_events language plpgsql security definer set search_path='' as $$
declare item public.award_items; payload jsonb; v public.site_log_events;
begin
  payload:=jsonb_build_object('award_item_id',p_award_item_id,'title',btrim(coalesce(p_title,'')),
    'target_date',p_target_date,'status',p_status,'note',nullif(btrim(coalesce(p_note,'')),''));
  v:=dao_private.site_existing_event(p_idempotency_key,'milestone',payload);
  if v.id is not null then return v; end if;
  if not dao_private.site_contractor_award_item(p_award_item_id) then
    raise exception using errcode='42501',message='active awarded contractor required';
  end if;
  if length(btrim(coalesce(p_title,''))) not between 1 and 160
    or p_status not in ('planned','in_progress','completed','cancelled')
    or length(btrim(coalesce(p_note,'')))>1000 then
    raise exception using errcode='22023',message='invalid milestone declaration';
  end if;
  perform 1 from public.award_items where id=p_award_item_id for update;
  if not dao_private.site_contractor_award_item(p_award_item_id) then
    raise exception using errcode='42501',message='active awarded contractor required';
  end if;
  select * into item from public.award_items where id=p_award_item_id;
  insert into public.site_log_events(project_id,award_item_id,request_id,actor_id,event_kind,
    milestone_key,declared_status,title,target_date,note,idempotency_key,command_payload)
  values(item.project_id,item.id,item.request_id,auth.uid(),'milestone',gen_random_uuid(),p_status,
    btrim(p_title),p_target_date,nullif(btrim(coalesce(p_note,'')),''),p_idempotency_key,payload)
  returning * into v;
  insert into public.audit_events(actor_id,action,entity_type,entity_id,metadata)
    values(auth.uid(),'site_milestone_recorded','project',v.project_id,
      jsonb_build_object('event_id',v.id,'award_item_id',v.award_item_id,'milestone_key',v.milestone_key));
  return v;
end;
$$;

create function dao_private.update_site_milestone(
  p_milestone_key uuid,p_target_date date,p_status text,p_note text,p_idempotency_key text
) returns public.site_log_events language plpgsql security definer set search_path='' as $$
declare previous public.site_log_events; payload jsonb; v public.site_log_events;
begin
  payload:=jsonb_build_object('milestone_key',p_milestone_key,'target_date',p_target_date,
    'status',p_status,'note',nullif(btrim(coalesce(p_note,'')),''));
  v:=dao_private.site_existing_event(p_idempotency_key,'milestone',payload);
  if v.id is not null then return v; end if;
  if p_milestone_key is null then raise exception using errcode='22023',message='milestone required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('site-milestone:'||p_milestone_key::text,0));
  select * into previous from public.site_log_events where milestone_key=p_milestone_key
    order by created_at desc,id desc limit 1;
  if previous.id is null or not dao_private.site_contractor_award_item(previous.award_item_id) then
    raise exception using errcode='42501',message='active awarded contractor required';
  end if;
  if previous.declared_status in ('completed','cancelled') then
    raise exception using errcode='23514',message='terminal milestone is immutable';
  end if;
  if p_status not in ('planned','in_progress','completed','cancelled')
    or length(btrim(coalesce(p_note,'')))>1000 then
    raise exception using errcode='22023',message='invalid milestone declaration';
  end if;
  perform 1 from public.award_items where id=previous.award_item_id for update;
  if not dao_private.site_contractor_award_item(previous.award_item_id) then
    raise exception using errcode='42501',message='active awarded contractor required';
  end if;
  insert into public.site_log_events(project_id,award_item_id,request_id,actor_id,event_kind,
    milestone_key,declared_status,title,target_date,note,idempotency_key,command_payload)
  values(previous.project_id,previous.award_item_id,previous.request_id,auth.uid(),'milestone',
    previous.milestone_key,p_status,previous.title,p_target_date,
    nullif(btrim(coalesce(p_note,'')),''),p_idempotency_key,payload) returning * into v;
  insert into public.audit_events(actor_id,action,entity_type,entity_id,metadata)
    values(auth.uid(),'site_milestone_recorded','project',v.project_id,
      jsonb_build_object('event_id',v.id,'award_item_id',v.award_item_id,'milestone_key',v.milestone_key));
  return v;
end;
$$;

create function dao_private.record_site_observation(
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
  select * into v from public.site_client_observations
    where actor_id=auth.uid() and idempotency_key=p_idempotency_key;
  if v.id is not null then
    if v.command_payload<>payload then
      raise exception using errcode='22023',message='idempotency key reused with different command';
    end if;
    return v;
  end if;
  select * into event from public.site_log_events where id=p_event_id;
  if event.id is null or not dao_private.site_client_project(event.project_id)
    or not dao_private.site_can_read_award_item(event.award_item_id) then
    raise exception using errcode='42501',message='confirmed project client required';
  end if;
  if p_outcome not in ('acknowledged','disputed')
    or (p_outcome='disputed' and length(btrim(coalesce(p_reason,''))) not between 3 and 1000)
    or (p_outcome='acknowledged' and length(btrim(coalesce(p_reason,'')))>1000) then
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

create function dao_private.site_execution_snapshot(
  p_project_id uuid,p_before_created_at timestamptz,p_before_id uuid,p_limit integer
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare page_size integer:=least(greatest(coalesce(p_limit,30),1),50);
begin
  if auth.uid() is null or not dao_private.account_active(auth.uid()) then
    raise exception using errcode='42501',message='active account required';
  end if;
  if not dao_private.site_client_project(p_project_id) and not exists(
    select 1 from public.award_items ai where ai.project_id=p_project_id
      and dao_private.site_contractor_award_item(ai.id)) then
    raise exception using errcode='42501',message='site execution access denied';
  end if;
  if (p_before_created_at is null)<>(p_before_id is null) then
    raise exception using errcode='22023',message='complete execution cursor required';
  end if;
  return jsonb_build_object(
    'project_id',p_project_id,
    'can_observe',dao_private.site_client_project(p_project_id),
    'lots',coalesce((
      select jsonb_agg(jsonb_build_object(
        'award_item_id',ai.id,'request_id',ai.request_id,'contractor_id',ai.contractor_id,
        'title',coalesce(rv.title,'Lot attribué'),'trade_id',rv.trade_id,
        'can_write',dao_private.site_contractor_award_item(ai.id),
        'latest_progress',(select jsonb_build_object('id',e.id,'created_at',e.created_at,
          'status',e.declared_status,'percent',e.progress_percent,'reason',e.note,'actor_id',e.actor_id)
          from public.site_log_events e where e.award_item_id=ai.id and e.event_kind='progress'
          order by e.created_at desc,e.id desc limit 1)
      ) order by ai.created_at,ai.id)
      from public.award_items ai
      join public.awards a on a.id=ai.award_id and a.status<>'cancelled'
      join public.project_requests r on r.id=ai.request_id and r.status in ('awarded','contracted')
      left join lateral (select v.title,v.trade_id from public.project_request_versions v
        where v.request_id=ai.request_id order by v.version_no desc limit 1) rv on true
      where ai.project_id=p_project_id and ai.active
        and dao_private.site_can_read_award_item(ai.id)
    ),'[]'::jsonb),
    'events',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',e.id,'created_at',e.created_at,'award_item_id',e.award_item_id,
        'request_id',e.request_id,'actor_id',e.actor_id,'kind',e.event_kind,
        'milestone_key',e.milestone_key,'status',e.declared_status,
        'percent',e.progress_percent,'work_date',e.work_date,'title',e.title,
        'target_date',e.target_date,'note',e.note,
        'evidence',coalesce((select jsonb_agg(jsonb_build_object('document_id',d.id,
          'name',d.original_name,'mime_type',d.mime_type,'created_at',x.created_at) order by x.created_at,x.id)
          from public.site_log_evidence x join public.documents d on d.id=x.document_id
          where x.event_id=e.id and dao_private.site_can_read_document(d.id,e.project_id)),'[]'::jsonb),
        'observations',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,
          'created_at',o.created_at,'actor_id',o.actor_id,'outcome',o.outcome,'reason',o.reason)
          order by o.created_at,o.id) from public.site_client_observations o where o.event_id=e.id),'[]'::jsonb)
      ) order by e.created_at desc,e.id desc)
      from (select x.* from public.site_log_events x where x.project_id=p_project_id
        and (p_before_created_at is null or (x.created_at,x.id)<(p_before_created_at,p_before_id))
        and dao_private.site_can_read_award_item(x.award_item_id)
        order by x.created_at desc,x.id desc limit page_size) e
    ),'[]'::jsonb)
  );
end;
$$;

create function public.record_site_progress(
  p_award_item_id uuid,p_status text,p_percent integer,p_reason text,
  p_document_ids uuid[],p_idempotency_key text
)
returns jsonb language sql security invoker set search_path='' as $$
  select to_jsonb(x)-'idempotency_key'-'command_payload'
  from dao_private.record_site_progress($1,$2,$3,$4,$5,$6) x;
$$;
create function public.record_site_intervention(
  p_award_item_id uuid,p_work_date date,p_note text,p_percent integer,
  p_document_ids uuid[],p_idempotency_key text
)
returns jsonb language sql security invoker set search_path='' as $$
  select to_jsonb(x)-'idempotency_key'-'command_payload'
  from dao_private.record_site_intervention($1,$2,$3,$4,$5,$6) x;
$$;
create function public.create_site_milestone(
  p_award_item_id uuid,p_title text,p_target_date date,p_status text,
  p_note text,p_idempotency_key text
)
returns jsonb language sql security invoker set search_path='' as $$
  select to_jsonb(x)-'idempotency_key'-'command_payload'
  from dao_private.create_site_milestone($1,$2,$3,$4,$5,$6) x;
$$;
create function public.update_site_milestone(
  p_milestone_key uuid,p_target_date date,p_status text,p_note text,p_idempotency_key text
)
returns jsonb language sql security invoker set search_path='' as $$
  select to_jsonb(x)-'idempotency_key'-'command_payload'
  from dao_private.update_site_milestone($1,$2,$3,$4,$5) x;
$$;
create function public.record_site_observation(
  p_event_id uuid,p_outcome text,p_reason text,p_idempotency_key text
)
returns jsonb language sql security invoker set search_path='' as $$
  select to_jsonb(x)-'idempotency_key'-'command_payload'
  from dao_private.record_site_observation($1,$2,$3,$4) x;
$$;
create function public.site_execution_snapshot(
  p_project_id uuid,p_before_created_at timestamptz,p_before_id uuid,p_limit integer
)
returns jsonb language sql stable security invoker set search_path='' as $$
  select dao_private.site_execution_snapshot($1,$2,$3,$4);
$$;

revoke all on function dao_private.site_existing_event(text,text,jsonb),
  dao_private.site_attach_evidence(public.site_log_events,uuid[]),
  dao_private.record_site_progress(uuid,text,integer,text,uuid[],text),
  dao_private.record_site_intervention(uuid,date,text,integer,uuid[],text),
  dao_private.create_site_milestone(uuid,text,date,text,text,text),
  dao_private.update_site_milestone(uuid,date,text,text,text),
  dao_private.record_site_observation(uuid,text,text,text),
  dao_private.site_execution_snapshot(uuid,timestamptz,uuid,integer)
  from public,anon,authenticated;
grant execute on function dao_private.site_existing_event(text,text,jsonb),
  dao_private.site_attach_evidence(public.site_log_events,uuid[]),
  dao_private.record_site_progress(uuid,text,integer,text,uuid[],text),
  dao_private.record_site_intervention(uuid,date,text,integer,uuid[],text),
  dao_private.create_site_milestone(uuid,text,date,text,text,text),
  dao_private.update_site_milestone(uuid,date,text,text,text),
  dao_private.record_site_observation(uuid,text,text,text),
  dao_private.site_execution_snapshot(uuid,timestamptz,uuid,integer)
  to authenticated,service_role;

revoke all on function public.record_site_progress(uuid,text,integer,text,uuid[],text),
  public.record_site_intervention(uuid,date,text,integer,uuid[],text),
  public.create_site_milestone(uuid,text,date,text,text,text),
  public.update_site_milestone(uuid,date,text,text,text),
  public.record_site_observation(uuid,text,text,text),
  public.site_execution_snapshot(uuid,timestamptz,uuid,integer)
  from public,anon,authenticated;
grant execute on function public.record_site_progress(uuid,text,integer,text,uuid[],text),
  public.record_site_intervention(uuid,date,text,integer,uuid[],text),
  public.create_site_milestone(uuid,text,date,text,text,text),
  public.update_site_milestone(uuid,date,text,text,text),
  public.record_site_observation(uuid,text,text,text),
  public.site_execution_snapshot(uuid,timestamptz,uuid,integer)
  to authenticated,service_role;

notify pgrst, 'reload schema';
commit;
