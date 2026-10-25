begin;

-- P11 technical inspections and reserve tracking. This is deliberately
-- separate from contractual acceptance, legal receipt and warranty periods.
create table public.site_technical_inspections (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  project_id uuid not null references public.projects,
  award_item_id uuid not null,
  request_id uuid not null,
  requested_by uuid not null references auth.users,
  request_note text,
  status text not null check(status in ('requested','in_progress','technical_check_complete','withdrawn')),
  revision integer not null default 1 check(revision>0),
  idempotency_key text not null check(length(idempotency_key) between 8 and 100),
  command_payload jsonb not null,
  unique(requested_by,idempotency_key),
  unique(id,project_id,award_item_id),
  foreign key(award_item_id,project_id,request_id)
    references public.award_items(id,project_id,request_id),
  check(request_note is null or length(btrim(request_note)) between 1 and 2000)
);
create index site_technical_inspections_project_page_idx
  on public.site_technical_inspections(project_id,created_at desc,id desc);
create index site_technical_inspections_award_page_idx
  on public.site_technical_inspections(award_item_id,created_at desc,id desc);

create table public.site_technical_inspection_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  inspection_id uuid not null,
  project_id uuid not null references public.projects,
  award_item_id uuid not null,
  actor_id uuid not null references auth.users,
  actor_role text not null check(actor_role in ('client','contractor','manager')),
  revision integer not null check(revision>0),
  event_kind text not null check(event_kind in ('requested','started','technical_check_complete','withdrawn','comment','manager_comment')),
  status_after text not null check(status_after in ('requested','in_progress','technical_check_complete','withdrawn')),
  note text,
  idempotency_key text not null check(length(idempotency_key) between 8 and 100),
  command_payload jsonb not null,
  unique(inspection_id,revision),
  unique(actor_id,idempotency_key),
  unique(id,project_id,award_item_id),
  foreign key(inspection_id,project_id,award_item_id)
    references public.site_technical_inspections(id,project_id,award_item_id),
  check(note is null or length(btrim(note)) between 1 and 2000),
  check((event_kind='requested' and status_after='requested')
    or (event_kind='started' and status_after='in_progress')
    or (event_kind='technical_check_complete' and status_after='technical_check_complete')
    or (event_kind='withdrawn' and status_after='withdrawn')
    or event_kind in ('comment','manager_comment'))
);
create index site_technical_inspection_events_page_idx
  on public.site_technical_inspection_events(inspection_id,created_at desc,id desc);

create table public.site_technical_reserves (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  project_id uuid not null references public.projects,
  award_item_id uuid not null,
  request_id uuid not null,
  inspection_id uuid,
  created_by uuid not null references auth.users,
  responsible_contractor_id uuid not null references public.contractor_profiles,
  title text not null check(length(btrim(title)) between 1 and 180),
  description text not null check(length(btrim(description)) between 3 and 4000),
  category text not null check(category in ('workmanship','materials','completeness','safety','other')),
  severity text not null check(severity in ('minor','moderate','major')),
  location text,
  bid_sub_lot_id uuid references public.bid_sub_lots,
  native_activity_id uuid,
  due_date date,
  status text not null check(status in ('open','correction_declared','recheck_requested','resolved_confirmed','reopened','withdrawn')),
  revision integer not null default 1 check(revision>0),
  idempotency_key text not null check(length(idempotency_key) between 8 and 100),
  command_payload jsonb not null,
  unique(created_by,idempotency_key),
  unique(id,project_id,award_item_id),
  foreign key(award_item_id,project_id,request_id)
    references public.award_items(id,project_id,request_id),
  foreign key(inspection_id,project_id,award_item_id)
    references public.site_technical_inspections(id,project_id,award_item_id),
  foreign key(native_activity_id,award_item_id)
    references public.native_execution_activities(id,award_item_id),
  check(location is null or length(btrim(location)) between 1 and 500),
  check(bid_sub_lot_id is null or native_activity_id is null)
);
create index site_technical_reserves_project_page_idx
  on public.site_technical_reserves(project_id,created_at desc,id desc);
create index site_technical_reserves_award_status_idx
  on public.site_technical_reserves(award_item_id,status,created_at desc,id desc);
create index site_technical_reserves_inspection_idx
  on public.site_technical_reserves(inspection_id,created_at desc,id desc)
  where inspection_id is not null;

create table public.site_technical_reserve_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  reserve_id uuid not null,
  project_id uuid not null references public.projects,
  award_item_id uuid not null,
  actor_id uuid not null references auth.users,
  actor_role text not null check(actor_role in ('client','contractor','manager')),
  revision integer not null check(revision>0),
  event_kind text not null check(event_kind in ('created','comment','correction_declared','recheck_requested','resolved_confirmed','reopened','withdrawn','manager_comment')),
  status_after text not null check(status_after in ('open','correction_declared','recheck_requested','resolved_confirmed','reopened','withdrawn')),
  note text,
  idempotency_key text not null check(length(idempotency_key) between 8 and 100),
  command_payload jsonb not null,
  unique(reserve_id,revision),
  unique(actor_id,idempotency_key),
  unique(id,project_id,award_item_id),
  foreign key(reserve_id,project_id,award_item_id)
    references public.site_technical_reserves(id,project_id,award_item_id),
  check(note is null or length(btrim(note)) between 1 and 2000),
  check((event_kind='created' and status_after='open')
    or (event_kind='correction_declared' and status_after='correction_declared')
    or (event_kind='recheck_requested' and status_after='recheck_requested')
    or (event_kind='resolved_confirmed' and status_after='resolved_confirmed')
    or (event_kind='reopened' and status_after='reopened')
    or (event_kind='withdrawn' and status_after='withdrawn')
    or event_kind in ('comment','manager_comment'))
);
create index site_technical_reserve_events_page_idx
  on public.site_technical_reserve_events(reserve_id,created_at desc,id desc);

create table public.site_technical_evidence (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  project_id uuid not null references public.projects,
  award_item_id uuid not null,
  inspection_event_id uuid,
  reserve_event_id uuid,
  document_id uuid not null references public.documents,
  actor_id uuid not null references auth.users,
  foreign key(inspection_event_id,project_id,award_item_id)
    references public.site_technical_inspection_events(id,project_id,award_item_id),
  foreign key(reserve_event_id,project_id,award_item_id)
    references public.site_technical_reserve_events(id,project_id,award_item_id),
  check((inspection_event_id is not null)::integer + (reserve_event_id is not null)::integer = 1),
  unique(inspection_event_id,document_id),
  unique(reserve_event_id,document_id)
);
create index site_technical_evidence_document_idx on public.site_technical_evidence(document_id);

create or replace function dao_private.site_technical_can_read_award_item(p_award_item_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and dao_private.account_active(auth.uid())
    and exists(select 1 from public.award_items ai
      join public.projects p on p.id=ai.project_id and p.status<>'archived'
      join public.contractor_profiles cp on cp.id=ai.contractor_id
      where ai.id=p_award_item_id and (
        dao_private.site_client_project(ai.project_id)
        or dao_private.manages_project(ai.project_id)
        or (dao_private.site_actor_workspace('contractor') and cp.user_id=auth.uid()
          and cp.verification_status<>'suspended'
          and exists(select 1 from public.project_members m where m.project_id=ai.project_id
            and m.user_id=auth.uid() and m.participation_role='contractor' and m.status='accepted'))
      ));
$$;

create or replace function dao_private.site_technical_actor_role(p_project_id uuid,p_award_item_id uuid)
returns text language sql stable security definer set search_path='' as $$
  select case
    when dao_private.site_client_project(p_project_id) then 'client'
    when dao_private.site_contractor_award_item(p_award_item_id) then 'contractor'
    when dao_private.manages_project(p_project_id) then 'manager'
    else null end;
$$;

create or replace function dao_private.site_technical_project_readable(p_project_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and dao_private.account_active(auth.uid())
    and exists(select 1 from public.projects p where p.id=p_project_id and p.status<>'archived')
    and (dao_private.site_client_project(p_project_id) or dao_private.manages_project(p_project_id)
      or exists(select 1 from public.award_items ai where ai.project_id=p_project_id
        and dao_private.site_technical_can_read_award_item(ai.id)));
$$;

revoke all on function dao_private.site_technical_can_read_award_item(uuid),
  dao_private.site_technical_actor_role(uuid,uuid),dao_private.site_technical_project_readable(uuid)
  from public,anon,authenticated;
grant execute on function dao_private.site_technical_can_read_award_item(uuid),
  dao_private.site_technical_actor_role(uuid,uuid),dao_private.site_technical_project_readable(uuid)
  to authenticated,service_role;

alter table public.site_technical_inspections enable row level security;
alter table public.site_technical_inspection_events enable row level security;
alter table public.site_technical_reserves enable row level security;
alter table public.site_technical_reserve_events enable row level security;
alter table public.site_technical_evidence enable row level security;
revoke all on public.site_technical_inspections,public.site_technical_inspection_events,
  public.site_technical_reserves,public.site_technical_reserve_events,public.site_technical_evidence
  from public,anon,authenticated;
grant select(id,created_at,updated_at,project_id,award_item_id,request_id,requested_by,request_note,status,revision)
  on public.site_technical_inspections to authenticated;
grant select(id,created_at,inspection_id,project_id,award_item_id,actor_id,actor_role,revision,event_kind,status_after,note)
  on public.site_technical_inspection_events to authenticated;
grant select(id,created_at,updated_at,project_id,award_item_id,request_id,inspection_id,created_by,
  responsible_contractor_id,title,description,category,severity,location,bid_sub_lot_id,native_activity_id,due_date,status,revision)
  on public.site_technical_reserves to authenticated;
grant select(id,created_at,reserve_id,project_id,award_item_id,actor_id,actor_role,revision,event_kind,status_after,note)
  on public.site_technical_reserve_events to authenticated;
grant select(id,created_at,project_id,award_item_id,inspection_event_id,reserve_event_id,document_id,actor_id)
  on public.site_technical_evidence to authenticated;
grant all on public.site_technical_inspections,public.site_technical_inspection_events,
  public.site_technical_reserves,public.site_technical_reserve_events,public.site_technical_evidence
  to service_role;

create policy read_site_technical_inspections on public.site_technical_inspections
  for select to authenticated using (dao_private.site_technical_can_read_award_item(award_item_id));
create policy read_site_technical_inspection_events on public.site_technical_inspection_events
  for select to authenticated using (dao_private.site_technical_can_read_award_item(award_item_id));
create policy read_site_technical_reserves on public.site_technical_reserves
  for select to authenticated using (dao_private.site_technical_can_read_award_item(award_item_id));
create policy read_site_technical_reserve_events on public.site_technical_reserve_events
  for select to authenticated using (dao_private.site_technical_can_read_award_item(award_item_id));
create policy read_site_technical_evidence on public.site_technical_evidence
  for select to authenticated using (
    dao_private.site_technical_can_read_award_item(award_item_id)
    and dao_private.site_can_read_document(document_id,project_id)
  );

create function dao_private.site_technical_no_delete() returns trigger
language plpgsql set search_path='' as $$
begin
  raise exception using errcode='23514',message='technical quality records cannot be deleted';
end;
$$;
create trigger no_delete_site_technical_inspections before delete on public.site_technical_inspections
  for each row execute function dao_private.site_technical_no_delete();
create trigger no_delete_site_technical_reserves before delete on public.site_technical_reserves
  for each row execute function dao_private.site_technical_no_delete();
create trigger immutable_site_technical_inspection_events before update or delete on public.site_technical_inspection_events
  for each row execute function dao_private.site_history_immutable();
create trigger immutable_site_technical_reserve_events before update or delete on public.site_technical_reserve_events
  for each row execute function dao_private.site_history_immutable();
create trigger immutable_site_technical_evidence before update or delete on public.site_technical_evidence
  for each row execute function dao_private.site_history_immutable();
revoke all on function dao_private.site_technical_no_delete() from public,anon,authenticated;

create function dao_private.site_technical_attach_evidence(
  p_project_id uuid,p_award_item_id uuid,p_inspection_event_id uuid,p_reserve_event_id uuid,p_document_ids uuid[]
) returns void language plpgsql security definer set search_path='' as $$
declare expected integer; inserted integer;
begin
  if coalesce(cardinality(p_document_ids),0)>10 then
    raise exception using errcode='22023',message='too many evidence documents';
  end if;
  select count(distinct x) into expected from unnest(coalesce(p_document_ids,array[]::uuid[])) x;
  if expected<>coalesce(cardinality(p_document_ids),0) then
    raise exception using errcode='22023',message='duplicate evidence document';
  end if;
  insert into public.site_technical_evidence(project_id,award_item_id,inspection_event_id,reserve_event_id,document_id,actor_id)
  select p_project_id,p_award_item_id,p_inspection_event_id,p_reserve_event_id,d.id,auth.uid()
  from unnest(coalesce(p_document_ids,array[]::uuid[])) x
  join public.documents d on d.id=x and d.project_id=p_project_id and d.owner_id=auth.uid()
    and d.status='approved' and d.share_scope='project_members';
  get diagnostics inserted=row_count;
  if inserted<>expected then
    raise exception using errcode='42501',message='evidence document is not authorized';
  end if;
end;
$$;

create function dao_private.site_technical_evidence_items(p_project_id uuid,p_inspection_event_id uuid,p_reserve_event_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('documentId',d.id,'name',d.original_name,
    'mimeType',d.mime_type,'addedAt',e.created_at) order by e.created_at,e.id),'[]'::jsonb)
  from public.site_technical_evidence e join public.documents d on d.id=e.document_id
  where e.project_id=p_project_id
    and ((p_inspection_event_id is not null and e.inspection_event_id=p_inspection_event_id)
      or (p_reserve_event_id is not null and e.reserve_event_id=p_reserve_event_id))
    and dao_private.site_technical_can_read_award_item(e.award_item_id);
$$;

create function dao_private.native_technical_inspections_v1(
  p_project_id uuid,p_award_item_id uuid,p_before_created_at timestamptz,p_before_id uuid,p_limit integer
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare page_size integer:=least(greatest(coalesce(p_limit,30),1),50); v_items jsonb; v_summary jsonb; v_more boolean;
begin
  if auth.uid() is null or not dao_private.account_active(auth.uid()) then
    raise exception using errcode='42501',message='active authentication required';
  end if;
  if not dao_private.site_technical_project_readable(p_project_id) then
    raise exception using errcode='42501',message='technical quality access denied';
  end if;
  if (p_before_created_at is null)<>(p_before_id is null) then
    raise exception using errcode='22023',message='complete technical quality cursor required';
  end if;
  if p_award_item_id is not null and not dao_private.site_technical_can_read_award_item(p_award_item_id) then
    raise exception using errcode='42501',message='awarded lot access denied';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'awardItemId',ai.id,'requestId',ai.request_id,
    'inspectionCount',(select count(*) from public.site_technical_inspections i where i.award_item_id=ai.id),
    'reserveCount',(select count(*) from public.site_technical_reserves r where r.award_item_id=ai.id),
    'openReserveCount',(select count(*) from public.site_technical_reserves r where r.award_item_id=ai.id and r.status not in ('resolved_confirmed','withdrawn')),
    'correctionsPendingReviewCount',(select count(*) from public.site_technical_reserves r where r.award_item_id=ai.id and r.status='correction_declared'),
    'rechecksRequestedCount',(select count(*) from public.site_technical_reserves r where r.award_item_id=ai.id and r.status='recheck_requested'),
    'lastTechnicalActivityAt',greatest(
      (select max(i.updated_at) from public.site_technical_inspections i where i.award_item_id=ai.id),
      (select max(r.updated_at) from public.site_technical_reserves r where r.award_item_id=ai.id)
    )
  ) order by ai.created_at,ai.id),'[]'::jsonb) into v_summary
  from public.award_items ai where ai.project_id=p_project_id
    and (p_award_item_id is null or ai.id=p_award_item_id)
    and dao_private.site_technical_can_read_award_item(ai.id);

  with page as (
    select i.* from public.site_technical_inspections i
    where i.project_id=p_project_id and (p_award_item_id is null or i.award_item_id=p_award_item_id)
      and dao_private.site_technical_can_read_award_item(i.award_item_id)
      and (p_before_created_at is null or (i.created_at,i.id)<(p_before_created_at,p_before_id))
    order by i.created_at desc,i.id desc limit page_size+1
  ), shown as (select * from page order by created_at desc,id desc limit page_size)
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',i.id,'projectId',i.project_id,'awardItemId',i.award_item_id,'requestId',i.request_id,
    'requestedBy',i.requested_by,'requestNote',i.request_note,'status',i.status,'revision',i.revision,
    'createdAt',i.created_at,'updatedAt',i.updated_at,
    'latestEvent',(select jsonb_build_object('id',e.id,'kind',e.event_kind,'status',e.status_after,
      'note',e.note,'createdAt',e.created_at) from public.site_technical_inspection_events e
      where e.inspection_id=i.id order by e.revision desc limit 1),
    'permissions',jsonb_build_object(
      'canStart',dao_private.site_technical_actor_role(i.project_id,i.award_item_id) in ('client','contractor') and i.status='requested',
      'canComplete',dao_private.site_technical_actor_role(i.project_id,i.award_item_id)='client' and i.status='in_progress',
      'canWithdraw',i.requested_by=auth.uid() and i.status in ('requested','in_progress'),
      'canComment',dao_private.site_technical_actor_role(i.project_id,i.award_item_id) in ('client','contractor'),
      'canManagerComment',dao_private.site_technical_actor_role(i.project_id,i.award_item_id)='manager'
    )
  ) order by i.created_at desc,i.id desc),'[]'::jsonb),
  exists(select 1 from page offset page_size)
  into v_items,v_more from shown i;
  return jsonb_build_object('projectId',p_project_id,'summary',v_summary,'items',v_items,'hasMore',v_more);
end;
$$;

create function dao_private.native_technical_reserves_v1(
  p_project_id uuid,p_award_item_id uuid,p_inspection_id uuid,
  p_before_created_at timestamptz,p_before_id uuid,p_limit integer
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare page_size integer:=least(greatest(coalesce(p_limit,30),1),50); v_items jsonb; v_summary jsonb; v_more boolean;
begin
  if auth.uid() is null or not dao_private.account_active(auth.uid()) then
    raise exception using errcode='42501',message='active authentication required';
  end if;
  if not dao_private.site_technical_project_readable(p_project_id) then
    raise exception using errcode='42501',message='technical quality access denied';
  end if;
  if (p_before_created_at is null)<>(p_before_id is null) then
    raise exception using errcode='22023',message='complete technical quality cursor required';
  end if;
  if p_award_item_id is not null and not dao_private.site_technical_can_read_award_item(p_award_item_id) then
    raise exception using errcode='42501',message='awarded lot access denied';
  end if;
  if p_inspection_id is not null and not exists(select 1 from public.site_technical_inspections i
    where i.id=p_inspection_id and i.project_id=p_project_id
      and (p_award_item_id is null or i.award_item_id=p_award_item_id)
      and dao_private.site_technical_can_read_award_item(i.award_item_id)) then
    raise exception using errcode='42501',message='inspection access denied';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'awardItemId',ai.id,'requestId',ai.request_id,
    'reserveCount',(select count(*) from public.site_technical_reserves r where r.award_item_id=ai.id),
    'openReserveCount',(select count(*) from public.site_technical_reserves r where r.award_item_id=ai.id and r.status not in ('resolved_confirmed','withdrawn')),
    'correctionsPendingReviewCount',(select count(*) from public.site_technical_reserves r where r.award_item_id=ai.id and r.status='correction_declared'),
    'rechecksRequestedCount',(select count(*) from public.site_technical_reserves r where r.award_item_id=ai.id and r.status='recheck_requested'),
    'lastTechnicalActivityAt',(select max(r.updated_at) from public.site_technical_reserves r where r.award_item_id=ai.id)
  ) order by ai.created_at,ai.id),'[]'::jsonb) into v_summary
  from public.award_items ai where ai.project_id=p_project_id
    and (p_award_item_id is null or ai.id=p_award_item_id)
    and dao_private.site_technical_can_read_award_item(ai.id);

  with page as (
    select r.* from public.site_technical_reserves r
    where r.project_id=p_project_id and (p_award_item_id is null or r.award_item_id=p_award_item_id)
      and (p_inspection_id is null or r.inspection_id=p_inspection_id)
      and dao_private.site_technical_can_read_award_item(r.award_item_id)
      and (p_before_created_at is null or (r.created_at,r.id)<(p_before_created_at,p_before_id))
    order by r.created_at desc,r.id desc limit page_size+1
  ), shown as (select * from page order by created_at desc,id desc limit page_size)
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',r.id,'projectId',r.project_id,'awardItemId',r.award_item_id,'requestId',r.request_id,
    'inspectionId',r.inspection_id,'createdBy',r.created_by,'title',r.title,'description',r.description,
    'category',r.category,'severity',r.severity,'location',r.location,'bidSubLotId',r.bid_sub_lot_id,
    'nativeActivityId',r.native_activity_id,'dueDate',r.due_date,'status',r.status,'revision',r.revision,
    'createdAt',r.created_at,'updatedAt',r.updated_at,
    'latestEvent',(select jsonb_build_object('id',e.id,'kind',e.event_kind,'status',e.status_after,
      'actorId',e.actor_id,'actorRole',e.actor_role,'note',e.note,'createdAt',e.created_at)
      from public.site_technical_reserve_events e where e.reserve_id=r.id order by e.revision desc limit 1),
    'permissions',jsonb_build_object(
      'canDeclareCorrection',dao_private.site_technical_actor_role(r.project_id,r.award_item_id)='contractor' and r.status in ('open','reopened','recheck_requested'),
      'canRequestRecheck',dao_private.site_technical_actor_role(r.project_id,r.award_item_id)='client' and r.status='correction_declared',
      'canConfirmResolved',dao_private.site_technical_actor_role(r.project_id,r.award_item_id)='client' and r.status='correction_declared',
      'canReopen',dao_private.site_technical_actor_role(r.project_id,r.award_item_id)='client' and r.status='resolved_confirmed',
      'canWithdraw',dao_private.site_technical_actor_role(r.project_id,r.award_item_id)='client' and r.created_by=auth.uid() and r.status='open',
      'canComment',dao_private.site_technical_actor_role(r.project_id,r.award_item_id) in ('client','contractor'),
      'canManagerComment',dao_private.site_technical_actor_role(r.project_id,r.award_item_id)='manager'
    )
  ) order by r.created_at desc,r.id desc),'[]'::jsonb),
  exists(select 1 from page offset page_size)
  into v_items,v_more from shown r;
  return jsonb_build_object('projectId',p_project_id,'summary',v_summary,'items',v_items,'hasMore',v_more);
end;
$$;

create function dao_private.native_technical_inspection_events_v1(
  p_inspection_id uuid,p_before_created_at timestamptz,p_before_id uuid,p_limit integer
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare parent public.site_technical_inspections; page_size integer:=least(greatest(coalesce(p_limit,30),1),50); v_items jsonb; v_more boolean;
begin
  if auth.uid() is null or not dao_private.account_active(auth.uid()) then raise exception using errcode='42501',message='active authentication required'; end if;
  select * into parent from public.site_technical_inspections where id=p_inspection_id;
  if parent.id is null or not dao_private.site_technical_can_read_award_item(parent.award_item_id) then
    raise exception using errcode='42501',message='inspection access denied';
  end if;
  if (p_before_created_at is null)<>(p_before_id is null) then raise exception using errcode='22023',message='complete technical quality cursor required'; end if;
  with page as (select e.* from public.site_technical_inspection_events e where e.inspection_id=p_inspection_id
    and (p_before_created_at is null or (e.created_at,e.id)<(p_before_created_at,p_before_id))
    order by e.created_at desc,e.id desc limit page_size+1),
  shown as (select * from page order by created_at desc,id desc limit page_size)
  select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'inspectionId',e.inspection_id,'actorId',e.actor_id,
    'actorRole',e.actor_role,'revision',e.revision,'kind',e.event_kind,'status',e.status_after,'note',e.note,
    'createdAt',e.created_at,'evidence',dao_private.site_technical_evidence_items(e.project_id,e.id,null))
    order by e.created_at desc,e.id desc),'[]'::jsonb),exists(select 1 from page offset page_size)
  into v_items,v_more from shown e;
  return jsonb_build_object('inspectionId',p_inspection_id,'status',parent.status,'revision',parent.revision,'items',v_items,'hasMore',v_more);
end;
$$;

create function dao_private.native_technical_reserve_events_v1(
  p_reserve_id uuid,p_before_created_at timestamptz,p_before_id uuid,p_limit integer
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare parent public.site_technical_reserves; page_size integer:=least(greatest(coalesce(p_limit,30),1),50); v_items jsonb; v_more boolean;
begin
  if auth.uid() is null or not dao_private.account_active(auth.uid()) then raise exception using errcode='42501',message='active authentication required'; end if;
  select * into parent from public.site_technical_reserves where id=p_reserve_id;
  if parent.id is null or not dao_private.site_technical_can_read_award_item(parent.award_item_id) then
    raise exception using errcode='42501',message='reserve access denied';
  end if;
  if (p_before_created_at is null)<>(p_before_id is null) then raise exception using errcode='22023',message='complete technical quality cursor required'; end if;
  with page as (select e.* from public.site_technical_reserve_events e where e.reserve_id=p_reserve_id
    and (p_before_created_at is null or (e.created_at,e.id)<(p_before_created_at,p_before_id))
    order by e.created_at desc,e.id desc limit page_size+1),
  shown as (select * from page order by created_at desc,id desc limit page_size)
  select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'reserveId',e.reserve_id,'actorId',e.actor_id,
    'actorRole',e.actor_role,'revision',e.revision,'kind',e.event_kind,'status',e.status_after,'note',e.note,
    'createdAt',e.created_at,'evidence',dao_private.site_technical_evidence_items(e.project_id,null,e.id))
    order by e.created_at desc,e.id desc),'[]'::jsonb),exists(select 1 from page offset page_size)
  into v_items,v_more from shown e;
  return jsonb_build_object('reserveId',p_reserve_id,'status',parent.status,'revision',parent.revision,'items',v_items,'hasMore',v_more);
end;
$$;

create function dao_private.request_native_technical_inspection_v1(
  p_award_item_id uuid,p_note text,p_document_ids uuid[],p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare item public.award_items; v public.site_technical_inspections; ev public.site_technical_inspection_events;
  payload jsonb; actor_role text;
begin
  if auth.uid() is null or not dao_private.account_active(auth.uid()) then raise exception using errcode='42501',message='active authentication required'; end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 100
    or (nullif(btrim(coalesce(p_note,'')),'') is not null and length(btrim(p_note)) not between 1 and 2000) then
    raise exception using errcode='22023',message='invalid inspection request';
  end if;
  payload:=jsonb_build_object('award_item_id',p_award_item_id,'note',nullif(btrim(coalesce(p_note,'')),''),
    'document_ids',to_jsonb(coalesce(p_document_ids,array[]::uuid[])));
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':technical-inspection:'||p_idempotency_key,0));
  select * into v from public.site_technical_inspections where requested_by=auth.uid() and idempotency_key=p_idempotency_key;
  if v.id is not null then
    if v.command_payload<>payload then raise exception using errcode='22023',message='idempotency key reused with different command'; end if;
    if not dao_private.site_technical_can_read_award_item(v.award_item_id) then raise exception using errcode='42501',message='inspection access denied'; end if;
    return jsonb_build_object('inspectionId',v.id,'awardItemId',v.award_item_id,'status',v.status,'revision',v.revision,'createdAt',v.created_at);
  end if;
  select ai.* into item from public.award_items ai where ai.id=p_award_item_id for update;
  actor_role:=dao_private.site_technical_actor_role(item.project_id,item.id);
  if item.id is null or not dao_private.site_can_read_award_item(item.id) or actor_role not in ('client','contractor') then
    raise exception using errcode='42501',message='active awarded lot participant required';
  end if;
  if (p_note is not null and length(btrim(p_note)) not between 1 and 2000) then raise exception using errcode='22023',message='invalid inspection note'; end if;
  insert into public.site_technical_inspections(project_id,award_item_id,request_id,requested_by,request_note,status,revision,idempotency_key,command_payload)
  values(item.project_id,item.id,item.request_id,auth.uid(),nullif(btrim(coalesce(p_note,'')),''),'requested',1,p_idempotency_key,payload)
  returning * into v;
  insert into public.site_technical_inspection_events(inspection_id,project_id,award_item_id,actor_id,actor_role,revision,event_kind,status_after,note,idempotency_key,command_payload)
  values(v.id,v.project_id,v.award_item_id,auth.uid(),actor_role,1,'requested','requested',v.request_note,p_idempotency_key,payload)
  returning * into ev;
  perform dao_private.site_technical_attach_evidence(v.project_id,v.award_item_id,ev.id,null,p_document_ids);
  insert into public.audit_events(actor_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),'site_technical_inspection_requested','project',v.project_id,jsonb_build_object('inspection_id',v.id,'award_item_id',v.award_item_id));
  return jsonb_build_object('inspectionId',v.id,'awardItemId',v.award_item_id,'status',v.status,'revision',v.revision,'createdAt',v.created_at);
end;
$$;

create function dao_private.record_native_technical_inspection_event_v1(
  p_inspection_id uuid,p_action text,p_note text,p_document_ids uuid[],p_expected_revision integer,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare parent public.site_technical_inspections; existing public.site_technical_inspection_events;
  actor_role text; next_status text; event_kind text; payload jsonb; ev public.site_technical_inspection_events;
begin
  if auth.uid() is null or not dao_private.account_active(auth.uid()) then raise exception using errcode='42501',message='active authentication required'; end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 100 or p_expected_revision is null or p_expected_revision<1 then
    raise exception using errcode='22023',message='valid revision and idempotency key required';
  end if;
  payload:=jsonb_build_object('inspection_id',p_inspection_id,'action',p_action,'note',nullif(btrim(coalesce(p_note,'')),''),
    'document_ids',to_jsonb(coalesce(p_document_ids,array[]::uuid[])),'expected_revision',p_expected_revision);
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':technical-inspection-event:'||p_idempotency_key,0));
  select * into existing from public.site_technical_inspection_events where actor_id=auth.uid() and idempotency_key=p_idempotency_key;
  if existing.id is not null then
    if existing.command_payload<>payload then raise exception using errcode='22023',message='idempotency key reused with different command'; end if;
    if not dao_private.site_technical_can_read_award_item(existing.award_item_id)
      or dao_private.site_technical_actor_role(existing.project_id,existing.award_item_id) is distinct from existing.actor_role then
      raise exception using errcode='42501',message='inspection access denied';
    end if;
    return jsonb_build_object('inspectionId',existing.inspection_id,'eventId',existing.id,'status',existing.status_after,'revision',existing.revision,'createdAt',existing.created_at);
  end if;
  select * into parent from public.site_technical_inspections where id=p_inspection_id for update;
  if parent.id is null then raise exception using errcode='42501',message='inspection access denied'; end if;
  actor_role:=dao_private.site_technical_actor_role(parent.project_id,parent.award_item_id);
  if actor_role is null then raise exception using errcode='42501',message='inspection access denied'; end if;
  if not dao_private.site_technical_can_read_award_item(parent.award_item_id)
    or (actor_role<>'manager' and not dao_private.site_can_read_award_item(parent.award_item_id)) then
    raise exception using errcode='42501',message='active award participant required';
  end if;
  if p_expected_revision<>parent.revision then raise exception using errcode='40001',message='inspection revision changed'; end if;
  if (nullif(btrim(coalesce(p_note,'')),'') is not null and length(btrim(p_note)) not between 1 and 2000) then raise exception using errcode='22023',message='invalid inspection note'; end if;
  if p_action not in ('start','complete','withdraw','comment','manager_comment')
    or (p_action in ('comment','manager_comment') and length(btrim(coalesce(p_note,''))) not between 1 and 2000) then
    raise exception using errcode='22023',message='invalid inspection action or note';
  end if;
  next_status:=parent.status;
  if p_action='start' and actor_role in ('client','contractor') and parent.status='requested' then
    event_kind:='started'; next_status:='in_progress';
  elsif p_action='complete' and actor_role='client' and parent.status='in_progress'
    and not exists(select 1 from public.site_technical_reserves r where r.inspection_id=parent.id and r.status not in ('resolved_confirmed','withdrawn')) then
    event_kind:='technical_check_complete'; next_status:='technical_check_complete';
  elsif p_action='withdraw' and parent.requested_by=auth.uid() and actor_role in ('client','contractor')
    and parent.status in ('requested','in_progress')
    and not exists(select 1 from public.site_technical_reserves r where r.inspection_id=parent.id and r.status not in ('resolved_confirmed','withdrawn')) then
    event_kind:='withdrawn'; next_status:='withdrawn';
  elsif p_action='comment' and actor_role in ('client','contractor') then
    event_kind:='comment';
  elsif p_action='manager_comment' and actor_role='manager' then
    event_kind:='manager_comment';
  else
    raise exception using errcode='42501',message='inspection action is not allowed';
  end if;
  update public.site_technical_inspections set status=next_status,revision=revision+1,updated_at=now() where id=parent.id returning * into parent;
  insert into public.site_technical_inspection_events(inspection_id,project_id,award_item_id,actor_id,actor_role,revision,event_kind,status_after,note,idempotency_key,command_payload)
  values(parent.id,parent.project_id,parent.award_item_id,auth.uid(),actor_role,parent.revision,event_kind,next_status,
    nullif(btrim(coalesce(p_note,'')),''),p_idempotency_key,payload) returning * into ev;
  perform dao_private.site_technical_attach_evidence(parent.project_id,parent.award_item_id,ev.id,null,p_document_ids);
  insert into public.audit_events(actor_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),'site_technical_inspection_event_recorded','project',parent.project_id,
    jsonb_build_object('inspection_id',parent.id,'award_item_id',parent.award_item_id,'event_kind',event_kind,'revision',parent.revision));
  return jsonb_build_object('inspectionId',parent.id,'eventId',ev.id,'status',next_status,'revision',parent.revision,'createdAt',ev.created_at);
end;
$$;

create function dao_private.create_native_technical_reserve_v1(
  p_award_item_id uuid,p_inspection_id uuid,p_title text,p_description text,p_category text,p_severity text,
  p_location text,p_bid_sub_lot_id uuid,p_native_activity_id uuid,p_due_date date,p_document_ids uuid[],p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare item public.award_items; inspection public.site_technical_inspections; v public.site_technical_reserves;
  ev public.site_technical_reserve_events; payload jsonb; actor_role text;
begin
  if auth.uid() is null or not dao_private.account_active(auth.uid()) then raise exception using errcode='42501',message='active authentication required'; end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 100 then raise exception using errcode='22023',message='valid idempotency key required'; end if;
  payload:=jsonb_build_object('award_item_id',p_award_item_id,'inspection_id',p_inspection_id,'title',btrim(coalesce(p_title,'')),
    'description',btrim(coalesce(p_description,'')),'category',p_category,'severity',p_severity,
    'location',nullif(btrim(coalesce(p_location,'')),''),'bid_sub_lot_id',p_bid_sub_lot_id,
    'native_activity_id',p_native_activity_id,'due_date',p_due_date,'document_ids',to_jsonb(coalesce(p_document_ids,array[]::uuid[])));
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':technical-reserve:'||p_idempotency_key,0));
  select * into v from public.site_technical_reserves where created_by=auth.uid() and idempotency_key=p_idempotency_key;
  if v.id is not null then
    if v.command_payload<>payload then raise exception using errcode='22023',message='idempotency key reused with different command'; end if;
    if not dao_private.site_technical_can_read_award_item(v.award_item_id) then raise exception using errcode='42501',message='reserve access denied'; end if;
    return jsonb_build_object('reserveId',v.id,'awardItemId',v.award_item_id,'status',v.status,'revision',v.revision,'createdAt',v.created_at);
  end if;
  select * into item from public.award_items ai where ai.id=p_award_item_id for update;
  actor_role:=dao_private.site_technical_actor_role(item.project_id,item.id);
  if item.id is null or not dao_private.site_can_read_award_item(item.id) or actor_role<>'client' then raise exception using errcode='42501',message='active project client required'; end if;
  if length(btrim(coalesce(p_title,''))) not between 1 and 180 or length(btrim(coalesce(p_description,''))) not between 3 and 4000
    or p_category not in ('workmanship','materials','completeness','safety','other')
    or p_severity not in ('minor','moderate','major')
    or (nullif(btrim(coalesce(p_location,'')),'') is not null and length(btrim(p_location))>500)
    or (p_bid_sub_lot_id is not null and p_native_activity_id is not null) then
    raise exception using errcode='22023',message='invalid technical reserve';
  end if;
  if p_inspection_id is not null then
    select * into inspection from public.site_technical_inspections where id=p_inspection_id and award_item_id=item.id for update;
    if inspection.id is null or inspection.status not in ('requested','in_progress') then raise exception using errcode='23514',message='active inspection required'; end if;
  end if;
  if p_bid_sub_lot_id is not null and not exists(select 1 from public.bid_sub_lots s join public.bid_items bi on bi.id=s.bid_item_id
    where s.id=p_bid_sub_lot_id and bi.id=item.bid_item_id and bi.request_id=item.request_id) then
    raise exception using errcode='22023',message='sub-lot does not belong to awarded lot';
  end if;
  if p_native_activity_id is not null and not exists(select 1 from public.native_execution_activities a
    where a.id=p_native_activity_id and a.award_item_id=item.id and a.active) then
    raise exception using errcode='22023',message='activity does not belong to awarded lot';
  end if;
  insert into public.site_technical_reserves(project_id,award_item_id,request_id,inspection_id,created_by,responsible_contractor_id,
    title,description,category,severity,location,bid_sub_lot_id,native_activity_id,due_date,status,revision,idempotency_key,command_payload)
  values(item.project_id,item.id,item.request_id,p_inspection_id,auth.uid(),item.contractor_id,btrim(p_title),btrim(p_description),
    p_category,p_severity,nullif(btrim(coalesce(p_location,'')),''),p_bid_sub_lot_id,p_native_activity_id,p_due_date,'open',1,p_idempotency_key,payload)
  returning * into v;
  insert into public.site_technical_reserve_events(reserve_id,project_id,award_item_id,actor_id,actor_role,revision,event_kind,status_after,note,idempotency_key,command_payload)
  values(v.id,v.project_id,v.award_item_id,auth.uid(),'client',1,'created','open',null,p_idempotency_key,payload) returning * into ev;
  perform dao_private.site_technical_attach_evidence(v.project_id,v.award_item_id,null,ev.id,p_document_ids);
  insert into public.audit_events(actor_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),'site_technical_reserve_created','project',v.project_id,jsonb_build_object('reserve_id',v.id,'award_item_id',v.award_item_id));
  return jsonb_build_object('reserveId',v.id,'awardItemId',v.award_item_id,'status',v.status,'revision',v.revision,'createdAt',v.created_at);
end;
$$;

create function dao_private.record_native_technical_reserve_event_v1(
  p_reserve_id uuid,p_action text,p_note text,p_document_ids uuid[],p_expected_revision integer,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare parent public.site_technical_reserves; existing public.site_technical_reserve_events;
  actor_role text; next_status text; event_kind text; payload jsonb; ev public.site_technical_reserve_events;
begin
  if auth.uid() is null or not dao_private.account_active(auth.uid()) then raise exception using errcode='42501',message='active authentication required'; end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 100 or p_expected_revision is null or p_expected_revision<1 then
    raise exception using errcode='22023',message='valid revision and idempotency key required';
  end if;
  payload:=jsonb_build_object('reserve_id',p_reserve_id,'action',p_action,'note',nullif(btrim(coalesce(p_note,'')),''),
    'document_ids',to_jsonb(coalesce(p_document_ids,array[]::uuid[])),'expected_revision',p_expected_revision);
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':technical-reserve-event:'||p_idempotency_key,0));
  select * into existing from public.site_technical_reserve_events where actor_id=auth.uid() and idempotency_key=p_idempotency_key;
  if existing.id is not null then
    if existing.command_payload<>payload then raise exception using errcode='22023',message='idempotency key reused with different command'; end if;
    if not dao_private.site_technical_can_read_award_item(existing.award_item_id)
      or dao_private.site_technical_actor_role(existing.project_id,existing.award_item_id) is distinct from existing.actor_role then
      raise exception using errcode='42501',message='reserve access denied';
    end if;
    return jsonb_build_object('reserveId',existing.reserve_id,'eventId',existing.id,'status',existing.status_after,'revision',existing.revision,'createdAt',existing.created_at);
  end if;
  select * into parent from public.site_technical_reserves where id=p_reserve_id for update;
  if parent.id is null then raise exception using errcode='42501',message='reserve access denied'; end if;
  actor_role:=dao_private.site_technical_actor_role(parent.project_id,parent.award_item_id);
  if actor_role is null then raise exception using errcode='42501',message='reserve access denied'; end if;
  if not dao_private.site_technical_can_read_award_item(parent.award_item_id) then raise exception using errcode='42501',message='reserve access denied'; end if;
  if p_expected_revision<>parent.revision then raise exception using errcode='40001',message='reserve revision changed'; end if;
  if nullif(btrim(coalesce(p_note,'')),'') is not null and length(btrim(p_note)) not between 1 and 2000 then raise exception using errcode='22023',message='invalid reserve note'; end if;
  if p_action not in ('declare_correction','request_recheck','confirm_resolved','reopen','withdraw','comment','manager_comment')
    or (p_action in ('declare_correction','request_recheck','reopen') and length(btrim(coalesce(p_note,''))) not between 3 and 2000)
    or (p_action in ('comment','manager_comment') and length(btrim(coalesce(p_note,''))) not between 1 and 2000) then
    raise exception using errcode='22023',message='invalid reserve action or note';
  end if;
  next_status:=parent.status;
  if p_action='comment' and actor_role in ('client','contractor') then
    event_kind:='comment';
  elsif p_action='manager_comment' and actor_role='manager' then
    event_kind:='manager_comment';
  elsif p_action='declare_correction' and actor_role='contractor' and parent.status in ('open','reopened','recheck_requested')
    and dao_private.site_technical_actor_role(parent.project_id,parent.award_item_id)='contractor' then
    event_kind:='correction_declared'; next_status:='correction_declared';
  elsif p_action='request_recheck' and actor_role='client' and parent.status='correction_declared' then
    event_kind:='recheck_requested'; next_status:='recheck_requested';
  elsif p_action='confirm_resolved' and actor_role='client' and parent.status='correction_declared' then
    event_kind:='resolved_confirmed'; next_status:='resolved_confirmed';
  elsif p_action='reopen' and actor_role='client' and parent.status='resolved_confirmed' then
    event_kind:='reopened'; next_status:='reopened';
  elsif p_action='withdraw' and actor_role='client' and parent.created_by=auth.uid() and parent.status='open' then
    event_kind:='withdrawn'; next_status:='withdrawn';
  else
    raise exception using errcode='42501',message='reserve action is not allowed';
  end if;
  if actor_role<>'manager' and not dao_private.site_contractor_award_item(parent.award_item_id)
    and not dao_private.site_client_project(parent.project_id) then
    raise exception using errcode='42501',message='active award participant required';
  end if;
  update public.site_technical_reserves set status=next_status,revision=revision+1,updated_at=now() where id=parent.id returning * into parent;
  insert into public.site_technical_reserve_events(reserve_id,project_id,award_item_id,actor_id,actor_role,revision,event_kind,status_after,note,idempotency_key,command_payload)
  values(parent.id,parent.project_id,parent.award_item_id,auth.uid(),actor_role,parent.revision,event_kind,next_status,
    nullif(btrim(coalesce(p_note,'')),''),p_idempotency_key,payload) returning * into ev;
  perform dao_private.site_technical_attach_evidence(parent.project_id,parent.award_item_id,null,ev.id,p_document_ids);
  insert into public.audit_events(actor_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),'site_technical_reserve_event_recorded','project',parent.project_id,
    jsonb_build_object('reserve_id',parent.id,'award_item_id',parent.award_item_id,'event_kind',event_kind,'revision',parent.revision));
  return jsonb_build_object('reserveId',parent.id,'eventId',ev.id,'status',next_status,'revision',parent.revision,'createdAt',ev.created_at);
end;
$$;

create function public.native_technical_inspections_v1(p_project_id uuid,p_award_item_id uuid,p_before_created_at timestamptz,p_before_id uuid,p_limit integer)
returns jsonb language sql security invoker set search_path='' as $$ select dao_private.native_technical_inspections_v1($1,$2,$3,$4,$5); $$;
create function public.native_technical_reserves_v1(p_project_id uuid,p_award_item_id uuid,p_inspection_id uuid,p_before_created_at timestamptz,p_before_id uuid,p_limit integer)
returns jsonb language sql security invoker set search_path='' as $$ select dao_private.native_technical_reserves_v1($1,$2,$3,$4,$5,$6); $$;
create function public.native_technical_inspection_events_v1(p_inspection_id uuid,p_before_created_at timestamptz,p_before_id uuid,p_limit integer)
returns jsonb language sql security invoker set search_path='' as $$ select dao_private.native_technical_inspection_events_v1($1,$2,$3,$4); $$;
create function public.native_technical_reserve_events_v1(p_reserve_id uuid,p_before_created_at timestamptz,p_before_id uuid,p_limit integer)
returns jsonb language sql security invoker set search_path='' as $$ select dao_private.native_technical_reserve_events_v1($1,$2,$3,$4); $$;
create function public.request_native_technical_inspection_v1(p_award_item_id uuid,p_note text,p_document_ids uuid[],p_idempotency_key text)
returns jsonb language sql security invoker set search_path='' as $$ select dao_private.request_native_technical_inspection_v1($1,$2,$3,$4); $$;
create function public.record_native_technical_inspection_event_v1(p_inspection_id uuid,p_action text,p_note text,p_document_ids uuid[],p_expected_revision integer,p_idempotency_key text)
returns jsonb language sql security invoker set search_path='' as $$ select dao_private.record_native_technical_inspection_event_v1($1,$2,$3,$4,$5,$6); $$;
create function public.create_native_technical_reserve_v1(p_award_item_id uuid,p_inspection_id uuid,p_title text,p_description text,p_category text,p_severity text,p_location text,p_bid_sub_lot_id uuid,p_native_activity_id uuid,p_due_date date,p_document_ids uuid[],p_idempotency_key text)
returns jsonb language sql security invoker set search_path='' as $$ select dao_private.create_native_technical_reserve_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12); $$;
create function public.record_native_technical_reserve_event_v1(p_reserve_id uuid,p_action text,p_note text,p_document_ids uuid[],p_expected_revision integer,p_idempotency_key text)
returns jsonb language sql security invoker set search_path='' as $$ select dao_private.record_native_technical_reserve_event_v1($1,$2,$3,$4,$5,$6); $$;

revoke all on function dao_private.site_technical_attach_evidence(uuid,uuid,uuid,uuid,uuid[]),
  dao_private.site_technical_evidence_items(uuid,uuid,uuid),
  dao_private.native_technical_inspections_v1(uuid,uuid,timestamptz,uuid,integer),
  dao_private.native_technical_reserves_v1(uuid,uuid,uuid,timestamptz,uuid,integer),
  dao_private.native_technical_inspection_events_v1(uuid,timestamptz,uuid,integer),
  dao_private.native_technical_reserve_events_v1(uuid,timestamptz,uuid,integer),
  dao_private.request_native_technical_inspection_v1(uuid,text,uuid[],text),
  dao_private.record_native_technical_inspection_event_v1(uuid,text,text,uuid[],integer,text),
  dao_private.create_native_technical_reserve_v1(uuid,uuid,text,text,text,text,text,uuid,uuid,date,uuid[],text),
  dao_private.record_native_technical_reserve_event_v1(uuid,text,text,uuid[],integer,text),
  public.native_technical_inspections_v1(uuid,uuid,timestamptz,uuid,integer),
  public.native_technical_reserves_v1(uuid,uuid,uuid,timestamptz,uuid,integer),
  public.native_technical_inspection_events_v1(uuid,timestamptz,uuid,integer),
  public.native_technical_reserve_events_v1(uuid,timestamptz,uuid,integer),
  public.request_native_technical_inspection_v1(uuid,text,uuid[],text),
  public.record_native_technical_inspection_event_v1(uuid,text,text,uuid[],integer,text),
  public.create_native_technical_reserve_v1(uuid,uuid,text,text,text,text,text,uuid,uuid,date,uuid[],text),
  public.record_native_technical_reserve_event_v1(uuid,text,text,uuid[],integer,text)
  from public,anon,authenticated;
grant execute on function dao_private.site_technical_attach_evidence(uuid,uuid,uuid,uuid,uuid[]),
  dao_private.site_technical_evidence_items(uuid,uuid,uuid),
  dao_private.native_technical_inspections_v1(uuid,uuid,timestamptz,uuid,integer),
  dao_private.native_technical_reserves_v1(uuid,uuid,uuid,timestamptz,uuid,integer),
  dao_private.native_technical_inspection_events_v1(uuid,timestamptz,uuid,integer),
  dao_private.native_technical_reserve_events_v1(uuid,timestamptz,uuid,integer),
  dao_private.request_native_technical_inspection_v1(uuid,text,uuid[],text),
  dao_private.record_native_technical_inspection_event_v1(uuid,text,text,uuid[],integer,text),
  dao_private.create_native_technical_reserve_v1(uuid,uuid,text,text,text,text,text,uuid,uuid,date,uuid[],text),
  dao_private.record_native_technical_reserve_event_v1(uuid,text,text,uuid[],integer,text)
  to authenticated,service_role;
grant execute on function public.native_technical_inspections_v1(uuid,uuid,timestamptz,uuid,integer),
  public.native_technical_reserves_v1(uuid,uuid,uuid,timestamptz,uuid,integer),
  public.native_technical_inspection_events_v1(uuid,timestamptz,uuid,integer),
  public.native_technical_reserve_events_v1(uuid,timestamptz,uuid,integer),
  public.request_native_technical_inspection_v1(uuid,text,uuid[],text),
  public.record_native_technical_inspection_event_v1(uuid,text,text,uuid[],integer,text),
  public.create_native_technical_reserve_v1(uuid,uuid,text,text,text,text,text,uuid,uuid,date,uuid[],text),
  public.record_native_technical_reserve_event_v1(uuid,text,text,uuid[],integer,text)
  to authenticated;

notify pgrst,'reload schema';
commit;
