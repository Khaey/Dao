begin;

-- P15 / Mission 5 (#456): project document dossier V2.
-- Additive layer over the existing private `documents` rows: families of
-- versioned revisions, optional lot attachments, an append-only history of
-- technical reviews and an explicit file control by the assigned Gestionnaire.
-- A technical review is NEVER a legal visa, a reception, a contract signature
-- or a payment trigger. Existing documents are neither requalified nor shared:
-- classifying one is an explicit action of its owner.

create table public.document_families (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  project_id uuid not null references public.projects,
  created_by uuid not null references auth.users,
  title text not null check(length(btrim(title)) between 1 and 160),
  category text check(category in ('plan','technical','photo','certificate','other')),
  visibility text not null default 'private' check(visibility in ('private','project','lots')),
  version integer not null default 1 check(version>0),
  unique(id,project_id)
);
create index document_families_project_idx on public.document_families(project_id,updated_at desc,id);

create table public.document_revisions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  family_id uuid not null,
  project_id uuid not null,
  document_id uuid not null unique references public.documents,
  revision_no integer not null check(revision_no>0),
  note text check(note is null or length(btrim(note)) between 1 and 1000),
  created_by uuid not null references auth.users,
  unique(family_id,revision_no),
  unique(id,family_id),
  foreign key(family_id,project_id) references public.document_families(id,project_id)
);
create index document_revisions_family_idx on public.document_revisions(family_id,revision_no desc);

create table public.document_family_lots (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  family_id uuid not null,
  project_id uuid not null,
  request_id uuid not null references public.project_requests,
  created_by uuid not null references auth.users,
  revoked_at timestamptz,
  revoked_by uuid references auth.users,
  foreign key(family_id,project_id) references public.document_families(id,project_id),
  check((revoked_at is null)=(revoked_by is null))
);
create unique index document_family_lots_active_idx on public.document_family_lots(family_id,request_id) where revoked_at is null;
create index document_family_lots_request_idx on public.document_family_lots(request_id) where revoked_at is null;

create table public.document_dossier_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  family_id uuid,
  revision_id uuid,
  project_id uuid not null references public.projects,
  document_id uuid references public.documents,
  actor_id uuid not null references auth.users,
  actor_role text not null check(actor_role in ('author','client','manager','participant')),
  event_kind text not null check(event_kind in (
    'family_created','revision_added','metadata_updated','file_approved','file_rejected',
    'start_review','observations','correction_requested','reviewed','comment')),
  note text check(note is null or length(btrim(note)) between 1 and 2000),
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text not null check(length(idempotency_key) between 8 and 100),
  unique(actor_id,idempotency_key),
  foreign key(family_id,project_id) references public.document_families(id,project_id),
  foreign key(revision_id,family_id) references public.document_revisions(id,family_id)
);
create index document_dossier_events_family_idx on public.document_dossier_events(family_id,created_at desc,id desc);
create index document_dossier_events_revision_idx on public.document_dossier_events(revision_id,created_at desc,id desc);

-- A lot holder is the Artisan of an ACTIVE award item on that lot (marketplace
-- awards do not create team membership), or the accepted team member the
-- Client assigned to that lot. Revocation/cancellation removes access at once.
create function dao_private.document_lot_holder(p_request_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and dao_private.account_active(auth.uid()) and (
    exists(select 1 from public.award_items ai where ai.request_id=p_request_id and ai.active
      and dao_private.site_contractor_award_item(ai.id))
    or exists(select 1 from public.project_requests r
      join public.project_members m on m.id=r.contractor_member_id and m.project_id=r.project_id
      where r.id=p_request_id and r.status<>'withdrawn' and m.user_id=auth.uid()
        and m.participation_role='contractor' and m.status='accepted'));
$$;

create function dao_private.document_family_readable(p_family_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and dao_private.account_active(auth.uid()) and exists(
    select 1 from public.document_families f where f.id=p_family_id and (
      f.created_by=auth.uid()
      or dao_private.manages_project(f.project_id)
      or (f.visibility in ('project','lots') and dao_private.owner(f.project_id))
      or (f.visibility='project' and dao_private.project_member(f.project_id))
      or (f.visibility='lots' and exists(select 1 from public.document_family_lots l
        where l.family_id=f.id and l.revoked_at is null and dao_private.document_lot_holder(l.request_id)))));
$$;

-- The file itself is readable through a family only once it passed the file
-- control; its owner and staff keep the pre-existing access.
create function dao_private.document_readable_in_family(p_document_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.document_revisions r join public.documents d on d.id=r.document_id
    where r.document_id=p_document_id and d.status='approved' and dao_private.document_family_readable(r.family_id));
$$;

alter policy read_allowed on public.documents to authenticated using (
  dao_private.staff() or owner_id=auth.uid() or (status='approved' and (
    (share_scope='project_members' and dao_private.project_member(project_id))
    or (share_scope='owner_only' and exists(select 1 from public.document_grants g
      where g.document_id=documents.id and g.user_id=auth.uid() and g.revoked_at is null))
    or dao_private.document_readable_in_family(id))));

alter table public.document_families enable row level security;
alter table public.document_revisions enable row level security;
alter table public.document_family_lots enable row level security;
alter table public.document_dossier_events enable row level security;
revoke all on public.document_families,public.document_revisions,public.document_family_lots,public.document_dossier_events
  from public,anon,authenticated;
grant select on public.document_families,public.document_revisions,public.document_family_lots to authenticated;
grant select(id,created_at,family_id,revision_id,project_id,document_id,actor_id,actor_role,event_kind,note,payload)
  on public.document_dossier_events to authenticated;
grant all on public.document_families,public.document_revisions,public.document_family_lots,public.document_dossier_events to service_role;
create policy read_document_families on public.document_families for select to authenticated
  using (dao_private.document_family_readable(id));
create policy read_document_revisions on public.document_revisions for select to authenticated
  using (dao_private.document_family_readable(family_id));
create policy read_document_family_lots on public.document_family_lots for select to authenticated
  using (dao_private.document_family_readable(family_id));
create policy read_document_dossier_events on public.document_dossier_events for select to authenticated
  using (family_id is not null and dao_private.document_family_readable(family_id));
create policy active_account on public.document_families as restrictive for all to authenticated
  using (dao_private.account_active(auth.uid())) with check (dao_private.account_active(auth.uid()));
create policy active_account on public.document_revisions as restrictive for all to authenticated
  using (dao_private.account_active(auth.uid())) with check (dao_private.account_active(auth.uid()));
create policy active_account on public.document_family_lots as restrictive for all to authenticated
  using (dao_private.account_active(auth.uid())) with check (dao_private.account_active(auth.uid()));
create policy active_account on public.document_dossier_events as restrictive for all to authenticated
  using (dao_private.account_active(auth.uid())) with check (dao_private.account_active(auth.uid()));
create trigger staff_scope before insert or update or delete on public.document_families
  for each row execute function dao_private.staff_scope_guard();
create trigger staff_scope before insert or update or delete on public.document_revisions
  for each row execute function dao_private.staff_scope_guard();
create trigger staff_scope before insert or update or delete on public.document_family_lots
  for each row execute function dao_private.staff_scope_guard();
create trigger staff_scope before insert or update or delete on public.document_dossier_events
  for each row execute function dao_private.staff_scope_guard();

create function dao_private.document_dossier_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception using errcode='23514',message='document dossier history is append-only'; end;
$$;
create trigger immutable_document_revisions before update or delete on public.document_revisions
  for each row execute function dao_private.document_dossier_immutable();
create trigger immutable_document_dossier_events before update or delete on public.document_dossier_events
  for each row execute function dao_private.document_dossier_immutable();
create trigger no_delete_document_families before delete on public.document_families
  for each row execute function dao_private.document_dossier_immutable();
create trigger no_delete_document_family_lots before delete on public.document_family_lots
  for each row execute function dao_private.document_dossier_immutable();
create function dao_private.document_family_lot_guard() returns trigger language plpgsql set search_path='' as $$
begin
  if OLD.revoked_at is not null or NEW.revoked_at is null or NEW.id<>OLD.id or NEW.family_id<>OLD.family_id
    or NEW.project_id<>OLD.project_id or NEW.request_id<>OLD.request_id or NEW.created_by<>OLD.created_by
    or NEW.created_at<>OLD.created_at then
    raise exception using errcode='23514',message='document lot attachments can only be revoked once';
  end if;
  return NEW;
end;
$$;
create trigger guard_document_family_lots before update on public.document_family_lots
  for each row execute function dao_private.document_family_lot_guard();
create function dao_private.document_family_guard() returns trigger language plpgsql set search_path='' as $$
begin
  if NEW.id<>OLD.id or NEW.project_id<>OLD.project_id or NEW.created_by<>OLD.created_by or NEW.created_at<>OLD.created_at then
    raise exception using errcode='23514',message='document family identity is immutable';
  end if;
  return NEW;
end;
$$;
create trigger guard_document_families before update on public.document_families
  for each row execute function dao_private.document_family_guard();

-- Versioned files are history: they cannot be deleted or re-shared outside
-- their family. Everything else keeps its existing behaviour.
create or replace function dao_private.delete_project_document(p_document_id uuid)
returns public.documents language plpgsql security definer set search_path=''
as $$
declare v public.documents;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication required'; end if;
  if exists(select 1 from public.document_revisions where document_id=p_document_id) then
    raise exception using errcode='23514',message='versioned document history is immutable';
  end if;
  delete from public.documents where id=p_document_id and (owner_id=auth.uid() or dao_private.staff()) returning * into v;
  if v.id is null then raise exception using errcode='42501',message='document access denied'; end if;
  return v;
end;
$$;

create or replace function dao_private.set_project_document_sharing(p_document_id uuid,p_share_scope text) returns public.documents
language plpgsql security definer set search_path='' as $$
declare v public.documents;
begin
  select * into v from public.documents where id=p_document_id for update;
  if auth.uid() is null or v.id is null or not (
    dao_private.staff() or (v.owner_id=auth.uid() and dao_private.project_member(v.project_id))) then
    raise exception using errcode='42501',message='document owner participation required';
  end if;
  if p_share_scope is null or p_share_scope not in ('owner_only','project_members') then
    raise exception using errcode='22023',message='invalid document sharing scope';
  end if;
  if exists(select 1 from public.document_revisions where document_id=v.id) then
    raise exception using errcode='23514',message='versioned document sharing follows its family';
  end if;
  update public.documents set share_scope=p_share_scope where id=v.id returning * into v;
  return v;
end;
$$;

create function dao_private.document_lot_title(p_request_id uuid)
returns text language sql stable security definer set search_path='' as $$
  select v.title from public.project_request_versions v where v.request_id=p_request_id
  order by v.version_no desc limit 1;
$$;

create function dao_private.document_replace_lots(p_family public.document_families,p_request_ids uuid[])
returns void language plpgsql security definer set search_path='' as $$
declare ids uuid[] := coalesce(p_request_ids,'{}'::uuid[]);
begin
  if cardinality(ids)>50 or cardinality(ids)<>(select count(distinct x) from unnest(ids) x) then
    raise exception using errcode='22023',message='invalid lot list';
  end if;
  if exists(select 1 from unnest(ids) x where not exists(select 1 from public.project_requests r
    where r.id=x and r.project_id=p_family.project_id and r.status<>'withdrawn')) then
    raise exception using errcode='23514',message='lot is not part of this project';
  end if;
  update public.document_family_lots set revoked_at=now(),revoked_by=auth.uid()
    where family_id=p_family.id and revoked_at is null and request_id<>all(ids);
  insert into public.document_family_lots(family_id,project_id,request_id,created_by)
    select p_family.id,p_family.project_id,x,auth.uid() from unnest(ids) x
    where not exists(select 1 from public.document_family_lots l where l.family_id=p_family.id
      and l.request_id=x and l.revoked_at is null);
end;
$$;

create function dao_private.document_dossier_command_v1(
  p_action text,p_project_id uuid,p_family_id uuid,p_document_id uuid,p_revision_id uuid,
  p_title text,p_category text,p_visibility text,p_request_ids uuid[],p_note text,
  p_expected_version integer,p_expected_revision_id uuid,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  me uuid := auth.uid();
  f public.document_families;
  d public.documents;
  r public.document_revisions;
  cur public.document_revisions;
  e public.document_dossier_events;
  role text;
  note text := nullif(btrim(coalesce(p_note,'')),'');
begin
  if me is null or not dao_private.account_active(me) then
    raise exception using errcode='42501',message='authentication required';
  end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 100 then
    raise exception using errcode='22023',message='idempotency key required';
  end if;
  select * into e from public.document_dossier_events where actor_id=me and idempotency_key=p_idempotency_key;
  if e.id is not null then
    return jsonb_build_object('familyId',e.family_id,'revisionId',e.revision_id,'eventId',e.id,'replayed',true);
  end if;
  if p_category is not null and p_category not in ('plan','technical','photo','certificate','other') then
    raise exception using errcode='22023',message='invalid document category';
  end if;
  if p_visibility is not null and p_visibility not in ('private','project','lots') then
    raise exception using errcode='22023',message='invalid document visibility';
  end if;

  if p_action='create_family' then
    select * into d from public.documents where id=p_document_id for update;
    if d.id is null or d.owner_id<>me or d.project_id is distinct from p_project_id
      or not dao_private.project_member(d.project_id) then
      raise exception using errcode='42501',message='document owner participation required';
    end if;
    if d.status='rejected' or exists(select 1 from public.projects where id=d.project_id and status='archived') then
      raise exception using errcode='23514',message='document is unavailable';
    end if;
    if exists(select 1 from public.document_revisions where document_id=d.id) then
      raise exception using errcode='23505',message='document is already versioned';
    end if;
    if nullif(btrim(coalesce(p_title,'')),'') is null then raise exception using errcode='22023',message='title required'; end if;
    -- A file already shared with every member cannot be silently narrowed.
    if d.share_scope='project_members' and coalesce(p_visibility,'private')<>'project' then
      raise exception using errcode='23514',message='document is already shared with project members';
    end if;
    insert into public.document_families(project_id,created_by,title,category,visibility)
      values(d.project_id,me,btrim(p_title),p_category,coalesce(p_visibility,'private')) returning * into f;
    perform dao_private.document_replace_lots(f,p_request_ids);
    insert into public.document_revisions(family_id,project_id,document_id,revision_no,note,created_by)
      values(f.id,f.project_id,d.id,1,note,me) returning * into r;
    insert into public.document_dossier_events(family_id,revision_id,project_id,document_id,actor_id,actor_role,event_kind,note,payload,idempotency_key)
      values(f.id,r.id,f.project_id,d.id,me,'author','family_created',note,
        jsonb_build_object('title',f.title,'category',f.category,'visibility',f.visibility,'requestIds',to_jsonb(coalesce(p_request_ids,'{}'::uuid[]))),
        p_idempotency_key) returning * into e;
    return jsonb_build_object('familyId',f.id,'revisionId',r.id,'eventId',e.id,'version',f.version,'replayed',false);
  end if;

  select * into f from public.document_families where id=coalesce(p_family_id,
    (select family_id from public.document_revisions where id=p_revision_id)) for update;
  if f.id is null or not dao_private.document_family_readable(f.id) then
    raise exception using errcode='42501',message='document family access denied';
  end if;
  if exists(select 1 from public.projects where id=f.project_id and status='archived') then
    raise exception using errcode='23514',message='project is archived';
  end if;
  select * into cur from public.document_revisions where family_id=f.id order by revision_no desc limit 1;

  if p_action='add_revision' then
    if f.created_by<>me or not dao_private.project_member(f.project_id) then
      raise exception using errcode='42501',message='document family author required';
    end if;
    if p_expected_revision_id is null or p_expected_revision_id<>cur.id then
      raise exception using errcode='40001',message='a newer revision exists';
    end if;
    select * into d from public.documents where id=p_document_id for update;
    if d.id is null or d.owner_id<>me or d.project_id<>f.project_id then
      raise exception using errcode='42501',message='document owner required';
    end if;
    if d.status='rejected' or (d.share_scope='project_members' and f.visibility<>'project') then
      raise exception using errcode='23514',message='document is unavailable';
    end if;
    if exists(select 1 from public.document_revisions where document_id=d.id) then
      raise exception using errcode='23505',message='document is already versioned';
    end if;
    insert into public.document_revisions(family_id,project_id,document_id,revision_no,note,created_by)
      values(f.id,f.project_id,d.id,cur.revision_no+1,note,me) returning * into r;
    update public.document_families set version=version+1,updated_at=now() where id=f.id returning * into f;
    insert into public.document_dossier_events(family_id,revision_id,project_id,document_id,actor_id,actor_role,event_kind,note,payload,idempotency_key)
      values(f.id,r.id,f.project_id,d.id,me,'author','revision_added',note,
        jsonb_build_object('revisionNo',r.revision_no,'supersedes',cur.id),p_idempotency_key) returning * into e;
    return jsonb_build_object('familyId',f.id,'revisionId',r.id,'eventId',e.id,'version',f.version,'replayed',false);
  end if;

  if p_action='update_family' then
    if f.created_by<>me or not dao_private.project_member(f.project_id) then
      raise exception using errcode='42501',message='document family author required';
    end if;
    if p_expected_version is null or p_expected_version<>f.version then
      raise exception using errcode='40001',message='document family changed';
    end if;
    if nullif(btrim(coalesce(p_title,'')),'') is null or p_visibility is null then
      raise exception using errcode='22023',message='title and visibility required';
    end if;
    if p_visibility<>'project' and exists(select 1 from public.document_revisions x join public.documents y on y.id=x.document_id
      where x.family_id=f.id and y.share_scope='project_members') then
      raise exception using errcode='23514',message='a revision is already shared with project members';
    end if;
    perform dao_private.document_replace_lots(f,p_request_ids);
    update public.document_families set title=btrim(p_title),category=p_category,visibility=p_visibility,
      version=version+1,updated_at=now() where id=f.id returning * into f;
    insert into public.document_dossier_events(family_id,project_id,actor_id,actor_role,event_kind,payload,idempotency_key)
      values(f.id,f.project_id,me,'author','metadata_updated',
        jsonb_build_object('title',f.title,'category',f.category,'visibility',f.visibility,'requestIds',to_jsonb(coalesce(p_request_ids,'{}'::uuid[]))),
        p_idempotency_key) returning * into e;
    return jsonb_build_object('familyId',f.id,'eventId',e.id,'version',f.version,'replayed',false);
  end if;

  if p_action in ('start_review','observations','correction_requested','reviewed','comment') then
    select * into r from public.document_revisions where id=p_revision_id and family_id=f.id;
    if r.id is null then raise exception using errcode='42501',message='document revision access denied'; end if;
    role := case when dao_private.owner(f.project_id) then 'client'
      when dao_private.manages_project(f.project_id) then 'manager'
      when f.created_by=me then 'author' else 'participant' end;
    if p_action<>'comment' then
      if role not in ('client','manager') or r.created_by=me then
        raise exception using errcode='42501',message='technical review not allowed';
      end if;
      if r.id<>cur.id then raise exception using errcode='40001',message='revision has been superseded'; end if;
      if not exists(select 1 from public.documents where id=r.document_id and status='approved') then
        raise exception using errcode='23514',message='document file is not controlled yet';
      end if;
    end if;
    if p_action in ('observations','correction_requested','comment') and note is null then
      raise exception using errcode='22023',message='note required';
    end if;
    insert into public.document_dossier_events(family_id,revision_id,project_id,document_id,actor_id,actor_role,event_kind,note,payload,idempotency_key)
      values(f.id,r.id,f.project_id,r.document_id,me,role,p_action,note,
        jsonb_build_object('revisionNo',r.revision_no,'legalEffect',false),p_idempotency_key) returning * into e;
    return jsonb_build_object('familyId',f.id,'revisionId',r.id,'eventId',e.id,'version',f.version,'replayed',false);
  end if;

  raise exception using errcode='22023',message='unsupported document dossier action';
end;
$$;

-- File control (quarantine exit) by the assigned Gestionnaire or an Admin.
-- It only qualifies the uploaded file as readable; it is not a technical
-- review of its content and it has no legal or financial effect.
create function dao_private.document_file_control_v1(p_document_id uuid,p_decision text,p_reason text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  me uuid := auth.uid();
  d public.documents;
  r public.document_revisions;
  e public.document_dossier_events;
  reason text := nullif(btrim(coalesce(p_reason,'')),'');
begin
  if me is null or p_idempotency_key is null or length(p_idempotency_key) not between 8 and 100 then
    raise exception using errcode='22023',message='idempotency key required';
  end if;
  select * into e from public.document_dossier_events where actor_id=me and idempotency_key=p_idempotency_key;
  if e.id is not null then
    return jsonb_build_object('documentId',e.document_id,'eventId',e.id,'replayed',true);
  end if;
  select * into d from public.documents where id=p_document_id for update;
  if d.id is null or not dao_private.manages_project(d.project_id) then
    raise exception using errcode='42501',message='assigned manager required';
  end if;
  if p_decision not in ('approved','rejected') or (p_decision='rejected' and reason is null) then
    raise exception using errcode='22023',message='invalid file control decision';
  end if;
  if d.status<>'quarantined' then raise exception using errcode='40001',message='file control already decided'; end if;
  update public.documents set status=p_decision where id=d.id returning * into d;
  select * into r from public.document_revisions where document_id=d.id;
  insert into public.document_dossier_events(family_id,revision_id,project_id,document_id,actor_id,actor_role,event_kind,note,payload,idempotency_key)
    values(r.family_id,r.id,d.project_id,d.id,me,'manager',case when p_decision='approved' then 'file_approved' else 'file_rejected' end,
      reason,jsonb_build_object('legalEffect',false),p_idempotency_key) returning * into e;
  insert into public.audit_events(actor_id,action,entity_type,entity_id,metadata)
    values(me,'document_file_'||p_decision,'document',d.id,jsonb_build_object('project_id',d.project_id));
  return jsonb_build_object('documentId',d.id,'status',d.status,'eventId',e.id,'replayed',false);
end;
$$;

create function dao_private.document_review_status(p_revision_id uuid,p_current uuid)
returns text language sql stable security definer set search_path='' as $$
  select case when p_revision_id<>p_current then 'superseded' else coalesce((
    select case e.event_kind when 'start_review' then 'in_review' when 'reviewed' then 'reviewed' else 'observations' end
    from public.document_dossier_events e
    where e.revision_id=p_revision_id and e.event_kind in ('start_review','observations','correction_requested','reviewed')
    order by e.created_at desc,e.id desc limit 1),'to_review') end;
$$;

-- Read model. Filtering is server-side: an Artisan who only holds a lot sees
-- only the families attached to the lots they hold, never the whole project.
create function dao_private.document_dossier_v1(p_project_id uuid,p_request_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  me uuid := auth.uid();
  is_owner boolean := dao_private.owner(p_project_id);
  is_manager boolean := dao_private.manages_project(p_project_id);
  is_member boolean := dao_private.project_member(p_project_id);
  held uuid[];
begin
  if me is null or not dao_private.account_active(me) then
    raise exception using errcode='42501',message='authentication required';
  end if;
  select coalesce(array_agg(r.id order by r.created_at),'{}') into held from public.project_requests r
    where r.project_id=p_project_id and r.status<>'withdrawn' and dao_private.document_lot_holder(r.id);
  if not (is_owner or is_manager or is_member or cardinality(held)>0) then
    raise exception using errcode='42501',message='project access denied';
  end if;
  if p_request_id is not null and not exists(select 1 from public.project_requests r
    where r.id=p_request_id and r.project_id=p_project_id and (is_owner or is_manager or is_member or r.id=any(held))) then
    raise exception using errcode='42501',message='lot access denied';
  end if;
  return jsonb_build_object(
    'projectId',p_project_id,
    'requestId',p_request_id,
    'actor',jsonb_build_object('isClient',is_owner,'isManager',is_manager,'isMember',is_member,
      'heldRequestIds',to_jsonb(held),'canControlFiles',is_manager,'canReview',is_owner or is_manager),
    'lots',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'title',dao_private.document_lot_title(r.id),'status',r.status) order by r.created_at,r.id)
      from public.project_requests r where r.project_id=p_project_id and r.status<>'withdrawn'
        and (is_owner or is_manager or is_member or r.id=any(held))),'[]'::jsonb),
    'families',coalesce((select jsonb_agg(fam order by (fam->>'updatedAt') desc,fam->>'id') from (
      select jsonb_build_object(
        'id',f.id,'title',f.title,'category',f.category,'visibility',f.visibility,'version',f.version,
        'createdAt',f.created_at,'updatedAt',f.updated_at,'createdBy',f.created_by,
        'createdByName',(select p.display_name from public.profiles p where p.user_id=f.created_by),
        'isMine',f.created_by=me,
        'canAddRevision',f.created_by=me and is_member,
        'currentRevisionId',cur.id,'currentRevisionNo',cur.revision_no,
        'lots',coalesce((select jsonb_agg(jsonb_build_object('requestId',l.request_id,'title',dao_private.document_lot_title(l.request_id)) order by l.created_at)
          from public.document_family_lots l where l.family_id=f.id and l.revoked_at is null
            and (is_owner or is_manager or is_member or l.request_id=any(held))),'[]'::jsonb),
        'revisions',coalesce((select jsonb_agg(jsonb_build_object(
            'id',r.id,'revisionNo',r.revision_no,'note',r.note,'createdAt',r.created_at,'createdBy',r.created_by,
            'createdByName',(select p.display_name from public.profiles p where p.user_id=r.created_by),
            'isCurrent',r.id=cur.id,
            'reviewStatus',dao_private.document_review_status(r.id,cur.id),
            'correctionRequested',exists(select 1 from public.document_dossier_events x where x.revision_id=r.id and x.event_kind='correction_requested'),
            'document',case when d.owner_id=me or is_manager or d.status='approved' then jsonb_build_object(
              'id',d.id,'originalName',d.original_name,'mimeType',d.mime_type,'sizeBytes',d.size_bytes,'status',d.status) else null end,
            'fileStatus',d.status
          ) order by r.revision_no desc)
          from public.document_revisions r join public.documents d on d.id=r.document_id where r.family_id=f.id),'[]'::jsonb),
        'events',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'createdAt',x.created_at,'revisionId',x.revision_id,
            'actorRole',x.actor_role,'actorName',(select p.display_name from public.profiles p where p.user_id=x.actor_id),
            'kind',x.event_kind,'note',x.note) order by x.created_at desc,x.id desc)
          from (select * from public.document_dossier_events y where y.family_id=f.id order by y.created_at desc,y.id desc limit 50) x),'[]'::jsonb)
      ) fam
      from public.document_families f
      join lateral (select * from public.document_revisions c where c.family_id=f.id order by c.revision_no desc limit 1) cur on true
      where f.project_id=p_project_id and dao_private.document_family_readable(f.id)
        and (p_request_id is null or exists(select 1 from public.document_family_lots l
          where l.family_id=f.id and l.request_id=p_request_id and l.revoked_at is null))
        and (is_owner or is_manager or is_member or exists(select 1 from public.document_family_lots l
          where l.family_id=f.id and l.revoked_at is null and l.request_id=any(held)))
    ) s),'[]'::jsonb));
end;
$$;

create function public.document_dossier_v1(p_project_id uuid,p_request_id uuid)
returns jsonb language sql security invoker set search_path='' as $$ select dao_private.document_dossier_v1($1,$2); $$;
create function public.document_dossier_command_v1(
  p_action text,p_project_id uuid,p_family_id uuid,p_document_id uuid,p_revision_id uuid,
  p_title text,p_category text,p_visibility text,p_request_ids uuid[],p_note text,
  p_expected_version integer,p_expected_revision_id uuid,p_idempotency_key text
) returns jsonb language sql security invoker set search_path='' as $$
  select dao_private.document_dossier_command_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13);
$$;
create function public.document_file_control_v1(p_document_id uuid,p_decision text,p_reason text,p_idempotency_key text)
returns jsonb language sql security invoker set search_path='' as $$ select dao_private.document_file_control_v1($1,$2,$3,$4); $$;

revoke all on function dao_private.document_lot_holder(uuid),dao_private.document_family_readable(uuid),
  dao_private.document_readable_in_family(uuid),dao_private.document_dossier_immutable(),
  dao_private.document_family_lot_guard(),dao_private.document_family_guard(),dao_private.document_lot_title(uuid),
  dao_private.document_replace_lots(public.document_families,uuid[]),
  dao_private.document_dossier_command_v1(text,uuid,uuid,uuid,uuid,text,text,text,uuid[],text,integer,uuid,text),
  dao_private.document_file_control_v1(uuid,text,text,text),dao_private.document_review_status(uuid,uuid),
  dao_private.document_dossier_v1(uuid,uuid),
  public.document_dossier_v1(uuid,uuid),
  public.document_dossier_command_v1(text,uuid,uuid,uuid,uuid,text,text,text,uuid[],text,integer,uuid,text),
  public.document_file_control_v1(uuid,text,text,text)
  from public,anon,authenticated;
grant execute on function dao_private.document_lot_holder(uuid),dao_private.document_family_readable(uuid),
  dao_private.document_readable_in_family(uuid),
  dao_private.document_dossier_command_v1(text,uuid,uuid,uuid,uuid,text,text,text,uuid[],text,integer,uuid,text),
  dao_private.document_file_control_v1(uuid,text,text,text),
  dao_private.document_dossier_v1(uuid,uuid) to authenticated,service_role;
grant execute on function public.document_dossier_v1(uuid,uuid),
  public.document_dossier_command_v1(text,uuid,uuid,uuid,uuid,text,text,text,uuid[],text,integer,uuid,text),
  public.document_file_control_v1(uuid,text,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
